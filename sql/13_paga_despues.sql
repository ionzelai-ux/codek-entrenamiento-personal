-- ════════════════════════════════════════════════════════════════════════
-- 13 · «ENTRENA Y PAGA DESPUÉS» (excepcional, con aprobación del administrador)
-- ════════════════════════════════════════════════════════════════════════
-- Hay clientes que entrenan y pagan más tarde, clase a clase. Es una EXCEPCIÓN:
--   · el entrenador la SOLICITA (pago_diferido = 'solicitado') y el administrador la APRUEBA ('aprobado') o la rechaza ('no');
--   · una vez aprobada, las sesiones se generan sin bono y se acumulan como deuda (sesiones hechas × tarifa_sesion);
--   · cuando el cliente paga, el administrador elige qué sesiones se abonan: se crea un bono de tipo 'cobro' (ya pagado)
--     y esas sesiones quedan enlazadas a él (sesiones.cobro_bono_id). Así el cobro entra solo en el Resumen y en Comisiones.
-- La seguridad la impone la base de datos (disparadores), no solo la pantalla: un entrenador nunca puede aprobarse, ni
-- crear un cobro, ni marcar sesiones como cobradas. Ejecutar en Supabase → SQL Editor, tras 12.
-- ════════════════════════════════════════════════════════════════════════

alter table public.clientes add column if not exists pago_diferido text not null default 'no'
  check (pago_diferido in ('no', 'solicitado', 'aprobado'));
alter table public.clientes add column if not exists tarifa_sesion numeric(7,2) check (tarifa_sesion >= 0);   -- € por sesión

alter table public.bonos add column if not exists tipo text not null default 'bono' check (tipo in ('bono', 'cobro'));
alter table public.sesiones add column if not exists cobro_bono_id uuid references public.bonos(id) on delete set null;
create index if not exists sesiones_cobro_bono_idx on public.sesiones(cobro_bono_id);

-- ── Clientes: solo el administrador aprueba y fija la tarifa de un pago diferido ya aprobado ──────────
create or replace function public.clientes_pago_diferido_control() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  -- auth.uid() es nulo desde el editor SQL o con la clave de servicio: se permite.
  if auth.uid() is null or public.es_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.pago_diferido = 'aprobado' then
      raise exception 'Solo el administrador puede aprobar que un cliente entrene y pague después';
    end if;
  else
    if old.pago_diferido = 'aprobado' and (new.pago_diferido is distinct from old.pago_diferido
                                           or new.tarifa_sesion is distinct from old.tarifa_sesion) then
      raise exception 'Solo el administrador puede cambiar un pago diferido ya aprobado';
    end if;
    if new.pago_diferido = 'aprobado' and old.pago_diferido is distinct from 'aprobado' then
      raise exception 'Solo el administrador puede aprobar que un cliente entrene y pague después';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists clientes_pago_diferido on public.clientes;
create trigger clientes_pago_diferido before insert or update on public.clientes
  for each row execute function public.clientes_pago_diferido_control();

-- ── Bonos de tipo 'cobro': solo los crea el administrador ──────────────────────────────────────────
create or replace function public.bonos_tipo_cobro_control() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null or public.es_admin() then return new; end if;
  if (tg_op = 'INSERT' and new.tipo = 'cobro') or (tg_op = 'UPDATE' and new.tipo is distinct from old.tipo) then
    raise exception 'Solo el administrador puede registrar cobros';
  end if;
  return new;
end;
$$;
drop trigger if exists bonos_tipo_cobro on public.bonos;
create trigger bonos_tipo_cobro before insert or update on public.bonos
  for each row execute function public.bonos_tipo_cobro_control();

-- ── Sesiones: solo el administrador las marca como cobradas ─────────────────────────────────────────
create or replace function public.sesiones_cobro_control() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null or public.es_admin() then return new; end if;
  if (tg_op = 'INSERT' and new.cobro_bono_id is not null) or (tg_op = 'UPDATE' and new.cobro_bono_id is distinct from old.cobro_bono_id) then
    raise exception 'Solo el administrador puede marcar sesiones como cobradas';
  end if;
  return new;
end;
$$;
drop trigger if exists sesiones_cobro on public.sesiones;
create trigger sesiones_cobro before insert or update on public.sesiones
  for each row execute function public.sesiones_cobro_control();

notify pgrst, 'reload schema';

-- Comprobación: 4 columnas nuevas y 3 disparadores.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and (
      (table_name = 'clientes' and column_name in ('pago_diferido', 'tarifa_sesion'))
   or (table_name = 'bonos' and column_name = 'tipo')
   or (table_name = 'sesiones' and column_name = 'cobro_bono_id'))) as columnas_nuevas,
  (select count(*) from pg_trigger where tgname in ('clientes_pago_diferido', 'bonos_tipo_cobro', 'sesiones_cobro') and not tgisinternal) as disparadores;
