import { Cta, Layout, P } from "./Layout";
import { greeting, money, oneLine, siteOrigin, str, type EmailTemplate } from "./helpers";

/**
 * To the booker when the site refunded a payment automatically: a scheduled payment taken after
 * the booking was cancelled (`reason: "inactive_invoice"`), or the part of a "Pay the rest now"
 * payment that was no longer due (`reason: "pay_rest_excess"`, or `"pay_rest_inactive"` when the
 * booking had been cancelled).
 */
export const paymentRefunded: EmailTemplate = {
  subject: (d) => {
    const amount = money(d.amountMinor, d.currency);
    return oneLine(amount ? `We've refunded your payment of ${amount}` : "We've refunded your payment");
  },
  body: (d) => {
    const amount = money(d.amountMinor, d.currency) || "your payment";
    const experience = str(d.experience) || "your Ef Zin booking";
    const why =
      d.reason === "pay_rest_excess"
        ? `When you paid the rest of your booking for ${experience}, part of it had already been paid, so we have refunded the difference.`
        : d.reason === "pay_rest_inactive"
          ? `You paid the rest of your booking for ${experience} after it was cancelled, so we have refunded that payment in full.`
          : `A scheduled payment was taken after your booking for ${experience} was cancelled, so we have refunded it in full.`;
    return (
      <Layout preview={`We've refunded ${amount} to your card.`} title="Payment refunded">
        <P>{greeting(d.name)}</P>
        <P>
          We&apos;ve refunded {amount} to the card you paid with. {why}
        </P>
        <P>Refunds usually show on your statement within 5 to 10 working days. You don&apos;t need to do anything.</P>
        <P>If you have any questions, just reply to this email.</P>
        <Cta href={`${siteOrigin()}/account`}>My Ef Zin</Cta>
      </Layout>
    );
  },
};
