# Ef Zin launch runbook

For Tanya and Claude, working through it together. Tick each box as we go. Tags on each step say who does it:

- **[Tanya]** needs your logins, your phone, or your decision.
- **[Claude]** Claude runs it from the project once you have given it the keys.
- **[Both]** done together (you click, Claude checks).

Nothing here needs you to write code. When a step says "paste into Vercel", Claude will show you exactly where to click.

**Two environments.** *Staging* is a private copy of the site (Vercel "Preview", its own Supabase project, Stripe in test mode) where nothing real can happen. *Production* is the real site (Vercel "Production", the real Supabase project, Stripe live). We finish and test everything on staging first, then repeat the setup for production.

**Never paste a secret into chat.** Put keys straight into Vercel, or into the `.env.local` file on your computer. Claude will tell you which.

---

## A. Accounts and keys

### A1. Accounts to have

- [ ] **[Tanya] Vercel Pro** (hosting). Pro is needed because the site's scheduled jobs run hourly, and the free plan only allows daily jobs. Sign up at vercel.com and choose Pro.
- [ ] **[Tanya] Supabase** (database and sign-in). Two projects: `efzin-staging` and `efzin-prod`. Upgrade `efzin-prod` to **Pro** (Settings > Billing). Pro is what gives automatic daily backups, so we do not lose guest or booking records.
- [ ] **[Tanya] Stripe**. Your existing account. Use **test mode** (toggle top right) for staging. Live keys only on launch day.
- [ ] **[Tanya] Resend** (email sending), plus access to wherever your domain's DNS is managed (see I2). Domain verification is in A3 and must be finished before testing.
- [ ] **[Tanya] Google Cloud** project for "Sign in with Google" (a free OAuth client; see B3). Before creating the client, set up the **OAuth consent screen**: Google Cloud console > APIs & Services > OAuth consent screen > External; app name "Ef Zin", support email `contact@efzinwellness.com`, authorised domain `efzinwellness.com`, developer contact email; scopes `openid`, `email`, `profile` (the defaults) only; then **Publish app** so any guest, not just test users, can sign in.
- [ ] **[Tanya] GitHub** (already done): `github.com/EfZinWellness/efzin-site`.

### A2. Every setting the site reads (the "environment variables")

These are entered once in Vercel (Project > Settings > Environment Variables). For each one, tick the Environment boxes shown. **Preview** = staging. **Production** = the real site. The same list lives in `.env.example` in the project.

| Setting | What it is | Where to find it | Preview (staging) | Production |
|---|---|---|---|---|
| `NEXT_PUBLIC_SITE_ORIGIN` | The site's own address, used in email links and Stripe return links. **Required in production.** | You decide. Production: `https://www.efzinwellness.com`. Staging: the Vercel preview address (no trailing slash). | the preview address | `https://www.efzinwellness.com` |
| `NEXT_PUBLIC_SUPABASE_URL` | Address of the Supabase project | Supabase > Project Settings > API > Project URL | staging project | prod project |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public key for sign-in | Supabase > Project Settings > API > `anon` `public` key | staging | prod |
| `SUPABASE_URL` | Same address again, for the server | Same as `NEXT_PUBLIC_SUPABASE_URL` | staging | prod |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret key that creates member accounts after payment. **Never share or expose.** | Supabase > Project Settings > API > `service_role` key | staging | prod |
| `DATABASE_URL` | Database connection string | Supabase > Connect > "Transaction pooler" connection string (replace `[YOUR-PASSWORD]` with the database password you set when creating the project) | staging | prod |
| `SUPABASE_DB_CA_CERT` | Supabase's certificate, so the database connection is encrypted and checked (see B, "Database encryption") | Supabase > Project Settings > Database > SSL Configuration > **Download certificate**. Open the downloaded `.crt` file in a text editor and paste all of it (including the BEGIN/END lines) | staging project's | prod project's |
| `STRIPE_SECRET_KEY` | Lets the site create payments and refunds | Stripe > Developers > API keys > Secret key. **Test mode: starts `sk_test_`. Live: starts `sk_live_`.** | `sk_test_...` | `sk_live_...` (launch day only) |
| `STRIPE_WEBHOOK_SECRET` | Proves messages really come from Stripe | Stripe > Developers > Webhooks > your endpoint > Signing secret (`whsec_...`). One per endpoint, so staging and production differ. | staging endpoint's | production endpoint's |
| `RESEND_API_KEY` | Sends the emails | Resend > API Keys > Create (sending access) | staging key | prod key |
| `ADMIN_EMAILS` | Who gets alert emails and may open `/admin`. Comma separated. | You decide, e.g. `contact@efzinwellness.com` | yes | yes |
| `CRON_SECRET` | Password the scheduled jobs use. Vercel sends it automatically. | Make up a long random string (Claude can generate one). Use a different one per environment. | yes | yes |
| `STRIPE_TEST_CLOCK_ID` | Staging only: lets the payment-plan test move Stripe's clock | Printed by the test-clock script in F2 | only while testing | **never** |

