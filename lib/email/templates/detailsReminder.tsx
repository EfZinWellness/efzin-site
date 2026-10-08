import { Cta, Layout, P, Small } from "./Layout";
import { greeting, safeUrl, siteOrigin, str, when, type EmailTemplate } from "./helpers";

export const detailsReminder: EmailTemplate = {
  subject: (d) => `A few details before ${str(d.experience) || "your Ef Zin experience"}`,
  body: (d) => (
    <Layout preview="A gentle reminder to add your details." title="A gentle reminder">
      <P>{greeting(d.name)}</P>
      <P>
        We’re looking forward to seeing you at {str(d.experience) || "your Ef Zin experience"}
        {when(d.startsAt, d.timezone) ? ` on ${when(d.startsAt, d.timezone)}` : ""}.
      </P>
      <P>When you have two minutes, please add your health details and sign the waiver, so we can look after you properly.</P>
      <Cta href={safeUrl(d.detailsLink, `${siteOrigin()}/account`)}>Add my details</Cta>
      <Small>Already done? Thank you, you can ignore this email.</Small>
    </Layout>
  ),
};
