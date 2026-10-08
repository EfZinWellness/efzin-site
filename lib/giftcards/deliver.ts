import type { SqlClient } from "../content/sync";
import { renderGiftCardPdf } from "../email/pdf/GiftCardPdf";
import { sendQuietly, type EmailAttachment, type SendEmailFn } from "../email/send";
import { estimateLocal, formatMoney } from "../pricing/estimate";
import { giftCodesCsv } from "./csv";
import { dubaiToday, formatYmd } from "./dates";
import { formatAed } from "./money";

export interface DeliverDeps {
  sendEmail: SendEmailFn;
  /** Site origin for the "Book with your gift" link. */
  origin: string;
  /** USD rates for the recipient "≈" estimate; without them no estimate is shown. */
  usdRates?: () => Promise<Record<string, number>>;
}

interface DueRow {
  id: string;
  code: string;
  initial_aed_minor: number;
  recipient_name: string | null;
  recipient_email: string | null;
  message: string | null;
  expires_at: string | Date;
  purchase_batch_id: string | null;
  presentment_currency: string | null;
  buyer_name: string;
  buyer_email: string;
  slug: string | null;
  title: string | null;
  quantity: number | null;
  buyer_receipt_sent_at: string | Date | null;
  deliver_on: string | Date;
}

const expiryYmd = (v: string | Date): string => dubaiToday(new Date(v));

/** Marks the card delivered if nobody else has; false when another run already took it. */
async function claim(db: SqlClient, id: string, now: Date): Promise<boolean> {
  const r = await db.query<{ id: string }>(
    "update gift_cards set delivered_at = $2 where id = $1 and delivered_at is null returning id",
    [id, now.toISOString()],
  );
  return r.rows.length > 0;
}

const unclaim = (db: SqlClient, ids: string[]) =>
  Promise.all(ids.map((id) => db.query("update gift_cards set delivered_at = null where id = $1", [id]))).then(() => {});

/** "EFZG-ABCD-EFGH" -> "EFZG-••••-EFGH". */
export const maskCode = (code: string): string => `EFZG-••••-${code.slice(-4)}`;

/**
 * Sends the "Gift card bought" receipt to the buyer for each active single (non-bulk) card of
 * the purchase, once per card (claimed with buyer_receipt_sent_at, undone if the send fails).
 * Cards already receipted (e.g. a send-to-me gift delivered with receipt wording) are skipped.
 * Never throws. Bulk purchases get their codes email from deliverDueGiftCards instead.
 */
export async function sendBuyerReceipts(
  db: SqlClient,
  now: Date,
  deps: DeliverDeps,
  paymentIntent: string,
): Promise<number> {
  const rows = await db.query<DueRow>(
    `select g.id, g.code, g.initial_aed_minor, g.recipient_name, g.recipient_email, g.buyer_receipt_sent_at,
            g.deliver_on, b.name as buyer_name, b.email as buyer_email
       from gift_cards g
       join people b on b.id = g.buyer_person_id
       left join gift_card_batches bt on bt.id = g.purchase_batch_id
      where g.status = 'active' and g.buyer_receipt_sent_at is null and g.stripe_payment_intent = $1
        and coalesce(bt.quantity, 1) = 1
      order by g.created_at, g.id`,
    [paymentIntent],
  );
  let n = 0;
  for (const r of rows.rows) {
    const claimed = await db.query<{ id: string }>(
      "update gift_cards set buyer_receipt_sent_at = $2 where id = $1 and buyer_receipt_sent_at is null returning id",
      [r.id, now.toISOString()],
    );
    if (!claimed.rows[0]) continue;
    const self = !r.recipient_email || r.recipient_email.toLowerCase() === r.buyer_email.toLowerCase();
    const ok = await sendQuietly(deps.sendEmail, "gift_card_bought", r.buyer_email, {
      buyerName: r.buyer_name,
      value: formatAed(r.initial_aed_minor),
      recipientLabel: self ? "you" : r.recipient_name || r.recipient_email,
      deliverOn: formatYmd(typeof r.deliver_on === "string" ? r.deliver_on.slice(0, 10) : r.deliver_on.toISOString().slice(0, 10)),
      codeMasked: maskCode(r.code),
      bookUrl: `${deps.origin}/events`,
    });
    if (ok) n++;
    else await db.query("update gift_cards set buyer_receipt_sent_at = null where id = $1", [r.id]);
  }
  return n;
}

/**
 * Emails every active gift card whose delivery date has come (Asia/Dubai calendar date) and
 * that has not been delivered. A single card goes to its recipient (PDF attached), then the
 * buyer gets a "delivered" note (not when the buyer is the recipient). A bulk purchase sends
 * the buyer one email with all codes and a CSV. A card is claimed before sending and put back
 * if the email fails, so re-runs and webhook retries never send twice and failures are retried.
 * `paymentIntent` limits the run to one purchase. Returns the number of cards delivered.
 */
