-- ════════════════════════════════════════════════════════════════════════
-- 05 · RESERVAS DE PRUEBA EN AIMHARDER (fase 2)
-- ════════════════════════════════════════════════════════════════════════
-- Apunta cada reserva de invitado que crea la prueba, para que la función solo pueda
-- cancelar ESAS reservas (nunca las de tus socios). Sin políticas y con permisos retirados:
-- solo la función de Supabase (service_role) puede leerla o escribirla.
-- Se puede ejecutar más de una vez.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.aimharder_pruebas (
  id          bigint generated always as identity primary key,
  booking_id  bigint not null,          -- número de reserva que devuelve AimHarder
  fecha       date not null,
  hora        text not null,
  schedule_id bigint not null,
  creada      timestamptz not null default now(),
  cancelada   timestamptz
);

alter table public.aimharder_pruebas enable row level security;
revoke all on public.aimharder_pruebas from anon, authenticated;
grant all on public.aimharder_pruebas to service_role;

notify pgrst, 'reload schema';

-- Comprobación: 1 fila con rls_activa = true y 0 políticas.
select c.relname as tabla, c.relrowsecurity as rls_activa,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as politicas
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'aimharder_pruebas';
