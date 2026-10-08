import { Link } from "@react-email/components";
import { Cta, Facts, Layout, P, Small } from "./Layout";
import { day, greeting, money, safeUrl, siteOrigin, str, type EmailTemplate } from "./helpers";

export const scheduledPaymentUpcoming: EmailTemplate = {
  subject: (d) => `Payment coming up for ${str(d.experience) || "your Ef Zin booking"}`,
  body: (d) => {
    const amount = money(d.amountMinor, d.currency);
    const last4 = str(d.cardLast4);
    const account = `${siteOrigin()}/account`;
    return (
      <Layout preview={`${amount} will be charged on ${day(d.dueOn)}.`} title="Your next payment">
        <P>{greeting(d.name)}</P>
        <P>
          A reminder that your next payment for {str(d.experience) || "your booking"} will be charged to your saved card
          {last4 ? ` ending ${last4}` : ""} in three days.
        </P>
        <Facts
          rows={[
            ["Amount", amount],
            ["Date", day(d.dueOn)],
            ["Still to pay after this", money(d.remainingAfterMinor, d.currency)],
          ]}
        />
        <P>Nothing to do if your card is up to date. You can also pay everything that is left now.</P>
        <Cta href={safeUrl(d.payRestUrl, account)}>Pay the rest now</Cta>
        <Small>
          New card? <Link href={safeUrl(d.updateCardUrl, account)}>Update card</Link>
        </Small>
      </Layout>
    );
  },
};
