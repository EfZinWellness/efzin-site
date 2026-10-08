import { Cta, Facts, Layout, P, Small } from "./Layout";
import { greeting, safeUrl, siteOrigin, str, when, type EmailTemplate } from "./helpers";

export const guestAdded: EmailTemplate = {
  subject: (d) => `${str(d.bookerName) || "A friend"} booked you a spot at ${str(d.experience) || "Ef Zin"}`,
  body: (d) => {
    const booker = str(d.bookerName) || "A friend";
    return (
      <Layout preview={`${booker} booked you a spot.`} title={`${booker} booked you a spot`}>
        <P>{greeting(d.name)}</P>
        <P>
          {booker} has booked you a place at {str(d.experience) || "an Ef Zin experience"}. We’re so glad you’re coming.
        </P>
        <Facts
          rows={[
            ["Experience", str(d.experience)],
            ["When", when(d.startsAt, d.timezone)],
          ]}
        />
        <P>Please complete your details (health questions and waiver) before you arrive.</P>
        <Cta href={safeUrl(d.claimLink, `${siteOrigin()}/account`)}>Complete my details</Cta>
        <Small>This link also opens your My Ef Zin account, where you can see your bookings.</Small>
      </Layout>
    );
  },
};
