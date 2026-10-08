import { AdminEmail } from "./AdminFacts";
import { str, type EmailTemplate } from "./helpers";

export const adminNewBooking: EmailTemplate = {
  subject: (d) => `New booking: ${str(d.experience) || "Ef Zin"}`,
  body: (d) => <AdminEmail title="New booking" lead={`${str(d.booker)} booked ${str(d.experience)}.`} data={d} />,
};
