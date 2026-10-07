# Ef Zin Phase 1 Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Squarespace site with a custom Ef Zin site: brand pages, event and retreat booking in the guest's local currency, auto-created member accounts, a CRM data model, policy-driven cancel/transfer/credit, emails, a read-only admin view, and the Squarespace migration.

**Architecture:** A Next.js App Router site on Vercel. Experiences and pages are versioned YAML/MDX in the repo; a build-time sync copies experiences and ticket types into Supabase Postgres, which holds people, bookings, holds, credits and requests behind Row Level Security. Stripe Checkout (Adaptive Pricing) takes payment; webhooks are the only thing that confirms bookings. Pure business rules (`lib/policy`, `lib/pricing`) carry no I/O and are unit tested exhaustively.

**Tech Stack:** Node 20 LTS, Next.js 15 (App Router, TypeScript strict), Tailwind CSS 4, Supabase (`@supabase/supabase-js`, `@supabase/ssr`), Stripe (`stripe` Node SDK), Resend + React Email, Zod, `yaml`, `next-mdx-remote`, Vitest, PGlite (`@electric-sql/pglite`) for database tests, Playwright, Stripe CLI.

**Spec:** `docs/superpowers/specs/2026-10-07-efzin-phase1-website-design.md`

## Global Constraints

- Repo root is `efzin-site/`. All paths below are relative to it.
- Language: English only. Greek words appear only as design accents: Κίνηση (Move), Διατροφή (Nourish), Ευημερία (Thrive), εὖ ζῆν.
- Tagline verbatim: "Ancient Wisdom for Modern Living".
- Fonts: Playfair Display (headings/body), Montserrat (labels/UI), Noto Serif Display (Greek), via `next/font/google`. Logo is the supplied wordmark/fζ files, never typed text.
- Visual direction A "Quiet Luxury": ivory background, navy text, full-bleed photos, thin outlined uppercase buttons. Reference: `.superpowers/brainstorm/visual-style.html` (A) and `booking-flow.html` in the EFZIN folder.
- Mobile-first; no horizontal scroll at 360px width.
- Base currencies: AED (Dubai events) and EUR (retreats). Reporting in AED. AED/USD peg = 3.6725.
- Money is always integer minor units (`*_minor`). No floats for stored money.
- Event times are stored as ISO timestamps with offset; display Dubai events in `Asia/Dubai`, retreats in the experience's `timezone` field.
- Checkout session and its spot hold expire together at creation + 31 minutes (Stripe minimum is 30).
- A booking is created only by the `checkout.session.completed` webhook.
- Stripe processing fees are deducted from guest-initiated refunds; never from Ef Zin-initiated cancellations.
- Credit is stored in AED, expires 12 months after issue, and is usable on any experience.
- Rewards booking count = own bookings (`is_booker = true`) that are checked in, plus imported history. Friends' tickets never count for the booker.
- Health data lives only in `health_profiles`; readable only by the person and admins.
- Admin = emails listed in env `ADMIN_EMAILS` (comma-separated, case-insensitive).
- Hosting must be **Vercel Pro** (Hobby forbids commercial use and limits cron to daily). This raises starting cost to ~$20/month; flag to Tanya before Task 0 completes.
- Every user-visible change ships on a Vercel preview URL that Tanya approves before promotion to production.

## Review Focus

1. **Returning guest with different email casing** (e.g. `Layla@Email.com` vs `layla@email.com`) must match the existing person, never duplicate. Test: Task 9 `upsertPersonByEmail is case-insensitive`.
2. **Same email entered twice in one booking** (booker adds themselves as a guest, or duplicate friend) must be rejected before checkout. Test: Task 8 `rejects duplicate guest emails`.
3. **Policy windows across time zones**: a Dubai event at 10:00 `+04:00` cancelled at 09:59 UTC two days earlier must use absolute hours, not local calendar days. Test: Task 4 `uses absolute hours across timezones`.
4. **Duplicate or out-of-order webhooks** (completed delivered twice; expired arriving after completed) must not double-book or release a paid spot. Test: Task 9 `webhook is idempotent and ignores expired after completed`.
5. **Zero-decimal presentment currencies** (JPY, KRW) in the "≈" estimate must not show decimals or be off by 100×. Test: Task 3 `formats zero-decimal currencies`.

---

## File Structure

```
efzin-site/
  content/experiences/*.yaml         # one file per event/retreat (Claude edits these)
  content/pages/*.mdx                # about, coaching, bespoke, corporate, faq, terms, privacy
  content/journal/*.mdx              # recipes/articles
  public/images/...                  # migrated Squarespace photos + brand files
  supabase/migrations/*.sql          # schema, RLS, functions
  lib/content/schema.ts              # Zod schemas + types for content
  lib/content/load.ts                # read/parse content files
  lib/pricing/*.ts                   # local-price estimate + formatting
  lib/policy/*.ts                    # cancel/refund/credit/transfer rules (pure)
  lib/booking/*.ts                   # validation, holds, availability, counts
  lib/stripe/*.ts                    # checkout, webhook handlers, refunds, invoices
  lib/email/templates/*.tsx, send.ts # React Email templates + Resend sender
  lib/db/*.ts                        # Supabase clients (server, service, browser)
  lib/auth/admin.ts                  # isAdmin()
  app/(site)/...                     # public pages
  app/account/...                    # member area
  app/admin/...                      # read-only admin
  app/api/checkout/route.ts, app/api/stripe/webhook/route.ts, app/api/cron/*/route.ts, app/api/requests/route.ts
  components/...                     # Nav, Footer, BookPanel, StickyBookBar, etc.
  scripts/sync-content.ts, scripts/import-squarespace.ts
  tests/unit/**, tests/db/**, tests/e2e/**
```

