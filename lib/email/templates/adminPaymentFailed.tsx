import { AdminEmail } from "./AdminFacts";
import { money, str, type EmailTemplate } from "./helpers";

export const adminPaymentFailed: EmailTemplate = {
  subject: (d) => `Payment failed: ${str(d.experience) || "Ef Zin booking"}`,
  body: (d) => (
    <AdminEmail
      title="A scheduled payment failed"
      lead={`${money(d.amountMinor, d.currency)} from ${str(d.booker)} was declined. Stripe retries automatically and the guest has the pay link.`}
      data={{ ...d, amount: money(d.amountMinor, d.currency) }}
    />
  ),
};
