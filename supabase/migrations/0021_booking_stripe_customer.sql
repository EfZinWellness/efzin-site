-- The Stripe customer a payment plan's card was saved on. A guest who books a plan without
-- signing in gets a fresh customer for that booking only (never the customer of the person
-- matching the typed email, whose saved cards must not be offered to someone else). Instalments,
-- "Pay the rest now", "Update card" and pay links use this customer when set, else the person's.
alter table bookings add column stripe_customer_id text;
