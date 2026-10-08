-- The "your spot is still waiting" email goes out at most once per pending checkout
-- (also set when the guest cancels and returns to the booking page, where no email is needed).
alter table pending_bookings add column abandoned_notified_at timestamptz;
