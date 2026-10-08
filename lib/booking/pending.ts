import type { SqlClient } from "../content/sync";
import type { Experience } from "../content/schema";
import { findUsableCredit } from "../credits/db";
import { getGiftBalance, releaseReservation, reserveGiftCard } from "../giftcards/db";
import { allocateDiscounts, type Allocation } from "../payments/allocate";
import type { PaymentOption, ScheduleItem } from "../payments/schedule";
import { policyCopy } from "../policy/copy";
import { convertMinor } from "../pricing/convert";
import { upsertPersonByEmail } from "../people/upsert";
import { bookingTotal, scheduleFor } from "./quote";
import type { BookingRequest } from "./validate";

/** Spots and gift value are held for the Checkout session's lifetime: creation + 31 minutes. */
export const HOLD_MINUTES = 31;

export class SoldOutError extends Error {
  constructor(public readonly ticketKey: string) {
    super(`SOLD_OUT: ${ticketKey}`);
    this.name = "SoldOutError";
  }
}

export type CodeErrorCode = "GIFT_INVALID" | "GIFT_EXPIRED" | "GIFT_INSUFFICIENT" | "CREDIT_INVALID";

export class CodeError extends Error {
  constructor(public readonly code: CodeErrorCode) {
    super(code);
    this.name = "CodeError";
  }
}

export interface PendingPayload {
  slug: string;
  experienceId: string;
  title: string;
  baseCurrency: string;
  option: PaymentOption;
  totalMinor: number;
  /** Card (seq 0) + gift + credit value received at confirmation, in AED, for reporting. */
  paidNowAedMinor: number;
  booker: { personId: string; name: string; email: string; phone: string; howHeard?: string; ticketTypeId: string };
  guests: { name: string; email: string; phone?: string; ticketTypeId: string }[];
  lines: { ticketKey: string; ticketTypeId: string; qty: number; priceMinor: number }[];
  /** Before discounts. */
  schedule: ScheduleItem[];
  /** After gift then credit; `allocation.schedule` is what is charged. */
  allocation: Allocation;
  gift: { code: string; cardId: string; reservationId: string; reservedAedMinor: number } | null;
  credit: { id: string; code: string; usedAedMinor: number } | null;
  policy: { template: string; copy: string[] };
  scheduleConsentAt: string | null;
  expiresAt: string;
}

const withUsd = (r: Record<string, number>) => ({ ...r, USD: 1 });

async function reserveGift(
  db: SqlClient,
  code: string,
  neededAed: number,
  pendingId: string,
  expiresAt: Date,
  now: Date,
): Promise<NonNullable<PendingPayload["gift"]>> {
  const bal = await getGiftBalance(db, code);
  if (!bal || (bal.status !== "active" && bal.status !== "expired")) throw new CodeError("GIFT_INVALID");
  if (bal.status === "expired" || (bal.expiresAt && Date.parse(bal.expiresAt) <= now.getTime())) {
    throw new CodeError("GIFT_EXPIRED");
  }
  const amount = Math.min(bal.availableAedMinor, neededAed);
  if (amount < 1) throw new CodeError("GIFT_INSUFFICIENT");
  try {
    const reservationId = await reserveGiftCard(db, bal.code, amount, pendingId, expiresAt);
    return { code: bal.code, cardId: bal.id, reservationId, reservedAedMinor: amount };
  } catch (err) {
    const m = /GIFT_INVALID|GIFT_EXPIRED|GIFT_INSUFFICIENT/.exec(err instanceof Error ? err.message : String(err));
    if (m) throw new CodeError(m[0] as CodeErrorCode);
    throw err;
  }
}

/**
 * In one transaction: upserts the booker, holds every ticket line, reserves the gift card,
 * checks the credit, allocates discounts and stores the pending booking. Throws SoldOutError
 * or CodeError (nothing is left behind). The caller then starts Stripe Checkout.
 */
