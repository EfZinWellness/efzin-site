# Ef Zin Phase 1, Tasks 8–18 (Revision 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish Phase 1 on top of completed Tasks 1–7: booking and checkout with **gift cards, deposits and monthly payment plans** (spec rev 2), the Stripe webhook lifecycle, gift card purchase, member accounts, emails and scheduled jobs, self-service cancel/transfer/credit, the admin view, the Squarespace import and launch.

**Architecture:** Same as the original plan. Pure logic for schedules, discount allocation and refund splitting lives in `lib/payments` and `lib/giftcards` (no I/O, exhaustively unit-tested). Postgres functions guard money and capacity races (`create_hold`, `reserve_gift_card`). Stripe Checkout takes the first payment and saves the card; later payments are Stripe Invoices charged to the saved card by a daily job; webhooks are the only thing that confirms money.

**Tech Stack:** As built so far (Node 24, Next.js 16 App Router, TS strict, Tailwind 4, Supabase Postgres via `pg` pool, PGlite tests, Vitest, Playwright), plus `stripe`, `@supabase/supabase-js` + `@supabase/ssr` (auth only), `resend`, `@react-email/components`, `@react-pdf/renderer`.

**Spec:** `docs/superpowers/specs/2026-10-07-efzin-phase1-website-design.md` (revision 2, approved by Tanya 2026-10-07)

**Supersedes:** Tasks 8–15 of `docs/superpowers/plans/2026-10-07-efzin-phase1-website.md`. Tasks 0–7 of that plan are complete.

## Global Constraints

Everything in the original plan's Global Constraints still applies. In addition, and overriding where they conflict:

- Existing interfaces to reuse, not re-create: `SqlClient` (lib/content/sync.ts), `getPool()` (lib/db/pool.ts or lib/booking/availability.ts), `upsertPersonByEmail` (lib/people/upsert.ts), `sendEmail`/`EmailKind`/`setEmailTransport` (lib/email/send.ts), `cancelOptions`/`creditExpiry`/`isCreditUsable` (lib/policy), `estimateLocal`/`formatMoney`/`getUsdRates` (lib/pricing), `loadExperience(s)`/`effectiveStatus` (lib/content), throttle pattern (lib/requests/throttle.ts).
- Migrations are numbered with the next free number at the time of the task (0001–0005 exist).
- Retreat deposit default **20%**; balance due **10 days before arrival**; `max_instalments` default **4**.
- Monthly payments fall on the booking's day of month, clamped to the month's last day; count = min(max_instalments, whole months between booking date and balance due date); equal amounts with the rounding remainder on the **final** payment; monthly option hidden if fewer than 2 fit; only "Pay in full" if the balance due date has passed.
- Deposit is charged in the guest's local currency (Adaptive Pricing); every later payment is charged in the experience's **base currency**, and the checkout screen says so.
- Gift card codes: `EFZG-XXXX-XXXX` from alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I). Credit codes stay `EFZ-` + 6.
- Gift card values: AED 250 / 500 / 1,000 / 2,500 or custom AED 100–10,000; message ≤ 300 chars; delivery today or up to 12 months ahead, emailed at **08:00 Asia/Dubai**; bulk quantity ≤ 50 (codes + CSV to buyer only); valid **12 months from purchase**; reminder 30 days before expiry; refundable within 14 days only if completely unused (via Stripe dashboard → `charge.refunded`).
- Gift card balance **always equals the sum of `gift_card_ledger`** (reasons: `issue`, `redeem`, `refund_return`, `expiry`, `void`).
- Gift card applied to the earliest payment first (the deposit), excess to later payments in order; one gift card + one credit per booking; gift cards cannot buy gift cards.
- Wrong gift/credit code attempts: ≤ 10 per hour per IP; on hitting the limit, log and email Tanya once per IP per hour.
- Payment plan cancellation stops all future payments; **Ef Zin never charges outstanding payments after a cancellation**.
- Money back on a booking paid partly by gift card: gift part returned to the gift card first (expired card → issued as 12-month credit instead), remainder to the card; choosing credit turns the whole paid amount into credit; Ef Zin cancellation returns the gift part to the card and refunds card payments in full.
- `metadata.kind` on every Stripe Checkout Session / Invoice we create: `booking` | `pay_rest` | `update_card` | `gift_purchase` | `scheduled_payment`.

## Review Focus

1. **Month-end booking dates** (booked 31 Jan) must schedule 28/29 Feb, 31 Mar…, never skip or duplicate a month. Test: Task 8 `clamps monthly dates to month end`.
2. **Same gift card used on two devices at once** must never spend more than the balance. Test: Task 9 `reserve_gift_card refuses beyond available balance`.
3. **Gift card covers the deposit but not the later payments** must still save a card (Checkout `mode: 'setup'`), and covering everything must skip Stripe entirely. Test: Task 10 `uses setup mode when first payment is zero` and `confirms directly when fully covered`.
4. **A scheduled invoice paid or failing after the booking was cancelled** must not revive the booking or email a payment-failed notice. Test: Task 11 `ignores invoice events for cancelled bookings`.
5. **EUR retreat paid with an AED gift card** must convert at the day's rate without overspending the card (floor on the base side, ceil on the AED debit). Test: Task 8 `converts AED gift value to EUR without overspending`.

