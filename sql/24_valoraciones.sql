-- ════════════════════════════════════════════════════════════════════════
-- 24 · VALORACIONES (invitados que vienen a una valoración, sin ficha de cliente)
-- ════════════════════════════════════════════════════════════════════════
-- Una valoración es una cita de un invitado con un entrenador a una fecha y hora. No es un cliente: no tiene ficha, bono,
-- créditos ni cobro, y por eso NO cuenta en comisiones, previsiones ni resúmenes. Solo sirve para que el entrenador la vea en
-- su calendario (en amarillo) y para avisar de solapes con sus sesiones.
--   · entrenador_id → quién la hace.
--   · nombre        → el invitado (p. ej. «Marta»).
--   · fecha, hora, duracion_min → cuándo y cuánto dura (60 min por defecto).
--   · nota          → teléfono, objetivo, lo que haga falta.
-- Reglas que impone la base de datos:
--   · el administrador ve y cambia todas;
--   · cada entrenador ve, crea, cambia y borra solo las suyas (no puede apuntar una a otro entrenador).
-- Ejecutar en Supabase → SQL Editor. Se puede repetir sin problema.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.valoraciones (
  id            uuid primary key default gen_random_uuid(),
  entrenador_id uuid not null references public.perfiles(id) on delete cascade,
  nombre        text not null check (length(btrim(nombre)) > 0),
  fecha         date not null,
  hora          time not null,
  duracion_min  int  not null default 60 check (duracion_min between 15 and 240),
  nota          text,
  creado_por    uuid default auth.uid() references public.perfiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists valoraciones_fecha_idx on public.valoraciones(fecha);
create index if not exists valoraciones_entrenador_idx on public.valoraciones(entrenador_id);

alter table public.valoraciones enable row level security;

drop policy if exists valoraciones_all on public.valoraciones;
create policy valoraciones_all on public.valoraciones for all to authenticated
  using (public.es_admin() or entrenador_id = auth.uid())
  with check (public.es_admin() or entrenador_id = auth.uid());

revoke all on public.valoraciones from anon;
grant select, insert, update, delete on public.valoraciones to authenticated;
grant all on public.valoraciones to service_role;

notify pgrst, 'reload schema';

-- Comprobación: tabla creada, seguridad activada y 1 política.
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'valoraciones') as tabla,
  (select relrowsecurity from pg_class where oid = 'public.valoraciones'::regclass) as seguridad_activada,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'valoraciones') as politicas;
