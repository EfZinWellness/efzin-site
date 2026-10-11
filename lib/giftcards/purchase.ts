import { z } from "zod";
import type { SqlClient } from "../content/sync";
import type { EmailKind } from "../email/send";
import { upsertPersonByEmail } from "../people/upsert";
import { adminAddress } from "../requests/handlers";
import { definitelyRejected, SAVED_CARD_FILTERS } from "../stripe/checkout";
import type { StripeApi } from "../stripe/client";
import { ensureStripeCustomer } from "../stripe/customers";
import { addMonthsYmd, dubaiToday, isValidYmd } from "./dates";
import { issueGiftCards } from "./db";

/** AED 250 / 500 / 1,000 / 2,500, in fils. */
export const GIFT_PRESETS_AED_MINOR = [25000, 50000, 100000, 250000] as const;
export const GIFT_MIN_AED_MINOR = 10000;
export const GIFT_MAX_AED_MINOR = 1000000;
export const GIFT_MAX_QUANTITY = 50;
export const GIFT_MESSAGE_MAX = 300;

export interface GiftPurchase {
  amountAedMinor: number;
  quantity: number;
  sendTo: "recipient" | "me";
  recipientName?: string;
  recipientEmail?: string;
  message?: string;
  /** Delivery date, YYYY-MM-DD (Dubai). */
  deliverOn: string;
  suggestedSlug?: string;
  buyerName: string;
  buyerEmail: string;
}

/** Blank form fields arrive as "": treat them as absent. */
const blank = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema);

/**
 * Validates a gift purchase. `now` fixes "today" (an Asia/Dubai calendar date) for the delivery
 * date range: today up to 12 months ahead. With a quantity above 1 every card goes to the
 * buyer straight away, so the recipient, message and date are dropped.
 */
export function GiftPurchaseSchema(now: Date) {
  const today = dubaiToday(now);
  const latest = addMonthsYmd(today, 12);
  return z
    .object({
      amountAedMinor: z
        .number("Choose a value.")
        .int("Choose a value.")
        .min(GIFT_MIN_AED_MINOR, "The value must be between AED 100 and AED 10,000.")
        .max(GIFT_MAX_AED_MINOR, "The value must be between AED 100 and AED 10,000."),
      quantity: blank(
        z
          .number("Choose how many.")
          .int("Choose how many.")
          .min(1, "Choose between 1 and 50 cards.")
          .max(GIFT_MAX_QUANTITY, "Choose between 1 and 50 cards.")
          .default(1),
      ),
      sendTo: blank(z.enum(["recipient", "me"]).default("recipient")),
      recipientName: blank(z.string().trim().min(1).max(120).optional()),
      recipientEmail: blank(z.email("Enter a valid recipient email.").max(254).optional()),
      message: blank(z.string().trim().max(GIFT_MESSAGE_MAX, "The message can be up to 300 characters.").optional()),
      deliverOn: blank(z.string().optional()),
      suggestedSlug: blank(z.string().max(120).regex(/^[a-z0-9][a-z0-9-]*$/).optional()),
      buyerName: z.string("Enter your name.").trim().min(1, "Enter your name.").max(120),
      buyerEmail: z.email("Enter a valid email.").max(254),
      website: z.string().max(0).optional(),
    })
    .superRefine((v, ctx) => {
      if (v.quantity !== 1) return;
      if (v.deliverOn !== undefined && (!isValidYmd(v.deliverOn) || v.deliverOn < today || v.deliverOn > latest)) {
        ctx.addIssue({ code: "custom", path: ["deliverOn"], message: "Choose a delivery date from today to 12 months ahead." });
      }
      if (v.sendTo === "recipient") {
        if (!v.recipientName) ctx.addIssue({ code: "custom", path: ["recipientName"], message: "Enter the recipient's name." });
        if (!v.recipientEmail) ctx.addIssue({ code: "custom", path: ["recipientEmail"], message: "Enter the recipient's email." });
      }
    })
    .transform((v): GiftPurchase => {
      const base = {
        amountAedMinor: v.amountAedMinor,
        quantity: v.quantity,
        suggestedSlug: v.suggestedSlug,
        buyerName: v.buyerName,
        buyerEmail: v.buyerEmail.toLowerCase(),
      };
      if (v.quantity > 1) return { ...base, sendTo: "me", deliverOn: today };
      if (v.sendTo === "me") return { ...base, sendTo: "me", message: v.message, deliverOn: v.deliverOn ?? today };
      return {
        ...base,
        sendTo: "recipient",
        recipientName: v.recipientName,
        recipientEmail: v.recipientEmail?.toLowerCase(),
        message: v.message,
        deliverOn: v.deliverOn ?? today,
      };
    });
}

export interface GiftCheckoutDeps {
  /** One dedicated connection: the cards and batch are issued in a transaction. */
  db: SqlClient;
  stripe: StripeApi;
  /** Site origin for return URLs. */
  origin: string;
  now: Date;
  /** The signed-in person (session cookie); saved cards only when it is the buyer. */
  signedInPersonId?: string | null;
}

/**
 * Issues the (pending) cards with their batch in one transaction, then opens Stripe Checkout
 * in AED (Adaptive Pricing shows the buyer their own currency). The cards only become active
 * when the webhook confirms payment. If Stripe definitely rejects the session the pending
 * cards are deleted; on an ambiguous failure they stay (they can never activate unpaid).
 * Discounts are not offered: gift cards cannot buy gift cards.
 */
