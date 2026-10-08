import { AdminEmail } from "./AdminFacts";
import { str, type EmailTemplate } from "./helpers";

export const adminError: EmailTemplate = {
  subject: (d) => `Ef Zin alert: ${str(d.context).replace(/_/g, " ") || "something needs attention"}`,
  body: (d) => (
    <AdminEmail title="Something needs your attention" lead={str(d.problem) || undefined} data={d} omit={["problem"]} />
  ),
};
