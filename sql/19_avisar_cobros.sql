-- ════════════════════════════════════════════════════════════════════════
-- 19 · AVISAR DE UN COBRO (el entrenador lo apunta, el administrador lo valida)
-- ════════════════════════════════════════════════════════════════════════
-- Cuando un cliente le paga a un entrenador y el administrador no está, el entrenador puede AVISAR de que ha cobrado un bono
-- (fecha en que lo recibió y cómo). El bono sigue sin estar pagado: aparece al administrador como «por validar» y solo
-- cuando él lo valida pasa a pagado (pagado_el) y cuenta en el Resumen y en las comisiones.
--   · cobro_avisado_el      → fecha en que el entrenador dice que recibió el dinero
--   · cobro_avisado_metodo  → cómo se lo dieron (efectivo / tarjeta / transferencia)
--   · cobro_avisado_por     → quién lo avisó (lo pone la base de datos, no se puede falsear)
--   · cobro_avisado_en      → cuándo lo apuntó (lo pone la base de datos)
-- Reglas que impone la base de datos:
--   · un entrenador solo puede avisar de bonos de sus clientes (ya lo impone bonos_all), que no estén pagados, que no sean
--     de tipo «cobro» y con una fecha que no sea futura; puede deshacer su aviso mientras no lo valide el administrador;
--   · «pagado_el» sigue siendo solo del administrador (sql/07);
--   · en cuanto el administrador confirma el pago, el aviso se borra solo.
-- Ejecutar en Supabase → SQL Editor. Se puede repetir sin problema.
-- ════════════════════════════════════════════════════════════════════════

alter table public.bonos add column if not exists cobro_avisado_el date;
alter table public.bonos add column if not exists cobro_avisado_metodo text check (cobro_avisado_metodo in ('efectivo', 'tarjeta', 'transferencia'));
alter table public.bonos add column if not exists cobro_avisado_por uuid references public.perfiles(id) on delete set null;
alter table public.bonos add column if not exists cobro_avisado_en timestamptz;

create or replace function public.bonos_aviso_cobro_control() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  limpiar boolean := false;
begin
  -- Pagado = confirmado por el administrador: el aviso ya no hace falta.
  if new.pagado_el is not null or new.cobro_avisado_el is null then
    limpiar := true;
  elsif auth.uid() is null or public.es_admin() then
    return new;   -- administrador / editor SQL: sin más restricciones
  end if;

  if limpiar then
    new.cobro_avisado_el := null; new.cobro_avisado_metodo := null; new.cobro_avisado_por := null; new.cobro_avisado_en := null;
    return new;
  end if;

  -- Entrenador que avisa de un cobro
  if new.tipo is distinct from 'bono' then
    raise exception 'Solo se puede avisar del cobro de un bono';
  end if;
  if new.cobro_avisado_el > current_date then
    raise exception 'La fecha en que recibiste el cobro no puede ser futura';
  end if;
  if tg_op = 'UPDATE' and new.cobro_avisado_el is not distinct from old.cobro_avisado_el
     and new.cobro_avisado_metodo is not distinct from old.cobro_avisado_metodo then
    -- el aviso ya existía y no se ha tocado: se conservan quién y cuándo
    new.cobro_avisado_por := old.cobro_avisado_por; new.cobro_avisado_en := old.cobro_avisado_en;
  else
    new.cobro_avisado_por := auth.uid(); new.cobro_avisado_en := now();   -- aviso nuevo o cambiado: lo firma quien lo hace
  end if;
  return new;
end;
$$;

-- Se llama «bonos_aviso_cobro» para que se ejecute antes que «bonos_confirma_pago» (orden alfabético).
drop trigger if exists bonos_aviso_cobro on public.bonos;
create trigger bonos_aviso_cobro before insert or update on public.bonos
  for each row execute function public.bonos_aviso_cobro_control();

notify pgrst, 'reload schema';

-- Comprobación: 4 columnas nuevas y el disparador creado.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'bonos'
     and column_name in ('cobro_avisado_el', 'cobro_avisado_metodo', 'cobro_avisado_por', 'cobro_avisado_en')) as columnas_nuevas,
  (select count(*) from pg_trigger where tgname = 'bonos_aviso_cobro' and not tgisinternal) as disparador;
