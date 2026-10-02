-- ════════════════════════════════════════════════════════════════════════
-- 12 · AJUSTES MANUALES EN LA LIQUIDACIÓN DE COMISIONES
-- ════════════════════════════════════════════════════════════════════════
-- Cuando un bono se excluye de la liquidación, baja a «Ajustes manuales» y la comisión se calcula a mano:
--   nº de clases que ha dado el entrenador × precio por clase (+ % de comisión editable y los mismos
--   descuentos de IVA / Seguridad Social). Dos sitios donde se guarda:
--   · comisiones_bono: tres campos nuevos para el bono excluido (clases, precio por clase, % propio).
--   · comisiones_manual: líneas libres que no vienen de ningún bono (p. ej. clases sueltas), por mes y entrenador.
-- Ambas son SOLO del administrador (mismo candado que sql/08). Ejecutar en Supabase → SQL Editor, tras 11.
-- ════════════════════════════════════════════════════════════════════════

alter table public.comisiones_bono add column if not exists manual_clases numeric(7,2) check (manual_clases >= 0);
alter table public.comisiones_bono add column if not exists manual_precio numeric(9,2) check (manual_precio >= 0);
alter table public.comisiones_bono add column if not exists manual_pct    numeric(5,2) check (manual_pct between 0 and 100);   -- null = el del origen del cliente

create table if not exists public.comisiones_manual (
  id              uuid primary key default gen_random_uuid(),
  mes             text not null check (mes ~ '^\d{4}-\d{2}$'),            -- 'AAAA-MM' en el que se liquida
  entrenador_id   uuid not null references public.perfiles(id) on delete cascade,
  concepto        text not null default '',
  clases          numeric(7,2) check (clases >= 0),
  precio          numeric(9,2) check (precio >= 0),                       -- € por clase
  pct             numeric(5,2) check (pct between 0 and 100),             -- null = el de «cliente externo»
  declarado       boolean not null default false,
  pago_entrenador text not null default 'efectivo' check (pago_entrenador in ('efectivo', 'nomina')),
  created_at      timestamptz not null default now()
);
create index if not exists comisiones_manual_mes_idx on public.comisiones_manual(mes);

alter table public.comisiones_manual enable row level security;
drop policy if exists comisiones_manual_admin on public.comisiones_manual;
create policy comisiones_manual_admin on public.comisiones_manual for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

revoke all on public.comisiones_manual from anon;
grant select, insert, update, delete on public.comisiones_manual to authenticated;
grant all on public.comisiones_manual to service_role;

notify pgrst, 'reload schema';

-- Comprobación: 3 columnas nuevas en comisiones_bono y la tabla nueva con RLS activa.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'comisiones_bono'
     and column_name in ('manual_clases', 'manual_precio', 'manual_pct')) as columnas_nuevas,
  (select relrowsecurity from pg_class where relname = 'comisiones_manual') as manual_rls;
