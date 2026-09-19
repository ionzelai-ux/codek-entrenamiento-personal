-- ════════════════════════════════════════════════════════════════════════
-- 00 · LIMPIAR EL PROYECTO (solo para reutilizar "PROGRESO CODEK")
-- ════════════════════════════════════════════════════════════════════════
-- ⚠️  DESTRUCTIVO: borra TODAS las tablas, funciones y datos del esquema
--     "public" de este proyecto. No se puede deshacer.
--     Ejecútalo SOLO si has mirado Table Editor y no hay nada que quieras
--     conservar. No toca los usuarios de Authentication (revísalos aparte).
-- ════════════════════════════════════════════════════════════════════════

drop schema if exists public cascade;
create schema public;

grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on schema public to postgres, service_role;

alter default privileges in schema public grant all on tables to postgres, service_role;
alter default privileges in schema public grant all on functions to postgres, service_role;
alter default privileges in schema public grant all on sequences to postgres, service_role;
