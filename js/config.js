// Configuración de la app. La anon key es pública por diseño: la seguridad
// la dan las políticas RLS de Supabase (sql/01_esquema.sql). NUNCA pongas aquí
// la service_role key.
export const SUPABASE_URL = 'https://itqxzzsunavobflqbbix.supabase.co';
export const SUPABASE_ANON_KEY = 'PEGA_AQUI_LA_ANON_KEY';

// El login es por usuario ("eduardo"); internamente Supabase Auth lo ve como
// eduardo@<LOGIN_DOMAIN>. Debe coincidir con los usuarios creados en Supabase.
export const LOGIN_DOMAIN = 'codek-ep.app';

export const DURACION_SESION_MIN = 60;
export const HORA_INICIO_CALENDARIO = 7;
export const HORA_FIN_CALENDARIO = 22;

// [sesiones al mes, €/sesión]: precios estándar, solo sugeridos (siempre editables).
export const TARIFAS_POR_HORA = [[4, 45], [8, 42], [12, 40], [16, 38], [40, 37]];
export const OPCIONES_BONO = [4, 8, 12, 16, 40];
