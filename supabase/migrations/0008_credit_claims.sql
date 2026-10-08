-- A credit is claimed by one pending checkout at a time (until the claim expires with its holds),
-- so two checkouts cannot both count on the same credit.
alter table credits
  add column claimed_pending_id uuid references pending_bookings (id) on delete set null,
  add column claim_expires_at timestamptz;
create index credits_claimed_pending_idx on credits (claimed_pending_id);
