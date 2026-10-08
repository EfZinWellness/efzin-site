-- Rev 2: gift cards, payment schedules, pending checkouts. Money is integer minor units.
-- All writes go through the service role; members only read their own gift cards and schedules.

-- ---------------------------------------------------------------------------
-- Columns on existing tables
-- ---------------------------------------------------------------------------

alter table experiences
  add column payment_options text[] not null default '{full}'
    check (payment_options <@ array['full', 'deposit_balance', 'instalments']::text[]),
  add column max_instalments int not null default 4 check (max_instalments >= 1);

alter table people add column stripe_customer_id text unique;

-- ---------------------------------------------------------------------------
-- Gift cards
-- ---------------------------------------------------------------------------

create table gift_card_batches (
  id uuid primary key default gen_random_uuid(),
  buyer_person_id uuid not null references people (id),
  quantity int not null check (quantity > 0),
  created_at timestamptz not null default now()
);

create table gift_cards (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  initial_aed_minor int not null check (initial_aed_minor > 0),
  -- Always equals the sum of gift_card_ledger; only the functions below change it.
  balance_aed_minor int not null default 0 check (balance_aed_minor >= 0),
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'active', 'void', 'expired')),
  buyer_person_id uuid not null references people (id),
  recipient_name text,
  recipient_email text,
  recipient_person_id uuid references people (id),
  message text check (message is null or char_length(message) <= 300),
  suggested_experience_id uuid references experiences (id),
  deliver_on date,
  delivered_at timestamptz,
  expires_at timestamptz,
  amount_paid_minor int,
  presentment_currency text,
  stripe_payment_intent text,
  purchase_batch_id uuid references gift_card_batches (id),
  created_at timestamptz not null default now()
);
create index gift_cards_buyer_idx on gift_cards (buyer_person_id);
create index gift_cards_recipient_idx on gift_cards (recipient_person_id);
create index gift_cards_payment_idx on gift_cards (stripe_payment_intent);

create table gift_card_ledger (
  id uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references gift_cards (id),
  booking_id uuid references bookings (id),
  amount_aed_minor int not null check (amount_aed_minor <> 0),
  reason text not null check (reason in ('issue', 'redeem', 'refund_return', 'expiry', 'void')),
  created_at timestamptz not null default now()
);
create index gift_card_ledger_card_idx on gift_card_ledger (gift_card_id);

-- ---------------------------------------------------------------------------
-- Pending checkouts, reservations, payment schedules
-- ---------------------------------------------------------------------------

create table pending_bookings (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  hold_ids uuid[] not null default '{}',
  reservation_ids uuid[] not null default '{}',
  checkout_session_id text unique,
  created_at timestamptz not null default now()
);

create table gift_card_reservations (
  id uuid primary key default gen_random_uuid(),
  gift_card_id uuid not null references gift_cards (id),
  pending_booking_id uuid not null references pending_bookings (id) on delete cascade,
  amount_aed_minor int not null check (amount_aed_minor > 0),
  expires_at timestamptz not null,
  released_at timestamptz, -- null = active (until expires_at)
  created_at timestamptz not null default now()
);
create index gift_card_reservations_card_idx on gift_card_reservations (gift_card_id);
create index gift_card_reservations_pending_idx on gift_card_reservations (pending_booking_id);

alter table bookings
  add column payment_option text check (payment_option in ('full', 'deposit_balance', 'instalments')),
  add column total_price_minor int,
  add column gift_card_id uuid references gift_cards (id),
  add column gift_card_applied_aed_minor int not null default 0 check (gift_card_applied_aed_minor >= 0),
  add column credit_applied_aed_minor int not null default 0 check (credit_applied_aed_minor >= 0),
  add column schedule_consent_at timestamptz;

