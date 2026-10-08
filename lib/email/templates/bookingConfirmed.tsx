import { OPTION_LABELS } from "../../booking/quote";
import type { PaymentOption } from "../../payments/schedule";
import { policyCopy } from "../../policy/copy";
import { Cta, Facts, H2, Layout, P, Small, Table } from "./Layout";
import { day, greeting, money, num, safeUrl, siteOrigin, str, strings, when, type Data, type EmailTemplate } from "./helpers";

type Item = { seq: number; dueOn: string; amountMinor: number; currency: string; status: string };

const STATUS: Record<string, string> = { paid: "Paid", scheduled: "Scheduled", failed: "Failed", cancelled: "Cancelled" };

function items(v: unknown): Item[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((i): i is Record<string, unknown> => typeof i === "object" && i !== null)
    .map((i) => ({
      seq: num(i.seq) ?? 0,
      dueOn: str(i.dueOn),
      amountMinor: num(i.amountMinor) ?? 0,
      currency: str(i.currency),
      status: str(i.status),
    }));
}

/** The policy agreed at checkout (from the booking's snapshot), else the template's wording. */
function policy(d: Data): string[] {
  const given = strings(d.policy);
  if (given.length > 0) return given;
  const t = str(d.policyTemplate);
  return t === "standard_event" || t === "standard_retreat" ? policyCopy(t) : [];
}

export const bookingConfirmed: EmailTemplate = {
  subject: (d) => `You're booked: ${str(d.experience) || "your Ef Zin experience"}`,
  body: (d) => {
    const schedule = items(d.schedule);
    const plan = schedule.length > 1;
    const option = str(d.paymentOption) as PaymentOption;
    const guests = strings(d.guests);
    const rules = policy(d);
    const detailsLink = safeUrl(d.claimLink, safeUrl(d.detailsLink, `${siteOrigin()}/account`));
    return (
      <Layout preview={`Your place at ${str(d.experience)} is confirmed.`} title="You're booked">
        <P>{greeting(d.name)}</P>
        <P>Thank you. Your place at {str(d.experience) || "your Ef Zin experience"} is confirmed, and we can’t wait to welcome you.</P>
        <Facts
          rows={[
            ["Experience", str(d.experience)],
            ["When", when(d.startsAt, d.timezone)],
            ["Where", str(d.venue)],
            ["Guests with you", guests.join(", ")],
            ["Payment", OPTION_LABELS[option] ?? ""],
            ["Paid today", money(d.amountPaidMinor, d.currency)],
            ["Booking reference", str(d.bookingId).slice(0, 8).toUpperCase()],
          ]}
        />
        {plan ? (
          <>
            <H2>Your payment schedule</H2>
            <Table
              head={["Payment", "Due", "Amount", "Status"]}
              rows={schedule.map((i) => [
                i.seq === 0 ? "Deposit" : `Payment ${i.seq}`,
                day(i.dueOn),
                money(i.amountMinor, i.currency),
                STATUS[i.status] ?? i.status,
              ])}
            />
            <Small>
              Ef Zin will charge your saved card on these dates, in {schedule[schedule.length - 1].currency || "the experience's currency"}; your
              bank converts if needed. We email you three days before each payment. You can pay the rest early or update your card in My Ef Zin.
            </Small>
          </>
        ) : null}
        <H2>Before you arrive</H2>
        <P>Please add your health details and sign the waiver, so we can look after you properly.</P>
        <Cta href={detailsLink}>Add my details</Cta>
        {d.calendar === true ? <Small>A calendar invite is attached.</Small> : null}
        {rules.length > 0 ? (
          <>
            <H2>Cancellation policy</H2>
            {rules.map((r) => (
              <Small key={r}>· {r}</Small>
            ))}
          </>
        ) : null}
      </Layout>
    );
  },
};
