import type { ReactNode } from "react";
import { Facts, Layout, P, Small } from "./Layout";
import { aed, day, greeting, money, num, str, when, type EmailTemplate } from "./helpers";

type Refund = { amountMinor?: unknown; currency?: unknown };

/** "€465 + €174" from the card refunds (one line per charge). */
function cardLine(v: unknown): string {
  const list = Array.isArray(v) ? (v as Refund[]) : [];
  return list
    .map((r) => money(r.amountMinor, r.currency))
    .filter(Boolean)
    .join(" + ");
}

/**
 * The booker's cancellation confirmation (self-service, or `byEfzin` when Ef Zin cancelled), with
 * what comes back where. `forGuest`: a guest on an Ef Zin-cancelled booking (no money facts).
 */
export const bookingCancelled: EmailTemplate = {
  subject: (d) =>
    d.byEfzin === true
      ? `${str(d.experience) || "Your Ef Zin experience"} has been cancelled`
      : d.forGuest === true
        ? `Your place at ${str(d.experience) || "Ef Zin"} has been cancelled`
        : `Your booking for ${str(d.experience) || "Ef Zin"} is cancelled`,
  body: (d) => {
    const experience = str(d.experience) || "your experience";
    const card = cardLine(d.cardRefunds);
    const gift = num(d.giftCardAed) ?? 0;
    const credit = num(d.creditAed) ?? 0;
    const rows: [string, ReactNode][] = [
      ["Experience", str(d.experience)],
      ["When", when(d.startsAt, d.timezone)],
      ["Refund to your card", card],
      ["Back on your gift card", gift > 0 ? aed(gift) : ""],
      ["Credit", credit > 0 ? aed(credit) : ""],
      ["Credit code", str(d.creditCode)],
      ["Credit expires", day(d.creditExpiresOn)],
    ];
    if (d.byEfzin === true) {
      return (
        <Layout preview={`We're sorry: ${experience} has been cancelled.`} title="Your experience has been cancelled">
          <P>{greeting(d.name)}</P>
          <P>We’re very sorry to let you know that {experience} has been cancelled.</P>
          {d.forGuest === true ? (
            <P>The person who booked your place will receive a full refund. We hope to welcome you at another Ef Zin experience soon.</P>
          ) : (
            <>
              <P>You’ll receive a full refund, with no fees deducted:</P>
              <Facts rows={rows} />
              <P>Card refunds usually reach your account within 5 to 10 working days.</P>
              <P>Would you rather move to a future experience instead? Just reply to this email and we’ll arrange it.</P>
            </>
          )}
          <Small>With love, Tanya and the Ef Zin team.</Small>
        </Layout>
      );
    }
    if (d.forGuest === true) {
      const booker = str(d.bookerName) || "The person who booked your place";
      return (
        <Layout preview="Your place has been cancelled." title="Your place has been cancelled">
          <P>{greeting(d.name)}</P>
          <P>{booker} has cancelled the booking for {experience}, so your place is cancelled too.</P>
          <Facts rows={[["Experience", str(d.experience)], ["When", when(d.startsAt, d.timezone)]]} />
          <Small>We hope to see you at another Ef Zin experience soon. Questions? Just reply to this email.</Small>
        </Layout>
      );
    }
    const nothing = !card && gift <= 0 && credit <= 0;
    return (
      <Layout preview="Your booking has been cancelled." title="Your booking is cancelled">
        <P>{greeting(d.name)}</P>
        <P>Your booking for {experience} has been cancelled, as you asked. No further payments will be taken.</P>
        <Facts rows={rows} />
        {nothing ? (
          <P>Under the cancellation policy for this booking, no refund or credit is due at this point.</P>
        ) : card ? (
          <P>Card refunds usually reach your account within 5 to 10 working days{num(d.feesDeductedMinor) ? " (Stripe processing fees are deducted, as set out in the policy)" : ""}.</P>
        ) : null}
        {credit > 0 ? <P>Enter the credit code when you book any event or retreat.</P> : null}
        <Small>We hope to see you again soon. If anything looks wrong, just reply to this email.</Small>
      </Layout>
    );
  },
};
