import { Text } from "@react-email/components";
import { C, Code, Cta, Layout, P, Quote, Small } from "./Layout";
import { greeting, safeUrl, siteOrigin, str, type EmailTemplate } from "./helpers";

const fromSomeoneElse = (d: Record<string, unknown>) => {
  const buyer = str(d.buyerName);
  return buyer && buyer !== str(d.recipientName) ? buyer : "";
};

export const giftCardDelivered: EmailTemplate = {
  subject: (d) => (fromSomeoneElse(d) ? `${fromSomeoneElse(d)} sent you an Ef Zin gift card` : "Your Ef Zin gift card"),
  body: (d) => {
    const buyer = fromSomeoneElse(d);
    const message = str(d.message);
    const suggested = str(d.suggested);
    const estimate = str(d.estimate);
    return (
      <Layout preview={buyer ? `${buyer} sent you a gift.` : "Your Ef Zin gift card."} title={buyer ? "A gift for you" : "Your gift card"}>
        <P>{greeting(d.recipientName)}</P>
        <P>{buyer ? `${buyer} has sent you a gift card for Ef Zin.` : "Here is your Ef Zin gift card."}</P>
        {message ? <Quote>&ldquo;{message}&rdquo;</Quote> : null}
        <Text style={{ fontSize: "34px", textAlign: "center", margin: "24px 0 0", color: C.navy }}>{str(d.value)}</Text>
        {estimate ? <Small>{estimate}</Small> : null}
        <Code>{str(d.code)}</Code>
        {suggested ? <P>Suggested experience: {suggested}</P> : null}
        <Small>Valid until {str(d.expiresOn)}. It can be spent on any Ef Zin event or retreat.</Small>
        <Cta href={safeUrl(d.bookUrl, `${siteOrigin()}/events`)}>Book with your gift</Cta>
        {d.hasPdf === true ? <Small>A printable card is attached.</Small> : null}
        {d.receipt === true ? <P>Thank you for your purchase.</P> : null}
      </Layout>
    );
  },
};
