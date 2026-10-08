import { Cta, Layout, P, Small } from "./Layout";
import { greeting, safeUrl, siteOrigin, str, type EmailTemplate } from "./helpers";

export const waitlistOpen: EmailTemplate = {
  subject: (d) => `A spot has opened: ${str(d.experience) || "Ef Zin"}`,
  body: (d) => (
    <Layout preview="A spot has opened up." title="A spot has opened">
      <P>{greeting(d.name)}</P>
      <P>Good news: a place has opened up at {str(d.experience) || "the experience you were waiting for"}.</P>
      <P>Spots go to whoever books first, so if you’d like it, book soon.</P>
      <Cta href={safeUrl(d.link, `${siteOrigin()}/events`)}>Book now</Cta>
      <Small>You’re receiving this because you joined the waitlist.</Small>
    </Layout>
  ),
};
