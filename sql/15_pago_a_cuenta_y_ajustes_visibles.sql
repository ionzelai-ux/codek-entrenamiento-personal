-- ════════════════════════════════════════════════════════════════════════
-- 15 · PAGO «A CUENTA» + EL ENTRENADOR VE SUS PROPIOS AJUSTES DE COMISIÓN
-- ════════════════════════════════════════════════════════════════════════
-- 1) «Entrena y paga después» tiene dos modalidades (solo el administrador las elige):
--      · 'sesion' (por defecto): precio por sesión y se eligen qué sesiones se abonan (como hasta ahora).
--      · 'cuenta': se apuntan pagos recibidos (importe + fecha + método) sin tener que cuadrarlos con sesiones concretas;
--        el balance es en euros: sesiones hechas × tarifa − lo pagado. Sus pagos NO generan comisión automática
--        (la comisión de esos clientes se pone a mano en «Ajustes manuales»).
--    Para poder apuntar un pago sin sesiones, un bono de tipo 'cobro' puede tener 0 sesiones.
-- 2) El entrenador puede LEER (no cambiar) lo que el administrador ha decidido sobre SUS bonos y SUS ajustes manuales de
--    comisión, para que su pestaña de comisiones parta de la liquidación real.
-- Ejecutar en Supabase → SQL Editor, tras 14.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1) Modalidad del pago diferido ──────────────────────────────────────────────────────────────────
alter table public.clientes add column if not exists pago_diferido_modo text not null default 'sesion'
  check (pago_diferido_modo in ('sesion', 'cuenta'));

-- Un bono normal sigue necesitando al menos 1 sesión; un cobro «a cuenta» puede tener 0.
do $$
declare r record;
begin
  for r in select conname from pg_constraint
           where conrelid = 'public.bonos'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%sesiones > 0%' loop
    execute format('alter table public.bonos drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.bonos drop constraint if exists bonos_sesiones_check;
alter table public.bonos add constraint bonos_sesiones_check check (sesiones > 0 or tipo = 'cobro');

-- Solo el administrador aprueba, fija la tarifa y elige la modalidad (sustituye al disparador de sql/13)
create or replace function public.clientes_pago_diferido_control() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null or public.es_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if new.pago_diferido = 'aprobado' then
      raise exception 'Solo el administrador puede aprobar que un cliente entrene y pague después';
    end if;
    if new.pago_diferido_modo is distinct from 'sesion' then
      raise exception 'Solo el administrador puede elegir la modalidad del pago diferido';
    end if;
  else
    if old.pago_diferido = 'aprobado' and (new.pago_diferido is distinct from old.pago_diferido
                                           or new.tarifa_sesion is distinct from old.tarifa_sesion) then
      raise exception 'Solo el administrador puede cambiar un pago diferido ya aprobado';
    end if;
    if new.pago_diferido = 'aprobado' and old.pago_diferido is distinct from 'aprobado' then
      raise exception 'Solo el administrador puede aprobar que un cliente entrene y pague después';
    end if;
    if new.pago_diferido_modo is distinct from old.pago_diferido_modo then
      raise exception 'Solo el administrador puede cambiar la modalidad del pago diferido';
    end if;
  end if;
  return new;
end;
$$;

-- ── 2) El entrenador lee lo que le afecta de las comisiones ──────────────────────────────────────────
create or replace function public.puede_ver_bono(bid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.es_admin() or exists (
    select 1 from public.bonos b join public.clientes c on c.id = b.cliente_id
    where b.id = bid and c.entrenador_id = auth.uid());
$$;
revoke execute on function public.puede_ver_bono(uuid) from public, anon;
grant  execute on function public.puede_ver_bono(uuid) to authenticated;

drop policy if exists comisiones_bono_leer on public.comisiones_bono;
create policy comisiones_bono_leer on public.comisiones_bono for select to authenticated
  using (public.puede_ver_bono(bono_id));

drop policy if exists comisiones_manual_leer on public.comisiones_manual;
create policy comisiones_manual_leer on public.comisiones_manual for select to authenticated
  using (entrenador_id = auth.uid());

notify pgrst, 'reload schema';

-- Comprobación: columna nueva (1), disparador (1) y las políticas de lectura nuevas (2).
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'clientes' and column_name = 'pago_diferido_modo') as columna_modo,
  (select count(*) from pg_policies where schemaname = 'public' and policyname in ('comisiones_bono_leer', 'comisiones_manual_leer')) as politicas_lectura,
  (select pg_get_constraintdef(oid) from pg_constraint where conname = 'bonos_sesiones_check' and conrelid = 'public.bonos'::regclass) as regla_sesiones;