For the automated staging test (F1), Claude also uses these **on your computer only**, not in Vercel: `E2E_STAGING_URL`, `E2E_STAGING_SLUG`, `EFZIN_E2E_ADMIN_EMAIL`, plus the staging `STRIPE_SECRET_KEY`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

Not for Vercel: `EFZIN_FAKE_USD_RATES`, `EFZIN_EXTRA_CONTENT_DIR`, `EFZIN_TEST_AUTH_EMAIL`, `EFZIN_FAKE_BOOKING_STATUS`. These are for the automated tests on a developer's computer.

- [ ] **[Tanya]** Staging values collected and pasted into Vercel for the **Preview** environment.
- [ ] **[Tanya]** Production values pasted into Vercel for **Production** later, at section I (not before).

### A3. Resend: verify the sending domain (do this now, before any testing)

**No emails from the site are sent until `efzinwellness.com` is verified in Resend.** That means no booking confirmations, receipts, gift cards, reminders or admin alerts on staging or on the live site, and the staging tests in F cannot pass their email checks. Verify the domain once; the same verification serves staging and production.

- [ ] **[Tanya, with Claude guiding on screen]** Resend > Domains > Add Domain > `efzinwellness.com`. Resend then shows a short list of DNS records (a DKIM record, an SPF record and a "return-path" MX record, normally on a `send.` sub-address).
- [ ] **[Tanya, with Claude guiding]** Add exactly those records at wherever the domain's DNS lives (probably Squarespace Domains, formerly Google Domains; see I2 for how to find it). Adding them does **not** touch the website or your inbox: leave every existing record (especially MX, SPF and DKIM for your normal email) as it is. If an SPF record already exists for the main domain, don't add a second one for the same name; ask Claude.
- [ ] **[Tanya]** Back in Resend click Verify and wait for "Verified" (minutes to hours). Create the API key (A2) after that.
- [ ] **[Claude]** Send one test email from the site (the contact form) and check it arrives and isn't in spam. Emails are sent from `Ef Zin <hello@efzinwellness.com>`.

---

## B. Supabase setup

Do this once for `efzin-staging`, and again for `efzin-prod` before launch. The full step-by-step is in **`docs/setup-supabase.md`**. The short version:

- [ ] **[Both]** Authentication > Providers > **Email: enabled, "Confirm email" ON.** This is what makes matching a signed-in person to their bookings safe. Never turn it off. If there is a separate switch for password sign-up, turn it off (members only use email links).
- [ ] **[Both]** Authentication > Email templates > **Magic Link**: replace the link with
  `<a href="{{ .SiteURL }}/account/auth/confirm?token_hash={{ .TokenHash }}&type=email">Sign in to My Ef Zin</a>`
  This is the "email template change". Without it, sign-in links go to the wrong page.
- [ ] **[Both]** Authentication > URL configuration: **Site URL** = the origin of that environment. **Redirect URLs** = `<origin>/account/auth/callback`, `<origin>/account/auth/confirm`, `<origin>/account`.
- [ ] **[Tanya]** Authentication > Providers > **Google**: paste the Google client ID and secret (B3).
- [ ] **[Tanya]** `efzin-prod` only: upgrade to **Pro** for backups, and check Database > Backups shows daily backups.
- [ ] **[Both]** **Sign-in emails: use Resend's mail server in Supabase.** Supabase's built-in mailer is heavily rate-limited (a handful of emails an hour) and not meant for real guests. After A3 is verified: Supabase > Authentication > Emails > SMTP Settings > turn on **Custom SMTP** with: host `smtp.resend.com`, port `465`, username `resend`, password = a Resend API key (create a separate key just for this), sender email `hello@efzinwellness.com`, sender name `Ef Zin`. Save, then request a sign-in link at `/account/signin` and check it arrives.

- [ ] **[Both]** **Database encryption.** Supabase > Project Settings > Database > SSL Configuration: turn on **Enforce SSL on incoming connections**, then **Download certificate** and put its text in `SUPABASE_DB_CA_CERT` (A2). The site always connects to Supabase with TLS and checks the certificate; it never switches the check off. If the setting is missing, it falls back to Node's built-in certificates and logs a warning, and Supabase's own certificate may then be refused, so the site cannot reach the database. After deploying, open a page that reads the database (for example `/admin`) to confirm the connection works.
  **Scripts run locally** (`npx tsx scripts/...`, e.g. cancel-experience, import-squarespace) connect the same way: set `SUPABASE_DB_CA_CERT` in the local environment too (alongside `DATABASE_URL`), or the connection may be refused.

**Which emails go through which system.** Supabase sends only the **"email me a sign-in link"** message that a member requests on the sign-in page (the Magic Link template above). Everything else is sent by the site itself through Resend: booking confirmations and the **account-claim link** in them (the site asks Supabase for the link, then puts it in its own email), receipts, reminders, gift cards, cancellations and admin alerts. So the SMTP setting fixes sign-in link requests; `RESEND_API_KEY` in Vercel handles the rest.

### B3. Google sign-in

