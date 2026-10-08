import { Cta, Facts, Layout, P } from "./Layout";
import { greeting, money, num, siteOrigin, str, type EmailTemplate } from "./helpers";

export const scheduledPaymentReceipt: EmailTemplate = {
  subject: (d) => `Payment received: ${str(d.experience) || "your Ef Zin booking"}`,
  body: (d) => {
    const remaining = num(d.remainingMinor);
    const done = remaining === 0;
    const id = str(d.bookingId);
    return (
      <Layout preview={`Thank you, we received ${money(d.amountMinor, d.currency)}.`} title="Payment received">
        <P>{greeting(d.name)}</P>
        <P>
          Thank you. We received your payment for {str(d.experience) || "your booking"}
          {done ? ", and your booking is now paid in full." : "."}
        </P>
        <Facts
          rows={[
            ["Paid", money(d.amountMinor, d.currency)],
            ["Still to pay", done ? "Nothing, you're all set" : money(d.remainingMinor, d.currency)],
          ]}
        />
        <Cta href={id ? `${siteOrigin()}/account/bookings/${encodeURIComponent(id)}` : `${siteOrigin()}/account`}>View my booking</Cta>
      </Layout>
    );
  },
};
