-- ════════════════════════════════════════════════════════════════════════
-- 16 · AJUSTES MANUALES DE COMISIONES: PERMITIR IMPORTES NEGATIVOS
-- ════════════════════════════════════════════════════════════════════════
-- Un ajuste manual puede restar (p. ej. 8 clases × −7 € = −56 €). Hasta ahora la base de datos rechazaba clases y precio por
-- clase negativos, así que la pantalla los sumaba pero no se guardaban. Se quitan esas dos restricciones, en las dos tablas:
--   · comisiones_manual (líneas sueltas): clases y precio
--   · comisiones_bono (bonos excluidos): manual_clases y manual_precio
-- El % de comisión sigue entre 0 y 100. Ejecutar en Supabase → SQL Editor. Se puede repetir sin problema.
-- ════════════════════════════════════════════════════════════════════════

do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass as tabla, c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'c'
      and c.conrelid in ('public.comisiones_manual'::regclass, 'public.comisiones_bono'::regclass)
      and a.attname in ('clases', 'precio', 'manual_clases', 'manual_precio')
      and array_length(c.conkey, 1) = 1
  loop
    execute format('alter table %s drop constraint %I', r.tabla, r.conname);
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Comprobación: debe salir 0 restricciones sobre clases/precio y 2 sobre el % (una por tabla).
select
  (select count(*)
     from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'c' and array_length(c.conkey, 1) = 1
      and c.conrelid in ('public.comisiones_manual'::regclass, 'public.comisiones_bono'::regclass)
      and a.attname in ('clases', 'precio', 'manual_clases', 'manual_precio')) as restricciones_clases_precio,
  (select count(*)
     from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.contype = 'c' and array_length(c.conkey, 1) = 1
      and c.conrelid in ('public.comisiones_manual'::regclass, 'public.comisiones_bono'::regclass)
      and a.attname in ('pct', 'manual_pct')) as restricciones_pct;
