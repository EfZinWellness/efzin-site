import { Cta, Facts, Layout, P, Small } from "./Layout";
import { aed, day, greeting, safeUrl, siteOrigin, str, type EmailTemplate } from "./helpers";

export const creditExpiring: EmailTemplate = {
  subject: (d) => `Your Ef Zin credit expires on ${day(d.expiresOn) || "soon"}`,
  body: (d) => (
    <Layout preview="Your credit expires in 30 days." title="Your credit expires soon">
      <P>{greeting(d.name)}</P>
      <P>A gentle reminder that your Ef Zin credit expires in 30 days. It can be used on any event or retreat.</P>
      <Facts
        rows={[
          ["Credit", aed(d.amountAedMinor)],
          ["Code", str(d.code)],
          ["Expires", day(d.expiresOn)],
        ]}
      />
      <Cta href={safeUrl(d.eventsUrl, `${siteOrigin()}/events`)}>See what’s on</Cta>
      <Small>Enter the code when you book.</Small>
    </Layout>
  ),
};
