-- Ejecuta después de 001_initial.sql para guardar el trazado GPS.
begin;
create table if not exists public.route_points (
  id bigint generated always as identity primary key,
  trip_id bigint not null,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  lat double precision not null check(lat between -90 and 90),
  lng double precision not null check(lng between -180 and 180),
  accuracy double precision not null check(accuracy between 0 and 60),
  recorded_at timestamptz not null,
  created timestamptz not null default now(),
  unique(trip_id,recorded_at),
  foreign key(trip_id,user_id) references public.trips(id,user_id) on delete cascade
);
create index if not exists route_points_user_idx on public.route_points(user_id);

create or replace function private.validate_route_point() returns trigger
language plpgsql set search_path='' as $$
begin
  perform 1 from public.trips where id=new.trip_id and user_id=new.user_id and ended is null for update;
  if not found then raise exception 'El viaje no está activo o no pertenece al conductor.'; end if;
  return new;
end;
$$;
revoke all on function private.validate_route_point() from public,anon,authenticated;
drop trigger if exists validate_route_position on public.route_points;
create trigger validate_route_position before insert on public.route_points
for each row execute function private.validate_route_point();

alter table public.route_points enable row level security;
revoke all on public.route_points from anon,authenticated;
grant select on public.route_points to authenticated;
grant insert(trip_id,user_id,lat,lng,accuracy,recorded_at) on public.route_points to authenticated;
grant usage on sequence public.route_points_id_seq to authenticated;
grant all on public.route_points to service_role;
grant usage,select on sequence public.route_points_id_seq to service_role;
drop policy if exists route_points_read on public.route_points;
create policy route_points_read on public.route_points for select to authenticated
using(user_id=(select auth.uid()) or (select private.is_admin()));
drop policy if exists route_points_create on public.route_points;
create policy route_points_create on public.route_points for insert to authenticated
with check(user_id=(select auth.uid()) and exists(select 1 from public.trips t where t.id=trip_id and t.user_id=(select auth.uid()) and t.ended is null));
notify pgrst,'reload schema';
commit;
