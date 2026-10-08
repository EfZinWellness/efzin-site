import { Cta, Facts, Layout, P } from "./Layout";
import { aed, greeting, num, siteOrigin, str, type EmailTemplate } from "./helpers";

export const giftCardUsed: EmailTemplate = {
  subject: () => "You used your Ef Zin gift card",
  body: (d) => {
    const left = num(d.balanceAedMinor) ?? 0;
    return (
      <Layout preview={`${aed(d.amountUsedAedMinor)} used, ${aed(d.balanceAedMinor)} left.`} title="Your gift card at work">
        <P>{greeting(d.name)}</P>
        <P>You used your Ef Zin gift card{str(d.experience) ? ` for ${str(d.experience)}` : ""}. Enjoy every moment.</P>
        <Facts
          rows={[
            ["Card", str(d.codeMasked)],
            ["Used", aed(d.amountUsedAedMinor)],
            ["Balance left", aed(d.balanceAedMinor)],
          ]}
        />
        {left > 0 ? (
          <>
            <P>The rest stays on your card for your next experience.</P>
            <Cta href={`${siteOrigin()}/events`}>See what’s on</Cta>
          </>
        ) : null}
      </Layout>
    );
  },
};
