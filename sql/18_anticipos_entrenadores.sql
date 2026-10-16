-- ════════════════════════════════════════════════════════════════════════
-- 18 · ANTICIPOS A LOS ENTRENADORES (se restan de la liquidación de comisiones)
-- ════════════════════════════════════════════════════════════════════════
-- Dinero que se le adelanta a un entrenador (p. ej. 200 € en efectivo). Cada anticipo tiene un mes de descuento
-- ('AAAA-MM', por defecto el de su fecha) y se resta de la comisión de ese mes en la pestaña Comisiones.
--   · Solo el administrador los crea, cambia y borra.
--   · Cada entrenador puede VER solo los suyos (para cuadrar con su pantalla de comisiones).
-- Ejecutar en Supabase → SQL Editor. Se puede repetir sin problema.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.comisiones_anticipos (
  id            uuid primary key default gen_random_uuid(),
  entrenador_id uuid not null references public.perfiles(id) on delete cascade,
  fecha         date not null default current_date,                         -- cuándo se le dio el dinero
  mes           text not null check (mes ~ '^\d{4}-\d{2}$'),                -- 'AAAA-MM' de la liquidación en la que se descuenta
  importe       numeric(9,2) not null check (importe > 0),
  concepto      text not null default '',
  created_at    timestamptz not null default now()
);
create index if not exists comisiones_anticipos_mes_idx on public.comisiones_anticipos(mes);

alter table public.comisiones_anticipos enable row level security;

drop policy if exists comisiones_anticipos_admin on public.comisiones_anticipos;
create policy comisiones_anticipos_admin on public.comisiones_anticipos for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists comisiones_anticipos_leer on public.comisiones_anticipos;
create policy comisiones_anticipos_leer on public.comisiones_anticipos for select to authenticated
  using (entrenador_id = auth.uid());

revoke all on public.comisiones_anticipos from anon;
grant select, insert, update, delete on public.comisiones_anticipos to authenticated;
grant all on public.comisiones_anticipos to service_role;

notify pgrst, 'reload schema';

-- Comprobación: la tabla existe (1), con seguridad activada (true) y 2 políticas.
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'comisiones_anticipos') as tabla,
  (select relrowsecurity from pg_class where oid = 'public.comisiones_anticipos'::regclass) as seguridad_activada,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'comisiones_anticipos') as politicas;