export async function deliverDueGiftCards(
  db: SqlClient,
  now: Date,
  deps: DeliverDeps,
  opts: { paymentIntent?: string } = {},
): Promise<number> {
  const due = await db.query<DueRow>(
    `select g.id, g.code, g.initial_aed_minor, g.recipient_name, g.recipient_email, g.message, g.expires_at,
            g.purchase_batch_id, g.presentment_currency, b.name as buyer_name, b.email as buyer_email,
            x.slug, x.title, bt.quantity, g.buyer_receipt_sent_at, g.deliver_on
       from gift_cards g
       join people b on b.id = g.buyer_person_id
       left join experiences x on x.id = g.suggested_experience_id
       left join gift_card_batches bt on bt.id = g.purchase_batch_id
      where g.status = 'active' and g.delivered_at is null and g.deliver_on <= $1::date
        and ($2::text is null or g.stripe_payment_intent = $2)
      order by g.created_at, g.id`,
    [dubaiToday(now), opts.paymentIntent ?? null],
  );

  const bulk = new Map<string, DueRow[]>();
  const singles: DueRow[] = [];
  for (const r of due.rows) {
    if ((r.quantity ?? 1) > 1 && r.purchase_batch_id) bulk.set(r.purchase_batch_id, [...(bulk.get(r.purchase_batch_id) ?? []), r]);
    else if (r.recipient_email) singles.push(r);
  }

  let delivered = 0;
  const rates = deps.usdRates ? await deps.usdRates().catch(() => ({}) as Record<string, number>) : {};

  for (const r of singles) {
    if (!(await claim(db, r.id, now))) continue;
    try {
      const expiresOn = expiryYmd(r.expires_at);
      const toSelf = r.recipient_email!.toLowerCase() === r.buyer_email.toLowerCase();
      const cur = r.presentment_currency;
      const local = toSelf && cur && cur !== "AED" ? estimateLocal(r.initial_aed_minor, "AED", cur, rates) : null;
      let attachments: EmailAttachment[] | undefined;
      try {
        const pdf = await renderGiftCardPdf({
          code: r.code,
          valueAedMinor: r.initial_aed_minor,
          recipientName: r.recipient_name,
          message: r.message,
          expiresOn,
          suggestedTitle: r.title,
        });
        attachments = [{ filename: `ef-zin-gift-card-${r.code}.pdf`, content: pdf, contentType: "application/pdf" }];
      } catch (err) {
        console.error("gift card PDF failed; sending without it", err);
      }
      // A send-to-me gift's delivery email doubles as the buyer's receipt (unless already sent).
      const asReceipt = toSelf && r.buyer_receipt_sent_at === null;
      await deps.sendEmail(
        "gift_card_delivered",
        r.recipient_email!,
        {
          hasPdf: attachments !== undefined,
          ...(asReceipt ? { receipt: true } : {}),
          recipientName: r.recipient_name ?? "",
          buyerName: r.buyer_name,
          message: r.message ?? "",
          code: r.code,
          value: formatAed(r.initial_aed_minor),
          ...(local !== null && cur ? { estimate: `≈ ${formatMoney(local, cur)}` } : {}),
          suggested: r.title ?? "",
          expiresOn,
          bookUrl: r.slug ? `${deps.origin}/book/${r.slug}` : `${deps.origin}/events`,
        },
        attachments,
      );
      if (asReceipt) {
        await db
          .query("update gift_cards set buyer_receipt_sent_at = $2 where id = $1 and buyer_receipt_sent_at is null", [r.id, now.toISOString()])
          .catch((e) => console.error("could not record receipt", e));
      }
    } catch (err) {
      console.error(`gift card ${r.id} delivery failed; will retry`, err);
      await unclaim(db, [r.id]);
      continue;
    }
    delivered++;
    if (r.recipient_email!.toLowerCase() !== r.buyer_email.toLowerCase()) {
      await sendQuietly(deps.sendEmail, "gift_card_delivered_buyer", r.buyer_email, {
        buyerName: r.buyer_name,
        recipientName: r.recipient_name ?? "",
        recipientEmail: r.recipient_email,
        value: formatAed(r.initial_aed_minor),
      });
    }
  }

  for (const rows of bulk.values()) {
    const claimed: DueRow[] = [];
    for (const r of rows) if (await claim(db, r.id, now)) claimed.push(r);
    if (claimed.length === 0) continue;
    const first = claimed[0];
    try {
      const cards = claimed.map((r) => ({
        code: r.code,
        valueAedMinor: r.initial_aed_minor,
        expiresOn: expiryYmd(r.expires_at),
      }));
      await deps.sendEmail(
        "gift_card_bought",
        first.buyer_email,
        {
          buyerName: first.buyer_name,
          value: formatAed(first.initial_aed_minor),
          expiresOn: cards[0].expiresOn,
          codes: cards.map((c) => c.code),
          bookUrl: `${deps.origin}/events`,
        },
        [{ filename: "ef-zin-gift-cards.csv", content: giftCodesCsv(cards), contentType: "text/csv" }],
      );
    } catch (err) {
      console.error("bulk gift card email failed; will retry", err);
      await unclaim(db, claimed.map((r) => r.id));
      continue;
    }
    delivered += claimed.length;
  }
  return delivered;
}
