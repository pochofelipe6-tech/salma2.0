-- Ejecutar completo en Supabase > SQL Editor. No requiere claves en el código.
begin;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 100),
  role text not null default 'driver' check (role in ('driver','admin')),
  created timestamptz not null default now()
);
create table if not exists public.vehicles (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  plate text not null unique check (plate ~ '^[A-Z0-9-]{5,10}$'),
  model text not null check (length(btrim(model)) between 1 and 100),
  created timestamptz not null default now(),
  unique(id,user_id)
);
create table if not exists public.trips (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  vehicle_id bigint not null,
  zone text not null check (zone in ('urbana','nacional','curvas','escolar')),
  sector text not null check (length(btrim(sector)) between 1 and 150),
  started timestamptz not null default now(),
  ended timestamptz check (ended >= started),
  foreign key(vehicle_id,user_id) references public.vehicles(id,user_id) on delete cascade,
  unique(id,user_id)
);
create unique index if not exists one_active_trip_per_driver on public.trips(user_id) where ended is null;
create index if not exists vehicles_user_idx on public.vehicles(user_id);
create index if not exists trips_user_idx on public.trips(user_id);
create table if not exists public.events (
  id bigint generated always as identity primary key,
  trip_id bigint not null,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  zone text not null check (zone in ('urbana','nacional','curvas','escolar')),
  sector text not null check (length(btrim(sector)) between 1 and 150),
  speed double precision not null check (speed > limit_speed and speed <= 300),
  limit_speed integer not null check (
    limit_speed=case zone when 'urbana' then 50 when 'nacional' then 70 when 'curvas' then 35 when 'escolar' then 30 end
  ),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  created timestamptz not null default now(),
  foreign key(trip_id,user_id) references public.trips(id,user_id) on delete cascade
);
create index if not exists events_user_idx on public.events(user_id);
create index if not exists events_trip_idx on public.events(trip_id);

-- El rol nunca se obtiene de los metadatos editables del usuario.
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,name,role)
  values(new.id,left(coalesce(nullif(btrim(new.raw_user_meta_data->>'name'),''),'Conductor'),100),'driver');
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public,anon,authenticated;
drop trigger if exists route_auth_user_created on auth.users;
create trigger route_auth_user_created after insert on auth.users
for each row execute function private.handle_new_user();
insert into public.profiles(id,name,role)
select id,left(coalesce(nullif(btrim(raw_user_meta_data->>'name'),''),'Conductor'),100),'driver'
from auth.users on conflict(id) do nothing;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin');
$$;
revoke all on function private.is_admin() from public,anon;
grant execute on function private.is_admin() to authenticated;

-- Bloquea viajes cerrados y serializa el cierre con la escritura de alertas.
create or replace function private.validate_event() returns trigger
language plpgsql set search_path='' as $$
begin
  perform 1 from public.trips where id=new.trip_id and user_id=new.user_id and ended is null for update;
  if not found then raise exception 'El viaje no está activo o no pertenece al conductor.'; end if;
  new.limit_speed:=case new.zone when 'urbana' then 50 when 'nacional' then 70 when 'curvas' then 35 when 'escolar' then 30 end;
  return new;
end;
$$;
revoke all on function private.validate_event() from public,anon,authenticated;
drop trigger if exists validate_route_event on public.events;
create trigger validate_route_event before insert on public.events
for each row execute function private.validate_event();

alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.trips enable row level security;
alter table public.events enable row level security;

-- Permisos mínimos: ni siquiera una llamada REST directa permite cambiar roles,
-- propietarios, horas de inicio o límites preventivos.
revoke all on public.profiles,public.vehicles,public.trips,public.events from anon,authenticated;
grant select on public.profiles,public.vehicles,public.trips,public.events to authenticated;
grant insert(user_id,plate,model) on public.vehicles to authenticated;
grant insert(user_id,vehicle_id,zone,sector) on public.trips to authenticated;
grant update(ended) on public.trips to authenticated;
grant insert(trip_id,user_id,zone,sector,speed,lat,lng) on public.events to authenticated;
grant usage on sequence public.vehicles_id_seq,public.trips_id_seq,public.events_id_seq to authenticated;
grant all on public.profiles,public.vehicles,public.trips,public.events to service_role;
grant usage,select on sequence public.vehicles_id_seq,public.trips_id_seq,public.events_id_seq to service_role;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
using(id=(select auth.uid()) or (select private.is_admin()));
drop policy if exists vehicles_read on public.vehicles;
create policy vehicles_read on public.vehicles for select to authenticated
using(user_id=(select auth.uid()) or (select private.is_admin()));
drop policy if exists vehicles_create on public.vehicles;
create policy vehicles_create on public.vehicles for insert to authenticated
with check(user_id=(select auth.uid()));
drop policy if exists trips_read on public.trips;
create policy trips_read on public.trips for select to authenticated
using(user_id=(select auth.uid()) or (select private.is_admin()));
drop policy if exists trips_create on public.trips;
create policy trips_create on public.trips for insert to authenticated
with check(user_id=(select auth.uid()) and exists(select 1 from public.vehicles v where v.id=vehicle_id and v.user_id=(select auth.uid())));
drop policy if exists trips_finish on public.trips;
create policy trips_finish on public.trips for update to authenticated
using(user_id=(select auth.uid()) and ended is null)
with check(user_id=(select auth.uid()) and ended is not null);
drop policy if exists events_read on public.events;
create policy events_read on public.events for select to authenticated
using(user_id=(select auth.uid()) or (select private.is_admin()));
drop policy if exists events_create on public.events;
create policy events_create on public.events for insert to authenticated
with check(user_id=(select auth.uid()) and exists(select 1 from public.trips t where t.id=trip_id and t.user_id=(select auth.uid()) and t.ended is null));

notify pgrst,'reload schema';
commit;
