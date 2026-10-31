-- ════════════════════════════════════════════════════════════════════════
-- 22 · CLIENTES EN PAUSA (enfermedad, baja, viaje…): no cuentan en las previsiones
-- ════════════════════════════════════════════════════════════════════════
-- Un cliente en pausa sigue en la lista (no se archiva ni se pierde nada), pero NO entra en la previsión de ingresos:
-- ni su renovación prevista, ni sus pagos programados, ni el «estimado» si es potencial.
-- Cuatro datos nuevos en la ficha:
--   · pausado      → true = en pausa.
--   · pausa_motivo → por qué (p. ej. «enferma», «de baja»).
--   · pausa_desde  → desde cuándo (por defecto, el día en que se pausa).
--   · pausa_hasta  → día en que vuelve (opcional): ese día se reanuda solo. Vacío = hasta que se reanude a mano.
-- Los puede cambiar el administrador y el entrenador de ese cliente (las políticas de clientes ya lo permiten).
-- Ejecutar en Supabase → SQL Editor. Se puede repetir sin problema.
-- ════════════════════════════════════════════════════════════════════════

alter table public.clientes add column if not exists pausado      boolean not null default false;
alter table public.clientes add column if not exists pausa_motivo text    not null default '';
alter table public.clientes add column if not exists pausa_desde  date;
alter table public.clientes add column if not exists pausa_hasta  date;

notify pgrst, 'reload schema';

-- Comprobación: deben salir las 4 columnas nuevas.
select count(*) as columnas_nuevas
from information_schema.columns
where table_schema = 'public' and table_name = 'clientes'
  and column_name in ('pausado', 'pausa_motivo', 'pausa_desde', 'pausa_hasta');