export async function createPendingBooking(
  db: SqlClient,
  req: BookingRequest,
  exp: Experience,
  now: Date,
  usdRates: Record<string, number>,
): Promise<{ id: string; payload: PendingPayload }> {
  const rates = withUsd(usdRates);
  const expiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);
  const tt = await db.query<{ id: string; key: string; experience_id: string }>(
    `select tt.id, tt.key, tt.experience_id from ticket_types tt
       join experiences e on e.id = tt.experience_id where e.slug = $1`,
    [exp.slug],
  );
  const ticketId = (key: string): string => {
    const row = tt.rows.find((r) => r.key === key);
    if (!row) throw new Error(`Ticket "${key}" of ${exp.slug} is not in the database (run sync:content)`);
    return row.id;
  };
  const lines = req.lines.map((l) => ({
    ticketKey: l.ticketKey,
    ticketTypeId: ticketId(l.ticketKey),
    qty: l.qty,
    priceMinor: exp.tickets.find((t) => t.key === l.ticketKey)!.priceMinor,
  }));
  // The booker takes the ticket left over once every guest has theirs.
  const bookerLine = lines.find((l) => req.guests.filter((g) => g.ticketKey === l.ticketKey).length < l.qty)!;

  await db.query("begin");
  try {
    const personId = await upsertPersonByEmail(db, req.booker);
    const pending = await db.query<{ id: string }>(
      "insert into pending_bookings (kind, payload) values ('booking', '{}'::jsonb) returning id",
    );
    const id = pending.rows[0].id;

    const holdIds: string[] = [];
    for (const l of lines) {
      try {
        const h = await db.query<{ id: string }>("select create_hold($1, $2, $3) as id", [
          l.ticketTypeId,
          l.qty,
          expiresAt.toISOString(),
        ]);
        holdIds.push(h.rows[0].id);
      } catch (err) {
        if (/SOLD_OUT/.test(err instanceof Error ? err.message : String(err))) throw new SoldOutError(l.ticketKey);
        throw err;
      }
    }

    const base = exp.baseCurrency;
    const totalMinor = bookingTotal(exp, req.lines);
    const schedule = scheduleFor(exp, totalMinor, req.paymentOption, now);

    let gift: PendingPayload["gift"] = null;
    let giftBase = 0;
    if (req.giftCode) {
      const neededAed = convertMinor(totalMinor, base, "AED", rates, "ceil");
      gift = await reserveGift(db, req.giftCode, neededAed, id, expiresAt, now);
      giftBase = convertMinor(gift.reservedAedMinor, "AED", base, rates, "floor");
    }

    let credit: PendingPayload["credit"] = null;
    let creditBase = 0;
    if (req.creditCode) {
      const c = await findUsableCredit(db, req.creditCode, now);
      if (!c) throw new CodeError("CREDIT_INVALID");
      const remainingAed = convertMinor(Math.max(0, totalMinor - giftBase), base, "AED", rates, "ceil");
      const usedAed = Math.min(c.amount_aed_minor, remainingAed);
      if (usedAed > 0) {
        credit = { id: c.id, code: c.code, usedAedMinor: usedAed };
        creditBase = convertMinor(usedAed, "AED", base, rates, "floor");
      }
    }

    const allocation = allocateDiscounts({
      schedule,
      giftAvailableBaseMinor: giftBase,
      creditAvailableBaseMinor: creditBase,
    });
    const paidNowBase = allocation.schedule[0].amountMinor + allocation.giftUsedBaseMinor + allocation.creditUsedBaseMinor;

    const payload: PendingPayload = {
      slug: exp.slug,
      experienceId: tt.rows[0].experience_id,
      title: exp.title,
      baseCurrency: base,
      option: req.paymentOption,
      totalMinor,
      paidNowAedMinor: convertMinor(paidNowBase, base, "AED", rates, "round"),
      booker: { personId, ...req.booker, ticketTypeId: bookerLine.ticketTypeId },
      guests: req.guests.map((g) => ({
        name: g.name,
        email: g.email,
        ...(g.phone ? { phone: g.phone } : {}),
        ticketTypeId: ticketId(g.ticketKey),
      })),
      lines,
      schedule,
      allocation,
      gift,
      credit,
      policy: { template: exp.policy, copy: policyCopy(exp.policy) },
      scheduleConsentAt: req.paymentOption !== "full" && req.scheduleConsent ? now.toISOString() : null,
      expiresAt: expiresAt.toISOString(),
    };
    await db.query(
      "update pending_bookings set payload = $2::jsonb, hold_ids = $3::uuid[], reservation_ids = $4::uuid[] where id = $1",
      [id, JSON.stringify(payload), holdIds, gift ? [gift.reservationId] : []],
    );
    await db.query("commit");
    return { id, payload };
  } catch (err) {
    await db.query("rollback").catch(() => {});
    throw err;
  }
}

/** Records the Checkout session on the pending booking and its holds. */
export async function attachCheckoutSession(db: SqlClient, pendingId: string, sessionId: string): Promise<void> {
  await db.query("update pending_bookings set checkout_session_id = $2 where id = $1", [pendingId, sessionId]);
  await db.query(
    "update holds set checkout_session_id = $2 where id in (select unnest(hold_ids) from pending_bookings where id = $1)",
    [pendingId, sessionId],
  );
}

/** Frees the spots and gift value of a checkout that never completed. */
export async function releasePending(db: SqlClient, pendingId: string): Promise<void> {
  await db.query(
    `update holds set released_at = now()
      where released_at is null and id in (select unnest(hold_ids) from pending_bookings where id = $1)`,
    [pendingId],
  );
  const r = await db.query<{ id: string }>(
    "select id from gift_card_reservations where pending_booking_id = $1 and released_at is null",
    [pendingId],
  );
  for (const row of r.rows) await releaseReservation(db, row.id);
}
