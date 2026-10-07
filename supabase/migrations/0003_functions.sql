-- Availability, spot holds and the rewards booking count.

-- capacity - guests on paid/deposit_paid bookings - qty in unreleased holds
create function available_spots(p_ticket_type uuid) returns int
language sql stable security definer set search_path = public as $$
  select t.capacity
    - coalesce((
        select count(*) from booking_guests g
        join bookings b on b.id = g.booking_id
        where g.ticket_type_id = t.id and b.status in ('paid', 'deposit_paid')
      ), 0)::int
    - coalesce((
        select sum(h.qty) from holds h
        where h.ticket_type_id = t.id and h.released_at is null
      ), 0)::int
  from ticket_types t
  where t.id = p_ticket_type
$$;

-- Locks the ticket_type row so concurrent callers are serialised, then checks availability.
create function create_hold(p_ticket_type uuid, p_qty int, p_expires_at timestamptz)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform 1 from ticket_types where id = p_ticket_type for update;
  if not found then
    raise exception 'TICKET_TYPE_NOT_FOUND';
  end if;
  if p_qty is null or p_qty < 1 then
    raise exception 'INVALID_QTY';
  end if;
  if available_spots(p_ticket_type) < p_qty then
    raise exception 'SOLD_OUT';
  end if;
  insert into holds (ticket_type_id, qty, expires_at)
  values (p_ticket_type, p_qty, p_expires_at)
  returning id into v_id;
  return v_id;
end
$$;

-- Own bookings only (is_booker rows) that are checked in, or belong to an imported booking.
-- Tickets bought for friends never count for the booker.
create function own_booking_count(p_person uuid) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int
  from booking_guests g
  join bookings b on b.id = g.booking_id
  where g.person_id = p_person
    and g.is_booker
    and (g.checked_in_at is not null or b.imported)
$$;

-- Only the server (service role) may hold spots or read counts; availability is public.
revoke execute on function create_hold(uuid, int, timestamptz) from public, anon, authenticated;
revoke execute on function own_booking_count(uuid) from public, anon, authenticated;
grant execute on function create_hold(uuid, int, timestamptz) to service_role;
grant execute on function own_booking_count(uuid) to service_role;
grant execute on function available_spots(uuid) to anon, authenticated, service_role;
