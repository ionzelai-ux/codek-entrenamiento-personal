-- ════════════════════════════════════════════════════════════════════════
-- 20 · AVISAR DE UN COBRO TAMBIÉN EN LOS CLIENTES QUE «PAGAN DESPUÉS»
-- ════════════════════════════════════════════════════════════════════════
-- Igual que sql/19 para los bonos, pero para los clientes que entrenan y pagan después (por sesión o «a cuenta»), cuyos
-- cobros solo puede registrar el administrador. El entrenador apunta aquí «me ha pagado X €» (con fecha, método y, si es «por
-- sesión», qué sesiones abona). Es solo un aviso: no cambia lo que debe el cliente hasta que el administrador lo VALIDA (la
-- aplicación crea entonces el cobro de verdad y borra el aviso) o lo rechaza (se borra).
--   · Cada entrenador solo ve y gestiona los avisos de SUS clientes; el administrador, todos.
--   · Solo se puede avisar de clientes con «paga después» aprobado, con importe > 0 y fecha no futura; las sesiones elegidas
--     tienen que ser del cliente y no estar ya cobradas; en «a cuenta» no se eligen sesiones.
--   · Quién avisó y cuándo lo pone la base de datos (no se puede falsear).
-- Ejecutar en Supabase → SQL Editor. Se puede repetir sin problema.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.cobros_avisados (
  id          uuid primary key default gen_random_uuid(),
  cliente_id  uuid not null references public.clientes(id) on delete cascade,
  importe     numeric(9,2) not null check (importe > 0),
  fecha       date not null,                                                      -- cuándo recibió el dinero
  metodo      text not null check (metodo in ('efectivo', 'tarjeta', 'transferencia')),
  sesion_ids  uuid[] not null default '{}',                                       -- sesiones que abona («por sesión»); vacío en «a cuenta»
  avisado_por uuid references public.perfiles(id) on delete set null,
  creado_en   timestamptz not null default now()
);
create index if not exists cobros_avisados_cliente_idx on public.cobros_avisados(cliente_id);

create or replace function public.cobros_avisados_control() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  cli public.clientes;
  n int;
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is null or public.es_admin() then return new; end if;
    raise exception 'Un aviso de cobro no se puede modificar: borra el aviso y crea otro';
  end if;
  -- INSERT
  if auth.uid() is not null then new.avisado_por := auth.uid(); end if;
  if auth.uid() is null or public.es_admin() then return new; end if;
  select * into cli from public.clientes where id = new.cliente_id;
  if cli.id is null or cli.pago_diferido is distinct from 'aprobado' then
    raise exception 'Solo se puede avisar del cobro de un cliente que entrena y paga después';
  end if;
  if new.fecha > current_date then
    raise exception 'La fecha en que recibiste el cobro no puede ser futura';
  end if;
  if coalesce(cli.pago_diferido_modo, 'sesion') = 'cuenta' then
    if cardinality(new.sesion_ids) > 0 then
      raise exception 'En un cliente «a cuenta» no se eligen sesiones: solo el importe, la fecha y el método';
    end if;
  else
    if cardinality(new.sesion_ids) = 0 then
      raise exception 'Elige qué sesiones te ha pagado';
    end if;
    select count(*) into n from public.sesiones s
      where s.id = any (new.sesion_ids) and s.cliente_id = new.cliente_id and s.cobro_bono_id is null;
    if n <> cardinality(new.sesion_ids) then
      raise exception 'Alguna sesión no es de este cliente o ya está cobrada';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists cobros_avisados_control on public.cobros_avisados;
create trigger cobros_avisados_control before insert or update on public.cobros_avisados
  for each row execute function public.cobros_avisados_control();

alter table public.cobros_avisados enable row level security;

drop policy if exists cobros_avisados_ver on public.cobros_avisados;
create policy cobros_avisados_ver on public.cobros_avisados for select to authenticated
  using (public.puede_ver_cliente(cliente_id));
drop policy if exists cobros_avisados_crear on public.cobros_avisados;
create policy cobros_avisados_crear on public.cobros_avisados for insert to authenticated
  with check (public.puede_ver_cliente(cliente_id));
drop policy if exists cobros_avisados_borrar on public.cobros_avisados;
create policy cobros_avisados_borrar on public.cobros_avisados for delete to authenticated
  using (public.puede_ver_cliente(cliente_id));
drop policy if exists cobros_avisados_cambiar on public.cobros_avisados;
create policy cobros_avisados_cambiar on public.cobros_avisados for update to authenticated
  using (public.es_admin()) with check (public.es_admin());

revoke all on public.cobros_avisados from anon;
grant select, insert, update, delete on public.cobros_avisados to authenticated;
grant all on public.cobros_avisados to service_role;

notify pgrst, 'reload schema';

-- Comprobación: la tabla existe (1), con seguridad activada (true), 4 políticas y el disparador.
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'cobros_avisados') as tabla,
  (select relrowsecurity from pg_class where oid = 'public.cobros_avisados'::regclass) as seguridad_activada,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'cobros_avisados') as politicas,
  (select count(*) from pg_trigger where tgname = 'cobros_avisados_control' and not tgisinternal) as disparador;
