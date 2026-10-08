import { Link } from "@react-email/components";
import { Code, Cta, Facts, H2, Layout, P, Small } from "./Layout";
import { aed, day, greeting, safeUrl, siteOrigin, str, when, type EmailTemplate } from "./helpers";

type Upcoming = { title: string; url: string; startsAt: string; timezone: string };

function upcoming(v: unknown): Upcoming[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((x) => ({ title: str(x.title), url: safeUrl(x.url, `${siteOrigin()}/events`), startsAt: str(x.startsAt), timezone: str(x.timezone) }))
    .filter((x) => x.title);
}

export const giftCardExpiring: EmailTemplate = {
  subject: (d) => `Your Ef Zin gift card expires on ${day(d.expiresOn) || "soon"}`,
  body: (d) => {
    const next = upcoming(d.upcoming);
    return (
      <Layout preview={`${aed(d.balanceAedMinor)} left on your gift card.`} title="Your gift card expires soon">
        <P>{greeting(d.name)}</P>
        <P>A gentle reminder that your Ef Zin gift card expires in 30 days, with {aed(d.balanceAedMinor) || "value"} still on it.</P>
        {str(d.code) ? <Code>{str(d.code)}</Code> : null}
        <Facts
          rows={[
            ["Balance", aed(d.balanceAedMinor)],
            ["Expires", day(d.expiresOn)],
          ]}
        />
        {next.length > 0 ? (
          <>
            <H2>Coming up</H2>
            {next.map((x) => (
              <Small key={x.url + x.title}>
                <Link href={x.url}>{x.title}</Link>
                {when(x.startsAt, x.timezone) ? `, ${when(x.startsAt, x.timezone)}` : ""}
              </Small>
            ))}
          </>
        ) : null}
        <Cta href={`${siteOrigin()}/events`}>Book with your gift</Cta>
      </Layout>
    );
  },
};
