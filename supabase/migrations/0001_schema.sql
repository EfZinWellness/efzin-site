-- Ef Zin schema. Money is always integer minor units. Writes go through the service role.

create table people (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  name text not null,
  email text not null,
  phone text,
  birthday date,
  how_heard text,
  marketing_consent boolean not null default false,
  marketing_consent_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  imported_from text check (imported_from in ('squarespace'))
);

-- Case-insensitive uniqueness: Layla@Email.com and layla@email.com are the same person.
create unique index people_email_lower_key on people (lower(email));

create table health_profiles (
  person_id uuid primary key references people (id) on delete cascade,
  conditions text,
  injuries text,
  pregnancy boolean not null default false,
  allergies text,
  dietary text,
  consent_at timestamptz,
  updated_at timestamptz not null default now()
);

create table waivers (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people (id) on delete cascade,
  version text not null,
  accepted_at timestamptz not null default now()
);

create table experiences (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  type text not null check (type in ('event', 'retreat')),
  title text not null,
  start_at timestamptz,
  end_at timestamptz,
  venue text,
  pillars text[] not null default '{}',
  status text not null default 'draft'
    check (status in ('draft', 'on_sale', 'interest', 'sold_out', 'past')),
  base_currency text not null default 'AED' check (base_currency in ('AED', 'EUR')),
  policy_template text,
  deposit_pct int check (deposit_pct between 1 and 100),
  balance_due_days int not null default 10,
  timezone text not null default 'Asia/Dubai',
  total_price_minor int
);

create table ticket_types (
  id uuid primary key default gen_random_uuid(),
  experience_id uuid not null references experiences (id) on delete cascade,
  name text not null,
  price_minor int not null check (price_minor >= 0),
  capacity int not null check (capacity >= 0)
);
create index ticket_types_experience_idx on ticket_types (experience_id);

create table holds (
  id uuid primary key default gen_random_uuid(),
  ticket_type_id uuid not null references ticket_types (id) on delete cascade,
  qty int not null check (qty > 0),
  checkout_session_id text,
  expires_at timestamptz not null,
  released_at timestamptz, -- null = active
  created_at timestamptz not null default now()
);
create index holds_ticket_type_idx on holds (ticket_type_id);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  booker_person_id uuid not null references people (id),
  experience_id uuid not null references experiences (id),
  status text not null
    check (status in ('paid', 'deposit_paid', 'refunded', 'cancelled', 'credited')),
  amount_paid_minor int,
  presentment_currency text,
  amount_aed_minor int,
  amount_paid_base_minor int,
  base_currency text,
  stripe_payment_intent text,
  policy_snapshot jsonb,
  cancelled_by text check (cancelled_by in ('guest', 'efzin')),
  imported boolean not null default false,
  created_at timestamptz not null default now()
);
create index bookings_booker_idx on bookings (booker_person_id);
create index bookings_experience_idx on bookings (experience_id);

create table booking_guests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  person_id uuid not null references people (id),
  ticket_type_id uuid not null references ticket_types (id),
  is_booker boolean not null default false,
  details_complete boolean not null default false,
  checked_in_at timestamptz,
  transfer_token uuid
);
create index booking_guests_booking_idx on booking_guests (booking_id);
create index booking_guests_person_idx on booking_guests (person_id);
create index booking_guests_ticket_idx on booking_guests (ticket_type_id);

create table credits (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people (id),
  code text unique,
  amount_aed_minor int not null check (amount_aed_minor > 0),
  source_booking_id uuid references bookings (id),
  expires_at timestamptz not null,
  redeemed_booking_id uuid references bookings (id),
  created_at timestamptz not null default now()
);
create index credits_person_idx on credits (person_id);

create table waitlist (
  id uuid primary key default gen_random_uuid(),
  ticket_type_id uuid not null references ticket_types (id) on delete cascade,
  person_id uuid references people (id),
  email text,
  position int not null,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  check (person_id is not null or email is not null)
);
create index waitlist_ticket_idx on waitlist (ticket_type_id, position);

create table requests (
  id uuid primary key default gen_random_uuid(),
  type text not null
    check (type in ('private', 'corporate', 'coaching', 'retreat_interest', 'deletion')),
  payload jsonb not null default '{}'::jsonb,
  person_id uuid references people (id),
  status text not null default 'new',
  created_at timestamptz not null default now()
);

create table stripe_events (
  id text primary key,
  processed_at timestamptz not null default now()
);
