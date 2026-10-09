-- ════════════════════════════════════════════════════════════════════════
-- 17 · RENOVACIONES: «NO VA A RENOVAR» Y «CAMBIA DE BONO» PARA LA PREVISIÓN DE INGRESOS
-- ════════════════════════════════════════════════════════════════════════
-- Por defecto se da por hecho que todo cliente con bono renueva. Tres datos nuevos en la ficha del cliente:
--   · no_renueva            → true = no va a renovar: no se cuenta en la previsión de ingresos.
--   · proximo_bono_sesiones → si va a cambiar de bono (p. ej. de 4 a 8 sesiones), el nº de sesiones del siguiente.
--   · proximo_bono_precio   → su precio total. Los dos van juntos; vacíos = igual que el último bono.
-- Los puede cambiar el administrador y el entrenador de ese cliente (las políticas de clientes ya lo permiten).
-- Ejecutar en Supabase → SQL Editor. Se puede repetir sin problema.
-- ════════════════════════════════════════════════════════════════════════

alter table public.clientes add column if not exists no_renueva boolean not null default false;
alter table public.clientes add column if not exists proximo_bono_sesiones integer check (proximo_bono_sesiones > 0);
alter table public.clientes add column if not exists proximo_bono_precio numeric(9,2) check (proximo_bono_precio >= 0);

notify pgrst, 'reload schema';

-- Comprobación: deben salir las 3 columnas nuevas.
select count(*) as columnas_nuevas
from information_schema.columns
where table_schema = 'public' and table_name = 'clientes'
  and column_name in ('no_renueva', 'proximo_bono_sesiones', 'proximo_bono_precio');