---

## File Structure (new in rev 2)

```
lib/payments/schedule.ts      # balanceDueDate, availableOptions, buildSchedule (pure)
lib/payments/allocate.ts      # allocateDiscounts (pure)
lib/payments/refundSplit.ts   # splitMoneyBack (pure)
lib/pricing/convert.ts        # convertMinor (pure)
lib/giftcards/code.ts         # generateGiftCode, normaliseCode, isGiftCode (pure)
lib/giftcards/db.ts           # issue, reserve, redeem, release, void, expire (SQL)
lib/stripe/client.ts, checkout.ts, handlers.ts, invoices.ts, refund.ts, customers.ts
lib/booking/validate.ts, holds.ts, pending.ts, waitlist.ts, transfer.ts
lib/credits/db.ts
lib/email/templates/*.tsx, lib/email/pdf/GiftCardPdf.tsx
app/(site)/book/[slug]/..., app/(site)/gift/..., app/account/..., app/admin/...
app/api/checkout, app/api/gift/checkout, app/api/codes/check, app/api/stripe/webhook, app/api/cron/{daily,hourly,gift-delivery}
```

---

### Task 8: Payment schedule, discount allocation and gift codes (pure logic)

**Files:**
- Create: `lib/payments/schedule.ts`, `lib/payments/allocate.ts`, `lib/payments/refundSplit.ts`, `lib/pricing/convert.ts`, `lib/giftcards/code.ts`
- Test: `tests/unit/schedule.test.ts`, `tests/unit/allocate.test.ts`, `tests/unit/refund-split.test.ts`, `tests/unit/giftcode.test.ts`

**Interfaces:**
```ts
type PaymentOption = 'full' | 'deposit_balance' | 'instalments';
interface ScheduleItem { seq: number; dueOn: string /* YYYY-MM-DD in experience tz */; amountMinor: number; currency: 'AED' | 'EUR' }
interface ScheduleInput {
  option: PaymentOption; totalMinor: number; depositPct: number; currency: 'AED'|'EUR';
  bookedAt: Date; startsAt: Date; balanceDueDays: number; maxInstalments: number; timezone: string;
}
function balanceDueDate(startsAt: Date, balanceDueDays: number, timezone: string): string;
function availableOptions(i: Omit<ScheduleInput,'option'|'totalMinor'|'currency'|'depositPct'> & { allowed: PaymentOption[] }): PaymentOption[];
function buildSchedule(i: ScheduleInput): ScheduleItem[];   // seq 0 = today's payment

function convertMinor(amountMinor: number, from: string, to: string, usdRates: Record<string, number>, round: 'floor'|'ceil'|'round'): number; // AED peg 3.6725, exponent table from lib/pricing/currency.ts

interface AllocationInput { schedule: ScheduleItem[]; giftAvailableBaseMinor: number; creditAvailableBaseMinor: number }
interface Allocation { schedule: ScheduleItem[] /* amounts reduced, never negative */; giftUsedBaseMinor: number; creditUsedBaseMinor: number }
function allocateDiscounts(i: AllocationInput): Allocation;  // gift first then credit, each applied to seq 0 first, then in seq order

interface MoneyBackInput { moneyBackBaseMinor: number; giftAppliedBaseMinor: number; giftCardExpired: boolean }
function splitMoneyBack(i: MoneyBackInput): { toGiftCardBaseMinor: number; toCreditBaseMinor: number; toCardBaseMinor: number };

function generateGiftCode(randomBytes: (n: number) => Uint8Array): string; // EFZG-XXXX-XXXX
function normaliseCode(input: string): string;  // uppercase, strip spaces/dashes, re-insert dashes for EFZG and EFZ formats
function isGiftCode(code: string): boolean;
```
Rules:
- `balanceDueDate` = calendar date of `startsAt` in `timezone` minus `balanceDueDays` days.
- `full` → one item: total, today. `deposit_balance` → seq 0 deposit `round(total × depositPct / 100)`, seq 1 the rest on the balance due date. `instalments` → seq 0 deposit, then n monthly items (Global Constraints rule) on booking day-of-month clamped, k = 1..n.
- `availableOptions`: filter `allowed`; drop `deposit_balance` and `instalments` if today ≥ balance due date; drop `instalments` if n < 2. `full` always present.
- `splitMoneyBack`: gift part = min(moneyBack, giftApplied) → to gift card, or to credit if the card has expired; remainder → card.

