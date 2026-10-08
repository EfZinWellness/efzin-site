/* eslint-disable jsx-a11y/alt-text -- @react-pdf/renderer's Image is a PDF element, not an HTML img. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { formatYmd } from "../../giftcards/dates";
import { formatAed } from "../../giftcards/money";

const NAVY = "#1A405A";
const IVORY = "#FFFDF1";
const SAND = "#D9C3A0";

export interface GiftCardPdfProps {
  code: string;
  valueAedMinor: number;
  recipientName?: string | null;
  message?: string | null;
  /** YYYY-MM-DD */
  expiresOn: string;
  suggestedTitle?: string | null;
  /** Brand images as PNG bytes; omitted images fall back to text. */
  wordmark?: Buffer | null;
  mark?: Buffer | null;
}

const s = StyleSheet.create({
  page: { backgroundColor: NAVY, color: IVORY, padding: 26, fontFamily: "Times-Roman" },
  frame: { flexGrow: 1, borderWidth: 0.75, borderColor: SAND, padding: 18, flexDirection: "row" },
  main: { flexGrow: 1, justifyContent: "space-between" },
  side: { width: 70, alignItems: "center", justifyContent: "center" },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  wordmark: { width: 96 },
  wordmarkText: { fontSize: 16, letterSpacing: 4 },
  eyebrow: { fontFamily: "Helvetica", fontSize: 7, letterSpacing: 2.5, color: SAND },
  value: { fontSize: 34, marginTop: 10 },
  to: { fontSize: 12, marginTop: 4 },
  message: { fontSize: 10, fontStyle: "italic", marginTop: 8, lineHeight: 1.35, color: IVORY },
  codeLabel: { fontFamily: "Helvetica", fontSize: 6.5, letterSpacing: 2, color: SAND },
  code: { fontFamily: "Courier-Bold", fontSize: 17, letterSpacing: 2, marginTop: 3 },
  small: { fontFamily: "Helvetica", fontSize: 7, color: SAND, marginTop: 4, lineHeight: 1.4 },
  mark: { width: 38 },
});

/** A6 landscape gift card: navy with ivory type, the wordmark and the fζ mark. */
export function GiftCardPdf(p: GiftCardPdfProps) {
  return (
    <Document title="Ef Zin gift card" author="Ef Zin">
      <Page size={[419.53, 297.64]} style={s.page}>
        <View style={s.frame}>
          <View style={s.main}>
            <View>
              <View style={s.top}>
                {p.wordmark ? (
                  <Image src={{ data: p.wordmark, format: "png" }} style={s.wordmark} />
                ) : (
                  <Text style={s.wordmarkText}>EF ZIN</Text>
                )}
                <Text style={s.eyebrow}>GIFT CARD</Text>
              </View>
              <Text style={s.value}>{formatAed(p.valueAedMinor)}</Text>
              {p.recipientName ? <Text style={s.to}>For {p.recipientName}</Text> : null}
              {p.message ? <Text style={s.message}>{p.message}</Text> : null}
            </View>
            <View>
              {p.suggestedTitle ? <Text style={s.small}>Suggested: {p.suggestedTitle}</Text> : null}
              <Text style={[s.codeLabel, { marginTop: 8 }]}>YOUR CODE</Text>
              <Text style={s.code}>{p.code}</Text>
              <Text style={s.small}>
                Valid until {formatYmd(p.expiresOn)}. Enter the code when booking any Ef Zin event or retreat at
                efzinwellness.com.
              </Text>
            </View>
          </View>
          {p.mark ? (
            <View style={s.side}>
              <Image src={{ data: p.mark, format: "png" }} style={s.mark} />
            </View>
          ) : null}
        </View>
      </Page>
    </Document>
  );
}

async function brandImage(file: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(process.cwd(), "public", "brand", file));
  } catch {
    return null;
  }
}

/** Renders the card to PDF bytes (server side). Loads the brand images from public/brand. */
export async function renderGiftCardPdf(props: GiftCardPdfProps): Promise<Buffer> {
  const [wordmark, mark] = await Promise.all([
    props.wordmark === undefined ? brandImage("wordmark-ivory.png") : props.wordmark,
    props.mark === undefined ? brandImage("mark-ivory.png") : props.mark,
  ]);
  return renderToBuffer(<GiftCardPdf {...props} wordmark={wordmark} mark={mark} />);
}
