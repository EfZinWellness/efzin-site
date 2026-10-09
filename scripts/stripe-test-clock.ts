/**
 * Stripe TEST-mode helper for the payment-plan scenario (see docs/launch-runbook.md, section F).
 *
 *   npx tsx scripts/stripe-test-clock.ts setup [--card fail|ok] [--name "Plan Tester"] [--start YYYY-MM-DD]
 *   npx tsx scripts/stripe-test-clock.ts advance --clock clock_... --to YYYY-MM-DD
 *   npx tsx scripts/stripe-test-clock.ts status --clock clock_...
 *   npx tsx scripts/stripe-test-clock.ts dates --start YYYY-MM-DD [--count 5]
 *
 * Needs STRIPE_SECRET_KEY (sk_test_ only; a live key is refused before anything is called).
 */
import Stripe from "stripe";
import { addMonthsClamped } from "../lib/payments/schedule";
import { assertStripeTestKey } from "../lib/stripe/testKey";

export const CARDS = {
  /** Attaches fine, then every charge is declined. */
  fail: { number: "4000000000000341", label: "4000 0000 0000 0341 (attaches, then declines every charge)", pm: "pm_card_chargeCustomerFail" },
  ok: { number: "4242424242424242", label: "4242 4242 4242 4242 (always succeeds)", pm: "pm_card_visa" },
} as const;

export type Command = "setup" | "advance" | "status" | "dates";

export interface Args {
  command: Command;
  card: keyof typeof CARDS;
  name: string;
  start?: string;
  clock?: string;
  to?: string;
  count: number;
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const COMMANDS: Command[] = ["setup", "advance", "status", "dates"];
const OPTIONS = ["card", "name", "start", "clock", "to", "count"];

export function parseArgs(argv: string[]): Args {
  const rest = [...argv];
  let command: Command = "setup";
  if (rest[0] && !rest[0].startsWith("--")) {
    const c = rest.shift()!;
    if (!COMMANDS.includes(c as Command)) throw new Error(`Unknown command "${c}". Use: ${COMMANDS.join(", ")}.`);
    command = c as Command;
  }
  const opts: Record<string, string> = {};
  while (rest.length) {
    const flag = rest.shift()!;
    if (!flag.startsWith("--") || !OPTIONS.includes(flag.slice(2))) throw new Error(`Unknown option "${flag}".`);
    const value = rest.shift();
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
    opts[flag.slice(2)] = value;
  }
  const card = (opts.card ?? "fail") as keyof typeof CARDS;
  if (!(card in CARDS)) throw new Error('--card must be "fail" or "ok".');
  if (opts.to !== undefined && !YMD.test(opts.to)) throw new Error("--to must be a date like YYYY-MM-DD.");
  if (opts.start !== undefined && !YMD.test(opts.start)) throw new Error("--start must be a date like YYYY-MM-DD.");
  const count = opts.count === undefined ? 5 : Number(opts.count);
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new Error("--count must be a whole number from 1 to 12.");
  if (command === "advance") {
    if (!opts.clock) throw new Error("advance needs --clock clock_...");
    if (!opts.to) throw new Error("advance needs --to YYYY-MM-DD");
  }
  if (command === "status" && !opts.clock) throw new Error("status needs --clock clock_...");
  if (command === "dates" && !opts.start) throw new Error("dates needs --start YYYY-MM-DD");
  return { command, card, name: opts.name ?? "Plan Tester", start: opts.start, clock: opts.clock, to: opts.to, count };
}

/** Monthly instalment dates counted from the first one (deposit date), month-end clamped. */
export function planDates(start: string, count: number): string[] {
  return Array.from({ length: count }, (_, k) => addMonthsClamped(start, k));
}

const toUnix = (ymd: string, hour = 12) =>
  Math.floor(Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10), hour) / 1000);
