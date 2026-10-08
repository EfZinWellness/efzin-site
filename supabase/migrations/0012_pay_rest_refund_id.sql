-- The automatic refund of a pay-rest excess is made at most once per session, even when the
-- webhook is retried after Stripe's 24-hour idempotency window.
alter table pay_rest_settlements add column refund_id text;
