import { Link } from "@react-email/components";
import { Cta, Facts, Layout, P, Small } from "./Layout";
import { greeting, safeUrl, siteOrigin, str, strings, when, type EmailTemplate } from "./helpers";

export const dayBefore: EmailTemplate = {
  subject: (d) => `See you tomorrow: ${str(d.experience) || "Ef Zin"}`,
  body: (d) => {
    const map = str(d.mapUrl);
    const timings = strings(d.timings);
    return (
      <Layout preview="Everything you need for tomorrow." title="See you tomorrow">
        <P>{greeting(d.name)}</P>
        <P>Tomorrow is the day. Here is everything you need for {str(d.experience) || "your Ef Zin experience"}.</P>
        <Facts
          rows={[
            ["When", when(d.startsAt, d.timezone)],
            ["Where", str(d.venue)],
            ["Address", str(d.address)],
            ["Map", /^https?:\/\//i.test(map) ? <Link href={map}>Open the map</Link> : ""],
            ["Timing", timings.join(" · ")],
          ]}
        />
        <P>
          Please arrive ten minutes early, in comfortable clothes, with a water bottle. What to bring, parking and the full timing are on the
          experience page.
        </P>
        <Cta href={safeUrl(d.experienceUrl, `${siteOrigin()}/events`)}>Full details</Cta>
        <Small>Running late or unable to come? Just reply to this email.</Small>
      </Layout>
    );
  },
};
