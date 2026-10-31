-- ════════════════════════════════════════════════════════════════════════
-- 23 · CERRAR LA LIQUIDACIÓN DE UN ENTRENADOR (queda guardada y bloqueada)
-- ════════════════════════════════════════════════════════════════════════
-- Al cerrar la liquidación de un mes de un entrenador se guarda una copia fija de todo lo que se ve en la pantalla
-- (bonos, comisiones, ajustes manuales, anticipos, nómina y reparto) y el mes queda BLOQUEADO en la base de datos:
-- mientras esté cerrada no se puede tocar nada que cambie esa liquidación:
--   · los ajustes por bono (incluir / declarado / manual)         · las líneas manuales
--   · los anticipos de ese mes                                    · la nómina de ese mes
--   · el importe, la fecha de cobro o el método de un bono que se cobró ese mes (ni crear ni borrar bonos cobrados ese mes)
--   · borrar a un cliente, o pasarlo a otro entrenador, si tiene bonos cobrados en un mes cerrado (se puede archivar)
-- Solo el administrador puede cerrarla; reabrirla (queda apuntado cuántas veces y cuándo) es lo único que la desbloquea.
-- Cada entrenador ve SOLO las suyas. La copia fija no se puede cambiar ni borrar mientras está cerrada.
-- Ejecutar en Supabase → SQL Editor. Se puede repetir sin problema.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.liquidaciones_cerradas (
  id                 uuid primary key default gen_random_uuid(),
  entrenador_id      uuid not null references public.perfiles(id) on delete cascade,
  mes                text not null check (mes ~ '^\d{4}-\d{2}$'),
  datos              jsonb not null,                                          -- copia fija de la liquidación
  cerrada_el         timestamptz not null default now(),
  cerrada_por        uuid references public.perfiles(id) on delete set null,
  reabierta_el       timestamptz,                                             -- null = CERRADA (bloqueada); con fecha = reabierta
  ultima_reapertura  timestamptz,
  reaperturas        integer not null default 0,
  unique (entrenador_id, mes)
);

-- ¿Está cerrada la liquidación de ese entrenador y mes? (security definer: la consultan los disparadores de todos los roles)
create or replace function public.liquidacion_cerrada(p_entrenador uuid, p_mes text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.liquidaciones_cerradas
                 where entrenador_id = p_entrenador and mes = p_mes and reabierta_el is null);
$$;

-- La propia tabla: al cerrar se fija quién y cuándo; cerrada solo se puede reabrir; reabierta se puede volver a cerrar.
create or replace function public.liquidaciones_cerradas_control() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.cerrada_el := now();
    new.cerrada_por := auth.uid();
    new.reabierta_el := null;
    new.ultima_reapertura := null;
    new.reaperturas := 0;
    return new;
  end if;
  if new.entrenador_id is distinct from old.entrenador_id or new.mes is distinct from old.mes then
    raise exception 'No se puede cambiar el entrenador ni el mes de una liquidación cerrada.';
  end if;
  if old.reabierta_el is null then
    if new.reabierta_el is null then
      raise exception 'Esta liquidación está cerrada y no se puede modificar. Reábrela primero.';
    end if;
    new.datos := old.datos;
    new.cerrada_el := old.cerrada_el;
    new.cerrada_por := old.cerrada_por;
    new.reabierta_el := now();
    new.ultima_reapertura := now();
    new.reaperturas := old.reaperturas + 1;
  else
    if new.reabierta_el is not null then
      raise exception 'Esta liquidación está reabierta: vuelve a cerrarla para guardar sus datos.';
    end if;
    new.cerrada_el := now();
    new.cerrada_por := auth.uid();
    new.ultima_reapertura := old.ultima_reapertura;
    new.reaperturas := old.reaperturas;
  end if;
  return new;
end;
$$;
drop trigger if exists liquidaciones_cerradas_control on public.liquidaciones_cerradas;
create trigger liquidaciones_cerradas_control before insert or update on public.liquidaciones_cerradas
  for each row execute function public.liquidaciones_cerradas_control();

alter table public.liquidaciones_cerradas enable row level security;

drop policy if exists liquidaciones_cerradas_admin on public.liquidaciones_cerradas;
create policy liquidaciones_cerradas_admin on public.liquidaciones_cerradas for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

drop policy if exists liquidaciones_cerradas_leer on public.liquidaciones_cerradas;
create policy liquidaciones_cerradas_leer on public.liquidaciones_cerradas for select to authenticated
  using (entrenador_id = auth.uid());

revoke all on public.liquidaciones_cerradas from anon;
grant select, insert, update on public.liquidaciones_cerradas to authenticated;   -- sin delete: una liquidación se reabre, no se borra
grant all on public.liquidaciones_cerradas to service_role;

-- ── Bloqueo de lo que cambia una liquidación cerrada ────────────────────────────────────────────────

-- Tablas con entrenador y mes: nómina, anticipos y líneas manuales.
create or replace function public.bloquear_liquidacion_cerrada() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op <> 'INSERT' then
    if public.liquidacion_cerrada(old.entrenador_id, old.mes) then
      raise exception 'La liquidación de % de este entrenador está cerrada. Reábrela en Comisiones para poder cambiar esto.', old.mes;
    end if;
  end if;
  if tg_op <> 'DELETE' then
    if public.liquidacion_cerrada(new.entrenador_id, new.mes) then
      raise exception 'La liquidación de % de este entrenador está cerrada. Reábrela en Comisiones para poder cambiar esto.', new.mes;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists comisiones_nomina_cerrada on public.comisiones_nomina;
