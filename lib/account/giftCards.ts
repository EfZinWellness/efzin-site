import type { SqlClient } from "../content/sync";
import { dubaiToday } from "../giftcards/dates";
import { maskCode } from "../giftcards/deliver";

export interface AccountGiftCard {
  id: string;
  /** Full code for cards that are the person's to spend; masked for cards bought for someone else. */
  code: string;
  initialAedMinor: number;
  balanceAedMinor: number;
  status: "active" | "expired";
  /** ISO timestamp */
  expiresAt: string | null;
  /** Who it was for (bought cards). */
  recipientLabel: string;
  /** Who sent it (received cards). */
  fromName: string;
  /** The code can be emailed to the person (active, and not masked). */
  canResend: boolean;
}

/**
 * SQL predicates over `gift_cards g` and the signed-in person `me`, with $today (a Dubai date).
 * - FOR_SOMEONE_ELSE: bought by me for another recipient (code masked, never re-sent to me).
 * - RECEIVED_VISIBLE: addressed to / used by me and already due (delivered, or the delivery date has come).
 * - HOLDS_CODE: I may see the full code (and have it re-sent).
 */
export const giftSql = (today: string) => {
  const forSomeoneElse = `(g.buyer_person_id = me.id and g.recipient_email is not null
      and lower(g.recipient_email) <> lower(me.email) and g.recipient_person_id is distinct from me.id)`;
  const receivedVisible = `((g.recipient_person_id = me.id or lower(g.recipient_email) = lower(me.email))
      and (g.delivered_at is not null or g.deliver_on <= ${today}::date))`;
  return {
    forSomeoneElse,
    receivedVisible,
    holdsCode: `((g.buyer_person_id = me.id and not ${forSomeoneElse}) or ${receivedVisible})`,
  };
};

interface Row {
  id: string;
  code: string;
  initial_aed_minor: number;
  balance_aed_minor: number;
  status: "active" | "expired";
  expires_at: string | Date | null;
  recipient_name: string | null;
  recipient_email: string | null;
  buyer_person_id: string;
  buyer_name: string;
  for_someone_else: boolean;
}

/**
 * Active and expired gift cards the person bought, and those they received from someone else
 * (linked to them, or addressed to their email) once the delivery date has come. Pending and
 * void cards are not shown.
 */
export async function loadGiftCards(
  db: SqlClient,
  personId: string,
  now: Date,
): Promise<{ bought: AccountGiftCard[]; received: AccountGiftCard[] }> {
  const q = giftSql("$2");
  const r = await db.query<Row>(
    `select g.id, g.code, g.initial_aed_minor, g.balance_aed_minor, g.status, g.expires_at, g.recipient_name,
            g.recipient_email, g.buyer_person_id, b.name as buyer_name, ${q.forSomeoneElse} as for_someone_else
       from gift_cards g
       join people b on b.id = g.buyer_person_id
       join people me on me.id = $1
      where g.status in ('active', 'expired')
        and (g.buyer_person_id = me.id or ${q.receivedVisible})
      order by g.created_at desc, g.id`,
    [personId, dubaiToday(now)],
  );
  const bought: AccountGiftCard[] = [];
  const received: AccountGiftCard[] = [];
  for (const g of r.rows) {
    const view: AccountGiftCard = {
      id: g.id,
      code: g.for_someone_else ? maskCode(g.code) : g.code,
      initialAedMinor: g.initial_aed_minor,
      balanceAedMinor: g.balance_aed_minor,
      status: g.status,
      expiresAt: g.expires_at === null ? null : new Date(g.expires_at).toISOString(),
      recipientLabel: g.recipient_name || g.recipient_email || "You",
      fromName: g.buyer_name,
      canResend: g.status === "active" && !g.for_someone_else,
    };
    (g.buyer_person_id === personId ? bought : received).push(view);
  }
  return { bought, received };
}