---

### Task 0: Machine, accounts and tooling (with Tanya)

No code. Claude guides Tanya through each item and records results in `docs/setup-checklist.md` (create it in the EFZIN folder, not in the repo).

- [ ] **Step 1: Decide the build machine** (spec open item 1). Personal machine recommended. All later steps run there.
- [ ] **Step 2: Install** Node 20 LTS, Git, Stripe CLI. Verify: `node -v` → `v20.x`, `git --version`, `stripe --version` all print versions.
- [ ] **Step 3: Create accounts** (personal email, not Accenture): GitHub, Vercel (**Pro**), Supabase (projects `efzin-staging` and `efzin-prod`, region closest to Dubai, e.g. `eu-central-1` or `ap-south-1`), Resend. Connect existing Stripe account; enable **Adaptive Pricing** in Stripe Dashboard → Settings → Payments; create Google OAuth client for Supabase Google sign-in.
- [ ] **Step 4: Collect from Tanya**: logo files (SVG/PNG wordmark + fζ mark), exact brand hex codes (from Canva brand kit or sampled from the PDF), domain registrar and mailbox provider for efzinwellness.com, current event prices/capacities, retreat deposit %, testimonials, corporate logos, coaching content (spec open items 3–7).
- [ ] **Step 5: Record** all env values (not secrets) and decisions in the checklist. Secrets go only in Vercel env and a local `.env.local` (gitignored).

---

### Task 1: Scaffold, brand tokens and site shell

**Files:**
- Create: `package.json`, `next.config.ts`, `app/layout.tsx`, `app/globals.css`, `components/Nav.tsx`, `components/Footer.tsx`, `components/BookButton.tsx`, `vitest.config.ts`, `playwright.config.ts`, `.env.example`, `.gitignore`
- Test: `tests/e2e/shell.spec.ts`

**Interfaces:**
- Produces: CSS variables `--navy --ivory --olive --choc --sand --teal --stone --sage --oxblood`; Tailwind theme colours of the same names; font CSS vars `--font-serif --font-sans --font-greek`; `<Nav />` with items `Events, Retreats, Bespoke, Coaching, Journal, About`, an account icon linking `/account`, and `<BookButton />` (opens `BookPanel` from Task 6).
- npm scripts: `dev`, `build` (runs `sync:content` first, Task 5), `test` (vitest), `test:e2e` (playwright), `sync:content`.

- [ ] **Step 1:** `npx create-next-app@latest efzin-site --ts --tailwind --app --eslint --no-src-dir`, then `git init` and push to a private GitHub repo `efzin-site`. Install dev deps: `vitest @playwright/test @electric-sql/pglite`.
- [ ] **Step 2: Write failing e2e test** `tests/e2e/shell.spec.ts`:
  - at viewport 375×812, `/` shows nav links (inside menu) `Events, Retreats, Bespoke, Coaching, Journal, About` and a visible `Book` button
  - `document.documentElement.scrollWidth <= 375`
  - footer contains links `FAQ, Contact, Terms, Privacy` and `contact@efzinwellness.com`
- [ ] **Step 3: Run** `npx playwright test tests/e2e/shell.spec.ts` → FAIL.
- [ ] **Step 4: Implement** tokens in `app/globals.css` using Task 0 hex codes; fonts in `app/layout.tsx`; Nav (desktop: links left/right of centred logo as mockup A; mobile: hamburger + logo + account icon + Book); Footer.
- [ ] **Step 5: Run** test → PASS. Connect repo to Vercel; confirm a preview URL deploys.
- [ ] **Step 6: Commit** `feat: scaffold site shell with Ef Zin brand tokens`.

---

### Task 2: Database schema, RLS and test harness

**Files:**
- Create: `supabase/migrations/0001_schema.sql`, `0002_rls.sql`, `0003_functions.sql`, `tests/db/harness.ts`, `tests/db/schema.test.ts`, `lib/db/types.ts`

**Interfaces:**
- Tables exactly as spec §6.2, plus: `bookings.amount_paid_base_minor int`, `bookings.base_currency text`, `bookings.cancelled_by text check in ('guest','efzin')`, `credits.code text unique`, `experiences.timezone text not null default 'Asia/Dubai'`, `experiences.total_price_minor int` (retreats; per-person full price), `booking_guests.transfer_token uuid`, `stripe_events(id text primary key, processed_at timestamptz)`.
- `people.email` stored lowercased with unique index on `lower(email)`.
- SQL functions (in `0003`):
  - `available_spots(p_ticket_type uuid) returns int` = capacity − guests on paid/deposit_paid bookings − qty in unreleased holds
  - `create_hold(p_ticket_type uuid, p_qty int, p_expires_at timestamptz) returns uuid`. Locks the ticket_type row (`for update`); raises exception `SOLD_OUT` if `available_spots < p_qty`
  - `own_booking_count(p_person uuid) returns int` per Global Constraints rule (imported bookings count as checked in)
