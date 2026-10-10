import { Cta, Facts, Layout, P, Small } from "./Layout";
import { aed, day, greeting, money, num, safeUrl, siteOrigin, str, when, type EmailTemplate } from "./helpers";

/**
 * To the booker when Ef Zin cancels an experience: choose a full refund or the full amount as
 * credit. The two links carry only an opaque token (refundUrl / creditUrl).
 */
export const efzinCancellationChoice: EmailTemplate = {
  subject: (d) => `${str(d.experience) || "Your Ef Zin experience"} has been cancelled: refund or credit?`,
  body: (d) => {
    const experience = str(d.experience) || "your experience";
    const amount = money(d.amountMinor, d.currency);
    const credit = num(d.creditAedMinor) ?? 0;
    const gift = num(d.giftCardAed) ?? 0;
    const deadline = day(d.deadline);
    const account = `${siteOrigin()}/account`;
    const refundUrl = safeUrl(d.refundUrl, account);
    const creditUrl = safeUrl(d.creditUrl, account);
    return (
      <Layout preview={`We're sorry: ${experience} has been cancelled. Choose a full refund or credit.`} title="Your experience has been cancelled">
        <P>{greeting(d.name)}</P>
        <P>
          We’re very sorry to let you know that {experience} has been cancelled. You’ll get back everything you paid
          {amount ? `, ${amount},` : ""} and you can choose how:
        </P>
        <Facts
          rows={[
            ["Experience", str(d.experience)],
            ["When", when(d.startsAt, d.timezone)],
            ["Amount paid", amount],
            ["Choose by", deadline],
          ]}
        />
        <P>
          <strong>A full refund</strong>, with no fees deducted: card payments go back to your card
          {gift > 0 ? ` and ${aed(gift)} goes back onto your gift card` : ""}.
        </P>
        <Cta href={refundUrl}>Refund me</Cta>
        <P>
          <strong>Ef Zin credit</strong> of {credit > 0 ? aed(credit) : "the full amount"}, valid for 12 months on any event or retreat.
        </P>
        <Cta href={creditUrl}>Give me credit</Cta>
        <Small>
          Each button opens a page where you confirm your choice. If we don’t hear from you{deadline ? ` by ${deadline}` : " within 7 days"}, we’ll
          refund you in full automatically.
        </Small>
        <Small>Refund: {refundUrl}</Small>
        <Small>Credit: {creditUrl}</Small>
        <Small>With love, Tanya and the Ef Zin team.</Small>
      </Layout>
    );
  },
};
