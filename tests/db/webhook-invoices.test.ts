import { describe, it, expect, beforeEach } from "vitest";
import { handleStripeEvent } from "../../lib/stripe/handlers";
import { chargeScheduledItem } from "../../lib/stripe/invoices";
import { NOW, invoiceEvent, planBooking, world, type World } from "./webhookFixtures";

let w: World;
beforeEach(async () => {
  w = await world();
});

async function item(id: string) {
  return (
    await w.db.query<{ status: string; stripe_invoice_id: string | null }>(
      "select status, stripe_invoice_id from payment_schedule_items where id = $1",
      [id],
    )
  ).rows[0];
}

describe("chargeScheduledItem", () => {
  it("builds the invoice as a draft, then finalizes and pays it with the customer's default card", async () => {
    const { bookingId, items } = await planBooking(w);
    expect(await chargeScheduledItem(w.db, w.stripe, items[1].id, NOW)).toEqual({ status: "charged", invoiceId: "in_test_1" });
    expect(w.stripe.invoicesCreated[0].params).toMatchObject({
      customer: "cus_test_1",
      currency: "eur",
      collection_method: "charge_automatically",
      auto_advance: false,
      default_payment_method: "pm_of_pi_cs_test_1",
      metadata: { kind: "scheduled_payment", item_id: items[1].id, booking_id: bookingId },
    });
    expect(w.stripe.invoiceItemsCreated[0]).toMatchObject({ invoice: "in_test_1", amount: 192000, currency: "eur" });
    // Stripe's automatic retries apply once the complete invoice is finalized.
    expect(w.stripe.invoiceFinalized).toEqual([{ id: "in_test_1", params: { auto_advance: true } }]);
    expect(w.stripe.invoiceStatus.in_test_1).toBe("paid");
    expect((await item(items[1].id)).stripe_invoice_id).toBe("in_test_1");
    // A second run does not create another invoice.
    expect((await chargeScheduledItem(w.db, w.stripe, items[1].id, NOW)).status).toBe("skipped");
    expect(w.stripe.invoicesCreated).toHaveLength(1);
  });

  it("resumes a half-built invoice when adding the line failed", async () => {
    const { items } = await planBooking(w);
    w.stripe.invoiceItemError = new Error("network");
    await expect(chargeScheduledItem(w.db, w.stripe, items[1].id, NOW)).rejects.toThrow("network");
    expect((await item(items[1].id)).stripe_invoice_id).toBe("in_test_1");
    expect(w.stripe.invoiceStatus.in_test_1).toBe("draft");

    expect(await chargeScheduledItem(w.db, w.stripe, items[1].id, NOW)).toEqual({ status: "charged", invoiceId: "in_test_1" });
    expect(w.stripe.invoicesCreated).toHaveLength(1);
    expect(w.stripe.invoiceItemsCreated).toHaveLength(1);
    expect(w.stripe.invoiceTotal.in_test_1).toBe(192000);
    expect(w.stripe.invoiceStatus.in_test_1).toBe("paid");
  });

  it("resumes a complete draft without adding a second line", async () => {
    const { items } = await planBooking(w);
    w.stripe.payError = Object.assign(new Error("boom"), { type: "StripeAPIError" });
    await expect(chargeScheduledItem(w.db, w.stripe, items[1].id, NOW)).rejects.toThrow("boom");
    w.stripe.payError = null;
    w.stripe.invoiceStatus.in_test_1 = "draft"; // as if finalize never happened
    expect((await chargeScheduledItem(w.db, w.stripe, items[1].id, NOW)).status).toBe("charged");
    expect(w.stripe.invoiceItemsCreated).toHaveLength(1);
  });

  it("reports a declined card as failed (the webhook records it)", async () => {
    const { items } = await planBooking(w);
    w.stripe.payError = Object.assign(new Error("declined"), { type: "StripeCardError" });
    expect((await chargeScheduledItem(w.db, w.stripe, items[1].id, NOW)).status).toBe("failed");
  });

  it("skips a cancelled booking", async () => {
    const { items } = await planBooking(w);
    await w.db.query("update bookings set status = 'cancelled'");
    expect(await chargeScheduledItem(w.db, w.stripe, items[1].id, NOW)).toEqual({ status: "skipped" });
    expect(w.stripe.invoicesCreated).toEqual([]);
  });

  // End of 2027-05-31 in Europe/Athens (UTC+3 in summer).
  const DUE_EOD = Math.floor(Date.parse("2027-05-31T23:59:59+03:00") / 1000);

  it("no Stripe customer: creates one and sends a pay-by-link invoice due on the item's date", async () => {
    const { items } = await planBooking(w);
    await w.db.query("update people set stripe_customer_id = null");
    expect(await chargeScheduledItem(w.db, w.stripe, items[1].id, NOW)).toEqual({ status: "invoiced", invoiceId: "in_test_1" });
    expect(w.stripe.customersCreated).toHaveLength(2);
    const params = w.stripe.invoicesCreated[0].params;
    expect(params).toMatchObject({ customer: "cus_test_2", collection_method: "send_invoice", due_date: DUE_EOD });
    expect(params.default_payment_method).toBeUndefined();
    expect(w.stripe.invoiceItemsCreated[0]).toMatchObject({ invoice: "in_test_1", amount: 192000 });
    expect(w.stripe.invoiceStatus.in_test_1).toBe("open");
    expect(w.stripe.invoicePaid).toEqual([]);
    expect(await item(items[1].id)).toEqual({ status: "scheduled", stripe_invoice_id: "in_test_1" });
  });

  it("customer without a default card: sends a pay-by-link invoice", async () => {
    const { items } = await planBooking(w);
    w.stripe.customerUpdates = [];
    expect((await chargeScheduledItem(w.db, w.stripe, items[1].id, NOW)).status).toBe("invoiced");
    expect(w.stripe.invoicesCreated[0].params).toMatchObject({ customer: "cus_test_1", collection_method: "send_invoice" });
  });

  it("emails the pay link of a pay-by-link invoice through Stripe, idempotently, also when resumed", async () => {
    const { items } = await planBooking(w);
    w.stripe.customerUpdates = [];
    w.stripe.sendInvoiceError = new Error("network");
    await expect(chargeScheduledItem(w.db, w.stripe, items[1].id, NOW)).rejects.toThrow("network");
    expect(w.stripe.invoiceStatus.in_test_1).toBe("open");
    // The next run finds the open, unsent invoice and sends it.
    expect(await chargeScheduledItem(w.db, w.stripe, items[1].id, NOW)).toEqual({ status: "invoiced", invoiceId: "in_test_1" });
    expect(w.stripe.invoicesSent).toEqual([{ id: "in_test_1", idempotencyKey: `efzin-item-${items[1].id}-send` }]);
  });

  it("a pay-by-link invoice made after the item's date is due at the end of that day, from the given clock", async () => {
    const { items } = await planBooking(w);
    w.stripe.customerUpdates = [];
    await chargeScheduledItem(w.db, w.stripe, items[1].id, new Date("2027-06-02T03:00:00Z"));
    expect(w.stripe.invoicesCreated[0].params.due_date).toBe(Math.floor(Date.parse("2027-06-02T23:59:59+03:00") / 1000));
  });
});