- `tests/db/harness.ts` exports `async function freshDb(): Promise<PGlite>` that creates a stub `auth` schema (`auth.users`, `auth.uid()` reading `current_setting('request.jwt.claim.sub')`, `auth.jwt()`) and applies all migrations in order.

- [ ] **Step 1: Write failing tests** `tests/db/schema.test.ts`:
  - `create_hold` succeeds for qty ≤ available and decrements `available_spots`
  - `create_hold` raises `SOLD_OUT` when qty > available
  - two concurrent `create_hold(qty=1)` on a ticket with 1 spot → exactly one succeeds
  - `own_booking_count` counts booker rows with `checked_in_at` set and imported rows; ignores friend rows and unchecked rows
  - inserting `Layla@Email.com` when `layla@email.com` exists violates unique index
  - RLS: as user A, `select * from health_profiles` returns only A's row; `bookings` returns only rows where A is booker or guest
- [ ] **Step 2: Run** `npx vitest run tests/db` → FAIL.
- [ ] **Step 3: Write migrations.** RLS: enable on every table; members read own `people`, `health_profiles`, `waivers`, `bookings`, `booking_guests`, `credits`; members update own `people` (except notes) and `health_profiles`; all writes otherwise via service role. Public read on `experiences` (status ≠ draft) and `ticket_types`.
- [ ] **Step 4: Run** tests → PASS. Apply migrations to `efzin-staging` with `npx supabase db push`; generate `lib/db/types.ts` with `npx supabase gen types typescript`.
- [ ] **Step 5: Commit** `feat: database schema, RLS and hold functions`.

---

### Task 3: Pricing estimate (`lib/pricing`)

**Files:**
- Create: `lib/pricing/currency.ts`, `lib/pricing/rates.ts`, `lib/pricing/estimate.ts`
- Test: `tests/unit/pricing.test.ts`

**Interfaces:**
- `currencyForCountry(country: string | null): string | null`. ISO-3166 alpha-2 → ISO-4217; `null` when unknown. Must cover at least AE, SA, KW, QA, BH, OM, GR, GB, IE, FR, DE, IT, ES, NL, CH, US, CA, AU, LB, JO, EG, IN, JP.
- `getUsdRates(): Promise<Record<string, number>>`. Fetches `https://open.er-api.com/v6/latest/USD` with `next: { revalidate: 86400 }`; on failure returns `{}`.
- `estimateLocal(baseMinor: number, baseCurrency: 'AED'|'EUR', target: string, usdRates: Record<string, number>): number | null`. Converts via USD (AED rate fixed 3.6725, ignoring feed); returns target minor units rounded to whole major units; `null` if target == base or rate missing.
- `formatMoney(minor: number, currency: string): string`. `Intl.NumberFormat('en', {style:'currency', currency, maximumFractionDigits: 0})`, minor→major using the currency's ISO exponent.

- [ ] **Step 1: Write failing tests:**
  - `estimateLocal(25000,'AED','GBP',{GBP:0.79})` → `5400` (AED 250 → $68.07 → £53.78 → £54)
  - `estimateLocal(25000,'AED','AED',{})` → `null`; missing rate → `null`
  - `estimateLocal(120000,'EUR','AED',{EUR:0.92})` → `479000`
  - `formats zero-decimal currencies`: `estimateLocal(25000,'AED','JPY',{JPY:150})` → `10211` and `formatMoney(10211,'JPY')` → `¥10,211`
  - `formatMoney(25000,'AED')` contains `250` and `AED`
  - `currencyForCountry('GR')` → `EUR`; `('XX')` → `null`
- [ ] **Step 2:** `npx vitest run tests/unit/pricing.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Minor-unit exponent: 0 for JPY, KRW, VND, CLP; 3 for KWD, BHD, OMR, JOD; else 2.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: local price estimate`.

---

### Task 4: Policy engine (`lib/policy`)

**Files:**
- Create: `lib/policy/types.ts`, `lib/policy/options.ts`, `lib/policy/credit.ts`
- Test: `tests/unit/policy.test.ts`

