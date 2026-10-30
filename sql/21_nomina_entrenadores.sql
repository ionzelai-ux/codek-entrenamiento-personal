-- ════════════════════════════════════════════════════════════════════════
-- 21 · NÓMINA DEL ENTRENADOR Y REPARTO DE SUS COMISIONES (nómina / efectivo)
-- ════════════════════════════════════════════════════════════════════════
-- Un entrenador con nómina cobra, como mínimo, esa nómina. Cada mes se resta de su comisión el COSTE EMPRESA de la nómina
-- (bruto + Seguridad Social de la empresa) y los anticipos; lo que queda lo reparte el administrador entre:
--   · nómina (se suma al bruto: importe ÷ (1 + SS empresa %)), y
--   · efectivo (se entrega tal cual).
-- Una fila por entrenador y mes:
--   · bruto          → bruto de su nómina de ese mes (informativo, para ver cómo queda la nómina con el reparto)
--   · coste_empresa  → lo que cuesta esa nómina a la empresa (bruto + SS empresa)
--   · parte_nomina   → de lo que queda por repartir, cuánto se le paga en nómina (el resto, en efectivo)
-- Solo el administrador la crea y la cambia; cada entrenador ve SOLO la suya.
-- Ejecutar en Supabase → SQL Editor. Se puede repetir sin problema.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.comisiones_nomina (
  id            uuid primary key default gen_random_uuid(),
  entrenador_id uuid not null references public.perfiles(id) on delete cascade,
  mes           text not null check (mes ~ '^\d{4}-\d{2}$'),
  bruto         numeric(9,2) not null default 0 check (bruto >= 0),
  coste_empresa numeric(9,2) not null default 0 check (coste_empresa >= 0),
  parte_nomina  numeric(9,2) not null default 0 check (parte_nomina >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (entrenador_id, mes)
);

create or replace function public.comisiones_nomina_actualizada() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists comisiones_nomina_updated on public.comisiones_nomina;
create trigger comisiones_nomina_updated before update on public.comisiones_nomina
  for each row execute function public.comisiones_nomina_actualizada();

alter table public.comisiones_nomina enable row level security;

drop policy if exists comisiones_nomina_admin on public.comisiones_nomina;
create policy comisiones_nomina_admin on public.comisiones_nomina for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists comisiones_nomina_leer on public.comisiones_nomina;
create policy comisiones_nomina_leer on public.comisiones_nomina for select to authenticated
  using (entrenador_id = auth.uid());

revoke all on public.comisiones_nomina from anon;
grant select, insert, update, delete on public.comisiones_nomina to authenticated;
grant all on public.comisiones_nomina to service_role;

notify pgrst, 'reload schema';

-- Comprobación: la tabla existe (1), con seguridad activada (true) y 2 políticas.
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'comisiones_nomina') as tabla,
  (select relrowsecurity from pg_class where oid = 'public.comisiones_nomina'::regclass) as seguridad_activada,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'comisiones_nomina') as politicas;
