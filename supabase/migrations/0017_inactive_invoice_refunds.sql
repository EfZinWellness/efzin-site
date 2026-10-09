-- A scheduled-payment invoice paid after its booking stopped being active is refunded in full,
-- once: the row is written when the payment is first seen and the refund id stored once made.
create table invoice_refunds (
  invoice_id text primary key,
  booking_id uuid references bookings (id),
  amount_minor int not null,
  currency text,
  refund_id text,
  created_at timestamptz not null default now()
);

alter table invoice_refunds enable row level security;
revoke all on invoice_refunds from anon, authenticated;

-- Places on a booking can be transferred at most 3 times (self-service).
alter table bookings add column transfer_count int not null default 0 check (transfer_count >= 0);
