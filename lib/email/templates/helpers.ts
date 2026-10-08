import type { ReactElement } from "react";
import { formatAmount, formatDueDate } from "../../booking/quote";
import { formatAed } from "../../giftcards/money";
import { SITE_URL } from "../../site";

/** Template data as callers pass it to sendEmail. Every reader below tolerates missing or odd values. */
export type Data = Record<string, unknown>;

export interface EmailTemplate {
  subject(d: Data): string;
  body(d: Data): ReactElement;
}

export const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

/** Site origin for links and the logo (absolute: email clients need full URLs). */
export function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_ORIGIN || SITE_URL).replace(/\/+$/, "");
}

export const logoUrl = (): string => `${siteOrigin()}/brand/wordmark-navy.png`;

/** "Dear Layla," from "Layla Haddad"; "Hello," without a name. */
export function greeting(name: unknown): string {
  const first = str(name).trim().split(/\s+/)[0];
  return first ? `Dear ${first},` : "Hello,";
}

/** "€480" / "AED 1,920.50"; "" when the amount or currency is missing. */
export function money(minor: unknown, currency: unknown): string {
  const m = num(minor);
  const c = str(currency).toUpperCase();
  if (m === null || !/^[A-Z]{3}$/.test(c)) return "";
  try {
    return formatAmount(m, c);
  } catch {
    return `${c} ${(m / 100).toFixed(2)}`;
  }
}

export const aed = (minor: unknown): string => {
  const m = num(minor);
  return m === null ? "" : formatAed(m);
};

/** "31 May 2027" from YYYY-MM-DD; "" otherwise. */
export function day(ymd: unknown): string {
  const s = str(ymd);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? formatDueDate(s) : "";
}

/** "Monday 1 February 2027, 10:00" in the experience's timezone (Dubai by default). */
export function when(iso: unknown, timezone?: unknown): string {
  const s = str(iso);
  const d = new Date(s);
  if (!s || Number.isNaN(d.getTime())) return "";
  const timeZone = str(timezone) || "Asia/Dubai";
  try {
    const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone }).format(d);
    const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone }).format(d);
    const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(d);
    return `${weekday} ${date}, ${time}`;
  } catch {
    return d.toUTCString();
  }
}

/** Only http(s) links are rendered as links. */
export const safeUrl = (v: unknown, fallback = siteOrigin()): string => {
  const s = str(v);
  return /^https?:\/\//i.test(s) ? s : fallback;
};

/** Subjects are single-line and bounded. */
export const oneLine = (s: string): string => s.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
