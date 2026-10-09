/** UTF-8 byte order mark, so Excel reads accents and Arabic names correctly. */
export const CSV_BOM = "﻿";

/**
 * One CSV cell. Quotes cells with commas, quotes, newlines or leading/trailing spaces, and
 * defuses spreadsheet formulas: a text cell starting with = + - @ (or a tab/CR) gets a leading
 * single quote. Numbers are written as they are (a negative number is a number, not a formula).
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  let s = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
