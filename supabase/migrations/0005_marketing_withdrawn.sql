-- When someone withdraws marketing consent we record when, so a later newsletter sign-up
-- form cannot silently re-subscribe them.
alter table people add column marketing_consent_withdrawn_at timestamptz;