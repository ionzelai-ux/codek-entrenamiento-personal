-- ════════════════════════════════════════════════════════════════════════
-- 11 · EXCLUIR BONOS DE LA LIQUIDACIÓN DE COMISIONES
-- ════════════════════════════════════════════════════════════════════════
-- Para circunstancias excepcionales (p. ej. el cliente no vino y hubo que contratar a otra persona):
-- un bono marcado como excluido no comisiona nada. Por defecto ninguno está excluido.
-- No hace falta ninguna política nueva: comisiones_bono ya es solo del administrador (sql/08).
-- Ejecutar en Supabase → SQL Editor, después de 10_lesiones.sql.
-- ════════════════════════════════════════════════════════════════════════

alter table public.comisiones_bono add column if not exists excluido boolean not null default false;

notify pgrst, 'reload schema';

-- Comprobación: debe salir la columna nueva.
select column_name, data_type, column_default from information_schema.columns
where table_schema = 'public' and table_name = 'comisiones_bono' and column_name = 'excluido';
