-- ════════════════════════════════════════════════════════════════════════
-- 09 · QUÉ ENTRENADORES ENTRAN EN EL SISTEMA DE COMISIONES
-- ════════════════════════════════════════════════════════════════════════
-- Añade a cada perfil si participa en la pestaña "Comisiones" (por defecto sí; se puede
-- desactivar por entrenador, p. ej. mientras no haya acuerdo de comisión con él). Un entrenador
-- desactivado sigue funcionando con normalidad en todo lo demás (calendario, clientes, cobros):
-- solo desaparece de la liquidación de comisiones.
-- Ejecutar en Supabase → SQL Editor, después de 08_comisiones.sql.
-- ════════════════════════════════════════════════════════════════════════

alter table public.perfiles add column if not exists aplica_comisiones boolean not null default true;

update public.perfiles set aplica_comisiones = false where usuario = 'jesus';

notify pgrst, 'reload schema';

-- Comprobación: quién entra en comisiones ahora mismo.
select usuario, nombre, rol, aplica_comisiones from public.perfiles order by rol, usuario;
