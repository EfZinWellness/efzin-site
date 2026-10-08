export type GiftEmailKind = "gift_card_bought" | "gift_card_delivered" | "gift_card_delivered_buyer";

export const GIFT_EMAIL_KINDS: ReadonlySet<string> = new Set<GiftEmailKind>([
  "gift_card_bought",
  "gift_card_delivered",
  "gift_card_delivered_buyer",
]);

const NAVY = "#1A405A";
const IVORY = "#FFFDF1";
const SAND = "#D9C3A0";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** Branded wrapper: ivory page, navy wordmark text, sand rules. Inline styles only (email clients). */
function shell(inner: string): string {
  return `<div style="background:${IVORY};padding:32px 16px;font-family:Georgia,'Times New Roman',serif;color:${NAVY}">
<div style="max-width:520px;margin:0 auto;text-align:center">
<p style="margin:0 0 24px;font-size:13px;letter-spacing:6px;text-transform:uppercase">Ef Zin</p>
${inner}
<hr style="border:0;border-top:1px solid ${SAND};margin:32px 0 12px">
<p style="margin:0;font-size:11px;color:#6E6F5E;font-family:Arial,sans-serif">Ef Zin &middot; efzinwellness.com</p>
</div></div>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${esc(href)}" style="background:${NAVY};color:${IVORY};padding:14px 28px;text-decoration:none;font-family:Arial,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase">${esc(label)}</a></p>`;

const codeBox = (code: string) =>
  `<p style="margin:20px 0;padding:16px;border:1px solid ${SAND};font-family:'Courier New',monospace;font-size:22px;letter-spacing:3px;font-weight:bold">${esc(code)}</p>`;

function delivered(d: Record<string, unknown>): { subject: string; text: string; html: string } {
  const to = str(d.recipientName);
  const buyer = str(d.buyerName);
  const message = str(d.message);
  const suggested = str(d.suggested);
  const estimate = str(d.estimate);
  const value = str(d.value);
  const hasPdf = d.hasPdf === true;
  const receipt = d.receipt === true;
  const subject = buyer && buyer !== to ? `${buyer} sent you an Ef Zin gift card` : "Your Ef Zin gift card";
  const lines = [
    to ? `Dear ${to},` : "Hello,",
    buyer && buyer !== to ? `${buyer} has sent you a gift card for Ef Zin.` : "Here is your Ef Zin gift card.",
    ...(message ? [`"${message}"`] : []),
    `Value: ${value}${estimate ? ` (${estimate})` : ""}`,
    `Your code: ${str(d.code)}`,
    ...(suggested ? [`Suggested experience: ${suggested}`] : []),
    `Valid until ${str(d.expiresOn)}. It can be spent on any Ef Zin event or retreat.`,
    `Book with your gift: ${str(d.bookUrl)}`,
    ...(hasPdf ? ["A printable card is attached."] : []),
    ...(receipt ? ["Thank you for your purchase."] : []),
  ];
  const html = shell(`
<p style="margin:0;font-size:22px">${to ? `Dear ${esc(to)}` : "Hello"}</p>
<p style="margin:12px 0 0;font-size:15px;line-height:1.6">${
    buyer && buyer !== to ? `${esc(buyer)} has sent you a gift card for Ef Zin.` : "Here is your Ef Zin gift card."
  }</p>
${message ? `<p style="margin:20px 0 0;font-size:16px;font-style:italic;line-height:1.6">&ldquo;${esc(message)}&rdquo;</p>` : ""}
<p style="margin:28px 0 0;font-size:34px">${esc(value)}</p>
${estimate ? `<p style="margin:4px 0 0;font-size:13px;color:#6E6F5E;font-family:Arial,sans-serif">${esc(estimate)}</p>` : ""}
${codeBox(str(d.code))}
${suggested ? `<p style="margin:0;font-size:14px">Suggested: ${esc(suggested)}</p>` : ""}
<p style="margin:12px 0 0;font-size:13px;color:#6E6F5E;font-family:Arial,sans-serif">Valid until ${esc(str(d.expiresOn))}. Spend it on any Ef Zin event or retreat.</p>
${button(str(d.bookUrl), "Book with your gift")}
${hasPdf ? `<p style="margin:0;font-size:12px;color:#6E6F5E;font-family:Arial,sans-serif">A printable card is attached.</p>` : ""}
${receipt ? `<p style="margin:16px 0 0;font-size:14px">Thank you for your purchase.</p>` : ""}`);
  return { subject, text: lines.join("\n\n"), html };
}

function deliveredBuyer(d: Record<string, unknown>): { subject: string; text: string; html: string } {
  const to = str(d.recipientName) || str(d.recipientEmail) || "your recipient";
  const buyer = str(d.buyerName);
  const text = `${buyer ? `Dear ${buyer},` : "Hello,"}\n\nYour gift has been delivered. ${to} has been emailed their ${str(d.value)} Ef Zin gift card.`;
  const html = shell(`
<p style="margin:0;font-size:22px">Your gift has been delivered</p>
<p style="margin:16px 0 0;font-size:15px;line-height:1.6">${buyer ? `Dear ${esc(buyer)}, ` : ""}${esc(to)} has been emailed their ${esc(str(d.value))} Ef Zin gift card.</p>`);
  return { subject: "Your Ef Zin gift has been delivered", text, html };
}

/** Receipt for a single gift: value, who it is for, when it goes out, and a masked card preview. */
function receiptEmail(d: Record<string, unknown>): { subject: string; text: string; html: string } {
  const buyer = str(d.buyerName);
  const who = str(d.recipientLabel) || "you";
  const text = [
    buyer ? `Dear ${buyer},` : "Hello,",
    `Thank you for your purchase. Your ${str(d.value)} Ef Zin gift card for ${who} will be emailed on ${str(d.deliverOn)}.`,
    `Card: ${str(d.codeMasked)}`,
    "The full code is sent with the card on the delivery date.",
  ].join("\n\n");
  const html = shell(`
<p style="margin:0;font-size:22px">Thank you for your purchase</p>
<p style="margin:12px 0 0;font-size:15px;line-height:1.6">${buyer ? `Dear ${esc(buyer)}, your` : "Your"} ${esc(str(d.value))} gift card for ${esc(who)} will be emailed on ${esc(str(d.deliverOn))}.</p>
<div style="margin:24px auto;max-width:320px;padding:20px;background:${NAVY};color:${IVORY}">
<p style="margin:0;font-size:12px;letter-spacing:4px;text-transform:uppercase">Ef Zin gift card</p>
<p style="margin:12px 0 0;font-size:28px">${esc(str(d.value))}</p>
<p style="margin:12px 0 0;font-family:'Courier New',monospace;font-size:16px;letter-spacing:2px">${esc(str(d.codeMasked))}</p>
</div>
<p style="margin:0;font-size:12px;color:#6E6F5E;font-family:Arial,sans-serif">The full code is sent with the card on the delivery date.</p>`);
  return { subject: "Thank you for your Ef Zin gift card purchase", text, html };
}

function bought(d: Record<string, unknown>): { subject: string; text: string; html: string } {
  if (!Array.isArray(d.codes)) return receiptEmail(d);
  const codes = Array.isArray(d.codes) ? (d.codes as unknown[]).map(String) : [];
  const buyer = str(d.buyerName);
  const subject = `Your Ef Zin gift cards (${codes.length})`;
  const text = [
    buyer ? `Dear ${buyer},` : "Hello,",
    `Thank you. Here are your ${codes.length} Ef Zin gift cards, ${str(d.value)} each, valid until ${str(d.expiresOn)}.`,
    codes.join("\n"),
    "The same codes are in the attached CSV (code,value_aed,expires_on). Each code can be spent on any Ef Zin event or retreat.",
  ].join("\n\n");
  const rows = codes
    .map((c) => `<tr><td style="padding:6px 0;font-family:'Courier New',monospace;font-size:15px;letter-spacing:2px">${esc(c)}</td></tr>`)
    .join("");
  const html = shell(`
<p style="margin:0;font-size:22px">Your gift cards</p>
<p style="margin:12px 0 0;font-size:15px;line-height:1.6">${buyer ? `Dear ${esc(buyer)}, thank you. ` : "Thank you. "}Here are your ${codes.length} gift cards, ${esc(str(d.value))} each, valid until ${esc(str(d.expiresOn))}.</p>
<table role="presentation" style="margin:20px auto;border-top:1px solid ${SAND};border-bottom:1px solid ${SAND}">${rows}</table>
<p style="margin:0;font-size:12px;color:#6E6F5E;font-family:Arial,sans-serif;line-height:1.6">The same codes are in the attached CSV. Each can be spent on any Ef Zin event or retreat.</p>
${button(str(d.bookUrl), "See what is on")}`);
  return { subject, text, html };
}

export function renderGiftEmail(
  kind: GiftEmailKind,
  data: Record<string, unknown>,
): { subject: string; text: string; html: string } {
  if (kind === "gift_card_delivered") return delivered(data);
  if (kind === "gift_card_delivered_buyer") return deliveredBuyer(data);
  return bought(data);
}