**Interfaces:**
```ts
type PolicyTemplate = 'standard_event' | 'standard_retreat';
type CancelOption =
  | { kind: 'refund'; ratio: number; deductFees: boolean }
  | { kind: 'credit'; amountAedMinor: number }
  | { kind: 'transfer' };
interface PolicyInput {
  template: PolicyTemplate; startsAt: Date; now: Date;
  amountPaidBaseMinor: number; totalPriceBaseMinor: number; amountPaidAedMinor: number;
  cancelledBy: 'guest' | 'efzin';
}
function cancelOptions(i: PolicyInput): CancelOption[];      // empty array = nothing allowed
function creditExpiry(issuedAt: Date): Date;                   // +12 calendar months
function isCreditUsable(expiresAt: Date, now: Date): boolean;
```
Rules (hours = (startsAt − now)/3_600_000, absolute):
- `cancelledBy: 'efzin'` → `[{refund, ratio:1, deductFees:false}, {transfer}]` for any template.
- standard_event: hours > 48 → `[refund ratio 1 deductFees true, credit amountPaidAedMinor, transfer?]`; 0 < hours ≤ 48 → `[credit, transfer?]`; hours ≤ 0 → `[]`. `transfer` included iff hours > 2.
- standard_retreat: hours > 60×24 → `[refund ratio 1 deductFees true, transfer]`; 30×24 ≤ hours ≤ 60×24 → refund ratio `max(0, paid − 0.5×total)/paid` (omit the refund option if ratio is 0), plus `transfer`; 0 < hours < 30×24 → `[transfer]`; hours ≤ 0 → `[]`.

- [ ] **Step 1: Write failing tests** (one `it` per line):
  - event at 48h+1m → kinds `['refund','credit','transfer']`, refund `deductFees: true`
  - event at exactly 48h → `['credit','transfer']`
  - event at 2h+1m → `['credit','transfer']`; at 2h → `['credit']`; at −1m → `[]`
  - `uses absolute hours across timezones`: startsAt `2026-11-08T10:00:00+04:00`, now `2026-11-06T05:59:00Z` → includes `refund`; now `2026-11-06T06:00:00Z` → no `refund`
  - retreat at 61 days, paid 100000/total 100000 → refund ratio 1
  - retreat at 45 days, paid 100000/total 100000 → ratio 0.5; paid 30000/total 100000 → no refund option, only `transfer`
  - retreat at 29 days → `['transfer']`
  - efzin cancel of event 1h before → refund ratio 1 `deductFees: false`
  - `creditExpiry(2026-10-07)` → `2027-10-07`; `isCreditUsable` true the day before, false the day after
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: cancellation/credit policy engine`.

---

### Task 5: Content model, loader and sync

**Files:**
- Create: `lib/content/schema.ts`, `lib/content/load.ts`, `scripts/sync-content.ts`, `content/experiences/2026-10-04-strong-body-calm-mind.yaml` (past), `content/experiences/2026-10-25-flow-and-create.yaml`, `content/experiences/reform-athletica-retreat.yaml` (status `interest`)
- Test: `tests/unit/content.test.ts`, `tests/db/sync.test.ts`

**Interfaces:**
- `ExperienceSchema` (Zod) fields: `slug, type ('event'|'retreat'), title, startsAt, endsAt, timezone, venue {name, address, mapUrl}, partner?, pillars ('move'|'nourish'|'thrive')[], status ('draft'|'on_sale'|'interest'|'sold_out'|'past'), baseCurrency ('AED'|'EUR'), policy (PolicyTemplate), heroImage, gallery[], summary, story (markdown), schedule [{time,label}], tickets [{key, name, description?, priceMinor, capacity}], depositPct? (retreats), totalPriceMinor? (retreats), faqs [{q,a}]`. Retreats require `depositPct` and `totalPriceMinor` unless status is `interest`.
- `type Experience = z.infer<typeof ExperienceSchema>`
- `loadExperiences(): Promise<Experience[]>`, `loadExperience(slug): Promise<Experience|null>`, `upcoming(list, now): Experience[]` (status on_sale|sold_out|interest and endsAt > now, sorted by startsAt), `loadPage(name)`, `loadJournal()`.
- `syncContent(db, experiences): Promise<SyncReport>` with `SyncReport = { upserted: string[]; errors: string[] }`. Upserts `experiences` and `ticket_types` by `(slug)` / `(experience_id, key)`; never deletes; records an error and skips if a ticket's new `capacity` < already-sold guests. CLI exits non-zero if `errors.length`.
- Effective status: when `endsAt < now` the site treats status as `past` regardless of the file.

- [ ] **Step 1: Write failing tests:** schema rejects retreat `on_sale` without `depositPct`; rejects negative price; the three seed files parse; `upcoming` excludes past/draft; sync upserts then re-sync is a no-op; sync with capacity below sold → error listed, DB unchanged.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement**; wire `"prebuild": "tsx scripts/sync-content.ts"` using `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` (staging for preview, prod for production via Vercel env scopes).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: content model and DB sync`.

---

### Task 6: Experience pages, Book panel and /now

**Files:**
- Create: `app/(site)/page.tsx` (Home), `app/(site)/events/page.tsx`, `app/(site)/events/[slug]/page.tsx`, `app/(site)/retreats/page.tsx`, `app/(site)/retreats/[slug]/page.tsx`, `app/(site)/now/page.tsx`, `components/BookPanel.tsx`, `components/StickyBookBar.tsx`, `components/ExperienceCard.tsx`, `components/PriceTag.tsx`, `lib/pricing/visitor.ts`
- Test: `tests/e2e/experiences.spec.ts`

