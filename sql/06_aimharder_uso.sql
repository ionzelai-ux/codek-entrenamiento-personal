-- ════════════════════════════════════════════════════════════════════════
-- 06 · CONTROL DE USO DE LA API DE AIMHARDER
-- ════════════════════════════════════════════════════════════════════════
-- AimHarder limita el número de peticiones (responde 429 «Too many requests») y, si se
-- insiste, el bloqueo se alarga. La función apunta aquí cuántas peticiones hace y, si
-- recibe un 429, hasta cuándo NO debe volver a llamar. Sin políticas y con permisos
-- retirados: solo la función de Supabase (service_role) puede leerla o escribirla.
-- Se puede ejecutar más de una vez.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.aimharder_uso (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  llamadas      int not null default 0,      -- peticiones hechas a AimHarder en esa invocación
  limitadas     int not null default 0,      -- de ellas, cuántas dieron 429
  bloqueo_hasta timestamptz                  -- si hubo 429: hasta cuándo no se vuelve a llamar
);
create index if not exists aimharder_uso_at_idx on public.aimharder_uso(at);

alter table public.aimharder_uso enable row level security;
revoke all on public.aimharder_uso from anon, authenticated;
grant all on public.aimharder_uso to service_role;

notify pgrst, 'reload schema';

-- Comprobación: 1 fila con rls_activa = true y 0 políticas.
select c.relname as tabla, c.relrowsecurity as rls_activa,
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as politicas
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'aimharder_uso';
