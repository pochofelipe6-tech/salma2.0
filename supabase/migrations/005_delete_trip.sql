-- Eliminar rutas y sus posiciones/alertas en cascada, solo administradores.
begin;
grant delete on public.trips to authenticated;
drop policy if exists trips_delete on public.trips;
create policy trips_delete on public.trips for delete to authenticated
using ((select private.is_admin()));
notify pgrst,'reload schema';
commit;
