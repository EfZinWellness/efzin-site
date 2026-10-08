import { Layout, P } from "./Layout";
import { greeting, str, type EmailTemplate } from "./helpers";

export const giftCardDeliveredBuyer: EmailTemplate = {
  subject: () => "Your Ef Zin gift has been delivered",
  body: (d) => {
    const to = str(d.recipientName) || str(d.recipientEmail) || "your recipient";
    return (
      <Layout preview="Your gift has been delivered." title="Your gift has been delivered">
        <P>{greeting(d.buyerName)}</P>
        <P>
          {to} has been emailed their {str(d.value)} Ef Zin gift card. Thank you for sharing Ef Zin.
        </P>
      </Layout>
    );
  },
};
