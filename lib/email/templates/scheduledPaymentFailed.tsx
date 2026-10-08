import { Link } from "@react-email/components";
import { Cta, Facts, Layout, P, Small } from "./Layout";
import { day, greeting, money, safeUrl, siteOrigin, str, type EmailTemplate } from "./helpers";

export const scheduledPaymentFailed: EmailTemplate = {
  subject: (d) => `Your payment for ${str(d.experience) || "your Ef Zin booking"} didn't go through`,
  body: (d) => {
    const due = day(d.balanceDueOn);
    const account = `${siteOrigin()}/account`;
    return (
      <Layout preview="Your payment didn't go through. Your booking is still confirmed." title="Your payment didn't go through">
        <P>{greeting(d.name)}</P>
        <P>
          We couldn’t take your payment of {money(d.amountMinor, d.currency) || "this instalment"} for {str(d.experience) || "your booking"}.
          Your booking is still confirmed, and your bank may simply need a moment: we’ll try again automatically.
        </P>
        <Facts
          rows={[
            ["Amount", money(d.amountMinor, d.currency)],
            ["Pay by", due],
          ]}
        />
        <P>
          You can pay now with the secure link below, or update your card.
          {due ? ` Anything still unpaid on ${due} means the booking is cancelled under our cancellation policy.` : ""}
        </P>
        <Cta href={safeUrl(d.payUrl, account)}>Pay now</Cta>
        <Small>
          New card? <Link href={safeUrl(d.updateCardUrl, account)}>Update card</Link>
        </Small>
      </Layout>
    );
  },
};