- [ ] **[Tanya]** Google Cloud console > APIs & Services > Credentials > Create OAuth client ID (Web application). Under "Authorised redirect URIs" add the callback address shown on Supabase's Google provider page. Copy the client ID and secret into Supabase.

---

## C. Database

Claude does these with the staging connection details. (Production repeats them at section I.)

- [ ] **[Claude]** Apply the migrations (all 19 files in `supabase/migrations/`) to staging: `npx supabase link --project-ref <staging ref>` then `npx supabase db push`. (Alternative if the Supabase login is awkward: run each file in order with `psql "$DATABASE_URL" -f supabase/migrations/0001_schema.sql`, and so on to 0019.)
- [ ] **[Claude]** Regenerate the data types from the real database: `npx supabase gen types typescript --project-id <staging ref> > lib/db/types.ts`. The types were hand-written until now, so this may show small differences; Claude fixes any and re-runs the tests.
- [ ] **[Claude]** Check the real Postgres behaves as the tests assumed (the tests used a stand-in database): security rules for signed-in members, and that two people cannot take the last spot at the same moment.
- [ ] **[Claude]** Run `show idle_in_transaction_session_timeout;`. The booking and refund code sometimes keeps a database transaction open for a moment while it talks to Stripe. If the value is a very short number (a few seconds), raise it to about 60 seconds: `alter role postgres set idle_in_transaction_session_timeout = '60s';`.
- [ ] **[Claude]** Sync the experiences into the database: `npm run sync:content`.
- [ ] **[Claude]** Note for later: the database library can read plain dates as "midnight in the computer's time zone". Vercel runs on UTC so this is harmless. If we ever run a script from a laptop in another time zone, set `pg.types.setTypeParser(1082, v => v)` first.
- [ ] **[Claude]** Migration 0016 (self-service cancellation) has no data back-fill. That is fine because there are no live bookings yet; confirm still true on the day.

---

## D. Stripe setup (test mode first, then again in live mode)

- [ ] **[Both]** Developers > Webhooks > Add endpoint. URL: `<origin>/api/stripe/webhook` (the staging preview address for staging). Subscribe to **exactly** these six events:
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `invoice.paid`
  - `invoice.payment_failed`
  - `invoice.overdue`
  - `charge.refunded`

  Card only (incl. Apple Pay / Google Pay); bank transfers and pay-later methods are switched off in code.

  Copy the signing secret into `STRIPE_WEBHOOK_SECRET` in Vercel for that environment.
- [ ] **[Tanya]** Settings > Payments > **Payment methods → Apple Pay and Google Pay ON** (Apple Pay domain verification is automatic for Stripe Checkout). Checkout shows them first on devices that support them. Only a guest **signed in to My Ef Zin** (as the booker / buyer) gets "save my card" and sees their saved cards; anyone booking without signing in never sees saved cards (a payment plan booked that way gets its own fresh Stripe customer). Payment plans save the card automatically.
- [ ] **[Tanya]** Settings > Payments > **Adaptive Pricing: ON** (guests see prices in their own currency). Already done for test mode; do it again in live mode.
- [ ] **[Both]** **Check Adaptive Pricing really works** alongside the saved card for payment plans: in F2, book a payment-plan retreat from a UK/EU-looking browser and confirm Checkout shows the deposit in GBP/EUR. If it only shows AED, the deposit is simply charged in AED; later instalments are still charged in the guest's currency. Also, **signed in to My Ef Zin** from the same browser: (1) book an event **paying in full** and (2) buy a **gift card**, each time ticking "save my card" at Checkout; confirm Checkout still shows the price in GBP/EUR with the save option, the payment goes through, and the next Checkout (still signed in) offers the saved card. Then sign out and start a booking with the same email: Checkout must **not** show any saved card. Tell Claude either way.
- [ ] **[Tanya]** Settings > Billing > Invoices (and Customer emails): switch **on** "Email finalised invoices and credit notes to customers" / "Send invoice emails". This is how guests without a saved card get a pay link.
- [ ] **[Tanya]** Settings > Billing > Subscriptions and emails > **Smart Retries: ON** (Stripe retries failed card payments at good times; the site waits 2 extra days after the due date before cancelling).
- [ ] **[Tanya]** Settings > Customer portal / receipts: leave default. Receipts for single payments are sent by the site.

---

## E. Vercel

