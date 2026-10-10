import { AdminEmail } from "./AdminFacts";
import { Cta, Facts, Layout, P, Small } from "./Layout";
import { day, greeting, money, safeUrl, siteOrigin, str, when, type EmailTemplate } from "./helpers";

/**
 * The day before a part-paid booking would be cancelled for an unpaid balance: to the booker
 * (amount, deadline, pay link, the policy) and, with `forAdmin`, the same facts to Tanya.
 */
export const bookingFinalReminder: EmailTemplate = {
  subject: (d) =>
    d.forAdmin === true
      ? `Final reminder sent (balance unpaid): ${str(d.experience) || "Ef Zin"}`
      : `Final reminder: your balance for ${str(d.experience) || "your Ef Zin booking"}`,
  body: (d) => {
    const amount = money(d.amountMinor, d.currency);
    const deadline = day(d.deadline);
    if (d.forAdmin === true) {
      return (
        <AdminEmail
          title="Final reminder sent: balance unpaid"
          lead={`The balance is still unpaid. Unless it is paid, the daily job cancels this booking under the policy on ${deadline || "the deadline"}.`}
          data={{ ...d, amount }}
          omit={["forAdmin", "amountMinor"]}
        />
      );
    }
    const experience = str(d.experience) || "your booking";
    const payUrl = safeUrl(d.payUrl, `${siteOrigin()}/account`);
    return (
      <Layout preview={`Please pay ${amount || "your balance"} before ${deadline || "tomorrow"} to keep your place.`} title="A final reminder about your balance">
        <P>{greeting(d.name)}</P>
        <P>
          We still haven&apos;t received {amount ? `the remaining ${amount}` : "the remaining balance"} for {experience}. To keep your place,
          please pay before {deadline ? `the morning of ${deadline}` : "tomorrow morning"}.
        </P>
        <Facts
          rows={[
            ["Experience", str(d.experience)],
            ["When", when(d.startsAt, d.timezone)],
            ["Amount due", amount],
            ["Pay before", deadline],
          ]}
        />
        <Cta href={payUrl}>Pay now</Cta>
        <P>
          If it isn&apos;t paid by then, your booking will be cancelled under our cancellation policy, and any refund or credit will
          follow that policy.
        </P>
        <Small>Already paid, or need a little more time? Just reply to this email. Pay link: {payUrl}</Small>
      </Layout>
    );
  },
};
