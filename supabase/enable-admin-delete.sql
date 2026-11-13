-- Ejecutar completo en Supabase > SQL Editor. Habilita ambas eliminaciones.
-- Solo el administrador puede eliminar vehiculos sin viajes.
begin;
alter table public.trips drop constraint if exists trips_vehicle_id_user_id_fkey;
alter table public.trips add constraint trips_vehicle_id_user_id_fkey
  foreign key(vehicle_id,user_id) references public.vehicles(id,user_id) on delete restrict;
grant delete on public.vehicles to authenticated;
drop policy if exists vehicles_delete on public.vehicles;
create policy vehicles_delete on public.vehicles for delete to authenticated
using ((select private.is_admin()));


-- Eliminar rutas y sus posiciones/alertas en cascada, solo administradores.

grant delete on public.trips to authenticated;
drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips for delete to authenticated
using ((select private.is_admin()));
notify pgrst,'reload schema';
commit;
