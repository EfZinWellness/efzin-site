import { Cta, Layout, P } from "./Layout";
import { greeting, safeUrl, siteOrigin, str, when, type EmailTemplate } from "./helpers";

export const dayAfter: EmailTemplate = {
  subject: (d) => `Thank you for joining ${str(d.experience) || "us"}`,
  body: (d) => {
    const next = str(d.nextTitle);
    return (
      <Layout preview="Thank you for coming." title="Thank you">
        <P>{greeting(d.name)}</P>
        <P>Thank you for joining us at {str(d.experience) || "Ef Zin"}. It was lovely to share the time with you.</P>
        <P>We’d love to hear how it was for you. Just reply to this email; every word is read.</P>
        {next ? (
          <P>
            Next up: {next}
            {when(d.nextStartsAt, d.nextTimezone) ? `, ${when(d.nextStartsAt, d.nextTimezone)}` : ""}.
          </P>
        ) : null}
        <Cta href={safeUrl(d.nextUrl, `${siteOrigin()}/events`)}>See what’s next</Cta>
      </Layout>
    );
  },
};
