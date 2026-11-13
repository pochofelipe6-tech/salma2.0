-- Ejecutar antes de 007_atlantico_road_catalog.sql. Conserva eventos antiguos.
begin;
create table if not exists public.road_limits (
  id text primary key,
  name text not null,
  zone text not null check(zone in ('urbana','nacional','curvas','escolar')),
  limit_speed integer not null check(limit_speed between 1 and 200),
  geometry jsonb not null check(jsonb_typeof(geometry)='array')
);
alter table public.road_limits enable row level security;
revoke all on public.road_limits from anon,authenticated;
grant select on public.road_limits to authenticated;
drop policy if exists road_limits_read on public.road_limits;
create policy road_limits_read on public.road_limits for select to authenticated using(true);
alter table public.events add column if not exists road_id text references public.road_limits(id);
alter table public.events drop constraint if exists events_limit_speed_check;
-- PostgreSQL puede nombrar el CHECK original events_check1 por referir a zone.
do $$ declare item record; begin
  for item in select conname from pg_constraint
    where conrelid='public.events'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%CASE%'
      and pg_get_constraintdef(oid) like '%limit_speed%'
  loop execute format('alter table public.events drop constraint %I',item.conname); end loop;
end $$;
alter table public.events add constraint events_limit_speed_check check (
  limit_speed between 1 and 200 and (road_id is not null or
  limit_speed=case zone when 'urbana' then 50 when 'nacional' then 70 when 'curvas' then 35 when 'escolar' then 30 end)
);
grant insert(road_id) on public.events to authenticated;

create or replace function private.distance_to_road(p_lat double precision,p_lng double precision,shape jsonb)
returns double precision language plpgsql immutable set search_path='' as $$
declare i integer; ax double precision; ay double precision; bx double precision; by_ double precision;
  dx double precision; dy double precision; fraction double precision; best double precision:=1e20;
begin
  for i in 1..jsonb_array_length(shape)-1 loop
    ax:=((shape->(i-1)->>0)::double precision-p_lng)*111195*cos(radians(p_lat));
    ay:=((shape->(i-1)->>1)::double precision-p_lat)*111195;
    bx:=((shape->i->>0)::double precision-p_lng)*111195*cos(radians(p_lat));
    by_:=((shape->i->>1)::double precision-p_lat)*111195;
    dx:=bx-ax;dy:=by_-ay;
    fraction:=greatest(0,least(1,-(ax*dx+ay*dy)/coalesce(nullif(dx*dx+dy*dy,0),1)));
    best:=least(best,sqrt(power(ax+fraction*dx,2)+power(ay+fraction*dy,2)));
  end loop;
  return best;
end; $$;
revoke all on function private.distance_to_road(double precision,double precision,jsonb) from public,anon;
grant execute on function private.distance_to_road(double precision,double precision,jsonb) to authenticated;

create or replace function private.validate_event() returns trigger
language plpgsql set search_path='' as $$
declare road public.road_limits%rowtype;
begin
  perform 1 from public.trips where id=new.trip_id and user_id=new.user_id and ended is null for update;
  if not found then raise exception 'El viaje no está activo o no pertenece al conductor.'; end if;
  if new.road_id is not null then
    select * into road from public.road_limits where id=new.road_id;
    if not found or private.distance_to_road(new.lat,new.lng,road.geometry)>35 then
      raise exception 'El tramo no corresponde a la posición GPS.';
    end if;
    new.limit_speed:=road.limit_speed;new.zone:=road.zone;new.sector:=left(road.name,150);
  else
    new.limit_speed:=case new.zone when 'urbana' then 50 when 'nacional' then 70 when 'curvas' then 35 when 'escolar' then 30 end;
  end if;
  return new;
end; $$;
revoke all on function private.validate_event() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
