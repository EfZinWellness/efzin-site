# Ef Zin Website: Phase 1 Design Spec ("Replace Squarespace")

**Date:** 2026-10-07
**Owner:** Tanya Malhas (Ef Zin)
**Status:** Draft for review

---

## 1. Purpose and intent

Ef Zin is a Greek-rooted wellness brand based in Dubai. It runs ticketed day events with partner venues, retreats (Aegean-inspired), coaching programs, private bespoke group trips (celebrations, bachelorettes, villa trips) and corporate wellness. The current Squarespace site is manual to update, can't take AED, and has no customer accounts, history or CRM.

**The new site must do three things equally:**
1. **Save Tanya time.** Updates are made by telling Claude in plain English. No manual page editing.
2. **Grow revenue.** Bookings are quicker and easier on phones, guests can pay in their local currency, and more repeat bookings follow.
3. **Build community.** Every guest becomes a member with a history, which sets up rewards and the library in Phase 2.

**Success for Phase 1:**
- Squarespace is cancelled.
- Every event or retreat can be booked on a phone in four screens, in the guest's local currency.
- Every guest, including friends booked by someone else, exists in Ef Zin's own CRM with health details, waiver and attendance.
- Tanya can add or change an event by messaging Claude, check it on a preview link, and approve it to go live.

### What Tanya said vs. what we assumed

| Decided by Tanya | Assumed by Claude (correct if wrong) |
|---|---|
| All three goals matter equally | Instagram is the main source of traffic, mostly on phones |
| Updates are made by telling Claude, with no big admin dashboard | A small read-only admin view is wanted anyway (Tanya agreed in the design discussion) |
| Private trips and corporate are core, equal to events and retreats | Phase 1 Private and Corporate use a structured enquiry form; the interactive builder comes in Phase 3 |
| Currencies follow the guest's location (Stripe Adaptive Pricing) | Base prices are in AED for Dubai and EUR for retreats; reporting is in AED |
| English only | Greek words are used as design accents |
| Visual direction A, "Quiet Luxury" (Aman-inspired) | Playfair Display is used instead of Casanova Serif (no Adobe web licence needed) |
| Booking flow approved (4 phone screens, account created automatically) | Account credit can be used on any event or retreat |
| Import past Squarespace customers with their history | The Instagram section is a curated photo grid linking to the profile, not a live feed |
| Booking alerts go to email | Coaching uses an enquiry form plus a WhatsApp button for now |
| Cancellation policies (section 9) | |

---

## 2. Roadmap (each phase gets its own spec)

| Phase | Scope |
|---|---|
| **1: Replace Squarespace** (this spec) | New site, event and retreat booking with local currency, accounts, CRM data, read-only admin view, emails, cancellation and credit rules, migration and launch |
| **2: Community** | Reward tiers (one-time 5% code at 5 own bookings, 10% at 10), referral reward (still to design), free on-demand library (a YouTube playlist that syncs automatically, plus recipes), Claude-drafted announcement emails and Instagram post and story content (sent only after Tanya approves) |
| **3: Bespoke** | Interactive "design your experience" builder, corporate quotes and Stripe invoicing, private client pages (proposal, itinerary, payment schedule, signed agreement) |

Phase 1 must be built so Phases 2 and 3 can be added without rebuilding:
- booking counts are already tracked
- the content model allows a "library" type
- the Requests table can be reused by the builder

---

## 3. Architecture

**Approach:** a custom site that Claude maintains (approach A).

| Concern | Choice |
|---|---|
| Site framework | Next.js (App Router) and TypeScript, styled with Tailwind CSS |
| Hosting | Vercel. Every change gets a preview link, and approved changes go live |
| Database and logins | Supabase: Postgres, Auth (emailed sign-in link and Google sign-in, no passwords), Row Level Security |
| Payments | Stripe Checkout with **Adaptive Pricing** (local currency in 150+ countries), Apple Pay and Google Pay, webhooks, Stripe Invoices for retreat balances. Uses Tanya's existing Stripe account |
| Email | Resend, with email templates built in code, sent from a branded address on efzinwellness.com |
| Scheduled jobs | Vercel Cron: reminders, releasing held spots, credit expiry, marking events as past |
| Exchange rates for the "≈" estimate | Free daily USD rates (AED is fixed to USD at 3.6725) and the guest's country from Vercel's location header |
| Code storage | GitHub |
| Environments | **Two Supabase projects (staging and production).** Preview deploys use staging data; live deploys use production |

