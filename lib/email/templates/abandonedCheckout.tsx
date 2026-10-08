import { Cta, Layout, P, Small } from "./Layout";
import { greeting, safeUrl, siteOrigin, str, type EmailTemplate } from "./helpers";

export const abandonedCheckout: EmailTemplate = {
  subject: () => "Your spot is still waiting",
  body: (d) => (
    <Layout preview="Your spot is still waiting." title="Your spot is still waiting">
      <P>{greeting(d.name)}</P>
      <P>You started booking {str(d.experience) || "an Ef Zin experience"} but didn’t quite finish. Spots are limited, so we wanted to let you know it’s still open.</P>
      <Cta href={safeUrl(d.link, `${siteOrigin()}/events`)}>Finish booking</Cta>
      <Small>If you changed your mind, no need to do anything. We won’t send this again.</Small>
    </Layout>
  ),
};
