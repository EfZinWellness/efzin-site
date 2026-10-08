-- When a member first consented to storing health data (consent_at is the latest confirmation,
-- updated_at the latest edit).
alter table health_profiles add column consent_given_at timestamptz;
update health_profiles set consent_given_at = consent_at where consent_at is not null;

-- What a "Pay the rest now" Checkout settled, recorded once per session so a webhook retry
-- or a second event for the same session never re-marks items or refunds a different amount.
create table pay_rest_settlements (
  session_id text primary key,
  booking_id uuid references bookings (id),
  settled_item_ids uuid[] not null default '{}',
  settled_minor int not null default 0,
  paid_minor int,
  excess_minor int not null default 0 check (excess_minor >= 0),
  currency text,
  invoice_ids text[] not null default '{}',
  booking_status text,
  created_at timestamptz not null default now()
);

alter table pay_rest_settlements enable row level security;
revoke all on pay_rest_settlements from anon, authenticated;
