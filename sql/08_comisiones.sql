-- ════════════════════════════════════════════════════════════════════════
-- 08 · LIQUIDACIÓN DE COMISIONES DE LOS ENTRENADORES
-- ════════════════════════════════════════════════════════════════════════
-- Dos tablas, ambas SOLO para el administrador (ni siquiera los entrenadores pueden leerlas):
--   · comisiones_config: los porcentajes pactados (una sola fila, editable desde la pantalla).
--   · comisiones_bono: por cada bono, si se trata como "declarado" (se le resta el IVA) y si a el
--     entrenador se le paga en efectivo o en nómina (se le resta la Seguridad Social). Si un bono no
--     tiene fila aquí, la pantalla usa el valor por defecto según su método de pago real.
-- Ejecutar en Supabase → SQL Editor, después de 07_pagos.sql.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.comisiones_config (
  id               smallint primary key default 1 check (id = 1),   -- una sola fila
  comision_codek   numeric(5,2) not null default 40,   -- % sobre clientes de origen Codek
  comision_externo numeric(5,2) not null default 60,   -- % sobre clientes que trajo el propio entrenador
  iva_pct          numeric(5,2) not null default 21,   -- % a extraer si el pago está declarado
  ss_pct           numeric(5,2) not null default 35,   -- % a extraer si se paga en nómina (coste de Seguridad Social)
  updated_at       timestamptz not null default now()
);
insert into public.comisiones_config (id) values (1) on conflict (id) do nothing;

create table if not exists public.comisiones_bono (
  bono_id         uuid primary key references public.bonos(id) on delete cascade,
  declarado       boolean,       -- null = usa el método de pago real del bono; si no, se fuerza a mano
  pago_entrenador text not null default 'efectivo' check (pago_entrenador in ('efectivo', 'nomina')),
  updated_at      timestamptz not null default now()
);

alter table public.comisiones_config enable row level security;
alter table public.comisiones_bono   enable row level security;

drop policy if exists comisiones_config_admin on public.comisiones_config;
create policy comisiones_config_admin on public.comisiones_config for all to authenticated
  using (public.es_admin()) with check (public.es_admin());
drop policy if exists comisiones_bono_admin on public.comisiones_bono;
create policy comisiones_bono_admin on public.comisiones_bono for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

revoke all on public.comisiones_config, public.comisiones_bono from anon;
grant select, insert, update, delete on public.comisiones_config, public.comisiones_bono to authenticated;
grant all on public.comisiones_config, public.comisiones_bono to service_role;

notify pgrst, 'reload schema';

-- Comprobación: debe salir 1 fila con la configuración por defecto y las dos tablas con RLS activa.
select
  (select comision_codek from public.comisiones_config where id = 1) as comision_codek,
  (select comision_externo from public.comisiones_config where id = 1) as comision_externo,
  (select iva_pct from public.comisiones_config where id = 1) as iva_pct,
  (select ss_pct from public.comisiones_config where id = 1) as ss_pct,
  (select relrowsecurity from pg_class where relname = 'comisiones_config') as config_rls,
  (select relrowsecurity from pg_class where relname = 'comisiones_bono') as bono_rls;
