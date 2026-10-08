import { Section, Text } from "@react-email/components";
import { C, Cta, Layout, P, Small, Table } from "./Layout";
import { greeting, safeUrl, siteOrigin, str, strings, type Data, type EmailTemplate } from "./helpers";

/** Receipt for a single gift: value, who it is for, when it goes out, and a masked card preview. */
function Receipt({ d }: { d: Data }) {
  const who = str(d.recipientLabel) || "you";
  return (
    <Layout preview="Thank you for your gift card purchase." title="Thank you for your purchase">
      <P>{greeting(d.buyerName)}</P>
      <P>
        Your {str(d.value)} Ef Zin gift card for {who} will be emailed on {str(d.deliverOn) || "the delivery date"}.
      </P>
      <Section style={{ backgroundColor: C.navy, padding: "20px", margin: "24px 0", textAlign: "center" }}>
        <Text style={{ color: C.ivory, fontSize: "12px", letterSpacing: "4px", textTransform: "uppercase", margin: 0 }}>Ef Zin gift card</Text>
        <Text style={{ color: C.ivory, fontSize: "28px", margin: "12px 0 0" }}>{str(d.value)}</Text>
        <Text style={{ color: C.ivory, fontFamily: "'Courier New', monospace", fontSize: "16px", letterSpacing: "2px", margin: "12px 0 0" }}>
          {str(d.codeMasked)}
        </Text>
      </Section>
      <Small>The full code is sent with the card on the delivery date.</Small>
    </Layout>
  );
}

/** Bulk purchase: every code (also in the attached CSV). */
function Codes({ d, codes }: { d: Data; codes: string[] }) {
  return (
    <Layout preview={`Your ${codes.length} Ef Zin gift cards.`} title="Your gift cards">
      <P>{greeting(d.buyerName)}</P>
      <P>
        Thank you. Here are your {codes.length} Ef Zin gift cards, {str(d.value)} each, valid until {str(d.expiresOn)}.
      </P>
      <Table head={null} rows={codes.map((c) => [c])} />
      <Small>The same codes are in the attached CSV (code, value, expiry). Each can be spent on any Ef Zin event or retreat.</Small>
      <Cta href={safeUrl(d.bookUrl, `${siteOrigin()}/events`)}>See what’s on</Cta>
    </Layout>
  );
}

export const giftCardBought: EmailTemplate = {
  subject: (d) => (Array.isArray(d.codes) ? `Your Ef Zin gift cards (${strings(d.codes).length})` : "Thank you for your Ef Zin gift card purchase"),
  body: (d) => (Array.isArray(d.codes) ? <Codes d={d} codes={strings(d.codes)} /> : <Receipt d={d} />),
};
