-- ════════════════════════════════════════════════════════════════════════
-- 07 · CONTROL DE PAGOS DE LOS BONOS
-- ════════════════════════════════════════════════════════════════════════
-- Añade a cada bono la fecha en la que el administrador confirmó el cobro (`pagado_el`).
--   · pagado_el vacío + fecha de pago futura   → pago programado
--   · pagado_el vacío + fecha de pago de hoy o pasada → PENDIENTE DE PAGO
--   · pagado_el con fecha                      → pagado
-- Todos los bonos que ya existen quedan sin confirmar (pendientes): el administrador los marca a mano.
-- Solo el administrador puede poner o quitar esa fecha (lo impone un disparador en la base de datos,
-- no solo la pantalla). Ejecutar en Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

alter table public.bonos add column if not exists pagado_el date;

create or replace function public.bonos_solo_admin_confirma_pago() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  -- auth.uid() es nulo cuando se ejecuta desde el editor SQL o con la clave de servicio: se permite.
  if auth.uid() is not null and not public.es_admin() then
    if tg_op = 'INSERT' and new.pagado_el is not null then
      raise exception 'Solo el administrador puede marcar un bono como pagado';
    end if;
    if tg_op = 'UPDATE' and new.pagado_el is distinct from old.pagado_el then
      raise exception 'Solo el administrador puede cambiar el estado de pago de un bono';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bonos_confirma_pago on public.bonos;
create trigger bonos_confirma_pago before insert or update on public.bonos
  for each row execute function public.bonos_solo_admin_confirma_pago();

notify pgrst, 'reload schema';

-- Comprobación: debe salir 1 fila con la columna y 1 disparador.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'bonos' and column_name = 'pagado_el') as columna,
  (select count(*) from pg_trigger where tgname = 'bonos_confirma_pago' and not tgisinternal) as disparador,
  (select count(*) from public.bonos where pagado_el is null) as bonos_pendientes_de_confirmar;