- [ ] **[Both]** vercel.com > Add New > Project > import `EfZinWellness/efzin-site`. Set the **Production Branch** to `main`. The `phase1` branch builds **Preview** deployments (this is staging). `phase1` is merged into `main` only on launch day (I1), after the Production environment variables are set. Keep Framework: Next.js.
- [ ] **[Both]** Environment variables: enter the table from A2 for **Preview**. Production values wait until section I.
- [ ] **[Both]** Remember: **changing an environment variable only affects new deployments.** After adding or changing any, redeploy (Deployments > the latest > Redeploy) before testing.
- [ ] **[Both]** **Scheduled jobs.** `vercel.json` already defines three: `/api/cron/daily` (06:00 Dubai: reminders, instalments, unpaid cancellations), `/api/cron/gift-delivery` (08:00 Dubai: scheduled gift cards) and `/api/cron/hourly` (frees spots and gift reservations from abandoned checkouts). Check Project > Settings > Cron Jobs lists all three and that `CRON_SECRET` is set for that environment. Note: Vercel runs cron jobs on the **Production** deployment only, so on staging Claude triggers them by hand (see F2).
- [ ] **[Tanya]** Set `ADMIN_EMAILS` (A2). Then check: signed in with that email, `/admin` opens; signed out or with another email it shows a "not found" page.
- [ ] **[Claude]** Open the preview address: every page loads, no error banner, `/api/cron/daily` without the secret answers 401.
- [ ] **[Claude]** Confirm A3 (Resend domain verified) is done; staging emails do not send without it.

---

## F. Staging tests (nothing here uses real money)

Everything below runs in **Stripe test mode** against the staging preview. Test cards: `4242 4242 4242 4242` (always works), `4000 0000 0000 0341` (saves fine, then every later charge is declined). Any future expiry, any 3 digits.

### F1. Automated booking test

