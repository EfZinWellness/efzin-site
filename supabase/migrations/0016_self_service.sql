-- Self-service cancellation, transfer and waitlist (Task 15).

-- The base-currency value of the gift card and credit applied at checkout, so money back is split
-- with the same figures the booking was priced with (no later exchange rate involved).
alter table bookings
  add column gift_card_applied_base_minor int not null default 0 check (gift_card_applied_base_minor >= 0),
  add column credit_applied_base_minor int not null default 0 check (credit_applied_base_minor >= 0);

-- One card refund per (booking, charge), written in the same transaction as the cancellation and
-- completed with the Stripe refund id afterwards. A row without refund_id is retried (same
-- idempotency key, same amount); a row with one is never refunded again.
create table booking_refunds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id),
  charge_id text not null,
  position int not null default 0, -- refund order: newest charge first
  amount_minor int not null check (amount_minor > 0),
  currency text not null,
  fee_deducted_minor int not null default 0 check (fee_deducted_minor >= 0),
  refund_id text,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (booking_id, charge_id)
);
create index booking_refunds_pending_idx on booking_refunds (booking_id) where refund_id is null;

alter table booking_refunds enable row level security;
revoke all on booking_refunds from anon, authenticated;

-- The payment intent of a "Pay the rest now" Checkout, so its charge is refunded on cancellation.
alter table pay_rest_settlements add column payment_intent text;

-- Waitlist entries from the public form: name and email, one entry per email per ticket.
alter table waitlist add column name text;
create unique index waitlist_ticket_email_key on waitlist (ticket_type_id, lower(email));
