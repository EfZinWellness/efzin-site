import { Body, Button, Container, Head, Heading, Hr, Html, Img, Link, Preview, Section, Text } from "@react-email/components";
import type { ReactNode } from "react";
import { logoUrl, siteOrigin } from "./helpers";

/** Brand palette (direction A: calm, lots of space, serif headings). */
export const C = { navy: "#1A405A", ivory: "#FFFDF1", choc: "#59352E", sand: "#D9C3A0", muted: "#6E6F5E" };
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "Arial, Helvetica, sans-serif";

export function Layout({ preview, title, children }: { preview: string; title: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: C.ivory, margin: 0, padding: "40px 0", fontFamily: SERIF, color: C.navy }}>
        <Container style={{ maxWidth: "560px", margin: "0 auto", padding: "0 24px" }}>
          <Section style={{ textAlign: "center", paddingBottom: "36px" }} data-skip-in-text="true">
            <Link href={siteOrigin()}>
              <Img src={logoUrl()} alt="Ef Zin" width="150" style={{ margin: "0 auto", display: "block" }} />
            </Link>
          </Section>
          <Heading as="h1" style={{ fontFamily: SERIF, fontWeight: "normal", fontSize: "26px", lineHeight: "1.3", margin: "0 0 24px" }}>
            {title}
          </Heading>
          {children}
          <Hr style={{ borderColor: C.sand, margin: "48px 0 16px" }} />
          <Text style={{ fontFamily: SANS, fontSize: "11px", letterSpacing: "2px", textTransform: "uppercase", color: C.muted, margin: 0 }}>
            Ef Zin · Ancient Wisdom for Modern Living
          </Text>
          <Text style={{ fontFamily: SANS, fontSize: "11px", color: C.muted, margin: "4px 0 0" }}>
            <Link href={siteOrigin()} style={{ color: C.muted }}>
              efzinwellness.com
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export function P({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: SERIF, fontSize: "16px", lineHeight: "1.7", margin: "0 0 16px", color: C.navy }}>{children}</Text>;
}

export function Small({ children }: { children: ReactNode }) {
  return <Text style={{ fontFamily: SANS, fontSize: "13px", lineHeight: "1.6", margin: "0 0 12px", color: C.muted }}>{children}</Text>;
}

export function H2({ children }: { children: ReactNode }) {
  return (
    <Heading as="h2" style={{ fontFamily: SERIF, fontWeight: "normal", fontSize: "19px", margin: "32px 0 12px", color: C.choc }}>
      {children}
    </Heading>
  );
}

export function Cta({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ margin: "28px 0" }}>
      <Button
        href={href}
        style={{
          backgroundColor: C.navy,
          color: C.ivory,
          padding: "14px 28px",
          fontFamily: SANS,
          fontSize: "12px",
          letterSpacing: "3px",
          textTransform: "uppercase",
          textDecoration: "none",
        }}
      >
        {children}
      </Button>
    </Section>
  );
}

/** A quiet two-column list of facts (label, value). Empty values are left out. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== "" && v !== null && v !== undefined);
  return <Table head={null} rows={shown.map(([label, value]) => [label, value])} labelFirst />;
}

/**
 * A simple bordered table (class "data": rendered as aligned columns in the plain-text part).
 * With `labelFirst`, the first column is a muted label.
 */
export function Table({ head, rows, labelFirst = false }: { head: string[] | null; rows: ReactNode[][]; labelFirst?: boolean }) {
  const cell = (i: number) => ({
    padding: "7px 12px 7px 0",
    verticalAlign: "top" as const,
    textAlign: "left" as const,
    ...(labelFirst && i === 0
      ? { width: "40%", fontFamily: SANS, fontSize: "12px", color: C.muted }
      : { fontFamily: SERIF, fontSize: "15px", color: C.navy }),
  });
  return (
    <table
      className="data"
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      style={{ borderTop: `1px solid ${C.sand}`, borderBottom: `1px solid ${C.sand}`, margin: "8px 0 24px", borderCollapse: "collapse" }}
    >
      <tbody>
        {head && (
          <tr>
            {head.map((h) => (
              <th key={h} style={{ ...cell(1), fontFamily: SANS, fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase", color: C.muted }}>
                {h}
              </th>
            ))}
          </tr>
        )}
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j} style={cell(j)}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: "'Courier New', monospace",
        fontSize: "22px",
        letterSpacing: "3px",
        fontWeight: "bold",
        textAlign: "center",
        border: `1px solid ${C.sand}`,
        padding: "16px",
        margin: "20px 0",
      }}
    >
      {children}
    </Text>
  );
}

export function Quote({ children }: { children: ReactNode }) {
  return (
    <Text style={{ fontFamily: SERIF, fontSize: "17px", fontStyle: "italic", lineHeight: "1.6", margin: "8px 0 24px", color: C.choc }}>
      {children}
    </Text>
  );
}
