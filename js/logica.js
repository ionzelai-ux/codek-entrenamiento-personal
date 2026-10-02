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
  // sinBono: sesiones ya hechas que ningún bono cubre (restantes se queda en 0 y escondería este descuadre)
  return { total, hechas, reservadas, noVino, restantes, libres: restantes - reservadas, sinBono: Math.max(0, hechas - total) };
}

// Cuánto lleva gastado cada bono: las sesiones hechas se reparten por orden entre los bonos (el más antiguo
// primero). Lo que no cabe en ninguno es `sinBono`. Devuelve { porBono: Map(id → {usadas, total}), sinBono }.
export function consumoPorBono(cliente, ahora = new Date()) {
  const bonos = [...(cliente.bonos || [])].sort((a, b) =>
    String(a.fecha_inicio || '').localeCompare(String(b.fecha_inicio || '')) || String(a.fecha_pago || '').localeCompare(String(b.fecha_pago || '')));
  let pendientes = (cliente.sesiones || []).filter(s => { const e = estadoEfectivo(s, ahora); return e === 'hecha' || e === 'auto'; }).length;
  const porBono = new Map();
  for (const b of bonos) {
    const total = Number(b.sesiones) || 0, usadas = Math.min(total, pendientes);
    pendientes -= usadas;
    porBono.set(b.id, { usadas, total });
  }
  return { porBono, sinBono: pendientes };
}

