-- ════════════════════════════════════════════════════════════════════════
-- 02 · VINCULAR USUARIOS (admin, Eduardo, Jesús)
-- ════════════════════════════════════════════════════════════════════════
-- ANTES, en Supabase → Authentication → Users → Add user → Create new user
-- (marca "Auto Confirm User") crea estos tres con la contraseña que elijas:
--     admin@codek-ep.app      eduardo@codek-ep.app      jesus@codek-ep.app
-- En la app se entra con el usuario a secas: admin · eduardo · jesus.
-- Después ejecuta este script (se puede repetir sin problema).
-- ════════════════════════════════════════════════════════════════════════

insert into public.perfiles (id, usuario, nombre, rol, color)
select id, 'admin', 'Jon', 'admin', '#8B2020' from auth.users where email = 'admin@codek-ep.app'
on conflict (id) do update set usuario = excluded.usuario, nombre = excluded.nombre, rol = excluded.rol, color = excluded.color;

insert into public.perfiles (id, usuario, nombre, rol, color)
select id, 'eduardo', 'Eduardo', 'entrenador', '#4a9fd4' from auth.users where email = 'eduardo@codek-ep.app'
on conflict (id) do update set usuario = excluded.usuario, nombre = excluded.nombre, rol = excluded.rol, color = excluded.color;

insert into public.perfiles (id, usuario, nombre, rol, color)
select id, 'jesus', 'Jesús', 'entrenador', '#d4903a' from auth.users where email = 'jesus@codek-ep.app'
on conflict (id) do update set usuario = excluded.usuario, nombre = excluded.nombre, rol = excluded.rol, color = excluded.color;

-- Comprobación: deben salir 3 filas.
select usuario, nombre, rol from public.perfiles order by rol, usuario;
