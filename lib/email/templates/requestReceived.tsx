import { AdminEmail } from "./AdminFacts";
import { str, type EmailTemplate } from "./helpers";

const kind = (d: Record<string, unknown>) => str(d.type).replace(/_/g, " ");

export const requestReceived: EmailTemplate = {
  subject: (d) => `New ${kind(d)} enquiry from ${str(d.name) || "a guest"}`,
  body: (d) => <AdminEmail title={`New ${kind(d)} enquiry`.replace(/\s+/g, " ")} lead="Reply to the guest directly." data={d} />,
};