create table payment_schedule_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  seq int not null check (seq >= 0), -- 0 = deposit
  due_on date not null,
  amount_minor int not null check (amount_minor >= 0),
  currency text not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'paid', 'failed', 'cancelled')),
  stripe_invoice_id text,
  attempts int not null default 0,
  paid_at timestamptz,
  unique (booking_id, seq)
);
create index payment_schedule_due_idx on payment_schedule_items (status, due_on);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table gift_card_batches enable row level security;
alter table gift_cards enable row level security;
alter table gift_card_ledger enable row level security;
alter table pending_bookings enable row level security;
alter table gift_card_reservations enable row level security;
alter table payment_schedule_items enable row level security;

revoke all on gift_card_batches, gift_cards, gift_card_ledger, pending_bookings,
  gift_card_reservations, payment_schedule_items from anon, authenticated;
grant select on gift_cards, payment_schedule_items to authenticated;

create policy gift_cards_party_read on gift_cards
  for select to authenticated
  using (buyer_person_id = current_person_id() or recipient_person_id = current_person_id());

create policy payment_schedule_items_read on payment_schedule_items
  for select to authenticated using (is_booking_participant(booking_id));

-- ---------------------------------------------------------------------------
-- Functions (service role only)
-- ---------------------------------------------------------------------------

-- Ledger sum minus reservations that are unreleased and unexpired.
create function gift_card_available(p_card uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(l.amount_aed_minor) from gift_card_ledger l where l.gift_card_id = p_card), 0)::int
       - coalesce((
           select sum(r.amount_aed_minor) from gift_card_reservations r
           where r.gift_card_id = p_card and r.released_at is null and r.expires_at > now()
         ), 0)::int
$$;

