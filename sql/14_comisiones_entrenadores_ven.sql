-- ════════════════════════════════════════════════════════════════════════
-- 14 · LOS ENTRENADORES VEN SU PROPIA PESTAÑA DE COMISIONES + SEGURIDAD SOCIAL AL 32,5 %
-- ════════════════════════════════════════════════════════════════════════
-- 1) El % de Seguridad Social por defecto pasa de 35 a 32,5 (la fila que ya existe se actualiza solo si seguía en 35).
-- 2) Los entrenadores pueden LEER los porcentajes de comisión (comisiones_config) para que su pestaña de comisiones parta
--    de los mismos valores que el administrador. NO pueden cambiarlos: escribir sigue siendo solo del administrador.
--    Lo demás (overrides por bono y ajustes manuales: comisiones_bono y comisiones_manual) sigue siendo solo del
--    administrador. La pestaña de un entrenador solo calcula con SUS bonos (que ya puede ver) y es una simulación que
--    no se guarda en ninguna parte.
-- Ejecutar en Supabase → SQL Editor, tras 13.
-- ════════════════════════════════════════════════════════════════════════

alter table public.comisiones_config alter column ss_pct set default 32.5;
update public.comisiones_config set ss_pct = 32.5 where id = 1 and ss_pct = 35;

drop policy if exists comisiones_config_leer on public.comisiones_config;
create policy comisiones_config_leer on public.comisiones_config for select to authenticated using (true);

notify pgrst, 'reload schema';

-- Comprobación: Seguridad Social = 32.50 y las dos políticas de comisiones_config (una de lectura para todos, otra solo admin).
select (select ss_pct from public.comisiones_config where id = 1) as ss_pct,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'comisiones_config') as politicas;
