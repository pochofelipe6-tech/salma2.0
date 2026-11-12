-- Reemplaza el correo y ejecuta en SQL Editor DESPUÉS de registrar la cuenta.
update public.profiles
set role='admin'
where id=(select id from auth.users where lower(email)=lower('correo@empresa.com'))
returning id,name,role;