### Where content lives
- **Events, retreats, pages, FAQs and journal posts are stored as files in the code repository** (YAML and MDX). Claude edits them, and every change is versioned and can be undone.
- When a deploy goes out, a **sync step** copies events, retreats and ticket types into the database, because bookings and capacity need them there. The sync updates existing records and never deletes anything that has bookings.
- **Photos:** stored in the repository at first, served through Vercel's image optimisation.

### Units and their single jobs
- `content/`: files for events, retreats, pages and the journal (managed by Claude)
- `lib/pricing`: base price → estimated local price and currency display
- `lib/booking`: spot holds, capacity, creating a booking, waitlist
- `lib/policy`: cancellation, refund, credit and transfer rules (pure logic, fully unit tested)
- `lib/stripe`: creating checkout sessions, handling webhooks, refunds, invoices
- `lib/email`: email templates and sending
- `app/(site)`: public pages; `app/account`: member area; `app/admin`: read-only admin view
- `scripts/`: content sync, Squarespace import

---

## 4. Site structure and user experience

**Navigation:** Events · Retreats · Bespoke · Coaching · Journal · About | account icon | **[Book]** (a fixed button in the top corner)

| Page | Contents |
|---|---|
| **Home** | Full-screen hero with the tagline "Ancient Wisdom for Modern Living"; εὖ ζῆν intro; the three pillars (Move/Κίνηση, Nourish/Διατροφή, Thrive/Ευημερία); upcoming experiences; featured retreat; Bespoke teaser (Private and Corporate); founder story; Instagram grid; newsletter sign-up |
| **Book quick panel** | Opens from the Book button. Shows the next 3–4 bookable experiences (date, estimated local price, spots left) with a tap straight through to booking |
| **Events** | A "What's on" list with retreats included, filters for Dubai/Abroad and Move/Nourish/Thrive, plus a past events gallery |
| **Event detail** | Hero, pillar tags, short story at the top with details below, schedule, ticket types, partner venue and map, cancellation policy, FAQs, "Only N spots left" (shown when N ≤ 5), fixed bottom bar "Book · AED X / ≈ £Y" |
| **Retreats / retreat detail** | Story-led layout: imagery, daily rhythm, who it's for, accommodation, what's included and not, deposit or full payment options, "Register interest" while dates are unconfirmed, and a "Speak to Tanya" WhatsApp button |
| **Bespoke** | Two paths: "For you & yours" (Private Escapes) and "For your team" (Corporate). Each has storytelling, past examples and testimonials, and a **structured enquiry form** (section 4.1) |
| **Corporate** (part of Bespoke) | Aimed at HR teams: formats (team day, offsite, recurring), outcomes, client logos, testimonials, and corporate fields on the form |
| **Coaching** | Programs, enquiry form, WhatsApp button |
| **Journal** | Recipes and articles (MDX), ready to grow into the library in Phase 2 |
| **About** | Founder story, credentials, manifesto |
| **FAQ, Contact, Terms, Privacy** | Contact keeps WhatsApp, email and Instagram. Terms are rewritten to match section 9 |
| **/now** | A branded link-in-bio page (replaces Linktree) that always shows what's currently on sale |
| **My Ef Zin** (`/account`) | Profile, health and dietary details, waiver, upcoming and past bookings, credit balance and expiry, guests waiting to complete their details, cancel or transfer actions (following section 9), consent settings, data deletion request |
| **Admin** (`/admin`) | Section 7 |

**Redirects:** every old Squarespace URL (`/ef-zin-retreats-1`, `/ef-zin-retreats`, `/past-events`, `/past-retreats`, `/forms`, `/interestform`, `/store/p/*`, `/privacy-policy-1`, `/privacy-policy-1-1`, `/faqs`, event pages) is permanently redirected (301) to its new equivalent.

