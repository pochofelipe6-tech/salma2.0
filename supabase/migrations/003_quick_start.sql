-- Permite iniciar una ruta sin registrar un vehículo.
begin;
alter table public.trips alter column vehicle_id drop not null;
drop policy if exists trips_create on public.trips;
create policy trips_create on public.trips for insert to authenticated
with check(user_id=(select auth.uid()) and (
  vehicle_id is null or exists(select 1 from public.vehicles v where v.id=vehicle_id and v.user_id=(select auth.uid()))
));
notify pgrst,'reload schema';
commit;
