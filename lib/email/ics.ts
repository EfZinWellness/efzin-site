/** A single-event iCalendar (RFC 5545) invite: times in UTC, text escaped, lines folded at 75 octets. */
export interface IcsEvent {
  uid: string;
  title: string;
  startsAt: string | Date;
  endsAt?: string | Date | null;
  location?: string | null;
  description?: string | null;
  url?: string | null;
  /** DTSTAMP: when the invite was made. */
  now: Date;
}

const utc = (d: string | Date): string => new Date(d).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const text = (s: string): string => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Folds a content line into chunks of at most 75 octets (continuations start with a space). */
function fold(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let bytes = 0;
  const limit = () => (out.length === 0 ? 75 : 74);
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    if (bytes + n > limit()) {
      out.push(out.length === 0 ? cur : ` ${cur}`);
      cur = "";
      bytes = 0;
    }
    cur += ch;
    bytes += n;
  }
  out.push(out.length === 0 ? cur : ` ${cur}`);
  return out;
}

export function buildIcs(e: IcsEvent): string {
  const start = new Date(e.startsAt);
  const end = e.endsAt ? new Date(e.endsAt) : new Date(start.getTime() + 2 * 3_600_000);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ef Zin//Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${utc(e.now)}`,
    `DTSTART:${utc(start)}`,
    `DTEND:${utc(end)}`,
    `SUMMARY:${text(e.title)}`,
    ...(e.location ? [`LOCATION:${text(e.location)}`] : []),
    ...(e.description ? [`DESCRIPTION:${text(e.description)}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.flatMap(fold).join("\r\n") + "\r\n";
}
