import { Cta, Facts, Layout, P } from "./Layout";
import { day, greeting, money, safeUrl, siteOrigin, str, type EmailTemplate } from "./helpers";

/** Older single-balance reminder; payment plans use scheduled_payment_upcoming. */
export const balanceReminder: EmailTemplate = {
  subject: (d) => `Your balance for ${str(d.experience) || "your Ef Zin booking"}`,
  body: (d) => (
    <Layout preview="Your balance is due soon." title="Your balance is due soon">
      <P>{greeting(d.name)}</P>
      <P>The balance for {str(d.experience) || "your booking"} is due soon.</P>
      <Facts
        rows={[
          ["Amount", money(d.amountMinor, d.currency)],
          ["Due", day(d.dueOn)],
        ]}
      />
      <Cta href={safeUrl(d.payUrl, `${siteOrigin()}/account`)}>Pay now</Cta>
    </Layout>
  ),
};
