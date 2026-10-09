/**
 * Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, embedded commas and newlines,
 * CRLF or LF line endings, and a leading byte order mark. Blank lines are skipped.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let touched = false; // the current row has any content at all

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    if (touched) rows.push(row);
    row = [];
    touched = false;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      touched = true;
    } else if (c === ",") {
      endField();
      touched = true;
    } else if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else if (c === "\n") {
      endRow();
    } else {
      field += c;
      touched = true;
    }
  }
  if (touched || field !== "") endRow();
  return rows;
}

/** Rows as objects keyed by the lowercased, trimmed header name. Extra cells are ignored. */
export function parseCsvRecords(input: string): Record<string, string>[] {
  const [header, ...body] = parseCsv(input);
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return body.map((cells) => {
    const rec: Record<string, string> = {};
    keys.forEach((k, i) => {
      if (k) rec[k] = (cells[i] ?? "").trim();
    });
    return rec;
  });
}

/** First non-empty value among the candidate header names (all lowercase). */
export function pick(rec: Record<string, string>, ...names: string[]): string {
  for (const n of names) {
    const v = rec[n];
    if (v) return v;
  }
  return "";
}
