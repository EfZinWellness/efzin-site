import type { SqlClient } from "../content/sync";

export interface AdminGiftCard {
  id: string;
  code: string;
  status: string;
  initialAedMinor: number;
  balanceAedMinor: number;
  expiresAt: string | null;
  createdAt: string;
  buyerName: string;
  buyerEmail: string;
  recipientName: string | null;
  recipientEmail: string | null;
}

export interface GiftTotals {
  /** Sum of every `issue` ledger row. */
  salesAedMinor: number;
  /** Sum of the balances of active cards. */
  outstandingAedMinor: number;
  /** Value that lapsed: the sum of `expiry` ledger rows, as a positive amount. */
  expiredAedMinor: number;
}

export async function loadAdminGiftCards(db: SqlClient): Promise<{ cards: AdminGiftCard[]; totals: GiftTotals }> {
  const c = await db.query<{
    id: string; code: string; status: string; initial: number; balance: number; expires_at: string | Date | null;
    created_at: string | Date; buyer_name: string; buyer_email: string; recipient_name: string | null; recipient_email: string | null;
  }>(
    `select c.id, c.code, c.status, c.initial_aed_minor as initial, c.balance_aed_minor as balance,
            c.expires_at, c.created_at, b.name as buyer_name, b.email as buyer_email,
            c.recipient_name, c.recipient_email
       from gift_cards c join people b on b.id = c.buyer_person_id
      order by c.created_at desc, c.id`,
  );
  const t = await db.query<{ sales: number; outstanding: number; expired: number }>(
    `select coalesce((select sum(amount_aed_minor) from gift_card_ledger where reason = 'issue'), 0)::int as sales,
            coalesce((select sum(balance_aed_minor) from gift_cards where status = 'active'), 0)::int as outstanding,
            coalesce((select -sum(amount_aed_minor) from gift_card_ledger where reason = 'expiry'), 0)::int as expired`,
  );
  return {
    cards: c.rows.map((x) => ({
      id: x.id, code: x.code, status: x.status, initialAedMinor: x.initial, balanceAedMinor: x.balance,
      expiresAt: x.expires_at === null ? null : new Date(x.expires_at).toISOString(),
      createdAt: new Date(x.created_at).toISOString(), buyerName: x.buyer_name, buyerEmail: x.buyer_email,
      recipientName: x.recipient_name, recipientEmail: x.recipient_email,
    })),
    totals: { salesAedMinor: t.rows[0].sales, outstandingAedMinor: t.rows[0].outstanding, expiredAedMinor: t.rows[0].expired },
  };
}
