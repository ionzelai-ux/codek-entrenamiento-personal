// Lógica pura (sin DOM ni red): fechas, créditos, tarifas, generación de sesiones,
// solapes y resúmenes. Se prueba con `node --test tests/`.
import { TARIFAS_POR_HORA, DURACION_SESION_MIN } from './config.js';

const pad = n => String(n).padStart(2, '0');

// ── Fechas (siempre locales, formato YYYY-MM-DD) ──────────────────────────
export function fechaISO(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export const hoyISO = () => fechaISO(new Date());
export function parseISO(iso) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
export function addDias(iso, n) { const d = parseISO(iso); d.setDate(d.getDate() + n); return fechaISO(d); }
export function diaSemana(iso) { const g = parseISO(iso).getDay(); return g === 0 ? 7 : g; } // 1=lunes … 7=domingo
export function lunesDe(iso) { return addDias(iso, 1 - diaSemana(iso)); }
export function primerDiaMes(iso, n = 0) { const d = parseISO(iso); d.setDate(1); d.setMonth(d.getMonth() + n); return fechaISO(d); }
export function ultimoDiaMes(iso) { const d = parseISO(iso); return fechaISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
export const horaAMin = h => { const [a, b] = String(h).split(':').map(Number); return a * 60 + (b || 0); };
export const minAHora = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export function edad(iso, hoy = hoyISO()) {
  if (!iso) return null;
  const n = parseISO(iso), h = parseISO(hoy);
  let e = h.getFullYear() - n.getFullYear();
  if (h.getMonth() < n.getMonth() || (h.getMonth() === n.getMonth() && h.getDate() < n.getDate())) e--;
  return e;
}
export const normalizaUsuario = u => String(u).normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, '');
// Acepta "eduardo" o "eduardo@cualquier.cosa" y se queda con la parte del usuario.
export const nombreUsuario = u => normalizaUsuario(u).split('@')[0];

// ── Tarifas ───────────────────────────────────────────────────────────────
export function precioHoraSugerido(n) {
  let p = TARIFAS_POR_HORA[0][1];
  for (const [s, pr] of TARIFAS_POR_HORA) if (n >= s) p = pr;
  return p;
}
export function precioBonoSugerido(n) {
  n = Number(n);
  return n > 0 ? Math.round(n * precioHoraSugerido(n) * 100) / 100 : 0;
}

// ── Sesiones y créditos ───────────────────────────────────────────────────
export function finSesion(s) {
  const d = parseISO(s.fecha);
  d.setHours(0, horaAMin(s.hora) + (s.duracion_min || DURACION_SESION_MIN), 0, 0);
  return d;
}
// Una reserva cuya hora ya pasó y nadie confirmó cuenta como "auto" (consume crédito).
export function estadoEfectivo(s, ahora = new Date()) {
  return s.estado === 'reservada' && finSesion(s) < ahora ? 'auto' : s.estado;
}
export const ocupaCredito = e => e === 'reservada' || e === 'hecha' || e === 'auto';

export function creditos(cliente, ahora = new Date()) {
  const total = (cliente.bonos || []).reduce((t, b) => t + (Number(b.sesiones) || 0), 0);
  let hechas = 0, reservadas = 0, noVino = 0;
  for (const s of cliente.sesiones || []) {
    const e = estadoEfectivo(s, ahora);
    if (e === 'hecha' || e === 'auto') hechas++;
    else if (e === 'reservada') reservadas++;
    else if (e === 'no_vino') noVino++;
  }
  const restantes = Math.max(0, total - hechas);
  return { total, hechas, reservadas, noVino, restantes, libres: restantes - reservadas };
}

// Estado de pago de un bono: 'pagado' solo si el administrador lo confirmó (pagado_el);
// si no, 'pendiente' cuando su fecha de pago es hoy o ya pasó, y 'programado' cuando es futura.
export const estadoPago = (bono, hoy = hoyISO()) => (bono.pagado_el ? 'pagado' : bono.fecha_pago <= hoy ? 'pendiente' : 'programado');

export const UMBRAL_RENOVAR = 2;   // con tantas sesiones o menos (y nada más por cobrar) toca renovar

// Situación de cobro de un cliente (para la lista): la primera que se cumpla de
//   pendiente (algún bono vencido sin confirmar) → programado (próximo pago) → renovar (quedan pocas sesiones) → pagado.
// Devuelve null para los potenciales. `importe` y `fecha` son los del bono que interesa en cada caso.
export function estadoCobro(cliente, hoy = hoyISO(), ahora = new Date()) {
  if (cliente.estado !== 'efectivo') return null;
  const bonos = [...(cliente.bonos || [])].sort((a, b) => a.fecha_pago.localeCompare(b.fecha_pago));
  if (!bonos.length) return { clave: 'sin_bono', importe: 0, fecha: null, n: 0, bonos: [] };
  const suma = l => Math.round(l.reduce((t, b) => t + (Number(b.precio) || 0), 0) * 100) / 100;
  const pendientes = bonos.filter(b => estadoPago(b, hoy) === 'pendiente');
  if (pendientes.length) return { clave: 'pendiente', importe: suma(pendientes), fecha: pendientes[0].fecha_pago, n: pendientes.length, bonos: pendientes };
  const programados = bonos.filter(b => estadoPago(b, hoy) === 'programado');
  if (programados.length) return { clave: 'programado', importe: suma([programados[0]]), fecha: programados[0].fecha_pago, n: programados.length, bonos: programados };
  const ultimo = bonos[bonos.length - 1];
  const clave = creditos(cliente, ahora).restantes <= UMBRAL_RENOVAR ? 'renovar' : 'pagado';
  return { clave, importe: Number(ultimo.precio) || 0, fecha: ultimo.fecha_pago, n: 0, bonos: [ultimo] };
}

// ── Solapes ───────────────────────────────────────────────────────────────
export function solapan(a, b) {
  if (a.fecha !== b.fecha) return false;
  const a0 = horaAMin(a.hora), a1 = a0 + (a.duracion_min || DURACION_SESION_MIN);
  const b0 = horaAMin(b.hora), b1 = b0 + (b.duracion_min || DURACION_SESION_MIN);
  return a0 < b1 && b0 < a1;
}
export function buscarConflictos(nueva, existentes, ignorarId = null) {
  return existentes.filter(e => e.id !== ignorarId && e.estado !== 'no_vino' && solapan(nueva, e));
}

// ── Generación de sesiones a partir de días fijos ─────────────────────────
// dias: [{dia: 1..7, hora: 'HH:MM'}]. Devuelve `cantidad` fechas a partir de `desde` (incluida).
export function generarFechas({ desde, dias, cantidad }) {
  const validos = (dias || []).filter(d => d.dia >= 1 && d.dia <= 7 && d.hora)
    .sort((a, b) => a.dia - b.dia || a.hora.localeCompare(b.hora));
  const out = [];
  if (!validos.length || !(cantidad >= 1) || !desde) return out;
  let f = desde;
  for (let i = 0; i < 800 && out.length < cantidad; i++, f = addDias(f, 1)) {
    const ds = diaSemana(f);
    for (const d of validos) if (d.dia === ds && out.length < cantidad) out.push({ fecha: f, hora: d.hora });
  }
  return out;
}

// ── Calendario semanal: reparte bloques solapados en carriles ─────────────
// items: [{ini, fin, ...}] en minutos. Añade `lane` y `lanes` a cada item.
export function repartirCarriles(items) {
  const orden = [...items].sort((a, b) => a.ini - b.ini || a.fin - b.fin);
  const res = [];
  let grupo = [], carriles = [], finGrupo = -Infinity;
  const cerrar = () => {
    const n = Math.max(...grupo.map(g => g.lane)) + 1;
    grupo.forEach(g => { g.lanes = n; });
    res.push(...grupo);
    grupo = []; carriles = []; finGrupo = -Infinity;
  };
  for (const it of orden) {
    if (grupo.length && it.ini >= finGrupo) cerrar();
    let lane = carriles.findIndex(f => f <= it.ini);
    if (lane < 0) { lane = carriles.length; carriles.push(it.fin); } else carriles[lane] = it.fin;
    it.lane = lane;
    grupo.push(it);
    finGrupo = Math.max(finGrupo, it.fin);
  }
  if (grupo.length) cerrar();
  return res;
}

// ── Ficha completa o con información pendiente ────────────────────────────
// Devuelve las etiquetas de lo que aún falta. Los campos OBLIGATORIOS (nombre, teléfono,
// tipo, origen, y el dinero) los exige el formulario; aquí se cuenta también lo deseable.
// Los días fijos y las notas son opcionales y no cuentan.
export function camposPendientes(c) {
  const lleno = x => x !== null && x !== undefined && String(x).trim() !== '';
  const falta = [];
  if (!lleno(c.apellidos)) falta.push('apellidos');
  if (!lleno(c.telefono)) falta.push('teléfono');
  if (!lleno(c.email)) falta.push('email');
  if (!lleno(c.fecha_nacimiento)) falta.push('fecha de nacimiento');
  if (c.estado === 'potencial') {
    if (!(c.pot_sesiones_bono > 0)) falta.push('sesiones que quiere');
    if (!(c.pot_veces_semana > 0)) falta.push('veces por semana');
    if (!(c.pot_precio > 0)) falta.push('importe estimado');
  } else {
    const bonos = c.bonos || [];
    if (!bonos.length) falta.push('bono');
    else if (bonos.some(b => !b.metodo_pago)) falta.push('método de pago');
  }
  return falta;
}

// ── Resumen de facturación ────────────────────────────────────────────────
// mes = 'YYYY-MM' (el mes se toma de la fecha de pago del bono). cobrado = confirmado como pagado por el
// administrador; pendiente = fecha de pago ya llegada pero sin confirmar; programado = fecha de pago futura;
// estimado = pipeline de potenciales activos.
export function agrupar(clientes, clave, mes, hoy = hoyISO()) {
  const g = new Map();
  for (const c of clientes) {
    const k = clave(c);
    if (!g.has(k)) g.set(k, { efectivos: 0, potenciales: 0, cobrado: 0, pendiente: 0, programado: 0, estimado: 0 });
    const r = g.get(k);
    if (c.activo) {
      if (c.estado === 'efectivo') r.efectivos++;
      else { r.potenciales++; r.estimado += Number(c.pot_precio) || 0; }
    }
    for (const b of c.bonos || []) {
      if (String(b.fecha_pago).slice(0, 7) !== mes) continue;
      const e = estadoPago(b, hoy);
      r[e === 'pagado' ? 'cobrado' : e] += Number(b.precio) || 0;
    }
  }
  return g;
}
export function sumar(filas) {
  const t = { efectivos: 0, potenciales: 0, cobrado: 0, pendiente: 0, programado: 0, estimado: 0 };
  for (const r of filas) for (const k of Object.keys(t)) t[k] += r[k];
  return t;
}

// Facturación prevista de un mes ('YYYY-MM') según las fechas de pago de los bonos: total, desglose por
// estado (pagado / pendiente / programado) y la lista de bonos ordenada por fecha de pago.
export function facturacionMes(clientes, mes, hoy = hoyISO()) {
  const t = { total: 0, pagado: 0, pendiente: 0, programado: 0 };
  const filas = [];
  for (const c of clientes) {
    for (const b of c.bonos || []) {
      if (String(b.fecha_pago).slice(0, 7) !== mes) continue;
      const estado = estadoPago(b, hoy), importe = Number(b.precio) || 0;
      t.total += importe; t[estado] += importe;
      filas.push({ cliente: c, bono: b, estado, importe });
    }
  }
  filas.sort((a, b) => a.bono.fecha_pago.localeCompare(b.bono.fecha_pago));
  for (const k of Object.keys(t)) t[k] = Math.round(t[k] * 100) / 100;
  return { mes, ...t, filas };
}