export async function startGiftCheckout(input: GiftPurchase, deps: GiftCheckoutDeps): Promise<{ url: string }> {
  const { db, stripe } = deps;
  const buyerPersonId = await upsertPersonByEmail(db, { name: input.buyerName, email: input.buyerEmail });
  // Signed in as the buyer: their Stripe customer, so Checkout offers to save the card and shows
  // saved ones. Anyone else (the buyer is found by the typed email): no customer, so nobody's
  // saved cards can be used. Made before any card is issued: a failure leaves nothing behind.
  const signedIn = !!deps.signedInPersonId && deps.signedInPersonId === buyerPersonId;
  const customer = signedIn ? await ensureStripeCustomer(db, stripe, buyerPersonId) : null;
  const suggested = input.suggestedSlug
    ? (await db.query<{ id: string }>("select id from experiences where slug = $1", [input.suggestedSlug])).rows[0]
    : undefined;
  const toBuyer = input.sendTo === "me";
  const recipient =
    input.quantity > 1
      ? undefined
      : toBuyer
        ? { name: input.buyerName, email: input.buyerEmail }
        : { name: input.recipientName, email: input.recipientEmail };

  let batchId: string;
  await db.query("begin");
  try {
    batchId = (
      await db.query<{ id: string }>(
        "insert into gift_card_batches (buyer_person_id, quantity) values ($1, $2) returning id",
        [buyerPersonId, input.quantity],
      )
    ).rows[0].id;
    await issueGiftCards(db, {
      count: input.quantity,
      initialAedMinor: input.amountAedMinor,
      buyerPersonId,
      recipient,
      message: input.quantity > 1 ? null : input.message,
      suggestedExperienceId: suggested?.id ?? null,
      deliverOn: input.deliverOn,
      batchId,
      // Replaced by the real payment intent when the webhook activates the cards.
      paymentRef: `gift_batch_${batchId}`,
    });
    await db.query("commit");
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }

  try {
    const metadata = { kind: "gift_purchase", batch_id: batchId };
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        // Card only (Apple Pay / Google Pay are card wallets, so included): no delayed methods
        // that settle days later.
        allowed_payment_method_types: ["card"],
        adaptive_pricing: { enabled: true },
        ...(customer
          ? {
              customer,
              saved_payment_method_options: { payment_method_save: "enabled" as const, allow_redisplay_filters: SAVED_CARD_FILTERS },
            }
          : { customer_email: input.buyerEmail }),
        client_reference_id: batchId,
        allow_promotion_codes: false,
        line_items: [
          {
            quantity: input.quantity,
            price_data: {
              currency: "aed",
              unit_amount: input.amountAedMinor,
              product_data: {
                name: "Ef Zin gift card",
                description: "Valid for 12 months on any Ef Zin event or retreat",
              },
            },
          },
        ],
        metadata,
        payment_intent_data: { metadata },
        success_url: `${deps.origin}/gift?paid=1`,
        cancel_url: `${deps.origin}/gift`,
      },
      { idempotencyKey: `efzin-gift-${batchId}` },
    );
    if (!session.url) throw new Error("Stripe returned a Checkout session without a URL");
    return { url: session.url };
  } catch (err) {
    if (definitelyRejected(err)) {
      await db
        .query("delete from gift_cards where purchase_batch_id = $1 and status = 'pending_payment'", [batchId])
        .then(() => db.query("delete from gift_card_batches where id = $1", [batchId]))
        .catch((e) => console.error("could not remove pending gift cards", e));
    }
    throw err;
  }
}

export interface GiftHandlerDeps {
  /** Runs fn on one dedicated connection; null when no database is configured. */
  withDb: <T>(fn: (db: SqlClient) => Promise<T>) => Promise<T | null>;
  stripe: StripeApi | null;
  origin: string;
  now: Date;
  sendEmail: (kind: EmailKind, to: string, data: Record<string, unknown>) => Promise<void>;
  /** The signed-in person's id (session cookie), or null. */
  currentPersonId?: () => Promise<string | null>;
}

type GiftBody = { url: string } | { error: string; errors?: string[]; message?: string };

const UNAVAILABLE = { error: "unavailable", message: "Gift cards cannot be bought online right now. Please message us." };

/** POST /api/gift/checkout, minus the body cap and throttle (see the route). */
export async function handleGiftCheckout(
  body: unknown,
  deps: GiftHandlerDeps,
): Promise<{ status: number; body: GiftBody }> {
  const parsed = GiftPurchaseSchema(deps.now).safeParse(body);
  if (!parsed.success) {
    return { status: 400, body: { error: "invalid", errors: [...new Set(parsed.error.issues.map((i) => i.message))] } };
  }
  const stripe = deps.stripe;
  if (!stripe) return { status: 503, body: UNAVAILABLE };
  try {
    const signedInPersonId = deps.currentPersonId ? await deps.currentPersonId().catch(() => null) : null;
    const out = await deps.withDb((db) =>
      startGiftCheckout(parsed.data, { db, stripe, origin: deps.origin, now: deps.now, signedInPersonId }),
    );
    return out === null ? { status: 503, body: UNAVAILABLE } : { status: 200, body: out };
  } catch (err) {
    console.error("gift checkout failed", err);
    try {
      await deps.sendEmail("admin_error", adminAddress(), {
        problem: "A buyer could not start a gift card checkout.",
        error: err instanceof Error ? err.message : String(err),
      });
    } catch (mailErr) {
      console.error("admin_error email failed", mailErr);
    }
    return { status: 500, body: { error: "server", message: "Something went wrong. Please try again." } };
  }
}