create trigger comisiones_nomina_cerrada before insert or update or delete on public.comisiones_nomina
  for each row execute function public.bloquear_liquidacion_cerrada();
drop trigger if exists comisiones_anticipos_cerrada on public.comisiones_anticipos;
create trigger comisiones_anticipos_cerrada before insert or update or delete on public.comisiones_anticipos
  for each row execute function public.bloquear_liquidacion_cerrada();
drop trigger if exists comisiones_manual_cerrada on public.comisiones_manual;
create trigger comisiones_manual_cerrada before insert or update or delete on public.comisiones_manual
  for each row execute function public.bloquear_liquidacion_cerrada();

-- Ajustes por bono: el mes y el entrenador salen del bono (mes en que se cobró) y de su cliente.
create or replace function public.bloquear_ajuste_bono_cerrado() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_bono uuid; v_ent uuid; v_mes text;
begin
  v_bono := case when tg_op = 'DELETE' then old.bono_id else new.bono_id end;
  select c.entrenador_id, to_char(b.pagado_el, 'YYYY-MM') into v_ent, v_mes
    from public.bonos b join public.clientes c on c.id = b.cliente_id where b.id = v_bono;
  if v_mes is not null and public.liquidacion_cerrada(v_ent, v_mes) then
    raise exception 'La liquidación de % de este entrenador está cerrada. Reábrela en Comisiones para poder cambiar esto.', v_mes;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists comisiones_bono_cerrada on public.comisiones_bono;
create trigger comisiones_bono_cerrada before insert or update or delete on public.comisiones_bono
  for each row execute function public.bloquear_ajuste_bono_cerrado();

-- Bonos cobrados en un mes cerrado: no se cambia su importe, su fecha de cobro ni su método, ni se crean o borran.
create or replace function public.bloquear_bono_cobrado_cerrado() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ent uuid; v_cambia boolean;
begin
  if tg_op <> 'INSERT' and old.pagado_el is not null then
    if tg_op = 'DELETE' then v_cambia := true;
    else v_cambia := new.precio is distinct from old.precio or new.pagado_el is distinct from old.pagado_el
                  or new.metodo_pago is distinct from old.metodo_pago or new.tipo is distinct from old.tipo
                  or new.cliente_id is distinct from old.cliente_id;
    end if;
    if v_cambia then
      select entrenador_id into v_ent from public.clientes where id = old.cliente_id;
      if public.liquidacion_cerrada(v_ent, to_char(old.pagado_el, 'YYYY-MM')) then
        raise exception 'La liquidación de % de este entrenador está cerrada. Reábrela en Comisiones para poder cambiar este bono.', to_char(old.pagado_el, 'YYYY-MM');
      end if;
    end if;
  end if;
  if tg_op <> 'DELETE' and new.pagado_el is not null then
    if tg_op = 'INSERT' or new.pagado_el is distinct from old.pagado_el or new.precio is distinct from old.precio then
      select entrenador_id into v_ent from public.clientes where id = new.cliente_id;
      if public.liquidacion_cerrada(v_ent, to_char(new.pagado_el, 'YYYY-MM')) then
        raise exception 'La liquidación de % de este entrenador está cerrada. Reábrela en Comisiones para registrar un cobro en ese mes.', to_char(new.pagado_el, 'YYYY-MM');
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists bonos_liquidacion_cerrada on public.bonos;
create trigger bonos_liquidacion_cerrada before insert or update or delete on public.bonos
  for each row execute function public.bloquear_bono_cobrado_cerrado();

-- Clientes con bonos cobrados en un mes cerrado: no se borran (al borrarlos se llevarían esos bonos) ni se pasan a otro entrenador.
create or replace function public.bloquear_cliente_con_cobros_cerrados() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_mes text;
begin
  if tg_op = 'UPDATE' and new.entrenador_id is not distinct from old.entrenador_id then
    return new;
  end if;
  select to_char(b.pagado_el, 'YYYY-MM') into v_mes
    from public.bonos b
   where b.cliente_id = old.id and b.pagado_el is not null
     and public.liquidacion_cerrada(old.entrenador_id, to_char(b.pagado_el, 'YYYY-MM'))
   limit 1;
  if v_mes is not null then
    raise exception 'Este cliente tiene bonos cobrados en la liquidación cerrada de %. Reábrela en Comisiones o archiva la ficha en lugar de %.', v_mes,
      case when tg_op = 'DELETE' then 'eliminarla' else 'pasarla a otro entrenador' end;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists clientes_liquidacion_cerrada on public.clientes;
create trigger clientes_liquidacion_cerrada before update or delete on public.clientes
  for each row execute function public.bloquear_cliente_con_cobros_cerrados();

notify pgrst, 'reload schema';

-- Comprobación: tabla (1), seguridad activada (true), 2 políticas y 6 disparadores de bloqueo (nómina, anticipos, manual, ajustes de bono, bonos, clientes).
select
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'liquidaciones_cerradas') as tabla,
  (select relrowsecurity from pg_class where oid = 'public.liquidaciones_cerradas'::regclass) as seguridad_activada,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'liquidaciones_cerradas') as politicas,
  (select count(*) from pg_trigger where tgname in ('comisiones_nomina_cerrada', 'comisiones_anticipos_cerrada', 'comisiones_manual_cerrada', 'comisiones_bono_cerrada', 'bonos_liquidacion_cerrada', 'clientes_liquidacion_cerrada') and not tgisinternal) as bloqueos;
