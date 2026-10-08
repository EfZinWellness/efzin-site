import type { SqlClient } from "../content/sync";
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
}

interface Row {
  id: string;
  code: string;
  initial_aed_minor: number;
  balance_aed_minor: number;
  status: "active" | "expired";
  expires_at: string | Date | null;
  recipient_name: string | null;
  recipient_email: string | null;
  recipient_person_id: string | null;
  buyer_person_id: string;
  buyer_name: string;
  my_email: string;
}

/**
 * Active and expired gift cards the person bought, and those they received (linked to them, or
 * addressed to their email) from someone else. Pending and void cards are not shown.
 */
export async function loadGiftCards(
  db: SqlClient,
  personId: string,
): Promise<{ bought: AccountGiftCard[]; received: AccountGiftCard[] }> {
  const r = await db.query<Row>(
    `select g.id, g.code, g.initial_aed_minor, g.balance_aed_minor, g.status, g.expires_at, g.recipient_name,
            g.recipient_email, g.recipient_person_id, g.buyer_person_id, b.name as buyer_name, me.email as my_email
       from gift_cards g
       join people b on b.id = g.buyer_person_id
       join people me on me.id = $1
      where g.status in ('active', 'expired')
        and (g.buyer_person_id = me.id or g.recipient_person_id = me.id or lower(g.recipient_email) = lower(me.email))
      order by g.created_at desc, g.id`,
    [personId],
  );
  const bought: AccountGiftCard[] = [];
  const received: AccountGiftCard[] = [];
  for (const g of r.rows) {
    const forSomeoneElse =
      g.buyer_person_id === personId &&
      g.recipient_email !== null &&
      g.recipient_email.toLowerCase() !== g.my_email.toLowerCase() &&
      g.recipient_person_id !== personId;
    const view: AccountGiftCard = {
      id: g.id,
      code: forSomeoneElse ? maskCode(g.code) : g.code,
      initialAedMinor: g.initial_aed_minor,
      balanceAedMinor: g.balance_aed_minor,
      status: g.status,
      expiresAt: g.expires_at === null ? null : new Date(g.expires_at).toISOString(),
      recipientLabel: g.recipient_name || g.recipient_email || "You",
      fromName: g.buyer_name,
    };
    (g.buyer_person_id === personId ? bought : received).push(view);
  }
  return { bought, received };
}
