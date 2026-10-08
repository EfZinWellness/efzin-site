import { provisionPeople, type AuthAdmin } from "../auth/provision";
import type { SqlClient } from "../content/sync";
import type { EmailKind, SendEmailFn } from "../email/send";
import { adminAddress } from "../requests/handlers";
import type { ConfirmOutcome } from "./confirm";

export interface ConfirmEffects {
  sendEmail: SendEmailFn;
  auth: AuthAdmin | null;
  /** Site origin for links, e.g. https://www.efzinwellness.com */
  origin: string;
}

type Guest = { person_id: string; name: string; email: string; is_booker: boolean; ticket_type_id: string };

/**
 * After a new booking commits: member accounts, the booker's confirmation (with the schedule),
 * "booked you a spot" for each guest, the new-booking note to Tanya, and alerts for a lost
 * credit/gift or an oversold ticket. Never throws: the booking is already confirmed, so a
 * failure is logged and reported to Tanya instead of failing the payment.
 */
export async function afterBookingConfirmed(db: SqlClient, outcome: ConfirmOutcome, fx: ConfirmEffects): Promise<void> {
  const failures: string[] = [];
  const send = async (kind: EmailKind, to: string, data: Record<string, unknown>) => {
    try {
      await fx.sendEmail(kind, to, data);
    } catch (err) {
      console.error(`[email] ${kind} to ${to} failed`, err);
      failures.push(`${kind} → ${to}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  try {
    const { bookingId } = outcome;
    const b = (
      await db.query<{
        experience_id: string;
        title: string;
        slug: string;
        start_at: string | Date | null;
        status: string;
        payment_option: string;
        amount_paid_minor: number;
        presentment_currency: string;
        amount_aed_minor: number;
        base_currency: string;
      }>(
        `select b.experience_id, e.title, e.slug, e.start_at, b.status, b.payment_option, b.amount_paid_minor,
                b.presentment_currency, b.amount_aed_minor, b.base_currency
           from bookings b join experiences e on e.id = b.experience_id where b.id = $1`,
        [bookingId],
      )
    ).rows[0];
    const guests = (
      await db.query<Guest>(
        `select g.person_id, p.name, p.email, g.is_booker, g.ticket_type_id
           from booking_guests g join people p on p.id = g.person_id
          where g.booking_id = $1 order by g.is_booker desc, p.email`,
        [bookingId],
      )
    ).rows;
    const schedule = (
      await db.query<{ seq: number; due_on: string; amount_minor: number; currency: string; status: string }>(
        `select seq, to_char(due_on, 'YYYY-MM-DD') as due_on, amount_minor, currency, status
           from payment_schedule_items where booking_id = $1 order by seq`,
        [bookingId],
      )
    ).rows;
    const booker = guests.find((g) => g.is_booker)!;
    const others = guests.filter((g) => !g.is_booker);
    const accountUrl = `${fx.origin}/account`;

    const prov = await provisionPeople(
      db,
      fx.auth,
      guests.map((g) => ({ personId: g.person_id, email: g.email })),
      accountUrl,
    );
    const linkFor = (g: Guest) => prov.links.get(g.person_id) ?? accountUrl;

    await send("booking_confirmed", booker.email, {
      name: booker.name,
      experience: b.title,
      startsAt: b.start_at ? new Date(b.start_at).toISOString() : null,
      bookingId,
      paymentOption: b.payment_option,
      amountPaidMinor: b.amount_paid_minor,
      currency: b.presentment_currency,
      schedule: schedule.map((i) => ({ seq: i.seq, dueOn: i.due_on, amountMinor: i.amount_minor, currency: i.currency, status: i.status })),
      guests: others.map((g) => g.name),
      claimLink: linkFor(booker),
      detailsLink: accountUrl,
    });
    for (const g of others) {
      await send("guest_added", g.email, {
        name: g.name,
        bookerName: booker.name,
        experience: b.title,
        startsAt: b.start_at ? new Date(b.start_at).toISOString() : null,
        claimLink: linkFor(g),
      });
    }

    const spots = await db.query<{ id: string; key: string; capacity: number; sold: number; remaining: number }>(
      `select tt.id, tt.key, tt.capacity, available_spots(tt.id) as remaining,
              (select count(*)::int from booking_guests g join bookings bk on bk.id = g.booking_id
                where g.ticket_type_id = tt.id and bk.status in ('paid', 'deposit_paid')) as sold
         from ticket_types tt where tt.experience_id = $1 order by tt.key`,
      [b.experience_id],
    );
    await send("admin_new_booking", adminAddress(), {
      experience: b.title,
      booker: `${booker.name} <${booker.email}>`,
      guests: guests.length,
      paymentOption: b.payment_option,
      paidNowAed: b.amount_aed_minor,
      spotsRemaining: spots.rows.map((s) => `${s.key}: ${s.remaining}`).join(", "),
    });

    const alert = (context: string, problem: string, extra: Record<string, unknown> = {}) =>
      send("admin_error", adminAddress(), {
        context,
        problem,
        bookingId,
        experience: b.title,
        booker: `${booker.name} <${booker.email}>`,
        ...extra,
      });
    const moved = { movedToScheduleMinor: outcome.shiftedBaseMinor, currency: b.base_currency };
    if (outcome.creditLost) {
      await alert(
        "credit_claim_lost",
        "The guest paid after their credit hold lapsed, so the credit was not applied. The amount was added to their payment schedule; please check with the guest.",
        moved,
      );
    }
    if (outcome.giftLost) {
      await alert(
        "gift_claim_lost",
        "The guest paid after their gift card hold lapsed and the gift value was no longer available. The amount was added to their payment schedule; please check with the guest.",
        moved,
      );
    }
    const mine = new Set(guests.map((g) => g.ticket_type_id));
    const oversold = spots.rows.filter((s) => mine.has(s.id) && s.sold > s.capacity);
    if (oversold.length > 0) {
      await alert("oversold", "A late payment was confirmed after its hold expired and the experience is now oversold.", {
        tickets: oversold.map((s) => `${s.key}: ${s.sold} sold of ${s.capacity}`).join(", "),
      });
    }
    if (prov.errors.length > 0) {
      await alert("auth_provisioning", "Member accounts could not be created for some guests.", { errors: prov.errors });
    }
  } catch (err) {
    console.error("[booking] post-confirmation steps failed", err);
    failures.push(err instanceof Error ? err.message : String(err));
  }

  if (failures.length > 0) {
    try {
      await fx.sendEmail("admin_error", adminAddress(), {
        context: "booking_emails_failed",
        problem: "A booking was confirmed but some emails or steps after it failed.",
        bookingId: outcome.bookingId,
        failures,
      });
    } catch (err) {
      console.error("[email] could not report post-confirmation failures", err);
    }
  }
}
