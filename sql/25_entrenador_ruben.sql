-- ════════════════════════════════════════════════════════════════════════
-- 25 · NUEVO ENTRENADOR: RUBÉN (solo Calendario y Clientes)
-- ════════════════════════════════════════════════════════════════════════
-- ANTES, en Supabase → Authentication → Users → Add user → Create new user
-- (marca "Auto Confirm User") crea este usuario con la contraseña que elijas:
--     ruben@codek-ep.app
-- En la app se entra con el usuario a secas: ruben (con o sin tilde).
-- Después ejecuta este script (se puede repetir sin problema).
--
-- Qué ve Rubén: Calendario y Clientes, solo lo suyo. NO tiene Comisiones (aplica_comisiones = false, igual que Jesús)
-- ni Resumen ni AimHarder (esas son del administrador). Para darle Comisiones más adelante:
--     update public.perfiles set aplica_comisiones = true where usuario = 'ruben';
-- ════════════════════════════════════════════════════════════════════════

insert into public.perfiles (id, usuario, nombre, rol, color, aplica_comisiones)
select id, 'ruben', 'Rubén', 'entrenador', '#9b6fd1', false from auth.users where email = 'ruben@codek-ep.app'
on conflict (id) do update set usuario = excluded.usuario, nombre = excluded.nombre, rol = excluded.rol, color = excluded.color,
                               aplica_comisiones = excluded.aplica_comisiones;

-- Comprobación: debe salir Rubén como entrenador con aplica_comisiones = false (y los demás como estaban).
select usuario, nombre, rol, aplica_comisiones from public.perfiles order by rol, usuario;
