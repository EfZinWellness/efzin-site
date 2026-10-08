-- Why and when a booking was cancelled. 'unpaid_balance' marks the daily job's cancellation of a
-- part-paid booking whose balance was still unpaid after its last instalment (plus grace), so the
-- notice to the guest and Tanya can be retried until it has been sent.
alter table bookings
  add column cancel_reason text check (cancel_reason in ('unpaid_balance')),
  add column cancelled_at timestamptz;