### 4.1 Bespoke enquiry form (Phase 1)
A single-page version of the Phase 3 builder. Fields:
- **Who's it for:** friends / family / corporate team / just me
- **Optional:** "Are you celebrating anything special?" (birthday, bachelorette, anniversary, other)
- **Where and when:** Dubai (half or full day) / Greece or abroad (multi-day) / flexible dates
- **Group size and rough age range**
- **Interests:** Move, Nourish and Thrive options as tappable chips
- **Accommodation** (if multi-day): villa / boutique hotel / already sorted
- **Budget (optional):** per person or total, in the guest's currency
- **Notes and inspiration links**
- **Corporate extras:** company name, team size, goals (e.g. stress, team bonding, burnout), invoicing contact

Submissions are saved to the `requests` table and emailed to Tanya.

---

## 5. Visual design: direction A, "Quiet Luxury"

Reference mockups: `.superpowers/brainstorm/visual-style.html` (direction A) and `.superpowers/brainstorm/booking-flow.html`.

**Principles:**
- Ivory backgrounds, navy type, full-bleed cinematic photography
- Lots of space and very little text
- Understated serif headings
- Greek words in italic Noto Serif Display used as accents
- Thin outlined buttons with uppercase, wide-spaced Montserrat labels
- Photos fade in gently as you scroll; no flashy animation

**Brand tokens** (exact hex codes to be sampled from `EF ZIN BRANDING FINAL.pdf` at build time):
- Primary: Aegean navy, ivory, dark olive, chocolate, sand
- Secondary: ocean teal, stone olive, sage, oxblood

**Typography:**
- Headings and body text: Playfair Display
- Labels and interface text: Montserrat
- Greek text: Noto Serif Display
- Logo: the actual wordmark and fζ monogram files, not typed text

**Phone first:** every page is designed at phone width (from 360px) first, with no sideways scrolling.

**Photos:** reuse every image from the current Squarespace site; Tanya supplies more later.

---

## 6. Booking flow and data

### 6.1 Booking journey (approved)
1. **Event page.** The fixed bar shows the base price and an estimated local price.
2. **Tickets and guests.** Choose ticket types and quantities; booker enters name, email, phone; each extra guest needs name and email (phone optional).
3. **Pay.** Stripe Checkout (Adaptive Pricing, Apple Pay, Google Pay, card) with a field for a reward, credit or gift code.
4. **Confirmed.** Prompt to complete health details and waiver; friends shown as "pending"; account already created.

Optional on step 2: "How did you hear about us?"

