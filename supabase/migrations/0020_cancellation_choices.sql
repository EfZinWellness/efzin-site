-- When Ef Zin cancels an experience, each booker chooses a full refund or the full amount as
-- credit (lib/booking/efzinChoice.ts). The booking is cancelled at once; the money moves when
-- the guest chooses through /account/cancellation/<token>, or by default (refund) once
-- deadline_at has passed. The token is the only key the guest's link carries.
create table cancellation_choices (
  booking_id uuid primary key references bookings (id),
  token uuid not null unique default gen_random_uuid(),
  offered_at timestamptz not null,
  deadline_at timestamptz not null,
  choice text check (choice in ('refund', 'credit')),
  decided_at timestamptz,
  decided_by text check (decided_by in ('guest', 'default')),
  check ((choice is null) = (decided_at is null) and (choice is null) = (decided_by is null))
);

create index cancellation_choices_pending on cancellation_choices (deadline_at) where choice is null;

alter table cancellation_choices enable row level security;
revoke all on cancellation_choices from anon, authenticated;

-- 'efzin_cancelled': Ef Zin cancelled the experience (money follows the guest's choice).
alter table bookings drop constraint bookings_cancel_reason_check;
alter table bookings add constraint bookings_cancel_reason_check check (cancel_reason in ('unpaid_balance', 'efzin_cancelled'));