- [ ] **[Claude]** Set (on the computer, not in Vercel): `E2E_STAGING_URL`, `STRIPE_SECRET_KEY` (**sk_test_ only; the test refuses a live key**), `EFZIN_E2E_ADMIN_EMAIL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (staging), and `E2E_STAGING_SLUG` (an experience that is on sale with spots left on staging; the test stops with a clear message if it is missing or not on sale). The test refuses the real efzinwellness.com address. Optional: `E2E_STAGING_SOLDOUT_SLUG` (an experience with no spots left, so the waitlist step runs). Test guests use Resend's safe test address `delivered@resend.dev` (with `+label` variants), so no real inbox is emailed.
- [ ] **[Claude]** Run `npm run test:e2e:staging`.
- **Expected:** with `E2E_STAGING_SOLDOUT_SLUG` set, four tests pass; without it, **three pass and one (the waitlist) is skipped**. (1) A booking with one guest goes through Stripe Checkout with the 4242 card and lands on the "you're booked in" page. (2) A sold-out experience shows "Join the waitlist" and accepts a name and email. (3) The booker signs in to My Ef Zin and sees the **cancel preview** with exact amounts; nothing is cancelled. (4) The admin opens the experience and checks the guest in. Without the settings above, the test shows as "skipped" with the reason.
- [ ] Afterwards Claude checks the booker and admin emails arrived in Resend's log, and `/admin` shows the booking.

### F2. Payment plan with a Stripe test clock

A "test clock" lets Stripe pretend time has passed, so we can test a monthly plan in an afternoon.

**One clock per booking scenario.** A clock can hold only a small number of customers (3 at time of writing) and the site creates a fresh Stripe customer for each new email, so each scenario below (A, B, C) gets its own clock: run `setup`, set the id in Vercel, redeploy, make that one booking, finish it, delete the clock, then start the next. Always unset `STRIPE_TEST_CLOCK_ID` and redeploy after deleting a clock, otherwise new bookings fail.

- [ ] **[Claude]** Scenario A. Run `npx tsx scripts/stripe-test-clock.ts setup --card fail`. It creates a clock (no customer) and prints the clock id and exact next steps. Set `STRIPE_TEST_CLOCK_ID` in Vercel Preview to that id and redeploy.
- [ ] **[Both]** Book the monthly-plan retreat on staging with a **new email address**, choosing "Deposit + monthly payments", paying the deposit at Checkout with `4000 0000 0000 0341`.
  - **Expected:** the deposit goes through, the booking is confirmed, the confirmation email lists each future date and amount, the plan table appears under the booking in My Ef Zin.
- [ ] **[Both]** For each due date in turn (the script prints the exact commands): advance the clock (`advance --clock ... --to <date>`), pull that item's due date to today in the database, and run the daily job by hand (`curl -H "Authorization: Bearer <CRON_SECRET>" <staging>/api/cron/daily`).
  - **Expected, first instalment (failing card):** the charge is declined; the guest gets a "payment did not go through, update your card" email; Tanya gets an alert; the item shows as failed in `/admin/payments`; the booking stays active.
- [ ] **[Both]** In My Ef Zin open the booking, choose **Update card**, and enter `4242 4242 4242 4242`.
  - **Expected:** the failed instalment is collected on the new card straight away; a receipt email arrives; the item shows paid.
- [ ] **[Both]** Advance through the remaining dates the same way.
  - **Expected:** each instalment is charged on its day, each gets an "upcoming payment" email beforehand and a receipt after.
- [ ] **[Claude]** Delete clock A, unset `STRIPE_TEST_CLOCK_ID`, then repeat `setup`, set the new id and redeploy for each of the next scenarios.
- [ ] **[Both]** Scenario B (new clock, new email). Make a plan booking, let one instalment fail, then choose **Pay the rest now**.
  - **Expected:** one Stripe payment for everything still owed, booking marked fully paid, one receipt.
- [ ] **[Both]** Scenario C (new clock, new email). Make a third booking and let an instalment stay unpaid past its due date plus 2 days.
  - **Expected:** the booking is cancelled, the guest gets a "cancelled for non-payment" email, and any money-back owed under the policy is refunded automatically; Tanya is alerted.
- [ ] **[Both]** A guest with **no saved card** (rare): expect Stripe to email an invoice with a pay link, and an alert to Tanya if it goes overdue.
- [ ] **[Claude]** Delete the last test clock in Stripe, then **unset `STRIPE_TEST_CLOCK_ID`** in Vercel and redeploy.

### F3. Gift cards

Use the `/gift` page on staging with the 4242 card.

- [ ] **Single gift, now.** Buy a AED 500 card for a friend's email. **Expected:** buyer gets a receipt; the friend gets an email with the code and a printable PDF card; it appears in `/admin/gift-cards`.
- [ ] **Single gift scheduled for tomorrow.** **Expected:** buyer gets a receipt saying when it will be delivered; the friend gets nothing yet. Next day (or run `/api/cron/gift-delivery` by hand with the date moved) the friend's email arrives.
- [ ] **Bulk of 3.** Buy quantity 3. **Expected:** the buyer receives all three codes in one email; no recipient fields shown.
- [ ] **Partial use.** Book an experience costing more than the card, entering the code. **Expected:** the card covers its balance, Stripe Checkout charges only the difference, the card shows the remaining balance of 0 and a "gift card used" email.
- [ ] **Partial use, balance left.** Book something cheaper than the card. **Expected:** no card payment needed (fully covered booking confirms straight away), balance on the card reduces by the price, the check-balance page on `/gift` shows the remainder.
- [ ] **Full use.** Use up a card exactly. **Expected:** balance 0, status used.
- [ ] **Refund within 14 days.** In Stripe (test mode) refund the whole payment for a card that has never been used. **Expected:** the card turns void in `/admin/gift-cards`; its code no longer works. Also try a part-used card: refunding should be refused as a decision by Tanya (the policy says no).
- [ ] **Cancel a gift-card-paid booking.** Cancel a booking that was paid partly or fully with a gift card, from My Ef Zin. **Expected:** the preview shows the money going back to the gift card (and card portion to the bank card) per the policy; after confirming, the card balance is restored and the guest gets a cancellation email. If the gift card has expired by then, expect a 12-month credit instead.

### F4. Anything else worth a look

- [ ] **[Claude]** Waitlist: when a spot frees up (cancel a booking on a full experience), the waitlist email is sent.
- [ ] **[Claude]** Self-service: transfer a place to a friend, cancel with refund, cancel for credit. Each shows exact amounts before confirming.
- [ ] **[Claude]** `/admin` (Upcoming, People, Requests, Gift cards, Payments due) all open for the admin; CSV export downloads.

---

## G. Content and import

- [ ] **[Tanya]** Give Claude the **real prices and capacities** for each live experience (the current files carry placeholder prices and times, marked `PLACEHOLDER`) and the real start/end times.
- [ ] **[Tanya]** Give Claude the **real WhatsApp number** (replaces `971XXXXXXXXX` in `lib/site.ts`).
- [ ] **[Tanya]** Give Claude the **Google review link** (`REVIEW_URL` in `lib/site.ts`; currently points to the Contact page). It goes in the "thank you" email sent the day after.
- [ ] **[Tanya]** Send **testimonials** and **client logos** for the Bespoke page (deferred until you supply them).
- [ ] **[Tanya]** Check the FAQ and Terms wording about flights and transfers matches your current site.
- [ ] **[Tanya]** Export from Squarespace: Commerce > Customers > Export (CSV) and Commerce > Orders > Download CSV (all dates). Put both files in a folder Claude can reach (not in the project's tracked files; they contain guest emails).
- [ ] **[Claude]** Preview: `npx tsx scripts/import-squarespace.ts --customers customers.csv --orders orders.csv --dry-run`. It shows counts and a list of product names that are not yet matched to experiences.
- [ ] **[Both]** For each unmatched product (past events and retreats), Claude creates a `status: past` experience file in `content/experiences/` (title, date, photos) from the list, runs `npm run sync:content`, and adds the product to `scripts/squarespace-map.json`. Repeat the dry run until "unmapped" and "missing experiences" are empty.
- [ ] **[Claude]** Note before the first real run: if an order's first row has no email, its imported reference number can differ from an earlier test import. There is no live data, so this only matters if a trial import was already run against the same database; if so, Claude clears the `imported` bookings first.
- [ ] **[Claude]** Run the import for real **on staging first**, check `/admin/people`, then on production at launch (section I). Reruns are safe.

---

## H. Tanya's phone checklist (about 30 minutes, on the staging address)

Open the staging address on your phone. Tick what feels right; write down anything odd and send Claude a screenshot.

- [ ] Home: logo, text and photos look right, menu opens, nothing sideways-scrolls.
- [ ] `/now`: shows what is on sale right now.
- [ ] Events and Retreats lists, then open an event and a retreat: photos, schedule, "what's included", price in your phone's currency, the WhatsApp "Speak to Tanya" button opens WhatsApp.
- [ ] Book an event (use the test card `4242 4242 4242 4242`, any future date, any 3 digits): the booking panel, adding a guest, the payment page, the "you're booked in" page, the email.
- [ ] Open My Ef Zin from the email link: your booking, add health details and waiver, see the cancel preview.
- [ ] Book a retreat with a payment plan: the schedule table reads clearly, the consent tick box is clear.
- [ ] Gift page: buy a card for yourself, check the email and the printable card, check the balance.
- [ ] Sold-out experience: waitlist form works.
- [ ] Bespoke, Coaching, Contact forms: send one, check the email reaches `ADMIN_EMAILS`.
- [ ] Journal, FAQ, Terms, Privacy: readable, correct, nothing missing.
- [ ] Sign in with Google and with an email link.
- [ ] `/admin` on your phone: Upcoming, People, Requests, Gift cards, Payments due, check-in button.
- [ ] Anything that feels slow, odd, or not like you.

Claude fixes what you find and re-runs F1.

---

## I. Launch day

Do these in order. Aim for a quiet day with a couple of hours free.

### I1. Production setup

- [ ] **[Both]** Repeat B (Supabase: auth settings, template, Google, **Resend SMTP**) for `efzin-prod`. The Resend domain from A3 is already verified. Confirm Pro and backups.
- [ ] **[Claude]** Repeat C for `efzin-prod` (migrations, `sync:content`, idle timeout check). No types regeneration needed beyond a re-check.
- [ ] **[Both]** Stripe **live mode**: add the webhook endpoint with the six events (D), put the live signing secret in Vercel Production, turn Adaptive Pricing, invoice emails and Smart Retries on in live mode.
- [ ] **[Tanya]** Put all Production environment variables in Vercel (A2): live `STRIPE_SECRET_KEY`, live `STRIPE_WEBHOOK_SECRET`, prod Supabase, `NEXT_PUBLIC_SITE_ORIGIN=https://www.efzinwellness.com`, `ADMIN_EMAILS`, a **new** `CRON_SECRET`. No `STRIPE_TEST_CLOCK_ID`. Only after these are all set:
- [ ] **[Both]** Merge `phase1` into `main` (launch day only) so Production deploys. Check the build is green and `/api/cron/daily` without the secret answers 401.
- [ ] **[Claude]** Run the Squarespace import against production (G).

