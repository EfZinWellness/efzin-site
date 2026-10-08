import type { SqlClient } from "../content/sync";
import { renderGiftCardPdf } from "../email/pdf/GiftCardPdf";
import type { EmailAttachment } from "../email/send";
import { dubaiToday } from "../giftcards/dates";
import { formatAed } from "../giftcards/money";
import { createLimiter } from "../requests/throttle";
import { UUID_RE } from "./bookings";
import { giftSql } from "./giftCards";

export interface ResendDeps {
  sendEmail: (kind: "gift_card_delivered", to: string, data: Record<string, unknown>, attachments?: EmailAttachment[]) => Promise<void>;
  origin: string;
  now?: Date;
}

/** 3 re-sends per hour per person (best effort, per server instance). */
const limiter = createLimiter(3, 60 * 60 * 1000);

export function resetGiftResendThrottleForTests(): void {
  limiter.reset();
}

/**
 * Re-sends an active gift card's code to the signed-in person's own email, and only for a card
 * they bought or received. Never sends to any other address.
 */
export async function resendGiftCard(
  db: SqlClient,
  deps: ResendDeps,
  personId: string,
  giftCardId: string,
): Promise<"sent" | "not_found" | "throttled"> {
  if (!UUID_RE.test(giftCardId)) return "not_found";
  const r = await db.query<{
    code: string;
    initial_aed_minor: number;
    expires_at: string | Date;
    message: string | null;
    recipient_name: string | null;
    buyer_name: string;
    my_name: string;
    my_email: string;
    slug: string | null;
    title: string | null;
  }>(
    `select g.code, g.initial_aed_minor, g.expires_at, g.message, g.recipient_name, b.name as buyer_name,
            me.name as my_name, me.email as my_email, x.slug, x.title
       from gift_cards g
       join people b on b.id = g.buyer_person_id
       join people me on me.id = $2
       left join experiences x on x.id = g.suggested_experience_id
      where g.id = $1 and g.status = 'active' and ${giftSql("$3").holdsCode}`,
    [giftCardId, personId, dubaiToday(deps.now ?? new Date())],
  );
  const card = r.rows[0];
  if (!card) return "not_found";
  const nowMs = (deps.now ?? new Date()).getTime();
  if (limiter.blocked(personId, nowMs)) return "throttled";
  limiter.record(personId, nowMs);

  const expiresOn = dubaiToday(new Date(card.expires_at));
  let attachments: EmailAttachment[] | undefined;
  try {
    const pdf = await renderGiftCardPdf({
      code: card.code,
      valueAedMinor: card.initial_aed_minor,
      recipientName: card.recipient_name,
      message: card.message,
      expiresOn,
      suggestedTitle: card.title,
    });
    attachments = [{ filename: `ef-zin-gift-card-${card.code}.pdf`, content: pdf, contentType: "application/pdf" }];
  } catch (err) {
    console.error("gift card PDF failed; re-sending without it", err);
  }
  await deps.sendEmail(
    "gift_card_delivered",
    card.my_email,
    {
      hasPdf: attachments !== undefined,
      recipientName: card.recipient_name ?? card.my_name,
      buyerName: card.buyer_name,
      message: card.message ?? "",
      code: card.code,
      value: formatAed(card.initial_aed_minor),
      suggested: card.title ?? "",
      expiresOn,
      bookUrl: card.slug ? `${deps.origin}/book/${card.slug}` : `${deps.origin}/events`,
    },
    attachments,
  );
  return "sent";
}
