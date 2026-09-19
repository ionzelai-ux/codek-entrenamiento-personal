// Capa de datos contra Supabase. La seguridad real está en las políticas RLS
// (sql/01_esquema.sql): aunque alguien manipule este código, la base de datos
// solo devuelve lo que ese usuario puede ver.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, LOGIN_DOMAIN } from './config.js';
import { nombreUsuario } from './logica.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function comprobar({ data, error }) {
  if (error) throw new Error(error.message || 'Error de base de datos');
  return data;
}
const hora = s => ({ ...s, hora: String(s.hora).slice(0, 5) });

// ── Sesión ────────────────────────────────────────────────────────────────
export async function iniciarSesion(usuario, clave) {
  const email = `${nombreUsuario(usuario)}@${LOGIN_DOMAIN}`;
  const { error } = await sb.auth.signInWithPassword({ email, password: clave });
  if (error) throw new Error('Usuario o contraseña incorrectos');
  return perfilActual();
}
export async function perfilActual() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const perfil = comprobar(await sb.from('perfiles').select('*').eq('id', session.user.id).maybeSingle());
  if (!perfil) {
    await sb.auth.signOut();
    throw new Error('Este usuario existe pero no tiene perfil. Ejecuta sql/02_usuarios.sql.');
  }
  return perfil;
}
export async function cerrarSesion() { await sb.auth.signOut(); }

// ── Entrenadores ──────────────────────────────────────────────────────────
export async function listarEntrenadores() {
  return comprobar(await sb.from('perfiles').select('*').eq('rol', 'entrenador').order('nombre'));
}

// ── Clientes (con bonos y sesiones para calcular créditos) ────────────────
export async function listarClientes() {
  const data = comprobar(await sb.from('clientes').select('*, bonos(*), sesiones(*)').order('nombre'));
  return data.map(c => ({ ...c, sesiones: (c.sesiones || []).map(hora) }));
}
export async function guardarCliente(c) {
  const { id, bonos, sesiones, ...campos } = c;
  const q = id ? sb.from('clientes').update(campos).eq('id', id) : sb.from('clientes').insert(campos);
  return comprobar(await q.select().single());
}
// La base de datos no da error si no tienes permiso para borrar: simplemente no borra nada.
// Por eso se comprueba que realmente se haya eliminado la fila.
export async function eliminarCliente(id) {
  const borradas = comprobar(await sb.from('clientes').delete().eq('id', id).select('id'));
  if (!borradas.length) throw new Error('No se ha podido eliminar la ficha. Solo el administrador puede borrar fichas.');
}

// ── Bonos ─────────────────────────────────────────────────────────────────
export async function crearBono(b) { return comprobar(await sb.from('bonos').insert(b).select().single()); }
export async function actualizarBono(id, cambios) {
  return comprobar(await sb.from('bonos').update(cambios).eq('id', id).select().single());
}
export async function eliminarBono(id) { comprobar(await sb.from('bonos').delete().eq('id', id)); }

// ── Sesiones ──────────────────────────────────────────────────────────────
export async function sesionesEntre(desde, hasta, entrenadorId = null) {
  let q = sb.from('sesiones')
    .select('*, clientes!inner(id, nombre, apellidos, entrenador_id)')
    .gte('fecha', desde).lte('fecha', hasta)
    .order('fecha').order('hora');
  if (entrenadorId) q = q.eq('clientes.entrenador_id', entrenadorId);
  return comprobar(await q).map(hora);
}
export async function crearSesiones(filas) { return comprobar(await sb.from('sesiones').insert(filas).select()); }
export async function actualizarSesion(id, cambios) {
  return comprobar(await sb.from('sesiones').update(cambios).eq('id', id).select().single());
}
export async function eliminarSesion(id) { comprobar(await sb.from('sesiones').delete().eq('id', id)); }