-- Writes a ledger row and keeps balance_aed_minor equal to the ledger sum. Caller holds the card lock.
create function gift_card_ledger_add(p_card uuid, p_booking uuid, p_amount int, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into gift_card_ledger (gift_card_id, booking_id, amount_aed_minor, reason)
  values (p_card, p_booking, p_amount, p_reason);
  update gift_cards set balance_aed_minor = balance_aed_minor + p_amount where id = p_card;
end
$$;

-- Locks the card row so concurrent reservations are serialised, then checks the available balance.
create function reserve_gift_card(p_code text, p_amount int, p_pending uuid, p_expires_at timestamptz)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_card gift_cards%rowtype;
  v_id uuid;
begin
  if p_amount is null or p_amount < 1 then
    raise exception 'INVALID_AMOUNT';
  end if;
  select * into v_card from gift_cards where code = upper(p_code) for update;
  if not found or v_card.status not in ('active', 'expired') then
    raise exception 'GIFT_INVALID';
  end if;
  if v_card.status = 'expired' or (v_card.expires_at is not null and v_card.expires_at <= now()) then
    raise exception 'GIFT_EXPIRED';
  end if;
  if gift_card_available(v_card.id) < p_amount then
    raise exception 'GIFT_INSUFFICIENT';
  end if;
  insert into gift_card_reservations (gift_card_id, pending_booking_id, amount_aed_minor, expires_at)
  values (v_card.id, p_pending, p_amount, p_expires_at)
  returning id into v_id;
  return v_id;
end
$$;

-- Turns a reservation into a spend. Idempotency: a reservation can be redeemed once.
create function redeem_gift_reservation(p_reservation uuid, p_booking uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_res gift_card_reservations%rowtype;
  v_card gift_cards%rowtype;
begin
  select * into v_res from gift_card_reservations where id = p_reservation;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND';
  end if;
  select * into v_card from gift_cards where id = v_res.gift_card_id for update;
  -- re-read under the lock
  select * into v_res from gift_card_reservations where id = p_reservation for update;
  if v_res.released_at is not null then
    raise exception 'RESERVATION_RELEASED';
  end if;
  if v_card.status <> 'active' or v_card.balance_aed_minor < v_res.amount_aed_minor then
    raise exception 'GIFT_INSUFFICIENT';
  end if;
  update gift_card_reservations set released_at = now() where id = p_reservation;
  perform gift_card_ledger_add(v_card.id, p_booking, -v_res.amount_aed_minor, 'redeem');
  update gift_cards
     set recipient_person_id = coalesce(
       recipient_person_id, (select booker_person_id from bookings where id = p_booking))
   where id = v_card.id;
end
$$;

-- Value coming back (a refund of a booking paid partly with a card).
create function return_to_gift_card(p_card uuid, p_booking uuid, p_amount int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_amount is null or p_amount < 1 then
    raise exception 'INVALID_AMOUNT';
  end if;
  perform 1 from gift_cards where id = p_card for update;
  if not found then
    raise exception 'GIFT_INVALID';
  end if;
  perform gift_card_ledger_add(p_card, p_booking, p_amount, 'refund_return');
end
$$;

-- Marks the paid-for cards active and writes the issue ledger row. Cards that are no longer pending are left alone.
create function activate_gift_cards(p_payment_intent text, p_expires_at timestamptz)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_card record;
  v_n int := 0;
begin
  for v_card in
    select id, initial_aed_minor from gift_cards
    where stripe_payment_intent = p_payment_intent and status = 'pending_payment'
    for update
  loop
    update gift_cards set status = 'active', expires_at = p_expires_at where id = v_card.id;
    perform gift_card_ledger_add(v_card.id, null, v_card.initial_aed_minor, 'issue');
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

-- Refund of a purchase: void every card from the payment if none has been used.
create function void_gift_cards_if_unused(p_payment_intent text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_card record;
begin
  perform 1 from gift_cards where stripe_payment_intent = p_payment_intent for update;
  if not found then
    return 'voided';
  end if;
  if exists (
    select 1 from gift_cards c
    where c.stripe_payment_intent = p_payment_intent
      and (
        exists (select 1 from gift_card_ledger l where l.gift_card_id = c.id and l.reason in ('redeem', 'refund_return'))
        or exists (
          select 1 from gift_card_reservations r
          where r.gift_card_id = c.id and r.released_at is null and r.expires_at > now())
      )
  ) then
    return 'partly_used';
  end if;
  for v_card in
    select id, balance_aed_minor from gift_cards
    where stripe_payment_intent = p_payment_intent and status in ('pending_payment', 'active')
  loop
    if v_card.balance_aed_minor > 0 then
      perform gift_card_ledger_add(v_card.id, null, -v_card.balance_aed_minor, 'void');
    end if;
    update gift_cards set status = 'void' where id = v_card.id;
  end loop;
  return 'voided';
end
$$;

-- Zeroes active cards past their expiry; returns how many were expired.
create function expire_gift_cards(p_now timestamptz)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_card record;
  v_n int := 0;
begin
  for v_card in
    select id, balance_aed_minor from gift_cards
    where status = 'active' and expires_at is not null and expires_at <= p_now
    for update
  loop
    if v_card.balance_aed_minor > 0 then
      perform gift_card_ledger_add(v_card.id, null, -v_card.balance_aed_minor, 'expiry');
    end if;
    update gift_cards set status = 'expired' where id = v_card.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end
$$;

revoke execute on function
  gift_card_available(uuid),
  gift_card_ledger_add(uuid, uuid, int, text),
  reserve_gift_card(text, int, uuid, timestamptz),
  redeem_gift_reservation(uuid, uuid),
  return_to_gift_card(uuid, uuid, int),
  activate_gift_cards(text, timestamptz),
  void_gift_cards_if_unused(text),
  expire_gift_cards(timestamptz)
  from public, anon, authenticated;
grant execute on function
  gift_card_available(uuid),
  gift_card_ledger_add(uuid, uuid, int, text),
  reserve_gift_card(text, int, uuid, timestamptz),
  redeem_gift_reservation(uuid, uuid),
  return_to_gift_card(uuid, uuid, int),
  activate_gift_cards(text, timestamptz),
  void_gift_cards_if_unused(text),
  expire_gift_cards(timestamptz)
  to service_role;
