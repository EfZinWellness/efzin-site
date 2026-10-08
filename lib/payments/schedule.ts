export type PaymentOption = "full" | "deposit_balance" | "instalments";

export interface ScheduleItem {
  seq: number;
  /** YYYY-MM-DD in the experience timezone */
  dueOn: string;
  amountMinor: number;
  currency: "AED" | "EUR";
}

export interface ScheduleInput {
  option: PaymentOption;
  totalMinor: number;
  depositPct: number;
  currency: "AED" | "EUR";
  bookedAt: Date;
  startsAt: Date;
  balanceDueDays: number;
  maxInstalments: number;
  timezone: string;
}

/** Calendar date (YYYY-MM-DD) of an instant in the given timezone. */
function calendarDate(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function parse(ymd: string): [number, number, number] {
  const [y, m, d] = ymd.split("-").map(Number);
  return [y, m, d];
}

function fmt(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = parse(ymd);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Add whole months, keeping the day-of-month clamped to the target month's last day. */
function addMonthsClamped(ymd: string, months: number): string {
  const [y, m, d] = parse(ymd);
  const idx = y * 12 + (m - 1) + months;
  const ny = Math.floor(idx / 12);
  const nm = (idx % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return fmt(ny, nm, Math.min(d, last));
}

export function balanceDueDate(startsAt: Date, balanceDueDays: number, timezone: string): string {
  return addDays(calendarDate(startsAt, timezone), -balanceDueDays);
}

/** Number of monthly instalments: min(max, whole months from booking to balance due). */
function instalmentCount(bookingDate: string, dueDate: string, maxInstalments: number): number {
  let k = 0;
  while (k < maxInstalments && addMonthsClamped(bookingDate, k + 1) <= dueDate) k++;
  return Math.min(maxInstalments, k);
}

export function availableOptions(
  i: Omit<ScheduleInput, "option" | "totalMinor" | "currency" | "depositPct"> & { allowed: PaymentOption[] },
): PaymentOption[] {
  const today = calendarDate(i.bookedAt, i.timezone);
  const due = balanceDueDate(i.startsAt, i.balanceDueDays, i.timezone);
  const pastDue = today >= due;
  const n = pastDue ? 0 : instalmentCount(today, due, i.maxInstalments);
  const result: PaymentOption[] = ["full"];
  if (!pastDue && i.allowed.includes("deposit_balance")) result.push("deposit_balance");
  if (!pastDue && n >= 2 && i.allowed.includes("instalments")) result.push("instalments");
  return result;
}

export function buildSchedule(i: ScheduleInput): ScheduleItem[] {
  const today = calendarDate(i.bookedAt, i.timezone);
  const item = (seq: number, dueOn: string, amountMinor: number): ScheduleItem => ({
    seq,
    dueOn,
    amountMinor,
    currency: i.currency,
  });
  if (i.option === "full") return [item(0, today, i.totalMinor)];

  const deposit = Math.round((i.totalMinor * i.depositPct) / 100);
  const remainder = i.totalMinor - deposit;
  const due = balanceDueDate(i.startsAt, i.balanceDueDays, i.timezone);

  if (i.option === "deposit_balance") return [item(0, today, deposit), item(1, due, remainder)];

  const n = instalmentCount(today, due, i.maxInstalments);
  if (n < 1) return [item(0, today, deposit), item(1, due, remainder)];
  const each = Math.floor(remainder / n);
  const schedule = [item(0, today, deposit)];
  for (let k = 1; k <= n; k++) {
    const amount = k === n ? remainder - each * (n - 1) : each;
    schedule.push(item(k, addMonthsClamped(today, k), amount));
  }
  return schedule;
}
