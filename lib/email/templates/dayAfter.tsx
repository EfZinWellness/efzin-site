import { Link } from "@react-email/components";
import { REVIEW_URL } from "../../site";
import { Cta, Layout, P, Small } from "./Layout";
import { greeting, safeUrl, siteOrigin, str, when, type EmailTemplate } from "./helpers";

export const dayAfter: EmailTemplate = {
  subject: (d) => `Thank you for joining ${str(d.experience) || "us"}`,
  body: (d) => {
    const next = str(d.nextTitle);
    return (
      <Layout preview="Thank you for coming." title="Thank you">
        <P>{greeting(d.name)}</P>
        <P>Thank you for joining us at {str(d.experience) || "Ef Zin"}. It was lovely to share the time with you.</P>
        <P>We’d love to hear how it was for you. A few words in a review help others find their way to Ef Zin, and every word is read.</P>
        <Small>
          <Link href={safeUrl(d.reviewUrl, REVIEW_URL)}>Leave a review</Link>
        </Small>
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
