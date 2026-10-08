import { render } from "@react-email/components";
import type { EmailKind } from "./send";
import { oneLine, type Data } from "./templates/helpers";
import { TEMPLATES } from "./templates";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const TEXT_OPTIONS = {
  selectors: [
    { selector: "h1", options: { uppercase: false } },
    { selector: "h2", options: { uppercase: false } },
    { selector: "table.data", format: "dataTable", options: { uppercaseHeaderCells: false, maxColumnWidth: 60 } },
  ],
};

/** The branded HTML and plain-text parts of an email. React escapes every value from `data`. */
export async function renderEmail(kind: EmailKind, data: Data): Promise<RenderedEmail> {
  const t = TEMPLATES[kind];
  const el = t.body(data);
  const [html, text] = await Promise.all([render(el), render(el, { plainText: true, htmlToTextOptions: TEXT_OPTIONS })]);
  return { subject: oneLine(t.subject(data)), html, text: text.trim() };
}