**Holding spots:** starting checkout holds the selected spots until the Stripe Checkout session expires, set to **30 minutes** (Stripe's minimum). If the session expires or is abandoned, the spots are released. A paid booking is confirmed **only** by the Stripe `checkout.session.completed` webhook.

**Accounts:** after payment, a Person and an Auth user are created or matched by email for the booker and every guest. Guests get a "{Booker} booked you a spot" email with a link to complete their details and claim their account.

**Retreats:** pay in full, or pay a deposit (percentage set per retreat) at checkout. The balance is sent as a **Stripe Invoice due 10 days before arrival**, with reminders 21, 14 and 11 days before. An unpaid balance by the due date cancels the booking under section 9 (amounts paid are handled by the policy).

### 6.2 Data model (Supabase)

| Table | Key fields |
|---|---|
| `people` | id, auth_user_id (nullable), name, email (unique), phone, birthday, how_heard, marketing_consent (+ timestamp), notes (admin), created_at, imported_from (squarespace or null) |
| `health_profiles` | person_id, conditions, injuries, pregnancy, allergies, dietary, consent_at, updated_at. **Restricted:** visible only to the person and admin |
| `waivers` | person_id, version, accepted_at |
| `experiences` | id, slug, type (event/retreat), title, start/end, venue, pillars, status (draft/on_sale/sold_out/past), base_currency (AED/EUR), policy_template, deposit_pct (retreats), balance_due_days (retreats, default 10) |
| `ticket_types` | id, experience_id, name, price_minor, capacity |
| `holds` | id, ticket_type_id, qty, checkout_session_id, expires_at |
| `bookings` | id, booker_person_id, experience_id, status (paid/deposit_paid/refunded/cancelled/credited), amount_paid_minor, presentment_currency, amount_aed_minor, stripe_payment_intent, policy_snapshot (JSON), created_at |
| `booking_guests` | id, booking_id, person_id, ticket_type_id, is_booker, details_complete, checked_in_at |
| `credits` | id, person_id, amount_aed_minor, source_booking_id, expires_at (issued + 12 months), redeemed_booking_id |
| `waitlist` | id, ticket_type_id, person_id/email, position, notified_at |
| `requests` | id, type (private/corporate/coaching/retreat_interest), payload (JSON), person_id, status, created_at |

**Booking counts for Phase 2 rewards** come from `booking_guests` where the guest is the booker (`is_booker`) and checked in. Tickets bought for friends don't count towards the booker's total. Friends build their own count through their own guest rows once they claim their account.

**Squarespace import:** past customers and orders go in as `people`, and past `bookings` and `booking_guests` are marked `imported` so they count in their history.

---

## 7. Admin view (read-only)

- `/admin`, available only to email addresses on an allowlist (Tanya's), and works on phones.
- **Upcoming:** each experience with spots sold and remaining, revenue in AED, and missing health details or waivers.
- **Guest list:** names, phone, dietary needs, health flags, and a **check-in tick**. This is the only thing you can change here.
- **People:** search, full history, total spent, birthday, how they heard about Ef Zin, notes.
- **Requests:** bespoke, corporate, coaching and retreat-interest submissions.
- **CSV export** for every list.
- Refunds and edits are done in the Stripe dashboard or by asking Claude. Stripe webhooks keep the site in sync.

---

## 8. Emails (Resend, Ef Zin branded)

| Trigger | Recipient | Content |
|---|---|---|
| Booking paid | Booker | Confirmation, receipt, calendar invite (.ics), link to health details and waiver, cancellation policy |
| Guest added | Guest | "{Booker} booked you a spot," link to complete details and claim account |
| 3 days before, details incomplete | Guest | Gentle reminder |
| 1 day before | All guests | Location, timing, what to bring, parking |
| 1 day after | Attendees | Thank you, review link, next event |
| Abandoned checkout (email known) | Booker | "Your spot is still waiting," 1 hour later, once |
| Waitlist spot opens | Next on the list | Invite to book (first come, first served) |
| Retreat balance | Booker | Stripe invoice plus reminders 21, 14 and 11 days before |
| Credit expiring | Holder | 30 days before expiry |
| Sign-in | Member | Sign-in link |
| New booking / request / error | **Tanya (email)** | Summary and spots remaining |
| Event cancelled or moved | All guests | **Drafted by Claude and sent only after Tanya approves** |

---

## 9. Cancellation, refund, credit and transfer policy

Each experience uses a **policy template**. The policy appears on the experience page, the guest accepts it at checkout, and a **snapshot is stored on the booking**, so later changes to the policy never affect existing bookings.

**Events (Dubai day experiences):**
- More than 48 hours before start: **full refund (minus Stripe processing fees) or full-value credit**, guest's choice
- Within 48 hours: **credit only**
- No-show: nothing
- Transfer to a friend: free, up to **2 hours** before start

**Retreats:**
- More than 60 days before: **full refund of amounts paid, minus Stripe processing fees**
- 30–60 days before: **50% of the total retreat price refunded**, calculated as `max(0, amount_paid − 50% × total_price) − Stripe fees`
- Within 30 days: no refund; transfer to another person allowed
- Payment plan balance due 10 days before arrival; missing it cancels the booking under these rules

**Private and corporate:** set per contract (outside Phase 1 booking flow).

**Cancellation by Ef Zin:** full refund (no fee deduction) or transfer to a future experience, guest's choice.

**Credit:** stored in AED and usable on any event or retreat. It **expires 12 months after it's issued**, with a reminder 30 days before.

**Self-service in My Ef Zin:** the Cancel and Transfer buttons show only the options the policy allows at that moment, with the exact refund amount, including the fee deduction, shown before the guest confirms.

**Terms & Conditions** are rewritten to match this section, including fee deduction and credit expiry. Recommend a legal review.

---

## 10. When things go wrong

| Case | Handling |
|---|---|
| Two buyers, last spot | Spot holds make it impossible to oversell; the second buyer sees "Just sold out, join the waitlist" |
| Sold out | Book becomes Join waitlist, and the status updates automatically |
| Payment fails or abandoned | No booking is created and the hold is released when the session expires |
| Webhook delayed or repeated | Webhook handling is safe to repeat (keyed on the Stripe event id); the confirmation page waits for the webhook before showing success |
| Refund in Stripe dashboard | `charge.refunded` webhook → booking marked refunded, spot released |
| Retreat balance unpaid | `invoice` overdue → booking cancelled under the policy, Tanya emailed |
| Details or waiver missing | Flagged in the admin guest list |
| Content sync conflict (e.g. capacity reduced below sold) | Sync refuses and reports it to Claude; never deletes experiences that have bookings |
| App errors | Logged and emailed to Tanya; nightly database backups (Supabase Pro) |

---

## 11. Privacy and security

- Health data is **special category data** (UAE privacy law and GDPR for EU guests). It needs explicit consent, sits in the restricted `health_profiles` table, is visible only to the person and admin, and members can request deletion from their account.
- Row Level Security on every table: members only ever see their own records.
- No personal data in URLs; Stripe handles all card data.
- Marketing consent is recorded separately from booking emails.
- The Privacy Policy is rewritten to cover the CRM, health data, Stripe, Resend and Supabase.

---

## 12. Migration and launch

1. Build privately on a Vercel preview while Squarespace stays live.
2. Bring over all photos, pages, events and galleries; Tanya exports Squarespace customers and orders (CSV); import them.
3. Test in Stripe test mode: GBP, EUR and USD purchases, group booking, sold out, waitlist, refund, guest cancel and transfer, retreat deposit and invoice. Then Tanya makes one real AED booking, which is refunded.
4. **Before launch day:** confirm where the domain and the contact@ mailbox are hosted, and keep the mail DNS records unchanged.
5. **Launch:** point DNS to Vercel, turn on redirects, set up Resend's sending records, and update the Instagram bio to `/now`.
6. **After 7–14 days of stable running:** disconnect Stripe from Squarespace and cancel the Squarespace plan.

---

## 13. Testing

- **Unit tests (Vitest):** `lib/policy` (every window and edge, fee deduction, retreat 50% formula, credit expiry), `lib/pricing`, booking-count rules, holds and capacity.
- **Integration tests:** Stripe webhook handlers against Stripe test-mode events; content sync.
- **End-to-end tests (Playwright, phone screen size):** full booking with a guest, sold out, waitlist, cancel and transfer, sign in, admin check-in.
- Every change ships behind a preview link that Tanya approves.

---

## 14. Running costs (estimated)

| Service | Start | When busy |
|---|---|---|
| Vercel | $0 | ~$20/month |
| Supabase (×2 projects; only production needs Pro) | $0 | ~$25/month |
| Resend | $0 | ~$20/month |
| Stripe | per transaction (unchanged) | conversion cost paid by the guest |
| YouTube (Phase 2) | $0 | $0 |
| **Total** | **~$0** | **~$50–90/month** |

---

## 15. Open items (to resolve before or during the build)

1. **Where to build:** a personal machine and personal accounts are recommended over the Accenture laptop and OneDrive. Tanya to decide before setup.
2. **Tools on the machine:** Node.js and Git need installing; GitHub, Vercel, Supabase and Resend accounts need creating (Claude will guide).
3. **Domain registrar and email provider** for efzinwellness.com and contact@, to confirm before launch.
4. **Exact brand hex codes**, sampled from the PDF; brand logo files (SVG/PNG) from Tanya.
5. **Real prices and capacities** for current events; deposit percentage for retreats.
6. **Testimonials and corporate client logos** for the Bespoke and Corporate pages.
7. **Coaching page content** (programs, format, pricing or "enquire").
8. **Retreat 30–60 day formula**: confirm "50% of total price" (section 9) is the intended reading.

### Out of scope for Phase 1
Rewards and referrals, on-demand library, announcement and Instagram content workflow (Phase 2). Interactive builder, corporate invoicing and quotes, private client pages (Phase 3). Arabic and Greek translations, WhatsApp alerts, paid memberships.