// Lo que costaría cada sesión según su último bono (precio ÷ sesiones); null si no tiene ningún bono.
export function precioSesionEstimado(cliente) {
  const ultimo = [...(cliente.bonos || [])].sort((a, b) => String(a.fecha_pago).localeCompare(String(b.fecha_pago))).pop();
  const n = Number(ultimo?.sesiones) || 0;
  return ultimo && n > 0 ? (Number(ultimo.precio) || 0) / n : null;
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

// ── Cambio de horario en bloque ───────────────────────────────────────────
// Sesiones de un cliente que todavía se pueden mover: las reservadas cuya hora no ha pasado.
export function sesionesCambiables(cliente, ahora = new Date()) {
  return (cliente.sesiones || []).filter(s => estadoEfectivo(s, ahora) === 'reservada')
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
}

// cambio = { modo: 'desplazar', minutos } (negativo = antes) o { modo: 'fijar', hora: 'HH:MM' }.
// Devuelve la hora nueva 'HH:MM', o null si no es válida o se sale del día (antes de 00:00 / pasada la medianoche).
export function horaNueva(hora, cambio) {
  let m;
  if (cambio?.modo === 'fijar') {
    if (!/^\d{1,2}:\d{2}$/.test(cambio.hora || '')) return null;
    m = horaAMin(cambio.hora);
  } else {
    const d = Number(cambio?.minutos);
    if (!Number.isFinite(d)) return null;
    m = horaAMin(hora) + d;
  }
  return m >= 0 && m < 24 * 60 ? minAHora(m) : null;
}

// Vista previa del cambio: para cada sesión candidata, su hora nueva y con qué otras sesiones del
// entrenador chocaría. `marcadas` = ids que se van a cambiar de verdad: sus huecos actuales quedan libres,
// así que no cuentan como choque; las que se dejan sin tocar sí.
export function planCambioHorario(candidatas, marcadas, cambio, existentes = []) {
  const quedan = existentes.filter(e => !marcadas.has(e.id));
  return candidatas.map(s => {
    const despues = horaNueva(s.hora, cambio);
    const conflictos = despues && marcadas.has(s.id)
      ? buscarConflictos({ fecha: s.fecha, hora: despues, duracion_min: s.duracion_min }, quedan) : [];
    return { sesion: s, hora_antes: s.hora, hora_despues: despues, conflictos };
  });
}

// Días fijos con la hora nueva: solo cambian los que coinciden con una sesión movida (mismo día de la
// semana y misma hora de antes). cambios = [{ fecha, hora_antes, hora_despues }].
export function diasFijosActualizados(dias, cambios) {
  const mapa = new Map();
  for (const c of cambios) {
    if (c.hora_despues && c.hora_despues !== c.hora_antes) mapa.set(`${diaSemana(c.fecha)}|${c.hora_antes}`, c.hora_despues);
  }
  return (dias || []).map(d => (mapa.has(`${d.dia}|${d.hora}`) ? { ...d, hora: mapa.get(`${d.dia}|${d.hora}`) } : d));
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
// Los días fijos y las notas son opcionales y no cuentan. Las lesiones sí cuentan (aunque sea
// para escribir "Ninguna"): antes de entrenar a alguien conviene saberlo con seguridad.
export function camposPendientes(c) {
  const lleno = x => x !== null && x !== undefined && String(x).trim() !== '';
  const falta = [];
  if (!lleno(c.apellidos)) falta.push('apellidos');
  if (!lleno(c.telefono)) falta.push('teléfono');
  if (!lleno(c.email)) falta.push('email');
  if (!lleno(c.fecha_nacimiento)) falta.push('fecha de nacimiento');
  if (!lleno(c.lesiones)) falta.push('lesiones o molestias');
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

// ── Revisión de datos ─────────────────────────────────────────────────────
// Busca incoherencias que hacen que las cifras no se puedan creer a ciegas. Cada incidencia lleva un nivel:
//   alta  = el dinero o las sesiones no cuadran (hay que corregirlo)
//   media = conviene revisarlo
//   info  = dato aproximado o incompleto
const fmtF = iso => String(iso).split('-').reverse().join('/');
const fmtE = n => Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const NIVEL = { alta: 0, media: 1, info: 2 };
const NOTA_HORA = 'Hora no registrada';

export function incidenciasCliente(c, ahora = new Date()) {
  const out = [];
  const nueva = (nivel, clave, texto) => out.push({ nivel, clave, texto });
  const sesiones = c.sesiones || [], bonos = c.bonos || [];
  const cr = creditos(c, ahora);
  const estados = sesiones.map(s => ({ s, e: estadoEfectivo(s, ahora) }));
  const conSesion = estados.filter(x => x.e !== 'no_vino');

  if (c.estado === 'potencial') {
    if (conSesion.length || bonos.length) nueva('media', 'potencial_con_datos', 'Está como potencial pero ya tiene sesiones o bonos: ¿falta convertirlo en cliente?');
    return out;
  }
  if (!bonos.length) {
    if (conSesion.length) nueva('alta', 'sesiones_sin_bono', `Tiene ${plural(conSesion.length, 'sesión', 'sesiones')} (${plural(cr.hechas, 'hecha', 'hechas')}) y ningún bono registrado: no consta qué se le ha cobrado.`);
    else nueva('media', 'sin_bono', 'Es cliente pero no tiene ningún bono.');
  } else {
    if (cr.sinBono > 0) {
      const p = precioSesionEstimado(c);
      nueva('alta', 'sesiones_sin_bono', `Ha hecho ${cr.hechas} sesiones y sus bonos suman ${cr.total}: ${plural(cr.sinBono, 'sesión', 'sesiones')} sin bono${p ? ` (≈ ${fmtE(cr.sinBono * p)} a ${fmtE(p)}/sesión)` : ''}.`);
    }
    if (cr.libres < 0) {
      const de = -cr.libres;
      nueva('media', 'reservadas_de_mas', `${plural(de, 'sesión reservada', 'sesiones reservadas')} sin crédito en el bono${cr.restantes === 0 ? ' (bono agotado)' : ''}.`);
    }
    const sinMetodo = bonos.filter(b => !b.metodo_pago).length;
    if (sinMetodo) nueva('info', 'bono_sin_metodo', `${plural(sinMetodo, 'bono', 'bonos')} sin método de pago.`);
  }
  const auto = estados.filter(x => x.e === 'auto').map(x => x.s).sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (auto.length) {
    const ejemplo = auto.slice(-3).map(s => fmtF(s.fecha).slice(0, 5)).join(', ');
    nueva('media', 'sin_confirmar', `${plural(auto.length, 'reserva pasada sin confirmar', 'reservas pasadas sin confirmar')} (${ejemplo}): cuentan como hechas; confírmalas o márcalas «No vino».`);
  }
  const vistas = new Map();
  for (const { s } of conSesion) { const k = `${s.fecha} ${s.hora}`; vistas.set(k, (vistas.get(k) || 0) + 1); }
  const duplicadas = [...vistas].filter(([, n]) => n > 1).map(([k]) => k);
  if (duplicadas.length) nueva('alta', 'duplicadas', `Sesiones repetidas el mismo día y hora: ${duplicadas.slice(0, 3).map(k => `${fmtF(k.slice(0, 10))} ${k.slice(11)}`).join(', ')}. ¿Se contaron dos veces?`);
  const aprox = sesiones.filter(s => s.nota === NOTA_HORA).length;
  if (aprox) nueva('info', 'hora_aproximada', `${plural(aprox, 'sesión', 'sesiones')} con la hora sin registrar (aparecen a las 10:00 como aproximación).`);
  return out;
}

// Solapes de un mismo entrenador entre sesiones con hora fiable. Devuelve [{ a, b }] (parejas de sesiones con su cliente).
export function solapesEntrenadores(clientes) {
  const porEntr = new Map();
  for (const c of clientes) {
    for (const s of c.sesiones || []) {
      if (s.estado === 'no_vino' || s.nota === NOTA_HORA) continue;
      if (!porEntr.has(c.entrenador_id)) porEntr.set(c.entrenador_id, []);
      porEntr.get(c.entrenador_id).push({ ...s, cliente: c });
    }
  }
  const res = [];
  for (const lista of porEntr.values()) {
    lista.sort((x, y) => x.fecha.localeCompare(y.fecha) || x.hora.localeCompare(y.hora));
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length && lista[j].fecha === lista[i].fecha; j++) {
        if (lista[i].cliente.id !== lista[j].cliente.id && solapan(lista[i], lista[j])) res.push({ a: lista[i], b: lista[j] });
      }
    }
  }
  return res;
}

// Revisión de todos los clientes (activos): [{ cliente, incidencias }] con lo más grave primero.
export function revisionDatos(clientes, ahora = new Date()) {
  const activos = clientes.filter(c => c.activo !== false);
  const mapa = new Map(activos.map(c => [c.id, incidenciasCliente(c, ahora)]));
  const nombre = c => `${c.nombre} ${c.apellidos || ''}`.trim();
  for (const { a, b } of solapesEntrenadores(activos)) {
    for (const [x, y] of [[a, b], [b, a]]) {
      mapa.get(x.cliente.id)?.push({ nivel: 'media', clave: 'solape', texto: `Coincide con ${nombre(y.cliente)} el ${fmtF(x.fecha)} a las ${y.hora} (mismo entrenador).` });
    }
  }
  return activos.map(c => ({ cliente: c, incidencias: mapa.get(c.id).sort((p, q) => NIVEL[p.nivel] - NIVEL[q.nivel]) }))
    .filter(r => r.incidencias.length)
    .sort((p, q) => NIVEL[p.incidencias[0].nivel] - NIVEL[q.incidencias[0].nivel] || nombre(p.cliente).localeCompare(nombre(q.cliente), 'es'));
}

// Para el aviso rápido en la lista de clientes: si lo que hay escrito dice básicamente "no tiene",
// no hace falta destacarlo con un chip de alarma (sí se sigue mostrando tal cual dentro de la ficha).
const SIN_LESION = /^(ningun[ao]s?|no|nada|sin lesiones?|sin lesión)\.?$/i;
export const tieneLesionActiva = lesiones => {
  const t = String(lesiones ?? '').trim();
  return t !== '' && !SIN_LESION.test(t);
};

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

// Cómo se llama un mes ('YYYY-MM') respecto a hoy, para las tarjetas de facturación: «ESTE MES»,
// «MES SIGUIENTE», «MES PASADO» o nada si está más lejos.
export function etiquetaMes(mes, hoy = hoyISO()) {
  const n = m => { const [y, mm] = m.split('-').map(Number); return y * 12 + mm; };
  const d = n(mes) - n(hoy.slice(0, 7));
  return d === 0 ? 'ESTE MES' : d === 1 ? 'MES SIGUIENTE' : d === -1 ? 'MES PASADO' : '';
}

// ── Liquidación de comisiones de los entrenadores ─────────────────────────
// Condiciones pactadas con Jon (editables desde la pantalla, se guardan en comisiones_config):
//   · % de comisión sobre el importe del bono: uno si el cliente es de origen Codek, otro si lo trajo el
//     propio entrenador ("externo").
//   · Si el pago del cliente está declarado (fiscalmente, como tarjeta/transferencia), antes se le quita el
//     IVA: importe ÷ (1 + iva/100). Ojo: es una DIVISIÓN (para sacar la base de un importe que YA lleva el
//     IVA dentro), no "quitar el 21%" multiplicando por 0,79 — son cálculos distintos.
//   · Si a el entrenador se le va a pagar por nómina, se hace la misma división con el % de Seguridad Social,
//     sobre lo que quede tras el paso anterior (en cascada, no sobre el importe original).
//   · El % de comisión se aplica al final, sobre la base ya reducida.
export const DEFAULT_CONFIG_COMISIONES = { comision_codek: 40, comision_externo: 60, iva_pct: 21, ss_pct: 35 };

// Por defecto se considera "declarado" (tarjeta o transferencia) salvo que se indique lo contrario a mano;
// un pago en efectivo empieza como "no declarado", pero Jon puede marcarlo como declarado igualmente
// (porque piensa declararlo aunque el cliente pagara en mano).
export const esDeclaradoPorDefecto = metodoPago => metodoPago === 'tarjeta' || metodoPago === 'transferencia';

// Importe sobre el que se aplica el % de comisión, tras los descuentos en cascada (IVA si está declarado y
// después Seguridad Social si se paga en nómina). Lo comparten los bonos y las líneas manuales.
function baseTrasDescuentos(importe, declarado, pagoEntrenador, config) {
  let base = importe;
  if (declarado) base = base / (1 + (Number(config.iva_pct) || 0) / 100);
  if (pagoEntrenador === 'nomina') base = base / (1 + (Number(config.ss_pct) || 0) / 100);
  return base;
}

// `override` = { declarado, pago_entrenador } guardado a mano para ESE bono (o null si no se ha tocado).
export function comisionBono(bono, origen, config, override = null) {
  const declarado = override?.declarado ?? esDeclaradoPorDefecto(bono.metodo_pago);
  const pagoEntrenador = override?.pago_entrenador || 'efectivo';
  const base = baseTrasDescuentos(Number(bono.precio) || 0, declarado, pagoEntrenador, config);
  const pct = origen === 'codek' ? Number(config.comision_codek) || 0 : Number(config.comision_externo) || 0;
  // Excluido a mano de la liquidación (circunstancias excepcionales, p. ej. no vino y hubo que contratar a otra
  // persona): no comisiona nada, pero se sigue viendo la fila para poder volver a incluirla.
  const excluido = !!override?.excluido;
  return { declarado, pagoEntrenador, pct, base, excluido, comision: excluido ? 0 : base * (pct / 100) };
}

// Bonos que se liquidan en `mes` ('YYYY-MM'): los que Jon confirmó como pagados con esa fecha
// (bono.pagado_el), no la fecha de pago prevista — se liquida sobre dinero ya cobrado de verdad.
export function bonosLiquidablesMes(clientes, mes) {
  const filas = [];
  for (const c of clientes) {
    for (const b of c.bonos || []) {
      if (b.pagado_el && String(b.pagado_el).slice(0, 7) === mes) filas.push({ cliente: c, bono: b });
    }
  }
  const nombreCli = c => `${c.nombre} ${c.apellidos || ''}`.trim();   // evita depender de store.js (circular)
  filas.sort((a, b) => a.bono.pagado_el.localeCompare(b.bono.pagado_el) || nombreCli(a.cliente).localeCompare(nombreCli(b.cliente), 'es'));
  return filas;
}

// `overridesPorBono` = { [bono_id]: { declarado, pago_entrenador } }
export function liquidacionMes(clientes, mes, config, overridesPorBono = {}) {
  return bonosLiquidablesMes(clientes, mes).map(({ cliente, bono }) => ({
    cliente, bono, ...comisionBono(bono, cliente.origen, config, overridesPorBono[bono.id] || null),
  }));
}

// Ajuste manual de una comisión (bono excluido o línea suelta): importe = clases que ha dado × precio por clase,
// y de ahí el mismo cálculo en cascada que un bono. `pct` vacío = el del origen (Codek / externo).
//   l = { clases, precio, pct, origen, declarado, pago_entrenador }
export function comisionManual(l, config) {
  const num = x => { const n = Number(x); return Number.isFinite(n) ? n : 0; };   // vacío / null / texto raro → 0
  const importe = num(l.clases) * num(l.precio);
  const pctDefecto = l.origen === 'codek' ? num(config.comision_codek) : num(config.comision_externo);
  const pct = l.pct === null || l.pct === undefined || l.pct === '' ? pctDefecto : num(l.pct);
  const declarado = !!l.declarado, pagoEntrenador = l.pago_entrenador || 'efectivo';
  const base = baseTrasDescuentos(importe, declarado, pagoEntrenador, config);
  return { importe, pct, pctDefecto, declarado, pagoEntrenador, base, comision: base * (pct / 100) };
}

// Líneas de «Ajustes manuales» de un mes: los bonos excluidos de `filas` (su ajuste se guarda en el override del
// bono: manual_clases, manual_precio, manual_pct) y las líneas libres de ese mes (`libres`, tabla comisiones_manual).
export function lineasManualesMes(filas, libres, mes, config, overridesPorBono = {}) {
  const nombreCli = c => `${c.nombre} ${c.apellidos || ''}`.trim();
  const deBono = filas.filter(f => f.excluido).map(f => {
    const ov = overridesPorBono[f.bono.id] || {};
    return {
      tipo: 'bono', id: f.bono.id, entrenador_id: f.cliente.entrenador_id, concepto: nombreCli(f.cliente), cliente: f.cliente, bono: f.bono,
      clases: ov.manual_clases ?? null, precio: ov.manual_precio ?? null, pct_manual: ov.manual_pct ?? null,
      ...comisionManual({ clases: ov.manual_clases, precio: ov.manual_precio, pct: ov.manual_pct, origen: f.cliente.origen, declarado: f.declarado, pago_entrenador: f.pagoEntrenador }, config),
    };
  });
  const sueltas = (libres || []).filter(l => l.mes === mes).map(l => ({
    tipo: 'libre', id: l.id, entrenador_id: l.entrenador_id, concepto: l.concepto || '',
    clases: l.clases ?? null, precio: l.precio ?? null, pct_manual: l.pct ?? null,
    ...comisionManual({ clases: l.clases, precio: l.precio, pct: l.pct, origen: 'externo', declarado: l.declarado, pago_entrenador: l.pago_entrenador }, config),
  }));
  return [...deBono, ...sueltas];
}

// Los bonos excluidos no cuentan como bono (ni en lo facturado, ni en `n`): su comisión pasa a ser la de su
// línea manual, que se suma junto a las líneas libres. `lineas` = resultado de lineasManualesMes.
export function totalesComisiones(filas, lineas = []) {
  const t = { importe: 0, comision: 0, efectivo: 0, nomina: 0, n: 0, excluidos: 0, importeExcluido: 0, manuales: 0, comisionManual: 0 };
  for (const f of filas) {
    const precio = Number(f.bono.precio) || 0;
    if (f.excluido) { t.excluidos++; t.importeExcluido += precio; continue; }
    t.n++;
    t.importe += precio;
    t.comision += f.comision;
    t[f.pagoEntrenador] += f.comision;
  }
  for (const l of lineas) {
    t.manuales++;
    t.comisionManual += l.comision;
    t.comision += l.comision;
    t[l.pagoEntrenador] += l.comision;
  }
  return t;
}

// Entrenadores que participan en el sistema de comisiones (`aplica_comisiones` es true por defecto;
// se puede desactivar uno concreto sin que deje de funcionar en el resto de la app).
export const entrenadoresConComision = entrenadores => entrenadores.filter(e => e.aplica_comisiones !== false);

export function agruparComisionesPorEntrenador(filas) {
  const g = new Map();
  for (const f of filas) {
    const k = f.cliente.entrenador_id;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(f);
  }
  return g;
}
