-- ════════════════════════════════════════════════════════════════════════
-- 10 · LESIONES / LIMITACIONES FÍSICAS DEL CLIENTE
-- ════════════════════════════════════════════════════════════════════════
-- Un campo de texto libre en cada ficha (potencial o cliente) para que el entrenador sepa,
-- antes de entrenar a alguien, si tiene alguna lesión o limitación de la que haya que avisar.
-- No hace falta ninguna política nueva: ya está cubierto por la seguridad de "clientes"
-- (sql/01_esquema.sql) — cada entrenador ve y edita el suyo, el admin ve todo.
-- Ejecutar en Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

alter table public.clientes add column if not exists lesiones text;

notify pgrst, 'reload schema';

-- Comprobación: debe salir la columna nueva.
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'clientes' and column_name = 'lesiones';
