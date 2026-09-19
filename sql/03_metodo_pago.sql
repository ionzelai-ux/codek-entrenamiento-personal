-- ════════════════════════════════════════════════════════════════════════
-- 03 · MÉTODO DE PAGO en los bonos (efectivo / tarjeta / transferencia)
-- ════════════════════════════════════════════════════════════════════════
-- Solo hace falta si ya habías ejecutado 01_esquema.sql ANTES de esta versión.
-- (Las instalaciones nuevas ya lo traen en 01.) Se puede repetir sin problema.
-- Los bonos que ya existieran quedan con método vacío; los nuevos lo exigen la app.
-- ════════════════════════════════════════════════════════════════════════

alter table public.bonos
  add column if not exists metodo_pago text
  check (metodo_pago in ('efectivo', 'tarjeta', 'transferencia'));

notify pgrst, 'reload schema';

-- Comprobación: debe salir 1 fila.
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'bonos' and column_name = 'metodo_pago';
