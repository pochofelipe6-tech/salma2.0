-- Requiere las migraciones 006, 007 y 008. Registrar propuestas no activa alertas nuevas.
begin;
alter table public.trips add column if not exists collect_zones boolean not null default false;
grant insert(collect_zones),update(collect_zones) on public.trips to authenticated;
drop policy if exists trips_collect on public.trips;
create policy trips_collect on public.trips for update to authenticated
using(user_id=(select auth.uid()) and ended is null)
with check(user_id=(select auth.uid()) and ended is null);

create table if not exists public.survey_zones (
  id bigint generated always as identity primary key,
  trip_id bigint references public.trips(id) on delete set null,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  candidate_key text not null check(length(candidate_key) between 1 and 150),
  name text not null check(length(name) between 1 and 200),
  zone text not null check(zone in ('urbana','nacional','curvas','escolar')),
  reason text not null check(length(reason)<=500),
  confidence text not null check(confidence in ('media','baja')),
  source text not null check(length(source)<=100),
  geometry jsonb not null check(jsonb_typeof(geometry)='array' and jsonb_array_length(geometry) between 2 and 10),
  lat double precision not null check(lat between -90 and 90),
  lng double precision not null check(lng between -180 and 180),
  radius integer not null default 20 check(radius between 5 and 40),
  status text not null default 'pending' check(status in ('pending','confirmed','rejected')),
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created timestamptz not null default now(),
  observed_at timestamptz not null default now(),
  unique(trip_id,candidate_key),
  check(status='pending' or (reviewed_by is not null and reviewed_at is not null))
);
create index if not exists survey_zones_status_idx on public.survey_zones(status);
alter table public.survey_zones enable row level security;
revoke all on public.survey_zones from anon,authenticated;
grant select on public.survey_zones to authenticated;
grant insert(trip_id,user_id,candidate_key,name,zone,reason,confidence,source,geometry,lat,lng,observed_at) on public.survey_zones to authenticated;
grant update(zone,radius,status,reviewed_by,reviewed_at) on public.survey_zones to authenticated;
grant usage on sequence public.survey_zones_id_seq to authenticated;
grant all on public.survey_zones to service_role;
grant usage,select on sequence public.survey_zones_id_seq to service_role;
drop policy if exists survey_read on public.survey_zones;
create policy survey_read on public.survey_zones for select to authenticated
using(user_id=(select auth.uid()) or status='confirmed' or (select private.is_admin()));
drop policy if exists survey_insert on public.survey_zones;
create policy survey_insert on public.survey_zones for insert to authenticated
with check(user_id=(select auth.uid()) and status='pending' and exists(
  select 1 from public.trips t where t.id=trip_id and t.user_id=(select auth.uid()) and t.ended is null and t.collect_zones
));
drop policy if exists survey_review on public.survey_zones;
create policy survey_review on public.survey_zones for update to authenticated
using((select private.is_admin())) with check((select private.is_admin()) and reviewed_by=(select auth.uid()));

-- Evitar insertar propuestas mientras el conductor finaliza el viaje.
create or replace function private.validate_survey_zone() returns trigger language plpgsql set search_path='' as $$
begin
  perform 1 from public.trips where id=new.trip_id and user_id=new.user_id and ended is null and collect_zones for update;
  if not found then raise exception 'La ruta no tiene registro de zonas activo.'; end if;
  return new;
end; $$;
revoke all on function private.validate_survey_zone() from public,anon,authenticated;
drop trigger if exists validate_survey_zone on public.survey_zones;
create trigger validate_survey_zone before insert on public.survey_zones for each row execute function private.validate_survey_zone();

create or replace function public.match_survey_zone(p_lat double precision,p_lng double precision,p_previous_lat double precision,p_previous_lng double precision)
returns table(id bigint,name text,zone text,limit_speed integer)
language sql stable security invoker set search_path='' as $$
 select z.id,z.name,z.zone,case z.zone when 'urbana' then 50 when 'nacional' then 70 when 'curvas' then 35 when 'escolar' then 30 end
 from public.survey_zones z where z.status='confirmed'
 and abs(z.lat-p_lat)<0.003 and abs(z.lng-p_lng)<0.003
 and private.distance_to_road(p_lat,p_lng,z.geometry)<=z.radius
 and private.distance_to_road(p_previous_lat,p_previous_lng,z.geometry)<=z.radius
 order by case z.zone when 'escolar' then 30 when 'curvas' then 35 when 'urbana' then 50 else 70 end,z.id limit 1;
$$;
revoke all on function public.match_survey_zone(double precision,double precision,double precision,double precision) from public,anon;
grant execute on function public.match_survey_zone(double precision,double precision,double precision,double precision) to authenticated;

alter table public.events add column if not exists survey_zone_id bigint references public.survey_zones(id) on delete set null;
alter table public.events drop constraint if exists events_limit_speed_check;
alter table public.events add constraint events_limit_speed_check check (
  limit_speed between 1 and 200 and (road_id is not null or survey_zone_id is not null or
  limit_speed=case zone when 'urbana' then 50 when 'nacional' then 70 when 'curvas' then 35 when 'escolar' then 30 end)
);
grant insert(survey_zone_id) on public.events to authenticated;
create or replace function private.validate_event() returns trigger language plpgsql set search_path='' as $$
declare road public.road_limits%rowtype; proposed public.survey_zones%rowtype;
begin
 perform 1 from public.trips where id=new.trip_id and user_id=new.user_id and ended is null for update;
 if not found then raise exception 'El viaje no está activo o no pertenece al conductor.'; end if;
 if new.survey_zone_id is not null then
   select * into proposed from public.survey_zones where id=new.survey_zone_id and status='confirmed';
   if not found or private.distance_to_road(new.lat,new.lng,proposed.geometry)>proposed.radius then raise exception 'Zona no confirmada o fuera de ubicación.'; end if;
   new.road_id:=null;new.zone:=proposed.zone;new.sector:=left(proposed.name,150);
   new.limit_speed:=case proposed.zone when 'urbana' then 50 when 'nacional' then 70 when 'curvas' then 35 when 'escolar' then 30 end;
 elsif new.road_id is not null then
   select * into road from public.road_limits where id=new.road_id;
   if not found or private.distance_to_road(new.lat,new.lng,road.geometry)>35 then raise exception 'El tramo no corresponde a la posición GPS.'; end if;
   new.limit_speed:=road.limit_speed;new.zone:=road.zone;new.sector:=left(road.name,150);
 else
   new.limit_speed:=case new.zone when 'urbana' then 50 when 'nacional' then 70 when 'curvas' then 35 when 'escolar' then 30 end;
 end if;
 return new;
end; $$;
revoke all on function private.validate_event() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