### I2. Domain and email DNS

Your domain is probably registered through **Google Domains, which Google moved to Squarespace Domains in 2023**. Confirm where it lives: log in at domains.squarespace.com (or Google Domains), or search the domain at who.is.

- [ ] **[Tanya]** Note down **every existing DNS record**, especially **MX** (receives your email), **TXT/SPF** and **DKIM** (proves your email is really yours). Screenshot the DNS page. **These must stay exactly as they are** or your inbox and outgoing mail will break.
- [ ] **[Both]** In Vercel > Project > Settings > Domains add `www.efzinwellness.com` and `efzinwellness.com` (redirects to www). Vercel shows what to add. Typically a `CNAME` for `www` and an `A` record for the bare domain. In your domain's DNS, **replace only** the records that point the website at Squarespace (the `www` CNAME and the `A` records for `@`); leave MX, SPF and DKIM alone.
- [ ] **[Both]** Resend: already verified in A3. Re-check Resend > Domains still shows "Verified" after the website DNS change, and that your existing MX, SPF and DKIM records are untouched.
- [ ] **[Claude]** Check after DNS settles (minutes to hours): the site loads on `https://www.efzinwellness.com` with a padlock; sending a test email from the site arrives and isn't in spam; your normal inbox still works (send yourself an email from another account).
- [ ] **[Claude]** **Check old links still work.** Each of these must answer a permanent redirect (301) to the new page:

  | Old address | Goes to |
  |---|---|
  | `/ef-zin-retreats-1` | `/events` |
  | `/ef-zin-retreats` | `/retreats` |
  | `/past-events` | `/events` |
  | `/past-retreats` | `/retreats` |
  | `/forms` | `/bespoke` |
  | `/interestform` | `/bespoke?type=retreat_interest` |
  | `/store/p/strongbody-calmmind-re` | `/events/2026-10-04-strong-body-calm-mind` |
  | `/store/p/strongbody-calmmind-re-k2dhd` | `/events/2026-10-04-strong-body-calm-mind` |
  | `/store/p/<anything else>` | `/events` |
  | `/privacy-policy-1` | `/privacy` |
  | `/privacy-policy-1-1` | `/privacy` |
  | `/faqs` | `/faq` |

  Claude checks each with `curl -sI https://www.efzinwellness.com/<old path>` and looks for `301`.

### I3. Final checks and go

