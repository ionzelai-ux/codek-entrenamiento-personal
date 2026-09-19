-- ════════════════════════════════════════════════════════════════════════
-- 01 · ESQUEMA + SEGURIDAD (RLS) · CODEK Entrenamiento Personal
-- ════════════════════════════════════════════════════════════════════════
-- Ejecutar en Supabase → SQL Editor, después de 00_limpiar_proyecto.sql.
-- Reglas de acceso:
--   · admin       → ve y modifica todo.
--   · entrenador  → solo sus clientes y los bonos/sesiones de esos clientes.
--   · sin sesión  → no ve nada.
-- ════════════════════════════════════════════════════════════════════════

-- ── Perfiles (uno por usuario de Authentication) ─────────────────────────
create table public.perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  usuario    text not null unique,
  nombre     text not null,
  rol        text not null check (rol in ('admin', 'entrenador')),
  color      text not null default '#8B2020',
  created_at timestamptz not null default now()
);

-- ── Clientes (potenciales y efectivos) ───────────────────────────────────
create table public.clientes (
  id               uuid primary key default gen_random_uuid(),
  entrenador_id    uuid not null references public.perfiles(id),
  nombre           text not null,
  apellidos        text not null default '',
  telefono         text,
  email            text,
  fecha_nacimiento date,
  estado           text not null default 'potencial' check (estado in ('potencial', 'efectivo')),
  origen           text not null check (origen in ('codek', 'externo')),  -- codek = captado por la empresa · externo = lo trae el entrenador
  -- Solo potenciales: qué le gustaría contratar (para estimar facturación)
  pot_sesiones_bono int check (pot_sesiones_bono > 0),
  pot_veces_semana  int check (pot_veces_semana between 1 and 7),
  pot_precio        numeric(9,2) check (pot_precio >= 0),
  -- Días fijos: [{"dia": 1..7 (1=lunes), "hora": "10:00"}]; vacío = sin días fijos
  dias_fijos       jsonb not null default '[]'::jsonb,
  notas            text,
  activo           boolean not null default true,   -- false = archivado
  created_at       timestamptz not null default now()
);
create index clientes_entrenador_idx on public.clientes(entrenador_id);

-- ── Bonos comprados ──────────────────────────────────────────────────────
create table public.bonos (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references public.clientes(id) on delete cascade,
  sesiones     int not null check (sesiones > 0),
  precio       numeric(9,2) not null check (precio >= 0),
  fecha_pago   date not null,       -- puede ser hoy o futura ("empezamos el mes que viene")
  fecha_inicio date not null,
  created_at   timestamptz not null default now()
);
create index bonos_cliente_idx on public.bonos(cliente_id);
create index bonos_fecha_pago_idx on public.bonos(fecha_pago);

-- ── Sesiones ─────────────────────────────────────────────────────────────
create table public.sesiones (
  id           uuid primary key default gen_random_uuid(),
  cliente_id   uuid not null references public.clientes(id) on delete cascade,
  bono_id      uuid references public.bonos(id) on delete set null,
  fecha        date not null,
  hora         time not null,
  duracion_min int not null default 60 check (duracion_min between 15 and 240),
  estado       text not null default 'reservada' check (estado in ('reservada', 'hecha', 'no_vino')),
  nota         text,
  created_at   timestamptz not null default now()
);
create index sesiones_cliente_idx on public.sesiones(cliente_id);
create index sesiones_fecha_idx on public.sesiones(fecha);

-- ── Funciones de ayuda para las políticas ────────────────────────────────
-- security definer: leen perfiles/clientes sin volver a pasar por RLS (evita recursión).
create function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'admin');
$$;

create function public.puede_ver_cliente(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.es_admin()
      or exists (select 1 from public.clientes c where c.id = cid and c.entrenador_id = auth.uid());
$$;

revoke execute on function public.es_admin() from public, anon;
revoke execute on function public.puede_ver_cliente(uuid) from public, anon;
grant  execute on function public.es_admin() to authenticated;
grant  execute on function public.puede_ver_cliente(uuid) to authenticated;

-- ── Row Level Security ───────────────────────────────────────────────────
alter table public.perfiles enable row level security;
alter table public.clientes enable row level security;
alter table public.bonos    enable row level security;
alter table public.sesiones enable row level security;

-- perfiles: cada uno ve el suyo; el admin ve todos. Solo se modifican desde SQL.
create policy perfiles_select on public.perfiles for select to authenticated
  using (id = auth.uid() or public.es_admin());

-- clientes: un entrenador solo puede crear/editar los suyos (no puede "regalar" un cliente a otro);
-- reasignar es cosa del admin; borrar también (los entrenadores archivan).
create policy clientes_select on public.clientes for select to authenticated
  using (public.es_admin() or entrenador_id = auth.uid());
create policy clientes_insert on public.clientes for insert to authenticated
  with check (public.es_admin() or entrenador_id = auth.uid());
create policy clientes_update on public.clientes for update to authenticated
  using (public.es_admin() or entrenador_id = auth.uid())
  with check (public.es_admin() or entrenador_id = auth.uid());
create policy clientes_delete on public.clientes for delete to authenticated
  using (public.es_admin());

-- bonos y sesiones: acceso según el cliente al que pertenecen.
create policy bonos_all on public.bonos for all to authenticated
  using (public.puede_ver_cliente(cliente_id))
  with check (public.puede_ver_cliente(cliente_id));

create policy sesiones_all on public.sesiones for all to authenticated
  using (public.puede_ver_cliente(cliente_id))
  with check (public.puede_ver_cliente(cliente_id));

-- ── Permisos de tabla: la clave anon no puede tocar nada ─────────────────
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

notify pgrst, 'reload schema';