- [ ] **Step 1: Write failing tests** (values from spec §6.3; total 240000 EUR, deposit 20%):
  - booked 2027-01-10, starts 2027-06-10 (Europe/Athens), max 4 → seq0 48000 on 2027-01-10, then 48000 on 2027-02-10, 03-10, 04-10, 05-10
  - booked 2027-02-10, same start → 3 × 64000 (03-10, 04-10, 05-10)
  - booked 2027-03-10 → 2 × 96000; booked 2027-04-25 → `availableOptions` excludes `instalments`, includes `deposit_balance`; booked 2027-06-05 → only `['full']`
  - `clamps monthly dates to month end`: booked 2027-01-31, starts 2027-07-15 → monthly dates 2027-02-28, 03-31, 04-30, 05-31
  - rounding: total 100000, deposit 20% = 20000, 3 instalments of 80000 → 26666, 26666, 26668
  - `deposit_balance`: seq1 due on 2027-05-31 for start 2027-06-10
  - `converts AED gift value to EUR without overspending`: `convertMinor(50000,'AED','EUR',{EUR:0.92},'floor')` → `12525` and back `convertMinor(12525,'EUR','AED',{EUR:0.92},'ceil')` ≤ `50000`
  - allocate: gift 60000 on schedule [48000, 48000…] → [0, 36000, 48000…], giftUsed 60000; gift + credit together; gift larger than total → all zero, giftUsed = total
  - splitMoneyBack: moneyBack 50000, giftApplied 30000 → gift 30000, card 20000; expired card → credit 30000, card 20000
  - gift code: format regex `^EFZG-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$`; `normaliseCode(' efzg abcd 2345 ')` → `EFZG-ABCD-2345`; `normaliseCode('efz-ab12cd')` → `EFZ-AB12CD`
- [ ] **Step 2:** `npx vitest run tests/unit/schedule.test.ts tests/unit/allocate.test.ts tests/unit/refund-split.test.ts tests/unit/giftcode.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run → PASS; then `npm test`.
- [ ] **Step 5: Commit** `feat: payment schedules, discount allocation, gift codes`.

---

### Task 9: Rev 2 schema, gift card and credit data layer

**Files:**
- Create: `supabase/migrations/0006_rev2_payments_giftcards.sql`, `lib/giftcards/db.ts`, `lib/credits/db.ts`
- Modify: `lib/db/types.ts`, `lib/content/schema.ts`, `lib/content/sync.ts`, content/experiences/reform-athletica-retreat.yaml
- Test: `tests/db/giftcards.test.ts`, `tests/db/credits.test.ts`, `tests/unit/content.test.ts`

**Interfaces:**
- Migration adds tables exactly as spec §6.4 (`gift_cards`, `gift_card_ledger`, `payment_schedule_items`) plus:
  - `gift_card_reservations(id, gift_card_id, pending_booking_id, amount_aed_minor, expires_at, released_at)`
  - `pending_bookings(id uuid pk, kind text, payload jsonb, hold_ids uuid[], reservation_ids uuid[], checkout_session_id text unique, created_at)`
  - `gift_card_batches(id, buyer_person_id, quantity, created_at)`
  - columns: `experiences.payment_options text[] not null default '{full}'`, `experiences.max_instalments int not null default 4`; `bookings.payment_option`, `bookings.total_price_minor`, `bookings.gift_card_id`, `bookings.gift_card_applied_aed_minor int not null default 0`, `bookings.credit_applied_aed_minor int not null default 0`, `bookings.schedule_consent_at`; `people.stripe_customer_id text unique`
  - ledger `reason` check: issue, redeem, refund_return, expiry, void
  - RLS: members read own gift cards (buyer or recipient person), own schedule items (via booking); nothing else new is member-readable
- SQL functions:
  - `gift_card_available(p_card uuid) returns int` = ledger sum − unreleased, unexpired reservations
  - `reserve_gift_card(p_code text, p_amount int, p_pending uuid, p_expires_at timestamptz) returns uuid`. Locks the card row `for update`; raises `GIFT_INVALID` (unknown/void/pending), `GIFT_EXPIRED`, `GIFT_INSUFFICIENT`
- `lib/giftcards/db.ts` (all take `SqlClient`): `issueGiftCards(db, {count, initialAedMinor, buyerPersonId, recipient?, message?, suggestedExperienceId?, deliverOn, batchId?, paymentRef}) → {id, code}[]` (status `pending_payment`, no ledger yet); `activateGiftCards(db, stripePaymentIntent)` (status active + ledger `issue`); `reserveGiftCard(...)`; `redeemReservation(db, reservationId, bookingId)` (ledger `redeem`, reservation released, sets `recipient_person_id` on first use); `releaseReservation(db, reservationId)`; `returnToGiftCard(db, cardId, bookingId, aedMinor)` (ledger `refund_return`); `voidIfUnused(db, stripePaymentIntent) → 'voided' | 'partly_used'`; `expireGiftCards(db, now) → number`; `getGiftBalance(db, codeOrId)`.
- `lib/credits/db.ts`: `issueCredit(db, personId, amountAedMinor, sourceBookingId, now) → {id, code}` (code `EFZ-` + 6 from the gift alphabet, expiry via `creditExpiry`), `findUsableCredit(db, code, now)`, `redeemCredit(db, creditId, bookingId, usedAedMinor, now)` (leftover → new credit row with the same `expires_at`).
- Content schema: `paymentOptions?: PaymentOption[]` (default retreats `['full','deposit_balance','instalments']`, events `['full']`), `maxInstalments?` (default 4), `depositPct` default 20 for retreats; sync writes `payment_options`, `max_instalments`.

- [ ] **Step 1: Write failing tests:** issue → pending card has balance 0 and can't be reserved (`GIFT_INVALID`); activate → balance = initial; `reserve_gift_card refuses beyond available balance` (reserve 30000 of 50000, then 30000 again → `GIFT_INSUFFICIENT`); expired reservation no longer counts; redeem writes a negative ledger row and balance = ledger sum; `returnToGiftCard` restores balance; `voidIfUnused` voids unused and reports `partly_used` otherwise; `expireGiftCards` zeroes balance with an `expiry` ledger row; credit issue/redeem with leftover keeps the original expiry; RLS: member A sees cards where they are buyer or recipient only; content defaults per type.
- [ ] **Step 2:** `npx vitest run tests/db/giftcards.test.ts tests/db/credits.test.ts tests/unit/content.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run → PASS; then `npm test`.
- [ ] **Step 5: Commit** `feat: rev 2 schema, gift card and credit data layer`.

