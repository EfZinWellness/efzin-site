-- When Ef Zin first tried to collect a scheduled item (its first Stripe invoice). The unpaid-balance
-- grace period counts from the later of the item's due date and this attempt.
alter table payment_schedule_items add column first_attempted_at timestamptz;