- [ ] **[Tanya]** **Legal review** of Terms, Privacy and the waiver: they are drafts. Read them, ideally with a lawyer, and tell Claude any changes. Remove the draft markers once approved.
- [ ] **[Tanya]** **A real AED booking and refund.** Book the cheapest real ticket (or a small gift card) with your own card on the live site, check the confirmation email and `/admin`, then cancel it from My Ef Zin and confirm the money is back on your card (a few days). This proves live Stripe, the webhook, email and refunds all work.
- [ ] **[Both]** Check Stripe live > Developers > Webhooks shows the endpoint receiving events with "Succeeded" responses.
- [ ] **[Both]** In Vercel > Logs, check the next scheduled jobs ran with no errors (Cron Jobs tab).
- [ ] **[Tanya]** **Instagram bio link** changed to `https://www.efzinwellness.com/now`.
- [ ] **[Tanya]** Tell people: newsletter / WhatsApp broadcast with the new link.
- [ ] **[Claude]** Keep the old Squarespace site untouched (and Stripe still connected to it) until J.

---

## J. After 7 to 14 stable days

"Stable" = bookings arriving, no unexplained alert emails, scheduled jobs running every day, no guest complaints about payments.

- [ ] **[Tanya]** Check nobody still pays through the old Squarespace checkout (look for any new Squarespace orders).
- [ ] **[Tanya]** Stripe > Settings > Connected apps / Integrations: **disconnect Squarespace**.
- [ ] **[Tanya]** Download any final Squarespace exports you want to keep (customers, orders, blog posts).
- [ ] **[Tanya]** **Cancel the Squarespace plan** (keep the domain registered; it is a separate subscription).
- [ ] **[Claude]** Remove any remaining pointers to the old site; run one last redirect check.

---

## K. Known limitations and decisions made on your behalf

While building, Claude and the reviewers made these calls without bothering you. If you disagree with any, tell Claude. Each line says what it costs if it turns out wrong.

**Design and technology**

- The site is built with the newest Next.js and Tailwind versions the setup tool offered, on Node 24. *If wrong:* small code differences, no guest impact.
- A couple of experimental Next.js speed features are switched off because they get in the way of sign-in and booking. *If wrong:* pages might load a touch slower.
- Fonts: we kept Playfair Display (free, licensed for the web) instead of your supplied "Casanova" font, because free fonts are often personal-use only. *If wrong:* the headings look slightly different from your branding files; swap if you have a web licence.
- Colours: navy, chocolate and ivory come from sampled logo pixels; the other tones are approximate. *If wrong:* a tweak.
- The desktop layout was never compared side by side with the mockups. *If wrong:* layout tweaks after your phone/desktop review.
- Photos used the Squarespace CDN first, then were downloaded into the site (up to 2000px wide, JPEG quality 82). *If wrong:* a few images may look soft; re-export a better one.

**Content and pages**

- "What's on now" (`/now`) shows only experiences actually on sale, not "register interest" retreats. *If wrong:* an interest-only retreat is missing from `/now` (still on Retreats and Home).
- Retreat pages have extra sections (who it's for, accommodation, what's included/not included) and a "Speak to Tanya" WhatsApp button, to match the spec. *If wrong:* empty sections if the text isn't supplied.
- "Sold out" now follows real availability: closing a sale early means lowering capacity or marking it past. *If wrong:* an experience shows bookable/sold out unexpectedly.
- Testimonials and client logos on Bespoke are left out until you send them; FAQ facts about flights and transfers were taken from your current site. *If wrong:* the page looks thin or out of date.
- The Terms don't yet spell out every partial-gift-card case (expired card becomes credit, Ef Zin cancelling). *If wrong:* a guest query to answer by hand; the legal review (I3) should cover it.
- Bookings need the experience's end date to be in the future and its status "on sale"; ended events cannot be booked. *If wrong:* none.

**Forms and spam**

- Public forms have length limits, a hidden "honeypot" field and a simple per-visitor rate limit. The limit is per server instance, so determined spammers can get through. *If wrong:* some spam; we'd add a CAPTCHA (Cloudflare Turnstile).
- The newsletter signup has no "confirm your email" step. Someone could sign up a stranger's email. Anyone who unsubscribed is never re-subscribed. *If wrong:* a stranger gets a newsletter; add double opt-in.
- If the database is down when someone sends an enquiry, you still get it by email, and the visitor sees an error. *If wrong:* none.

**Booking, cancellation and policy**