---

### Task 10: Booking form and checkout

**Files:**
- Create: `app/(site)/book/[slug]/page.tsx`, `components/BookingForm.tsx`, `components/ScheduleTable.tsx`, `lib/booking/validate.ts`, `lib/booking/pending.ts`, `lib/stripe/client.ts`, `lib/stripe/customers.ts`, `lib/stripe/checkout.ts`, `app/api/checkout/route.ts`, `app/api/codes/check/route.ts`
- Test: `tests/unit/booking-validate.test.ts`, `tests/db/checkout.test.ts`, `tests/e2e/booking-form.spec.ts`

**Interfaces:**
```ts
interface BookingRequest {
  slug: string;
  lines: { ticketKey: string; qty: number }[];
  booker: { name: string; email: string; phone: string; howHeard?: string };
  guests: { name: string; email: string; phone?: string; ticketKey: string }[];
  paymentOption: PaymentOption;
  giftCode?: string; creditCode?: string;
  policyAccepted: true; scheduleConsent?: true;   // scheduleConsent required unless option is 'full'
  website?: string;                                // honeypot
}
function validateBooking(req: unknown, exp: Experience, now: Date): { ok: true; value: BookingRequest } | { ok: false; errors: string[] };
function startCheckout(req: BookingRequest, deps: { db: SqlClient; stripe: Stripe; now: Date; usdRates: Record<string,number>; origin: string }):
  Promise<{ kind: 'redirect'; url: string } | { kind: 'confirmed'; bookingId: string }>;
function ensureStripeCustomer(db, stripe, personId): Promise<string>;   // stores people.stripe_customer_id
```
- validate: experience `effectiveStatus === 'on_sale'` and `endsAt > now`; total qty = 1 + guests.length; ticket keys exist; emails lowercased; **rejects duplicate guest emails** (including the booker's); option ∈ `availableOptions(...)`; `scheduleConsent` required for non-full options; honeypot empty.
- startCheckout, in one DB transaction up to the Stripe call: upsert booker person; `create_hold` per line (expires now + 31 min; `SOLD_OUT` → `SoldOutError`); `buildSchedule`; reserve gift card (`reserve_gift_card`, amount = min(card available, total converted to AED, ceil)) and validate credit; `allocateDiscounts`; insert `pending_bookings` (payload includes schedule, allocation, policy snapshot via `policyCopy` + template).
  - all amounts zero → call the Task 11 confirmation path directly (`confirmPendingBooking`) and return `{kind:'confirmed'}`
  - seq 0 amount zero but later items > 0 → Checkout `mode: 'setup'` with the customer (`uses setup mode when first payment is zero`)
  - otherwise Checkout `mode: 'payment'`, one line item "{title} — {option label}" for the seq 0 amount in base currency, `customer` (via `ensureStripeCustomer`) when option ≠ full with `payment_intent_data.setup_future_usage: 'off_session'`, `expires_at`, `after_expiration.recovery.enabled: true`, `metadata: { kind: 'booking', pending_booking_id }`, success URL `/book/[slug]/confirmed?session={CHECKOUT_SESSION_ID}`
- `POST /api/codes/check` `{code, slug}` → `{valid, kind: 'gift'|'credit', availableAed, availableBase}`; wrong attempts throttled per Global Constraints (429 after 10/hour/IP; email Tanya once per IP per hour via `sendEmail('admin_error', …)`).
- `POST /api/checkout` → 409 `{error:'sold_out'}`, 409 `{error:'gift_insufficient'}`, 400 on validation, else the result. Body cap 32 KB, same throttle style as `/api/requests`.
- BookingForm: mockup screen 2 + payment option picker; non-full options render `ScheduleTable` (dates, amounts, base currency, line "Later payments are charged in {currency}; your bank converts") and the consent checkbox "Ef Zin will charge this card on these dates"; code field validates via `/api/codes/check`.

- [ ] **Step 1: Write failing tests:** validation cases incl. `rejects duplicate guest emails`, ended experience rejected, instalments rejected when unavailable, consent required; DB (PGlite + fake Stripe): holds created per qty; `SoldOutError` creates no Stripe session and no pending row; deposit option → Stripe called with seq 0 amount 48000 and `setup_future_usage`; `uses setup mode when first payment is zero`; `confirms directly when fully covered` (gift ≥ total → no Stripe call, booking row exists); code check throttles the 11th wrong attempt. E2E (375px): option picker shows the schedule for the retreat fixture, consent checkbox required.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run → PASS; `npm test`, `npm run test:e2e`.
- [ ] **Step 5: Commit** `feat: booking form and checkout with payment plans and codes`.

---

### Task 11: Stripe webhook lifecycle

**Files:**
- Create: `app/api/stripe/webhook/route.ts`, `lib/stripe/handlers.ts`, `lib/booking/confirm.ts`, `lib/auth/provision.ts`, `lib/stripe/invoices.ts`
- Test: `tests/db/webhook.test.ts`

**Interfaces:**
- `confirmPendingBooking(db, pendingId, payment: { amountPaidMinor; presentmentCurrency; paymentIntentId?; paymentMethodId? } | null): Promise<string /*bookingId*/>`: creates `bookings` (status `paid` if no remaining schedule items else `deposit_paid`; `amount_paid_base_minor` = seq 0 + discounts; `amount_aed_minor`; gift/credit applied amounts; `schedule_consent_at`; policy snapshot), `booking_guests` (booker `is_booker`), `payment_schedule_items` (seq 0 `paid`, others `scheduled`), redeems gift reservation and credit, releases holds, upserts all guest people, provisions auth users (`ensureAuthUser(email) → { claimLink }`), and queues emails `booking_confirmed` (includes the schedule), `guest_added`, `admin_new_booking`. Idempotent on `pendingId`.
- `handleStripeEvent(evt, deps)`: inserts `stripe_events.id` first and returns early on repeat. Dispatch by `metadata.kind`:
  - `checkout.session.completed`: `booking` → confirm (and, for setup mode, store the saved payment method as the customer's default); `gift_purchase` → `activateGiftCards` + send gift emails (Task 12); `pay_rest` → mark all remaining items `paid`, void their open invoices, booking `paid`; `update_card` → set customer default payment method and update any open invoices' payment method.
  - `checkout.session.expired`: release holds and gift reservations unless already confirmed; send `abandoned_checkout` with the recovery URL (once).
  - `invoice.paid` (`scheduled_payment`): item `paid`, booking `paid` when none remain, email `scheduled_payment_receipt`.
  - `invoice.payment_failed` (`scheduled_payment`): item `failed`, `attempts`+1, email booker `scheduled_payment_failed` (with `hosted_invoice_url` and the balance due date) and Tanya.
  - `charge.refunded`: booking payment → booking `refunded` when fully refunded; gift purchase → `voidIfUnused`, and if `partly_used` email Tanya.
- `ignores invoice events for cancelled bookings`: invoice events for a booking whose status is `cancelled`/`refunded`/`credited` change nothing and send nothing.
- Route verifies the signature with `STRIPE_WEBHOOK_SECRET`; 400 on a bad signature; errors go through `reportError` (Task 14; until then `sendEmail('admin_error', …)`).
- `lib/stripe/invoices.ts`: `chargeScheduledItem(db, stripe, itemId)` creates an invoice item + invoice in base currency for the customer, `collection_method: 'charge_automatically'`, `default_payment_method` = customer default, `metadata: { kind: 'scheduled_payment', item_id, booking_id }`, finalises and pays; stores `stripe_invoice_id`. Skips items whose booking isn't `deposit_paid`.

- [ ] **Step 1: Write failing tests** (PGlite + fake events + stubbed email/auth/stripe): completed booking → 1 booking, 2 guests, 2 people, schedule items (1 paid, 4 scheduled), holds released, gift ledger `redeem` row, emails queued; same event twice → 1 booking; expired after completed → nothing released, no abandoned email; `invoice.paid` on the last item → booking `paid`; `invoice.payment_failed` → item `failed`, two emails; `ignores invoice events for cancelled bookings`; gift purchase refund → `voided`, partly used → Tanya emailed; `chargeScheduledItem` skips a cancelled booking.
- [ ] **Step 2:** `npx vitest run tests/db/webhook.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Local check: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
- [ ] **Step 4:** Run → PASS; `npm test`.
- [ ] **Step 5: Commit** `feat: Stripe webhook booking, payment plan and gift lifecycle`.

---

### Task 12: Gift card purchase and delivery

**Files:**
- Create: `app/(site)/gift/page.tsx`, `app/(site)/gift/balance/page.tsx`, `components/GiftForm.tsx`, `app/api/gift/checkout/route.ts`, `lib/giftcards/purchase.ts`, `lib/giftcards/deliver.ts`, `lib/email/pdf/GiftCardPdf.tsx`, `lib/giftcards/csv.ts`
- Modify: `components/Footer.tsx`, `components/BookPanel.tsx`, `app/(site)/now/page.tsx`, `components/ExperienceDetail.tsx` (add "Give this as a gift" → `/gift?for=<slug>`)
- Test: `tests/unit/gift-purchase.test.ts`, `tests/db/gift-deliver.test.ts`, `tests/e2e/gift.spec.ts`

**Interfaces:**
- `GiftPurchaseSchema`: `amountAedMinor` ∈ {25000, 50000, 100000, 250000} or 10000–1000000; `quantity` 1–50; for quantity 1: `sendTo: 'recipient' | 'me'`, recipient name/email required when `recipient`, `message` ≤ 300, `deliverOn` today..today+12 months (Dubai date); `suggestedSlug?`; buyer name/email; honeypot.
- `startGiftCheckout(input, deps) → { url }`: upsert buyer; `issueGiftCards` (pending); Checkout `mode: 'payment'`, AED line item × quantity, `metadata: { kind: 'gift_purchase', batch_id }`; `discounts` not allowed (gift cards can't buy gift cards).
- `deliverDueGiftCards(db, now) → number`: active, `deliver_on ≤ today (Dubai)`, `delivered_at` null, recipient email present → send `gift_card_delivered` (with PDF from `GiftCardPdf`, value in AED + "≈" estimate for the recipient's currency where known) and `gift_card_delivered_buyer`, set `delivered_at`. Bulk → one `gift_card_bought` email to the buyer with all codes and a CSV attachment (`code,value_aed,expires_on`). Delivery-today cards are sent immediately from the webhook via the same function.
- `/gift/balance`: code → balance and expiry (rate limited like `/api/codes/check`).

- [ ] **Step 1: Write failing tests:** schema accepts preset/custom values and rejects 9999 and 1000001, quantity 51, message 301, a date 13 months out; `startGiftCheckout` issues `quantity` pending cards and passes the AED amount; `deliverDueGiftCards` sends only due cards once (re-run sends nothing), bulk sends one email with a CSV; e2e: /gift shows the four presets, "Give this as a gift" link on an event page, footer link to /gift.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** (direction A styling; the card design uses the fζ mark and navy/ivory).
- [ ] **Step 4:** Run → PASS; `npm test`, `npm run test:e2e`.
- [ ] **Step 5: Commit** `feat: gift card purchase and delivery`.

---

### Task 13: Auth and My Ef Zin

**Files:**
- Create: `lib/db/supabase-server.ts`, `lib/db/supabase-browser.ts`, `middleware.ts` (or `proxy.ts` per Next 16 convention), `app/account/signin/page.tsx`, `app/account/page.tsx`, `app/account/profile/page.tsx`, `app/account/health/page.tsx`, `app/account/bookings/[id]/page.tsx`, `app/account/gift-cards/page.tsx`, `app/(site)/book/[slug]/confirmed/page.tsx`, `lib/stripe/selfServe.ts`
- Test: `tests/e2e/account.spec.ts`, `tests/unit/self-serve.test.ts`

**Interfaces:**
- Sign-in: Supabase email link + Google. `/account/*` requires a session.
- Account home: upcoming and past bookings, credit balance with codes and expiry, gift cards bought and received with balances (re-send code button → `gift_card_delivered` to the signed-in holder only), guests on my bookings with `details_complete`.
- Health page: as original plan Task 10 (explicit consent checkbox required; waiver `v1` from `content/pages/waiver.mdx`; saving both sets `details_complete` on upcoming `booking_guests`); "Request deletion of my data" → `requests` type `deletion` + email Tanya.
- Booking page: schedule (paid / upcoming / failed) with **Pay the rest now** → `startPayRest(bookingId, personId) → {url}` (Checkout payment for the sum of unpaid items, base currency, `metadata.kind = 'pay_rest'`) and **Update card** → `startUpdateCard(personId) → {url}` (Checkout `mode: 'setup'`, `metadata.kind = 'update_card'`). Both only for the booker.
- Confirmed page polls by session id (≤ 20 s) before "You're in, {first name}." and shows the health/waiver task and pending guests.

- [ ] **Step 1: Write failing tests:** unit: `startPayRest` sums only unpaid items and refuses a non-booker or a cancelled booking; `startUpdateCard` creates a setup session for the person's customer. E2E: unauthenticated `/account` → sign-in; seeded session sees a booking with its schedule; health save without consent errors; confirmed page shows "You're in".
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run → PASS; `npm test`, `npm run test:e2e`.
- [ ] **Step 5: Commit** `feat: member accounts with schedules and gift cards`.

---

### Task 14: Email templates and scheduled jobs

**Files:**
- Create: `lib/email/templates/*.tsx` (one per kind), `lib/email/ics.ts`, `lib/email/log.ts`, `lib/errors/report.ts`, `app/api/cron/daily/route.ts`, `app/api/cron/hourly/route.ts`, `app/api/cron/gift-delivery/route.ts`, migration `00NN_email_log.sql`, `vercel.json`
- Modify: `lib/email/send.ts` (render templates, `email_log` dedupe, extend `EmailKind`)
- Test: `tests/unit/email.test.ts`, `tests/db/cron.test.ts`

**Interfaces:**
- `EmailKind` adds: `scheduled_payment_upcoming`, `scheduled_payment_receipt`, `scheduled_payment_failed`, `admin_payment_failed`, `gift_card_bought`, `gift_card_delivered`, `gift_card_delivered_buyer`, `gift_card_used`, `gift_card_expiring`, `booking_cancelled_unpaid`.
- `email_log(kind, to, ref, sent_at)` unique `(kind, to, ref)`; `sendEmail` skips if already sent.
- `reportError(err, context)`: logs and sends `admin_error` at most once per context per hour.
- Cron (`Authorization: Bearer ${CRON_SECRET}`):
  - **daily 06:00 Dubai** (`0 2 * * *`): details_reminder (3 days before, incomplete), day_before, day_after, `scheduled_payment_upcoming` (3 days before each scheduled item), **charge due items** via `chargeScheduledItem` (due today, status scheduled/failed, booking `deposit_paid`), **cancel unpaid at balance due date** (booking still `deposit_paid` after its balance due date → status `cancelled`, future items `cancelled`, open invoices voided, refund per policy on amounts paid, `booking_cancelled_unpaid` to booker + Tanya), `credit_expiring` and `gift_card_expiring` (30 days before), `expireGiftCards`.
  - **gift delivery 08:00 Dubai** (`0 4 * * *`): `deliverDueGiftCards`.
  - **hourly** (`0 * * * *`): release holds and gift reservations expired > 5 min ago.
- Every template: wordmark logo, ivory/navy, plain-text fallback; `booking_confirmed` includes the schedule table and policy text.

- [ ] **Step 1: Write failing tests:** each template renders its key copy; ICS has DTSTART in UTC; cron selects exactly the due rows (seed items due today, in 3 days, already paid, on a cancelled booking); a second run sends nothing (`email_log`); unpaid-at-due-date booking becomes `cancelled` with no further charges.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run → PASS; `npm test`.
- [ ] **Step 5: Commit** `feat: email templates and scheduled jobs`.

---

### Task 15: Self-service cancel, transfer, credit and waitlist

**Files:**
- Create: `app/account/bookings/[id]/actions.ts`, `lib/stripe/refund.ts`, `lib/booking/cancel.ts`, `lib/booking/transfer.ts`, `lib/booking/waitlist.ts`, `app/(site)/waitlist/[slug]/page.tsx`, `scripts/cancel-experience.ts`
- Test: `tests/db/self-service.test.ts`

**Interfaces:**
- `previewCancellation(db, bookingId, choice: 'refund'|'credit', now) → { options: CancelOption[]; toGiftCardAed; toCreditAed; toCardByCharge: {chargeId, amountMinor, currency}[]; feesDeductedMinor }` — same maths as `cancelBooking`.
- `cancelBooking(db, stripe, bookingId, choice, cancelledBy: 'guest'|'efzin', now)`: uses `cancelOptions` with base amounts actually paid (incl. gift and credit); money back split by `splitMoneyBack`; card part refunded across the booking's charges newest first, each `round(chargeAmount × share)` minus that charge's Stripe fee when `deductFees` (fee converted to the charge currency via `balance_transaction.exchange_rate`), floored at 0; gift part → `returnToGiftCard` (or credit if expired); credit choice → `issueCredit` for the whole paid amount in AED; future schedule items `cancelled`, open invoices voided, **no further charges**; status `refunded`/`credited`/`cancelled`; spots free; `notifyWaitlist`.
- `transferSpot(db, bookingGuestId, newGuest, now)` only when `transfer` is allowed; swaps the person, resets `details_complete`, emails `guest_added`.
- `joinWaitlist`, `notifyWaitlist` as original plan Task 12.
- `scripts/cancel-experience.ts <slug> --dry-run|--send`: Ef Zin cancellation for every booking (`cancelledBy: 'efzin'`), dry run renders the guest email to a file for Tanya's approval and calls no Stripe API.

- [ ] **Step 1: Write failing tests:** event 3 days out, refund → card refund `amount − fee`; credit choice → credit = `amount_aed_minor` + gift applied, 12-month expiry; event at 1 day → refund absent; retreat at 45 days on a plan with deposit 48000 + one 48000 instalment paid of 240000 total → no money back (paid 96000 < 120000), future items cancelled, nothing charged; retreat at 70 days paid 96000 incl. 30000 gift → 30000 back to gift card, 66000 − fees to card; expired gift card → that part becomes credit; Ef Zin cancel → gift part to card, card refund in full with no fee; transfer 1h before an event rejected; cancel notifies the waitlist; `cancel-experience --dry-run` calls no refund.
- [ ] **Step 2:** `npx vitest run tests/db/self-service.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run → PASS; `npm test`.
- [ ] **Step 5: Commit** `feat: self-service cancel, transfer, credit, waitlist`.

---

### Task 16: Admin view

As original plan Task 13 (files under `app/admin/...`, `isAdmin`, read-only except `toggleCheckIn`, CSV export), plus:
- **Gift cards** page: every card (buyer, recipient, value, balance, expiry, status) and totals — sales (sum of `issue`), outstanding balance (sum of active balances), expired value (sum of `expiry`). Gift card sales are excluded from experience revenue.
- **Payments due** page: scheduled items due in the next 30 days, failed items with attempts and booker contact, total still to collect per retreat.
- Experience revenue counts card payments + credit + gift applied on paid/deposit_paid bookings (AED).

- [ ] **Step 1: Write failing tests:** `isAdmin` case-insensitive; non-admin → 404; revenue excludes gift card sales; gift totals match seeded ledger; payments-due lists only next-30-day and failed items; check-in toggle updates `own_booking_count`; CSV export returns `text/csv`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** (stacked cards under 640px).
- [ ] **Step 4:** Run → PASS; `npm test`, `npm run test:e2e`.
- [ ] **Step 5: Commit** `feat: read-only admin view with gift cards and payments due`.

---

### Task 17: Squarespace migration

As original plan Task 14 (`importSquarespace`, mapping file, fixtures, idempotent on Squarespace order id via a new `bookings.external_ref` migration, unmapped products listed), plus: download every current site image into `public/images/` and switch content YAML and pages from the Squarespace CDN to `/images/...`, then remove the CDN from `images.remotePatterns`.

- [ ] **Step 1: Write failing tests** with fixtures (counts, repeat customer `own_booking_count` = 2, rerun no-op, unmapped listed); a unit test that no content file references `images.squarespace-cdn.com`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run → PASS. Run against staging with Tanya's real export; review `unmapped` with her.
- [ ] **Step 5: Commit** `feat: Squarespace import and local images`.

---

### Task 18: End-to-end tests, launch and switchover

As original plan Task 15, plus in Stripe test mode: a retreat on a monthly plan using a **Stripe test clock** (advance through each due date; one failed payment with card `4000 0000 0000 0341`, then "Update card" and "Pay the rest now"); gift card purchase (single, scheduled for tomorrow, bulk of 3); partial and full gift card use; cancellation of a gift-card-paid booking; a gift card refunded within 14 days. Launch runbook (`docs/launch-runbook.md`) adds: Vercel cron jobs enabled, `CRON_SECRET` set, Stripe webhook endpoint subscribed to `checkout.session.completed`, `checkout.session.expired`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`; Supabase Pro on `efzin-prod`; real AED booking + refund by Tanya; DNS (domain likely moved from Google Domains to Squarespace Domains) with MX/SPF/DKIM unchanged; Resend DNS; redirects verified; Instagram bio → `/now`; Squarespace cancelled after 7–14 stable days.

- [ ] **Step 1:** Write `tests/e2e/booking.spec.ts` (full booking with a guest via Stripe test card `4242 4242 4242 4242`, sold out → waitlist, cancel preview, admin check-in) → run → PASS.
- [ ] **Step 2:** Run the test-clock and gift scenarios above in Stripe test mode; record results in the runbook.
- [ ] **Step 3:** Tanya UAT on the preview URL on her phone; fix; re-run.
- [ ] **Step 4:** Launch per runbook.
- [ ] **Step 5:** After 7–14 stable days: disconnect Stripe from Squarespace, cancel the plan. Commit `docs: launch runbook`.