**Interfaces:**
- Consumes: Task 3 `estimateLocal/formatMoney/currencyForCountry/getUsdRates`; Task 5 loaders; Task 2 `available_spots`.
- `visitorCurrency(headers: Headers): string | null` reads `x-vercel-ip-country`.
- `<PriceTag baseMinor baseCurrency visitorCurrency rates />` renders `AED 250` and, if available, `≈ £54`.
- `<StickyBookBar>` (mobile only) shows `PriceTag` + `Book` (→ `/book/[slug]`, Task 8) or `Join waitlist` when sold out or `Register interest` when status `interest`.
- Spots-left text `Only N spots left` shown when N ≤ 5.

- [ ] **Step 1: Write failing e2e** (375px; set header `x-vercel-ip-country: GB` via Playwright `extraHTTPHeaders`, stub rates route): event page shows title, schedule rows, `AED`, `≈ £`, a `Book` sticky bar, cancellation policy text; events list filters Dubai/Abroad and Move/Nourish/Thrive change visible cards; Book panel lists ≤4 upcoming; `/now` lists on-sale experiences; retreat with status `interest` shows `Register interest` and a WhatsApp link `https://wa.me/`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** following mockup A and spec §4 (Home section order exactly as spec table). Policy text comes from a `policyCopy(template)` map in `lib/policy/copy.ts` with the spec §9 wording.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: experience pages, book panel, /now`.

---

### Task 7: Static pages, enquiry forms and redirects

**Files:**
- Create: `app/(site)/[page]/page.tsx` (MDX pages: about, coaching, faq, contact, terms, privacy), `app/(site)/bespoke/page.tsx`, `app/(site)/bespoke/corporate/page.tsx`, `app/(site)/journal/page.tsx`, `app/(site)/journal/[slug]/page.tsx`, `components/EnquiryForm.tsx`, `app/api/requests/route.ts`, `lib/requests/schema.ts`, `redirects.ts` (imported by `next.config.ts`), `content/pages/*.mdx`
- Test: `tests/unit/requests.test.ts`, `tests/e2e/pages.spec.ts`

**Interfaces:**
- `RequestSchema` discriminated on `type: 'private'|'corporate'|'coaching'|'retreat_interest'` with the spec §4.1 fields; `budget?: {amount:number, currency:string, basis:'per_person'|'total'}`; corporate adds `company, teamSize, goals[], invoiceContact`. Every type requires `name, email`, optional `phone`.
- `POST /api/requests` → validates, upserts person (Task 9 `upsertPersonByEmail`), inserts `requests`, emails Tanya (Task 11 `sendEmail('request_received', ...)`), returns `{ok:true}`; 400 with Zod issues on invalid input.
- `POST /api/newsletter` `{name?, email}` → `upsertPersonByEmail` then sets `marketing_consent=true` and its timestamp; used by the Home and footer sign-up.
- `redirects` array: permanent 301s for every path in spec §4 Redirects, including `/store/p/strongbody-calmmind-re` and `/store/p/strongbody-calmmind-re-k2dhd` → `/events/2026-10-04-strong-body-calm-mind`.

- [ ] **Step 1: Write failing tests:** schema accepts a corporate payload, rejects missing email, accepts budget without amount fields omitted; e2e: bespoke shows two paths "For you & yours" / "For your team", submitting the private form shows a thank-you message; `GET /ef-zin-retreats-1` → 301 to `/events`; `/faqs` → 301 `/faq`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Terms MDX reflects spec §9 verbatim rules including fee deduction and 12-month credit expiry; Privacy covers health data, Stripe, Resend, Supabase (spec §11). Mark both with a "Draft, pending legal review" HTML comment.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: static pages, enquiry forms, redirects`.

---

### Task 8: Booking form and checkout session

**Files:**
- Create: `app/(site)/book/[slug]/page.tsx`, `components/BookingForm.tsx`, `lib/booking/validate.ts`, `lib/stripe/client.ts`, `lib/stripe/checkout.ts`, `app/api/checkout/route.ts`, `lib/credits/redeem.ts`
- Test: `tests/unit/booking-validate.test.ts`, `tests/unit/checkout.test.ts`

**Interfaces:**
```ts
interface BookingRequest {
  slug: string;
  lines: { ticketKey: string; qty: number }[];
  booker: { name: string; email: string; phone: string; howHeard?: string };
  guests: { name: string; email: string; phone?: string; ticketKey: string }[]; // one per extra ticket
  payment: 'full' | 'deposit';           // deposit only for retreats
  code?: string;                          // credit code
  policyAccepted: true;
}
function validateBooking(req: unknown, exp: Experience): { ok: true; value: BookingRequest } | { ok: false; errors: string[] };
function createCheckout(req: BookingRequest, exp: Experience, db, stripe): Promise<{ url: string }>;
```
- validate: total qty = 1 + guests.length; every ticketKey exists; emails lowercased; **rejects duplicate guest emails** (including booker's); requires `policyAccepted`.
- createCheckout: `expiresAt = now + 31 min`; for each line call `create_hold` (on `SOLD_OUT` throw `SoldOutError`); Stripe `checkout.sessions.create` with `mode:'payment'`, line items in `exp.baseCurrency` (deposit = `round(priceMinor × depositPct/100)`), `expires_at`, `customer_email`, `payment_intent_data.setup_future_usage` not set, `after_expiration.recovery.enabled: true`, `success_url=/book/[slug]/confirmed?session={CHECKOUT_SESSION_ID}`, `metadata.pending_booking_id` → row in new table `pending_bookings(id, payload jsonb, hold_ids uuid[], session_id, created_at)` (add migration `0004_pending.sql`). Credit code: validated by `redeemPreview(code, now)` (exists, unredeemed, `isCreditUsable`) → Stripe `discounts:[{coupon}]` with a one-off coupon `amount_off` = min(credit converted to base currency, subtotal), `duration:'once'`.
- `POST /api/checkout` → 409 `{error:'sold_out'}` on `SoldOutError`, 400 on validation, else `{url}`.

- [ ] **Step 1: Write failing tests:** validation cases above incl. `rejects duplicate guest emails`; checkout with a mocked Stripe client: passes `expires_at` = now+31m, deposit line amount for depositPct 30 on 400000 = 120000, creates holds equal to qty, throws `SoldOutError` and creates no Stripe session when a hold fails, applies coupon for valid credit and rejects expired credit.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement**; BookingForm UI matches mockup screen 2 (ticket steppers, booker fields, one guest card per extra ticket, optional "How did you hear about us?", code field, policy checkbox).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: booking form and Stripe checkout`.

---

### Task 9: Stripe webhook: confirm, expire, refund, invoices

**Files:**
- Create: `app/api/stripe/webhook/route.ts`, `lib/stripe/handlers.ts`, `lib/people/upsert.ts`, `lib/auth/provision.ts`, `lib/stripe/invoice.ts`
- Test: `tests/db/webhook.test.ts`

**Interfaces:**
- `upsertPersonByEmail(db, {name, email, phone?, howHeard?}): Promise<string /*person id*/>`. Case-insensitive match; fills blanks, never overwrites non-empty fields.
- `ensureAuthUser(email): Promise<{ claimLink: string }>`. `auth.admin.createUser({email, email_confirm:true})` if absent; `auth.admin.generateLink({type:'magiclink', email, options:{redirectTo:'/account'}})`.
- `handleStripeEvent(evt: Stripe.Event, deps): Promise<void>`. Inserts `stripe_events.id` first; returns early if it already exists.
  - `checkout.session.completed`: load pending; create `bookings` (status `paid` or `deposit_paid`; `presentment_currency`, `amount_paid_minor` from `session.amount_total/currency`; `amount_paid_base_minor`; `amount_aed_minor` via peg/rates; `policy_snapshot` = template + copy); one `booking_guests` per ticket (`is_booker` for booker); mark holds released; redeem credit (leftover → new credit row, same `expires_at`); provision auth for all; send `booking_confirmed` to booker, `guest_added` to each guest, `admin_new_booking` to Tanya. If deposit: `createBalanceInvoice(booking)`, a Stripe Invoice in base currency for remaining amount, `due_date` = startsAt − 10 days, `collection_method:'send_invoice'`.
  - `checkout.session.expired`: release holds unless booking for that pending exists; send `abandoned_checkout` with `session.after_expiration.recovery.url` if email known.
  - `charge.refunded`: booking `refunded` if fully refunded; guests' spots free automatically via `available_spots`.
  - `invoice.paid`: booking `paid`. `invoice.overdue`: cancel booking under policy (no refund since within 30 days), email Tanya.
- Route verifies signature with `STRIPE_WEBHOOK_SECRET`; returns 200 after handling, 400 on bad signature.

- [ ] **Step 1: Write failing tests** (PGlite + fake Stripe events + stubbed email/auth):
  - completed creates 1 booking, 2 booking_guests, 2 people; holds released; emails `booking_confirmed`,`guest_added`,`admin_new_booking` queued
  - `upsertPersonByEmail is case-insensitive`
  - `webhook is idempotent and ignores expired after completed`: same completed event twice → 1 booking; expired after completed → holds not re-released, no abandoned email
  - deposit booking → status `deposit_paid` and invoice created with due date startsAt−10d
  - refunded → status `refunded`, `available_spots` restored
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Local check with `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: Stripe webhook booking lifecycle`.

---

### Task 10: Auth and My Ef Zin

**Files:**
- Create: `lib/db/server.ts`, `lib/db/browser.ts`, `middleware.ts`, `app/account/signin/page.tsx`, `app/account/page.tsx`, `app/account/profile/page.tsx`, `app/account/health/page.tsx`, `app/account/bookings/[id]/page.tsx`, `app/(site)/book/[slug]/confirmed/page.tsx`
- Test: `tests/e2e/account.spec.ts`

**Interfaces:**
- Sign-in: email magic link + Google (`signInWithOtp`, `signInWithOAuth`). `/account/*` requires session (middleware redirect to `/account/signin`).
- Account home shows: upcoming and past bookings, credit balance with codes and expiry, guests on my bookings with `details_complete` status, link to health & waiver.
- Health page: fields from `health_profiles`; explicit consent checkbox required to save (sets `consent_at`); waiver text (version `v1`, from `content/pages/waiver.mdx`) with accept → inserts `waivers`. Saving both sets `details_complete` on the person's upcoming `booking_guests`.
- "Request deletion of my data" button → `requests` row type `deletion` (add to `RequestSchema`) + email Tanya.
- Confirmed page polls the booking by session id (up to 20 s) before showing "You're in, {first name}." (mockup screen 4); shows health/waiver task and pending guests.

- [ ] **Step 1: Write failing e2e:** unauthenticated `/account` → signin; with a seeded session (service-role generated link), account lists a seeded booking; saving health without consent shows an error; with consent + waiver marks details complete; confirmed page shows "You're in".
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: member accounts`.

---

### Task 11: Emails and scheduled jobs

**Files:**
- Create: `lib/email/send.ts`, `lib/email/templates/{BookingConfirmed,GuestAdded,DetailsReminder,DayBefore,DayAfter,AbandonedCheckout,WaitlistOpen,BalanceReminder,CreditExpiring,AdminNewBooking,AdminNewRequest,AdminError}.tsx`, `lib/email/ics.ts`, `app/api/cron/daily/route.ts`, `app/api/cron/hourly/route.ts`, `vercel.json`
- Test: `tests/unit/email.test.ts`, `tests/db/cron.test.ts`

**Interfaces:**
- `type EmailKind = 'booking_confirmed'|'guest_added'|'details_reminder'|'day_before'|'day_after'|'abandoned_checkout'|'waitlist_open'|'balance_reminder'|'credit_expiring'|'admin_new_booking'|'request_received'|'admin_error'`
- `sendEmail(kind: EmailKind, to: string, data: object): Promise<void>`. Resend from `Ef Zin <hello@efzinwellness.com>`; admin kinds go to `ADMIN_EMAILS`; writes `email_log(kind, to, ref, sent_at)` (migration `0005_email_log.sql`) and skips if `(kind,to,ref)` already sent.
- `buildIcs(exp: Experience): string`
- `reportError(err: unknown, context: string): Promise<void>`. Logs and sends `admin_error` (at most one per `context` per hour via `email_log`). Wrap the webhook route and both cron routes with it.
- Cron (`Authorization: Bearer ${CRON_SECRET}`): **daily 06:00 Dubai** → details_reminder (3 days before, incomplete), day_before, day_after, balance_reminder at 21/14/11 days before due date, credit_expiring at 30 days, release holds expired > 5 min (safety net). **Hourly** → none required beyond safety-net hold release (abandoned email is sent by the expired webhook).
- Every template: Ef Zin logo, ivory/navy, plain-text fallback.

- [ ] **Step 1: Write failing tests:** each template renders and contains its key copy (`You're in`, `booked you a spot`, the event title, policy text in confirmation); ICS has `DTSTART` in UTC; cron selects exactly the guests due (seed bookings at 3 days, 2 days, 1 day, yesterday) and `email_log` prevents a second send on re-run.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement**; `vercel.json` crons `0 2 * * *` (06:00 Dubai) and `0 * * * *`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: transactional emails and cron`.

---

### Task 12: Self-service cancel, transfer, credits and waitlist

**Files:**
- Create: `app/account/bookings/[id]/actions.ts`, `lib/stripe/refund.ts`, `lib/credits/issue.ts`, `lib/booking/transfer.ts`, `lib/booking/waitlist.ts`, `app/(site)/waitlist/[slug]/page.tsx`
- Test: `tests/db/self-service.test.ts`

**Interfaces:**
- `refundBooking(bookingId, ratio, deductFees): Promise<{ refundedMinor: number; currency: string }>`. Across the booking's charges (balance invoice charge first, then deposit/full): amount = `round(chargeAmount × ratio)`; if `deductFees`, subtract the charge's `balance_transaction.fee` converted to the charge currency by `/ exchange_rate` (or as-is if same currency); floor at 0. Shows the same figure before confirm (`previewRefund` with identical maths).
- `issueCredit(personId, amountAedMinor, sourceBookingId): Promise<{code}>`. Code format `EFZ-` + 6 uppercase alphanumerics; `expires_at = creditExpiry(now)`; emails code.
- `transferSpot(bookingGuestId, newGuest:{name,email}): Promise<void>`. Allowed only if `cancelOptions` includes `transfer`; swaps person on that guest row, resets `details_complete`, emails new guest `guest_added`.
- Server actions on booking page render only options from `cancelOptions(...)` with `cancelledBy:'guest'`, show the exact refund preview, require a confirm click. On cancel: refund → status `refunded`, or credit → status `credited`; spots free; then `notifyWaitlist(ticketTypeId)`.
- `scripts/cancel-experience.ts <slug> --dry-run|--send`. Ef Zin-initiated cancellation used by Claude: `--dry-run` prints affected guests and renders the guest email to a file for Tanya's approval; `--send` refunds each booking with `refundBooking(id, 1, false)`, sets `cancelled_by='efzin'`, marks the experience `past`/cancelled in YAML, and emails guests (offering transfer instead by reply).
- `joinWaitlist(ticketTypeId, {name,email})`; `notifyWaitlist(ticketTypeId)` emails everyone not yet notified when spots > 0 (first come, first served at checkout).

- [ ] **Step 1: Write failing tests:** event cancelled 3 days out with refund → Stripe refund called with `amount − fee`; same with credit → credit row AED amount = `amount_aed_minor`, expiry +12 months; event at 1 day → refund option absent; transfer at 1h before event rejected; retreat at 45 days paid 100% → refund ratio 0.5 minus fee; cancel triggers waitlist email; `cancel-experience --send` refunds in full with no fee deduction and `--dry-run` calls no Stripe refund.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: self-service cancel, transfer, credits, waitlist`.

---

### Task 13: Admin view

**Files:**
- Create: `lib/auth/admin.ts`, `app/admin/layout.tsx`, `app/admin/page.tsx` (Upcoming), `app/admin/experiences/[slug]/page.tsx` (guest list + check-in), `app/admin/people/page.tsx`, `app/admin/people/[id]/page.tsx`, `app/admin/requests/page.tsx`, `app/admin/export/[kind]/route.ts`
- Test: `tests/e2e/admin.spec.ts`, `tests/unit/admin.test.ts`

**Interfaces:**
- `isAdmin(email: string | null | undefined): boolean` (case-insensitive against `ADMIN_EMAILS`).
- All admin data read with the service client **after** `isAdmin` check; non-admins get 404.
- Only mutation: `toggleCheckIn(bookingGuestId)` sets/clears `checked_in_at`.
- Upcoming shows per experience: sold/remaining, revenue AED (`sum(amount_aed_minor)` of paid+deposit_paid), count missing details. Guest list shows name, phone, dietary, health flags, waiver ✓/✗, check-in toggle. People: search by name/email, history, total spent AED, birthday, how heard, notes. Export: CSV of people, bookings, guests per experience, requests.

- [ ] **Step 1: Write failing tests:** `isAdmin('Tanya@…')` true when env lowercased; non-admin session → 404 on `/admin`; admin sees seeded experience with correct sold/remaining; check-in toggle persists and increments `own_booking_count` for the booker; export returns `text/csv` with header row.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** (mobile-first tables as stacked cards under 640px).
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat: read-only admin view with check-in`.

---

### Task 14: Squarespace migration (content and customers)

**Files:**
- Create: `scripts/import-squarespace.ts`, `scripts/squarespace-map.json` (product name → experience slug), `tests/fixtures/sqsp-customers.csv`, `tests/fixtures/sqsp-orders.csv`, past-experience YAML files, `public/images/**`
- Test: `tests/db/import.test.ts`

**Interfaces:**
- `importSquarespace(db, customersCsv: string, ordersCsv: string, map: Record<string,string>): Promise<{people:number; bookings:number; unmapped:string[]}>`. People via `upsertPersonByEmail` with `imported_from='squarespace'`, marketing consent only if the CSV says subscribed; each order line → `bookings` (status `paid`, `imported`) + booker `booking_guests` with `checked_in_at = experience start`. Unmapped products listed, not guessed. Re-running is a no-op (match on Squarespace order id stored in `bookings.external_ref`, migration `0006`).

- [ ] **Step 1: Write failing tests** with fixtures (3 customers, one with two orders, one unmapped product): counts match, `own_booking_count` = 2 for the repeat customer, rerun adds nothing, unmapped listed.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Then download every image from the current site (URL list gathered in brainstorming plus a crawl of each page) into `public/images/`, and write past events/retreats as `status: past` YAML so galleries render.
- [ ] **Step 4:** Run → PASS. Run against staging with Tanya's real export; review `unmapped` with her.
- [ ] **Step 5: Commit** `feat: Squarespace import and migrated content`.

---

### Task 15: End-to-end booking test, launch and cutover

**Files:**
- Create: `tests/e2e/booking.spec.ts`, `docs/launch-runbook.md`

- [ ] **Step 1: Write e2e** against staging with Stripe test mode (375px): book Whole experience ×2 with a guest → Stripe test card `4242 4242 4242 4242` → confirmed page "You're in"; webhook created booking; sold-out path shows "Just sold out" and waitlist; cancel from account shows refund preview; admin check-in works.
- [ ] **Step 2:** Run `npx playwright test` → all PASS. Manually verify GBP/EUR/USD presentment via Stripe test cards for those countries.
- [ ] **Step 3: Tanya UAT** on the preview URL on her phone; collect changes; fix; re-run.
- [ ] **Step 4: Runbook + launch** (`docs/launch-runbook.md`): upgrade `efzin-prod` to Supabase Pro (nightly backups); switch Stripe and Supabase to production keys; Tanya makes one real AED booking and it is refunded; confirm registrar and mail DNS (MX, SPF, DKIM unchanged); add Resend DNS records; point apex and `www` to Vercel; verify every redirect returns 301; update Instagram bio to `/now`.
- [ ] **Step 5:** After 7–14 days stable: disconnect Stripe from Squarespace, cancel the Squarespace plan. Commit `docs: launch runbook`.
