-- ════════════════════════════════════════════════════════════════════════
-- 04 · TOKENS DE AIMHARDER (integración de racks)
-- ════════════════════════════════════════════════════════════════════════
-- AimHarder entrega una pareja NUEVA de tokens cada vez que se renuevan y la anterior
-- deja de valer. Esta tabla guarda la pareja vigente para que la función de Supabase la
-- pueda actualizar sola. NO contiene ningún token: se rellena únicamente desde la función.
--
-- Seguridad: RLS activado y SIN políticas + permisos retirados → ni la app web ni ningún
-- usuario (ni siquiera el administrador) puede leerla. Solo la función (service_role).
-- Se puede ejecutar más de una vez.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.aimharder_tokens (
  id             int primary key default 1 check (id = 1),   -- una sola fila
  access_token   text not null,
  refresh_token  text not null,
  access_expira  text,
  refresh_expira text,
  updated_at     timestamptz not null default now()
);

alter table public.aimharder_tokens enable row level security;
revoke all on public.aimharder_tokens from anon, authenticated;
grant all on public.aimharder_tokens to service_role;

notify pgrst, 'reload schema';

-- Comprobación: debe salir 1 fila con rls_activa = true, y ninguna política.
select c.relname as tabla, c.relrowsecurity as rls_activa,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as politicas
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'aimharder_tokens';
