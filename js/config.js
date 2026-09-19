// Configuración de la app. La anon key es pública por diseño: la seguridad
// la dan las políticas RLS de Supabase (sql/01_esquema.sql). NUNCA pongas aquí
// la service_role key.
export const SUPABASE_URL = 'https://itqxzzsunavobflqbbix.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0cXh6enN1bmF2b2JmbHFiYml4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTg4MTcsImV4cCI6MjA5Mjg5NDgxN30.FVjN6PIDRPtd2vJ5VrdBR2xakDJV_J7kG7aCH7OpcaI';

// El login es por usuario ("eduardo"); internamente Supabase Auth lo ve como
// eduardo@<LOGIN_DOMAIN>. Debe coincidir con los usuarios creados en Supabase.
export const LOGIN_DOMAIN = 'codek-ep.app';

export const DURACION_SESION_MIN = 60;
export const HORA_INICIO_CALENDARIO = 7;
export const HORA_FIN_CALENDARIO = 22;

// [sesiones al mes, €/sesión]: precios estándar, solo sugeridos (siempre editables).
export const TARIFAS_POR_HORA = [[4, 45], [8, 42], [12, 40], [16, 38], [40, 37]];
export const OPCIONES_BONO = [4, 8, 12, 16, 40];
