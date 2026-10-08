-- Links a pending checkout to the booking it became, so confirmation is idempotent.
alter table pending_bookings
  add column confirmed_booking_id uuid unique references bookings (id);