describe("invoice webhooks (follow-ups)", () => {
  it("invoice.overdue on a pay-by-link invoice alerts Tanya", async () => {
    const { bookingId, items } = await planBooking(w);
    await handleStripeEvent(
      invoiceEvent("evt_od", "invoice.overdue", items[1].id, bookingId, { collection_method: "send_invoice" }),
      w.deps,
    );
    expect(w.emails.map((e) => [e.kind, e.data.context])).toEqual([["admin_error", "invoice_overdue"]]);
    expect((await item(items[1].id)).status).toBe("scheduled");
  });

  it("invoice.overdue on a card invoice changes nothing", async () => {
    const { bookingId, items } = await planBooking(w);
    await handleStripeEvent(
      invoiceEvent("evt_od", "invoice.overdue", items[1].id, bookingId, { collection_method: "charge_automatically" }),
      w.deps,
    );
    expect(w.emails).toEqual([]);
  });

  it("invoice.paid for an item already paid under another invoice alerts Tanya (possible double payment)", async () => {
    const { bookingId, items } = await planBooking(w);
    await handleStripeEvent(invoiceEvent("evt_a", "invoice.paid", items[1].id, bookingId), w.deps);
    w.emails.length = 0;
    await handleStripeEvent(invoiceEvent("evt_b", "invoice.paid", items[1].id, bookingId), w.deps);
    expect(w.emails.map((e) => [e.kind, e.data.context])).toEqual([["admin_error", "possible_double_payment"]]);
    expect((await item(items[1].id)).stripe_invoice_id).toBe("in_evt_a");
  });

  it("a repeat invoice.paid for the same invoice is not a double payment", async () => {
    const { bookingId, items } = await planBooking(w);
    await handleStripeEvent(invoiceEvent("evt_a", "invoice.paid", items[1].id, bookingId), w.deps);
    w.emails.length = 0;
    await w.db.query("delete from stripe_events");
    await handleStripeEvent(invoiceEvent("evt_a", "invoice.paid", items[1].id, bookingId), w.deps);
    expect(w.emails).toEqual([]);
  });
});
