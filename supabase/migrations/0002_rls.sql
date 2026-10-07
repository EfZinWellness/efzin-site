-- Row level security. Every table has RLS on; all writes other than the member
-- self-service updates below go through the service role (which bypasses RLS).

alter table people enable row level security;
alter table health_profiles enable row level security;
alter table waivers enable row level security;
alter table experiences enable row level security;
alter table ticket_types enable row level security;
alter table holds enable row level security;
alter table bookings enable row level security;
alter table booking_guests enable row level security;
alter table credits enable row level security;
alter table waitlist enable row level security;
alter table requests enable row level security;
alter table stripe_events enable row level security;

-- Helpers are security definer so policies on bookings and booking_guests do not
-- recurse into each other.
create function current_person_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from people where auth_user_id = auth.uid() limit 1
$$;

create function is_booking_participant(p_booking uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bookings b
    where b.id = p_booking and b.booker_person_id = current_person_id()
  ) or exists (
    select 1 from booking_guests g
    where g.booking_id = p_booking and g.person_id = current_person_id()
  )
$$;

create function is_booker_of(p_booking uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bookings b
    where b.id = p_booking and b.booker_person_id = current_person_id()
  )
$$;

-- Privileges: start from nothing, then grant only what members and the public need.
revoke all on all tables in schema public from anon, authenticated;
revoke execute on function current_person_id(), is_booking_participant(uuid), is_booker_of(uuid) from public, anon;
grant execute on function current_person_id(), is_booking_participant(uuid), is_booker_of(uuid)
  to authenticated, service_role;

grant select on experiences, ticket_types to anon, authenticated;
grant select on health_profiles, waivers, bookings, booking_guests, credits to authenticated;
-- Admin notes are never readable by members, so select is column-level (no `notes`).
-- Members must list columns explicitly; `select *` on people is denied for them.
grant select (id, auth_user_id, name, email, phone, birthday, how_heard,
              marketing_consent, marketing_consent_at, created_at, imported_from)
  on people to authenticated;
grant update (name, phone, birthday, how_heard, marketing_consent, marketing_consent_at)
  on people to authenticated;
grant update (conditions, injuries, pregnancy, allergies, dietary, consent_at, updated_at)
  on health_profiles to authenticated;

-- Public catalogue
create policy experiences_public_read on experiences
  for select to anon, authenticated using (status <> 'draft');

create policy ticket_types_public_read on ticket_types
  for select to anon, authenticated
  using (exists (select 1 from experiences e where e.id = experience_id and e.status <> 'draft'));

-- Members: own rows
create policy people_self_read on people
  for select to authenticated using (auth_user_id = auth.uid());
create policy people_self_update on people
  for update to authenticated
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

create policy health_profiles_self_read on health_profiles
  for select to authenticated using (person_id = current_person_id());
create policy health_profiles_self_update on health_profiles
  for update to authenticated
  using (person_id = current_person_id()) with check (person_id = current_person_id());

create policy waivers_self_read on waivers
  for select to authenticated using (person_id = current_person_id());

create policy bookings_participant_read on bookings
  for select to authenticated using (is_booking_participant(id));

create policy booking_guests_read on booking_guests
  for select to authenticated
  using (person_id = current_person_id() or is_booker_of(booking_id));

create policy credits_self_read on credits
  for select to authenticated using (person_id = current_person_id());

-- holds, waitlist, requests, stripe_events: RLS on, no policies, service role only.
