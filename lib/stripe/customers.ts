import type { SqlClient } from "../content/sync";
import type { StripeApi } from "./client";
import { isStripeTestKey } from "./testKey";

/** Staging only: attach new customers to a Stripe test clock (scripts/stripe-test-clock.ts). */
export function testClockParam(): { test_clock?: string } {
  const clock = process.env.STRIPE_TEST_CLOCK_ID?.trim();
  return clock && isStripeTestKey(process.env.STRIPE_SECRET_KEY) ? { test_clock: clock } : {};
}

/** Returns the person's Stripe customer, creating and storing it (people.stripe_customer_id) on first use. */
export async function ensureStripeCustomer(db: SqlClient, stripe: StripeApi, personId: string): Promise<string> {
  const r = await db.query<{ name: string; email: string; phone: string | null; stripe_customer_id: string | null }>(
    "select name, email, phone, stripe_customer_id from people where id = $1",
    [personId],
  );
  const person = r.rows[0];
  if (!person) throw new Error(`Person ${personId} not found`);
  if (person.stripe_customer_id) return person.stripe_customer_id;

  const customer = await stripe.customers.create(
    {
      name: person.name,
      email: person.email,
      ...(person.phone ? { phone: person.phone } : {}),
      metadata: { person_id: personId },
      ...testClockParam(),
    },
    // A retried request for the same person reuses the same customer.
    { idempotencyKey: `efzin-person-${personId}` },
  );
  const set = await db.query<{ stripe_customer_id: string }>(
    `update people set stripe_customer_id = coalesce(stripe_customer_id, $2)
      where id = $1 returning stripe_customer_id`,
    [personId, customer.id],
  );
  return set.rows[0].stripe_customer_id;
}
