import { Facts, Layout, P, Small } from "./Layout";
import { greeting, str, when, type EmailTemplate } from "./helpers";

/** To the previous guest when the booker gave their place to someone else. */
export const bookingTransferred: EmailTemplate = {
  subject: (d) => `Your place at ${str(d.experience) || "Ef Zin"} has been transferred`,
  body: (d) => (
    <Layout preview="Your place has been transferred." title="Your place has been transferred">
      <P>{greeting(d.name)}</P>
      <P>
        Your place at {str(d.experience) || "the experience"} has been transferred
        {str(d.newGuestName) ? ` to ${str(d.newGuestName)}` : " to someone else"} by the person who made the booking.
      </P>
      <Facts
        rows={[
          ["Experience", str(d.experience)],
          ["When", when(d.startsAt, d.timezone)],
        ]}
      />
      <Small>If you didn’t expect this, just reply to this email and we’ll look into it.</Small>
    </Layout>
  ),
};