- Retreat places can be transferred to another person at any time before the retreat (events: not within 2 hours of the start), up to 3 transfers per booking. *If wrong:* a retreat guest could transfer within 2 hours of start (harmless).
- Cancelling an event that a payment plan hasn't finished: if the policy offers money back we refund, otherwise we offer credit (for example within 48 hours of an event). *If wrong:* a credit given instead of nothing.
- When a booker cancels, the other guests on the booking are emailed. *If wrong:* a surprised guest; unlikely.
- If a booking is cancelled for non-payment, we give guests 2 extra days after the due date (more than the spec's "unpaid at the due date") so card retries and pay links can finish. *If wrong:* a spot is held up to 2 extra days.
- A checkout can leave the spots held for up to 31 minutes after a failed attempt (until Stripe expires it). *If wrong:* a spot looks taken for half an hour.
- Stripe's "abandoned cart recovery" is off; the reminder email links back to the booking page, so the guest re-enters details. *If wrong:* slightly more effort for a returning guest.
- Credits are reserved for a pending checkout the same way gift cards are, so the same credit can't be used twice at once. *If wrong:* a credit looks "in use" for up to half an hour.
- Stripe cannot charge tiny amounts, so if a gift card would leave a first payment under the minimum (AED 2.00 / EUR 0.50), the gift card covers a little less. *If wrong:* a gift card shows a little balance left over.
- If a guest pays after the gift card or credit they chose is no longer usable, their booking is still confirmed, the shortfall is added to their payment plan, and you are emailed to settle it by hand. *If wrong:* manual work for you in rare cases.
- If someone pays after their held spot expired and the experience filled up, they are still booked in (they paid) and you are emailed. *If wrong:* an experience can be one over capacity.
- A guest without a saved card is emailed a Stripe invoice with a pay link; the instalment stays unpaid until they pay. *If wrong:* relies on Stripe's email arriving.
- If a payment arrives for a cancelled booking, the guest is refunded automatically and you are emailed. Stripe fees on those refunds are not returned to Ef Zin. *If wrong:* small fee costs.
- "Pay the rest now" sessions last 30 minutes; any overpayment is refunded automatically. *If wrong:* a small Stripe fee on a refund.
- Imported (Squarespace) bookings are marked paid and checked in at the event start, so they count towards "returning guest" perks. Quantities above 1 become one booking. Refunded, cancelled, voided or pending orders are skipped and listed. Foreign-currency orders are stored with AED 0 for you to convert by hand. *If wrong:* a guest's history is slightly off.
- Past experiences for the import are created at import time, because the real list isn't known until your export is in. *If wrong:* an extra step on launch day.

**Gift cards and credits**

- Returning money to a gift card is capped at what that booking used; if the card has expired or been voided, the guest gets a 12-month credit instead. *If wrong:* a credit instead of restored balance.
- A late payer who used a gift reservation that has expired may need manual handling (you get an email). *If wrong:* manual work for you.
- Gift card value must be between AED 100 and AED 10,000 in the database. *If wrong:* a one-line change.
- A receipt is emailed to the buyer for every single gift. *If wrong:* none.
- The printable card is left out of the email if the PDF fails to generate; the code is always included. *If wrong:* a plain email.
- Only the person who paid can see their payment plan; other guests on the booking cannot. *If wrong:* a guest who wants to see it must ask the booker.

**Payments and Stripe**

- Invoices are created one step at a time (draft, add line, finalise, pay) and double-checked against what was agreed. A mismatch changes nothing and emails you. *If wrong:* an instalment waits for you.
- Refunds and cancellations void unpaid invoices even when the booking is already inactive, so retries finish cleanly. *If wrong:* none.
- Payments or retries on cancelled bookings never email the guest, but email you. *If wrong:* none.
- Stripe fees are not recovered on automatic refunds. *If wrong:* small cost per refund.
- If Stripe has the customer's saved card, the site charges it on the due date. If a card is declined once, the item is marked failed and the guest is emailed with a link to update the card. *If wrong:* an instalment waits for the guest.
- Money-related items still to triage in the final review: (a) a failed automatic refund is alerted but not retried; (b) the refund for a payment on a cancelled booking could in theory run twice if Stripe sends the same event twice (event de-duplication normally prevents it); (c) database transactions are held open across Stripe calls (hence the C check). *If wrong:* a manual refund in Stripe.

**Sign-in and accounts**

- Booking creates a My Ef Zin account automatically. Matching by email only happens when Supabase has confirmed the address and the sign-in is email-link or Google, so **"Confirm email" must stay ON**. *If wrong:* someone could see another person's bookings.
- Sign-in links are verified on the server after a tap on a confirm page, so email scanners can't use them up. Links still expire, so emails point to My Ef Zin sign-in as a fallback. *If wrong:* an older link needs a fresh sign-in.
- The admin area is read-only (people, requests, gift cards, payments) plus check-in. Refunds and cancellations on behalf of guests are done in Stripe or by Claude. *If wrong:* a request to Claude to do it.

**Emails and reminders**

- Each email kind gets simple text first, then branded templates for everything. *If wrong:* an email looks plainer than the rest.
- The "day after" email goes only to guests checked in at the event, with the review link. Day-before emails include the venue address and map link when known. *If wrong:* an absent guest misses a thank-you.
- If the daily job is missed on a given day, exact-day reminders for that day are lost (instalments still catch up). *If wrong:* a reminder missing.
- A booker email that bounces is retried daily for up to 30 days. *If wrong:* noise in the email log.

**Process**

- The launch work was split: everything automatic (this runbook, the staging test, the test-clock script) first; everything needing your accounts and phone (this document) second. *If wrong:* none.
- Scripts that use the database, Stripe or Resend only run when Claude has the keys; none of them is deployed.
