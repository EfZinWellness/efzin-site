-- Emails sent once per (kind, recipient, ref): reminders, receipts and alerts from jobs that can
-- run again (a cron retry, a second daily run) never send twice. A row is written just before the
-- send and removed again if the send fails, so a failed email is retried on the next run.
create table email_log (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  "to" text not null,
  ref text not null,
  sent_at timestamptz not null default now(),
  unique (kind, "to", ref)
);

alter table email_log enable row level security;
revoke all on email_log from anon, authenticated;
