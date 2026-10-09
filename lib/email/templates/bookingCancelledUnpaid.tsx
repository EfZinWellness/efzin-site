import { AdminEmail } from "./AdminFacts";
import { Facts, Layout, P, Small } from "./Layout";
import { day, greeting, money, num, str, type EmailTemplate } from "./helpers";

/** Sent to the booker, and (with `forAdmin`) to Tanya, when the balance was unpaid at the due date. */
export const bookingCancelledUnpaid: EmailTemplate = {
  subject: (d) =>
    d.forAdmin === true
      ? `Booking cancelled (balance unpaid): ${str(d.experience) || "Ef Zin"}`
      : `Your booking for ${str(d.experience) || "Ef Zin"} has been cancelled`,
  body: (d) => {
    if (d.forAdmin === true) {
      return (
        <AdminEmail
          title="Booking cancelled: balance unpaid"
          lead="The balance was still unpaid after the balance due date, so the booking was cancelled under the policy, open invoices were voided and the spots were released."
          data={{ ...d, unpaid: money(d.unpaidMinor, d.currency) }}
          omit={["forAdmin"]}
        />
      );
    }
    const unpaid = money(d.unpaidMinor, d.currency);
    const due = day(d.balanceDueOn);
    const refund = num(d.refundMinor) ?? 0;
    return (
      <Layout preview="Your booking has been cancelled because the balance was not paid." title="Your booking has been cancelled">
        <P>{greeting(d.name)}</P>
        <P>
          We didn’t receive the remaining balance{unpaid ? ` of ${unpaid}` : ""} for {str(d.experience) || "your booking"}
          {due ? ` by the balance due date, ${due}` : " by the balance due date"}, so your booking has been cancelled under our cancellation policy.
        </P>
        <Facts
          rows={[
            ["Experience", str(d.experience)],
            ["Unpaid balance", unpaid],
            ["Balance due date", due],
            ["Refund", refund > 0 ? money(refund, d.refundCurrency ?? d.currency) : ""],
          ]}
        />
        <P>
          No further payments will be taken.{" "}
          {refund > 0
            ? "The refund shown above is on its way to your card."
            : d.refundDue === true
              ? "We'll be in touch about the money due back to you under the policy."
              : "Under the policy, amounts already paid are not refunded at this point."}
        </P>
        <Small>If you think this is a mistake, or you’d like to talk it through, just reply to this email.</Small>
      </Layout>
    );
  },
};