const fromUnix = (s: number) => new Date(s * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";

async function setup(stripe: Stripe, a: Args): Promise<void> {
  const frozen = a.start ? toUnix(a.start) : Math.floor(Date.now() / 1000);
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: frozen, name: `efzin-plan-${Date.now()}` });
  const first = a.start ?? new Date(clock.frozen_time * 1000).toISOString().slice(0, 10);
  console.log(`
Test clock ready (TEST mode).
  clock     ${clock.id}   (frozen at ${fromUnix(clock.frozen_time)})
  card      ${CARDS[a.card].label}

One clock per booking scenario: a clock holds only a small number of customers (3 at time of writing),
so run "setup" again for each new scenario instead of reusing one clock.

How the site uses it
  1. In Vercel (staging / Preview environment) set  STRIPE_TEST_CLOCK_ID=${clock.id}  and redeploy
     (changed settings only apply to a new deployment). Every NEW Stripe customer the site creates is then
     attached to this clock (test keys only). Book with a NEW email so the site creates a fresh customer.
  2. Book the monthly-plan retreat on the staging site. In Stripe Checkout use the card above:
     ${CARDS[a.card].number}, any future expiry, any CVC. (The failing card saves fine at checkout and
     declines on the later charges, which is the point of the scenario.)
  3. Read the due dates:  select seq, due_on, status from payment_schedule_items order by booking_id, seq;
  4. For each due date, in order:
       a. Move Stripe's clock:   npx tsx scripts/stripe-test-clock.ts advance --clock ${clock.id} --to <due date>
       b. Make the site collect that instalment. The site's daily job works from the real calendar, so pull the
          item's due date forward in the database:
            update payment_schedule_items set due_on = current_date where booking_id = '<booking id>' and seq = <n>;
          then run the daily job:
            curl -H "Authorization: Bearer $CRON_SECRET" https://<staging address>/api/cron/daily
       c. Check:  npx tsx scripts/stripe-test-clock.ts status --clock ${clock.id}
  5. With the failing card the first charge is declined: expect the "payment did not go through" email, the item
     marked failed in /admin/payments, and Stripe retrying (Smart Retries) as the clock moves on.
  6. In My Ef Zin open the booking, choose Update card, enter 4242 4242 4242 4242. The failed instalment is
     collected on the new card. Then try Pay the rest now for what remains.
  7. When done, delete the clock in the Stripe dashboard (Test mode > Developers > Test clocks); that removes
     its customers too. Then UNSET STRIPE_TEST_CLOCK_ID in Vercel and redeploy (a deleted clock makes new bookings fail).

Planned dates (deposit on the clock's date, then monthly):
  ${planDates(first, 5).join("  ")}
`);
}

async function advance(stripe: Stripe, a: Args): Promise<void> {
  const clock = await stripe.testHelpers.testClocks.advance(a.clock!, { frozen_time: toUnix(a.to!) });
  console.log(
    `Advancing ${clock.id} to ${fromUnix(toUnix(a.to!))}. Status: ${clock.status}. Stripe takes a few seconds to process; run "status" to check.`,
  );
}

async function status(stripe: Stripe, a: Args): Promise<void> {
  const clock = await stripe.testHelpers.testClocks.retrieve(a.clock!);
  console.log(`Clock ${clock.id}: ${clock.status}, time is ${fromUnix(clock.frozen_time)}`);
  const customers = await stripe.customers.list({ test_clock: clock.id, limit: 10 });
  for (const c of customers.data) {
    console.log(`\nCustomer ${c.id} (${c.email})`);
    const invoices = await stripe.invoices.list({ customer: c.id, limit: 20 });
    if (invoices.data.length === 0) console.log("  no invoices yet");
    for (const inv of invoices.data) {
      console.log(`  ${inv.id}  ${inv.status}  ${(inv.total / 100).toFixed(2)} ${inv.currency.toUpperCase()}  attempts: ${inv.attempt_count}`);
    }
  }
}

async function main(): Promise<number> {
  let args: Args;
  let key = "";
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.command !== "dates") key = assertStripeTestKey(process.env.STRIPE_SECRET_KEY);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  if (args.command === "dates") {
    console.log(planDates(args.start!, args.count).join("\n"));
    return 0;
  }
  const stripe = new Stripe(key);
  try {
    if (args.command === "setup") await setup(stripe, args);
    else if (args.command === "advance") await advance(stripe, args);
    else await status(stripe, args);
    return 0;
  } catch (e) {
    console.error(`Stripe said: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

// Run only when started directly (tests import this file for parseArgs and the guard).
if (process.argv[1] && /stripe-test-clock\.[cm]?[jt]s$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main().then((code) => process.exit(code));
}
