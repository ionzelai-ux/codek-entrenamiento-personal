// aimharder-probe · FASE 1 (lectura) + FASE 2 (prueba controlada de reservas)
// Función de Supabase (Edge Function) que habla con la API de AimHarder en nombre del
// administrador. Fase 1: comprueba la conexión y lista las clases de un día (localiza el
// «Rack libre», sus horas y su aforo). Fase 2: reserva y cancela plazas de PRUEBA como
// invitado «PRUEBA PT» para comprobar cómo se comporta AimHarder.
//
// Seguridad:
//  · Los tokens viven en los secretos de Supabase (AIMHARDER_ACCESS_TOKEN / _REFRESH_TOKEN)
//    y, una vez renovados, en la tabla privada `aimharder_tokens` (sql/04_aimharder_tokens.sql).
//  · Solo puede llamarla un usuario con sesión iniciada cuyo perfil sea 'admin'. La anon key
//    (pública) NO sirve: se rechaza con 403.
//  · Ninguna respuesta incluye tokens; cualquier cosa con aspecto de token se oculta.
//  · Solo se cancelan reservas que la propia función haya creado y apuntado en
//    `aimharder_pruebas` (sql/05_aimharder_pruebas.sql). Máximo 6 pruebas activas a la vez
//    y solo con al menos 3 horas de margen antes de la clase.

const API = 'https://api.aimharder.com';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MARGEN_MIN = 180;            // la prueba debe ser ≥ 3 h antes de la clase (AimHarder no deja cancelar con < 1 h)
const MAX_PRUEBAS_ACTIVAS = 6;
// Cálculo de ocupación (los números de reserva de AimHarder crecen ~310.000 al día en todo el sistema;
// se usa una cifra mayor y 45 días de margen para no dejarse reservas fuera al acotar el historial).
const RVID_POR_DIA = 400000;
const DIAS_ATRAS = 45;
const PARALELO = 2;                // peticiones simultáneas máximas
const INTERVALO_MS = 1000;         // separación mínima entre peticiones (AimHarder limita el ritmo: en la 1.ª prueba real
                                   // aguantó ~110 por minuto con 429 continuos; se va a 60 por minuto para no rozar el límite)
const MAX_REINTENTOS = 6;          // ante «demasiadas peticiones» (429)
// Freno de seguridad (sql/06_aimharder_uso.sql). En la 1.ª prueba real AimHarder aceptó ≈ 100 peticiones y
// rechazó el resto, y seguía rechazando una hora después: se trabaja por debajo de ese tope y, al primer
// bloqueo serio, no se vuelve a llamar durante un rato (insistir lo alargaría). Ajustar cuando AimHarder diga su límite.
const LIMITE_HORA = 90;            // peticiones máximas por hora que se permite hacer esta integración
const BLOQUEO_MS = 30 * 60 * 1000; // parada tras un 429 serio (si AimHarder pide más con Retry-After, se respeta)
const RAFAGA_MAX_MS = 15000;       // un 429 con Retry-After ≤ 15 s se trata como ráfaga: se espera y se reintenta
const PRESUPUESTO_MS = 110000;     // tiempo máximo de cada tanda (la función se corta a los ~150 s)
const MAX_PAGINAS = 40;

export interface Tokens { access: string; refresh: string }
export interface Caducidad { access: string | null; refresh: string | null }
export interface AlmacenTokens {
  leer(): Promise<Tokens | null>;
  guardar(t: Tokens, exp: Caducidad): Promise<void>;
  caducidad(): Promise<Caducidad | null>;
}
export interface Prueba { booking_id: number; fecha: string; hora: string; schedule_id: number; cancelada: string | null }
export interface AlmacenPruebas {
  registrar(p: { booking_id: number; fecha: string; hora: string; schedule_id: number }): Promise<void>;
  listar(): Promise<Prueba[]>;
  marcarCancelada(booking_id: number): Promise<void>;
}
export interface AlmacenUso {
  leer(): Promise<{ usadas: number; bloqueoHasta: number | null }>;   // peticiones de la última hora y bloqueo vigente (ms)
  guardar(f: { llamadas: number; limitadas: number; bloqueoHasta: number | null }): Promise<void>;
  quitarBloqueo(): Promise<void>;
}
export interface ControlUso {
  cargar(): Promise<void>;
  antes(): void;                                        // lanza si hay bloqueo o el cupo está agotado; si no, cuenta la petición
  respuesta(estado: number, retryAfterMs: number): void;
  guardar(): Promise<void>;
  reiniciar(): Promise<void>;
  estado(): { usadas: number; limite: number; bloqueoHasta: string | null };
}
export interface Deps {
  esAdmin(authorization: string | null): Promise<boolean>;
  almacen: AlmacenTokens;
  pruebas: AlmacenPruebas;
  uso: ControlUso;
  fetchFn: typeof fetch;
  hoy(): string;
  ahoraMadrid(): string;           // 'AAAA-MM-DD HH:MM' en hora de Madrid
  pausa(ms: number): Promise<void>;
  reloj(): number;                 // milisegundos (para medir el tiempo del cálculo)
}
interface Respuesta { estado: number; json: any; cab?: Record<string, string> }

export class ErrorAimHarder extends Error {
  estado: number;
  constructor(mensaje: string, estado = 500) { super(mensaje); this.estado = estado; }
}

export const ocultarTokens = (texto: string): string => texto.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]');

// ── Freno de seguridad ─────────────────────────────────────────────────────
const horaMadrid = (ms: number): string => new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' }).format(new Date(ms));

export function crearControlUso(almacen: AlmacenUso, reloj: () => number): ControlUso {
  let usadas = 0, bloqueoHasta: number | null = null, llamadas = 0, limitadas = 0, seguidas = 0;
  return {
    async cargar() {
      const u = await almacen.leer();
      usadas = u.usadas; bloqueoHasta = u.bloqueoHasta; llamadas = 0; limitadas = 0; seguidas = 0;
    },
    antes() {
      if (bloqueoHasta !== null && bloqueoHasta > reloj()) {
        throw new ErrorAimHarder(`AimHarder nos está limitando el uso («Too many requests»). Para no alargar el bloqueo no se harán más peticiones hasta las ${horaMadrid(bloqueoHasta)} (hora de Madrid).`, 429);
      }
      if (usadas + llamadas >= LIMITE_HORA) {
        throw new ErrorAimHarder(`Cupo de peticiones de la última hora agotado (${usadas + llamadas}/${LIMITE_HORA}). Se espera para no pasar el límite de AimHarder.`, 429);
      }
      llamadas++;
    },
    respuesta(estado, retryAfterMs) {
      if (estado !== 429) { seguidas = 0; return; }
      limitadas++; seguidas++;
      // Ráfaga corta (Retry-After pequeño y no repetido): se reintenta. Cualquier otro 429: parada larga.
      if (retryAfterMs > RAFAGA_MAX_MS || seguidas >= 2) bloqueoHasta = reloj() + Math.max(retryAfterMs, BLOQUEO_MS);
    },
    async guardar() {
      if (llamadas === 0 && limitadas === 0) return;
      const f = { llamadas, limitadas, bloqueoHasta: limitadas > 0 ? bloqueoHasta : null };
      usadas += llamadas; llamadas = 0; limitadas = 0;
      await almacen.guardar(f);
    },
    async reiniciar() { await almacen.quitarBloqueo(); bloqueoHasta = null; seguidas = 0; },
    estado() {
      return { usadas: usadas + llamadas, limite: LIMITE_HORA, bloqueoHasta: bloqueoHasta !== null && bloqueoHasta > reloj() ? new Date(bloqueoHasta).toISOString() : null };
    },
  };
}
const retryAfterMs = (r: { cab?: Record<string, string> }): number => { const s = Number(r.cab?.['retry-after']); return Number.isFinite(s) && s > 0 ? s * 1000 : 0; };

async function pedir(fetchFn: typeof fetch, metodo: string, ruta: string, token: string, cuerpo?: unknown): Promise<Respuesta> {
  const r = await fetchFn(`${API}/${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let json: any;
  try { json = JSON.parse(texto); } catch { json = { _texto: texto.slice(0, 300) }; }
  const cab: Record<string, string> = {};                 // solo las cabeceras de límite de uso (sirven para ajustar el ritmo)
  r.headers.forEach((v: string, k: string) => { if (/^(retry-after|x-ratelimit|ratelimit)/i.test(k)) cab[k.toLowerCase()] = v; });
  return { estado: r.status, json, cab };
}

const caducado = (r: Respuesta): boolean =>
  r.estado === 401 || (r.estado === 403 && /expir|caduc/i.test(JSON.stringify(r.json)));

// Renueva los tokens. La pareja anterior queda invalidada, así que se guarda ANTES de usarla.
async function renovar(deps: Deps, t: Tokens): Promise<Tokens> {
  deps.uso.antes();
  const r = await pedir(deps.fetchFn, 'GET', 'auth/tokens/refresh', t.refresh);
  deps.uso.respuesta(r.estado, retryAfterMs(r));
  const d = r.json?.data ?? r.json;
  if (r.estado !== 200 || !d?.['access-token'] || !d?.['refresh-token']) {
    throw new ErrorAimHarder(`No se pudieron renovar los tokens (HTTP ${r.estado}). Si el refresh token caducó, pulsa «Refrescar tokens» en AimHarder y actualiza los secretos de Supabase.`, 502);
  }
  const nuevo: Tokens = { access: d['access-token'], refresh: d['refresh-token'] };
  try {
    await deps.almacen.guardar(nuevo, { access: d['access-token-expires-at'] ?? null, refresh: d['refresh-token-expires-at'] ?? null });
  } catch (_e) {
    throw new ErrorAimHarder('IMPORTANTE: AimHarder renovó los tokens pero no se pudieron guardar. Pulsa «Refrescar tokens» en AimHarder y actualiza los secretos de Supabase.', 500);
  }
  return nuevo;
}

// Si varias peticiones simultáneas se encuentran el token caducado, solo una debe renovarlo:
// la pareja anterior queda invalidada y renovar dos veces rompería la segunda.
const renovaciones = new WeakMap<object, Promise<Tokens>>();
function renovarUnaVez(deps: Deps, t: Tokens): Promise<Tokens> {
  let p = renovaciones.get(deps);
  if (!p) {
    p = renovar(deps, t).finally(() => { renovaciones.delete(deps); });
    renovaciones.set(deps, p);
  }
  return p;
}

export async function llamarAimHarder(deps: Deps, metodo: string, ruta: string, cuerpo?: unknown): Promise<Respuesta> {
  let t = await deps.almacen.leer();
  if (!t) throw new ErrorAimHarder('Faltan los tokens: crea los secretos AIMHARDER_ACCESS_TOKEN y AIMHARDER_REFRESH_TOKEN en Supabase (Edge Functions → Secrets).', 500);
  deps.uso.antes();
  let r = await pedir(deps.fetchFn, metodo, ruta, t.access, cuerpo);
  deps.uso.respuesta(r.estado, retryAfterMs(r));
  if (caducado(r)) {                        // token de acceso caducado: se renueva una vez y se reintenta
    const actual = await deps.almacen.leer();
    t = actual && actual.access !== t.access ? actual : await renovarUnaVez(deps, t);   // otro ya lo renovó → usar el nuevo
    deps.uso.antes();
    r = await pedir(deps.fetchFn, metodo, ruta, t.access, cuerpo);
    deps.uso.respuesta(r.estado, retryAfterMs(r));
  }
  return r;
}

// AimHarder devuelve { data: [ {schedule_id, time, name, duration, limit, ...} ], pagination, info }.
// Se aceptan también las variantes que describe su documentación.
export function extraerClases(json: any) {
  const lista = json?.appointments ?? json?.data?.appointments
    ?? (Array.isArray(json?.data) ? json.data : null) ?? (Array.isArray(json) ? json : null);
  if (!Array.isArray(lista)) return null;
  return lista.map((c: any) => ({
    schedule_id: c.schedule_id, hora: c.time, nombre: c.name, descripcion: c.description ?? '',
    duracion: typeof c.duration === 'number' ? `${c.duration} min` : (c.duration ?? ''),
    aforo: c.limit, sala: c.room_name ?? '', class_id: c.class_id,
    cancelada: !!c.cancelled, publica: c.is_public ?? null,
    es_rack: /rack/i.test(String(c.name ?? '')), es_personal: /personal/i.test(String(c.name ?? '')),
  }));
}

const mensajeApi = (r: Respuesta): string => ocultarTokens(String(r.json?.error?.message ?? r.json?.message ?? r.json?._texto ?? `HTTP ${r.estado}`));
const exito = (r: Respuesta): boolean => r.estado === 200 || r.estado === 201;
const minutosLocal = (s: string): number => {        // 'AAAA-MM-DD HH:MM' → minutos (ambas fechas en la misma zona)
  const [f, h] = s.split(' ');
  const [a, m, d] = f.split('-').map(Number);
  const [hh, mm] = h.split(':').map(Number);
  return Date.UTC(a, m - 1, d, hh, mm) / 60000;
};

// ── FASE 2 · prueba controlada ─────────────────────────────────────────────
export async function reservarPrueba(deps: Deps, fecha: string, hora: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) {
    return { ok: false, error: 'Indica la fecha (AAAA-MM-DD) y la hora (HH:MM).' };
  }
  if (minutosLocal(`${fecha} ${hora}`) - minutosLocal(deps.ahoraMadrid()) < MARGEN_MIN) {
    return { ok: false, error: 'La prueba debe hacerse al menos 3 horas antes de la clase, para poder cancelarla sin problema (AimHarder no deja cancelar con menos de 1 hora).' };
  }
  const activas = (await deps.pruebas.listar()).filter(p => !p.cancelada);
  if (activas.length >= MAX_PRUEBAS_ACTIVAS) {
    return { ok: false, error: `Ya hay ${activas.length} reservas de prueba activas. Cancélalas antes de crear más.` };
  }
  const cal = await llamarAimHarder(deps, 'GET', `calendar/${fecha}`);
  if (cal.estado !== 200) return { ok: false, http: cal.estado, error: mensajeApi(cal) };
  const candidatas = (extraerClases(cal.json) ?? []).filter(c => c.es_rack && c.hora === hora && !c.cancelada);
  if (candidatas.length === 0) return { ok: false, error: `No hay ninguna clase «Rack libre» a las ${hora} el ${fecha}.` };
  if (candidatas.length > 1) return { ok: false, error: `Hay ${candidatas.length} clases «Rack libre» a las ${hora}; no sé cuál usar.` };
  const clase = candidatas[0];

  const r = await llamarAimHarder(deps, 'POST', 'classes/booking/guest', {
    schedule_id: clase.schedule_id, booking_date: fecha,
    name: 'PRUEBA', first_surname: 'PT', booking_notes: 'Prueba automática de la integración: se cancelará',
  });
  const id = r.json?.data?.id ?? r.json?.id;
  if (!exito(r) || id == null) {
    return { ok: false, http: r.estado, schedule_id: clase.schedule_id, aforo: clase.aforo, error: mensajeApi(r) };
  }
  try {
    await deps.pruebas.registrar({ booking_id: Number(id), fecha, hora, schedule_id: clase.schedule_id });
  } catch (_e) {
    // Sin apuntarla no podríamos cancelarla luego: se anula al momento para no dejarla huérfana.
    await llamarAimHarder(deps, 'POST', 'classes/booking/cancel', { booking_id: Number(id), reason: 'Prueba abortada' });
    return { ok: false, error: 'No se pudo apuntar la reserva de prueba (¿falta ejecutar sql/05_aimharder_pruebas.sql?). Se ha cancelado para no dejarla huérfana.' };
  }
  // Estado que AimHarder da a la reserva ("confirmed" o "waiting_list"): si las que pasan del aforo
  // salen en lista de espera, se podrá detectar cuándo no queda rack. Solo informativo.
  let estadoReserva: string | null = null;
  try {
    const g = await llamarAimHarder(deps, 'GET', `bookings/${id}`);
    if (g.estado === 200) estadoReserva = String(g.json?.data?.state ?? g.json?.state ?? '') || null;
  } catch (_e) { /* no es imprescindible */ }
  return {
    ok: true, booking_id: Number(id), schedule_id: clase.schedule_id, aforo: clase.aforo, estado_reserva: estadoReserva,
    mensaje: `Reserva de prueba creada (nº ${id}) en «Rack libre» ${hora} del ${fecha}. Estado en AimHarder: ${estadoReserva ?? 'no disponible'}. Mira también si las plazas ocupadas han subido.`,
  };
}

export async function cancelarPruebas(deps: Deps) {
  const activas = (await deps.pruebas.listar()).filter(p => !p.cancelada);   // solo las que creó esta función
  if (activas.length === 0) return { ok: true, canceladas: 0, resultados: [], mensaje: 'No hay reservas de prueba activas.' };
  const resultados: any[] = [];
  for (const p of activas) {
    const r = await llamarAimHarder(deps, 'POST', 'classes/booking/cancel', { booking_id: p.booking_id, reason: 'Fin de la prueba de integración' });
    if (exito(r) || r.estado === 404) {                 // 404: ya no existía en AimHarder
      await deps.pruebas.marcarCancelada(p.booking_id);
      resultados.push({ booking_id: p.booking_id, ok: true, nota: r.estado === 404 ? 'ya no existía en AimHarder' : undefined });
    } else {
      resultados.push({ booking_id: p.booking_id, ok: false, http: r.estado, error: mensajeApi(r) });
    }
  }
  const canceladas = resultados.filter(x => x.ok).length;
  return {
    ok: canceladas === resultados.length, canceladas, resultados,
    mensaje: canceladas === resultados.length ? `${canceladas} reserva(s) de prueba cancelada(s).` : `Se cancelaron ${canceladas} de ${resultados.length}; revisa los errores.`,
  };
}

// Diagnóstico: lee (solo lectura) todo lo que AimHarder cuenta de NUESTRAS reservas de prueba activas:
// estado de cada una, su ficha completa, cómo aparecen en la lista de invitados y los datos de la clase.
// Sirve para saber si se puede detectar el aforo superado. Nunca devuelve datos de otros invitados.
export async function diagnosticoPruebas(deps: Deps) {
  const activas = (await deps.pruebas.listar()).filter(p => !p.cancelada);
  if (activas.length === 0) return { ok: false, error: 'No hay reservas de prueba activas: haz alguna reserva antes de pedir el diagnóstico.' };
  const recorte = (x: unknown, n = 2500) => ocultarTokens(JSON.stringify(x)).slice(0, n);
  const intentar = async <T>(f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch (_e) { return null; } };

  const estados: any[] = [];
  let reservaCruda = '';
  for (const p of activas) {
    const g = await llamarAimHarder(deps, 'GET', `bookings/${p.booking_id}`);
    const d = g.json?.data ?? g.json;
    estados.push({ booking_id: p.booking_id, http: g.estado, estado: d?.state ?? null, cancelacion: d?.cancellation_date ?? null, hecha_por: d?.booked_by?.type ?? null });
    if (!reservaCruda && g.estado === 200) reservaCruda = recorte(g.json);
  }

  const ids = activas.map(p => p.booking_id);
  const gi = await intentar(() => llamarAimHarder(deps, 'GET', `guests?id_from=${Math.min(...ids)}&id_to=${Math.max(...ids)}`));
  let invitados: any = { http: gi?.estado ?? null };
  if (gi) {
    const j = gi.json;
    const lista = j?.data?.guests ?? j?.guests ?? (Array.isArray(j?.data) ? j.data : (Array.isArray(j) ? j : null));
    if (Array.isArray(lista)) {
      const propios = lista.filter((x: any) => ids.includes(Number(x.id)) && String(x.name) === 'PRUEBA');   // solo las nuestras
      invitados = { http: gi.estado, encontrados: propios.length, ejemplo: propios.length ? recorte(propios[0], 1200) : null };
    } else {
      invitados = { http: gi.estado, forma: Object.keys(j ?? {}) };
    }
  }

  const ult = activas[activas.length - 1];
  const cal = await intentar(() => llamarAimHarder(deps, 'GET', `calendar/${ult.fecha}`));
  const clase = cal ? (extraerClases(cal.json) ?? []).find(c => c.schedule_id === ult.schedule_id) ?? null : null;
  let claseCruda = '';
  if (clase?.class_id != null) {
    const c = await intentar(() => llamarAimHarder(deps, 'GET', `classes/${clase.class_id}`));
    if (c) claseCruda = recorte(c.json);
  }
  return { ok: true, activas: activas.length, estados, reserva_cruda: reservaCruda, invitados, clase: clase ? { nombre: clase.nombre, aforo: clase.aforo, hora: clase.hora, schedule_id: clase.schedule_id } : null, clase_cruda: claseCruda };
}

// ── Ocupación de un Rack libre (solo lectura) ──────────────────────────────
// La API no dice cuántas plazas hay ocupadas, así que se calcula: se suman las reservas confirmadas
// de todos los socios (su historial, acotado por número de reserva) más las de invitado que conocemos.
// Se devuelven solo recuentos y números de reserva: nunca nombres, emails ni teléfonos.
function extraerLista(json: any, claves: string[]): any[] | null {
  const d = json?.data;
  if (Array.isArray(d)) return d;
  for (const k of claves) {
    if (Array.isArray(d?.[k])) return d[k];
    if (Array.isArray(json?.[k])) return json[k];
  }
  return Array.isArray(json) ? json : null;
}
const siguienteCursor = (json: any): string | null => json?.pagination?.nextCursor ?? json?.data?.pagination?.nextCursor ?? null;

interface Contadores { solicitudes: number; reintentos: number; libreDesde: number; ultimoLimite: Record<string, string> | null }

// Ritmo compartido por todas las peticiones: cada una reserva su hueco (una cada INTERVALO_MS) y,
// si AimHarder responde 429 («demasiadas peticiones»), TODAS esperan lo que pida (Retry-After) o,
// si no lo dice, un tiempo creciente. Así no se malgasta el cupo golpeando el límite.
async function pedirConReintento(deps: Deps, c: Contadores, ruta: string): Promise<Respuesta> {
  for (let intento = 0; ; intento++) {
    const ahora = deps.reloj();
    const espera = Math.max(0, c.libreDesde - ahora);
    c.libreDesde = Math.max(c.libreDesde, ahora) + INTERVALO_MS;
    if (espera > 0) await deps.pausa(espera);
    c.solicitudes++;
    const r = await llamarAimHarder(deps, 'GET', ruta);
    if (r.estado !== 429 || intento >= MAX_REINTENTOS) return r;
    c.reintentos++;
    c.ultimoLimite = r.cab ?? null;
    const ra = Number(r.cab?.['retry-after']);
    const pide = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * 2 ** intento;
    c.libreDesde = Math.max(c.libreDesde, deps.reloj() + Math.min(15000, pide));
  }
}

async function paginar(deps: Deps, c: Contadores, rutaBase: string, claves: string[], vencido: () => boolean) {
  const items: any[] = [];
  let cursor: string | null = null;
  let paginas = 0;
  do {
    const ruta: string = cursor ? `${rutaBase}${rutaBase.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : rutaBase;
    const r = await pedirConReintento(deps, c, ruta);
    if (r.estado !== 200) return { items, error: `HTTP ${r.estado}: ${mensajeApi(r)}`, forma: null as string[] | null, truncado: false };
    const lista = extraerLista(r.json, claves);
    if (!lista) return { items, error: 'formato inesperado', forma: Object.keys(r.json ?? {}), truncado: false };
    items.push(...lista);
    cursor = siguienteCursor(r.json);
    paginas++;
  } while (cursor && paginas < MAX_PAGINAS && !vencido());
  // truncado = quedaron páginas sin leer (por el tope de páginas o por el tiempo): el resultado NO es completo
  return { items, error: null as string | null, forma: null as string[] | null, truncado: cursor !== null };
}

async function enParalelo<T>(items: T[], n: number, f: (x: T) => Promise<void>, vencido: () => boolean): Promise<void> {
  let i = 0;
  const trabajador = async () => { while (i < items.length && !vencido()) { const x = items[i++]; await f(x); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, trabajador));
}

// Estado parcial de un cálculo que no cabe en una sola tanda (la función tiene un tiempo máximo):
// se devuelve tal cual y quien llama lo reenvía en `previo` para continuar donde se quedó.
export interface EstadoOcupacion {
  pendientes: number[]; reservas_socios: number[]; en_espera: number; socios_revisados: number;
  socios_total: number; solicitudes: number; reintentos_429: number;
}

export async function calcularOcupacion(deps: Deps, fecha: string, hora: string, previo?: EstadoOcupacion | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) return { ok: false, error: 'Indica la fecha (AAAA-MM-DD) y la hora (HH:MM).' };
  const inicio = deps.reloj();
  const vencido = () => deps.reloj() - inicio > PRESUPUESTO_MS;
  const c: Contadores = { solicitudes: previo?.solicitudes ?? 0, reintentos: previo?.reintentos_429 ?? 0, libreDesde: 0, ultimoLimite: null };
  const esNumeros = (x: unknown): x is number[] => Array.isArray(x) && x.length <= 5000 && x.every(n => Number.isFinite(n));
  if (previo && !(esNumeros(previo.pendientes) && esNumeros(previo.reservas_socios))) return { ok: false, error: 'El estado para continuar el cálculo no es válido.' };

  // 1) La clase «Rack libre» de esa hora (además deja el token renovado antes de lanzar peticiones simultáneas)
  const cal = await pedirConReintento(deps, c, `calendar/${fecha}`);
  if (cal.estado === 429) {
    return { ok: false, http: 429, limite: c.ultimoLimite ?? cal.cab ?? null, error: 'AimHarder está limitando las peticiones («Too many requests»): se ha superado su cupo de uso. Espera unos minutos sin lanzar nada más y vuelve a intentarlo.' };
  }
  if (cal.estado !== 200) return { ok: false, http: cal.estado, error: mensajeApi(cal) };
  const candidatas = (extraerClases(cal.json) ?? []).filter(x => x.es_rack && x.hora === hora && !x.cancelada);
  if (candidatas.length === 0) return { ok: false, error: `No hay ninguna clase «Rack libre» a las ${hora} el ${fecha}.` };
  if (candidatas.length > 1) return { ok: false, error: `Hay ${candidatas.length} clases «Rack libre» a las ${hora}; no sé cuál usar.` };
  const clase = candidatas[0];

  // 2) Número de reserva de referencia (las nuestras): sirve para no leer todo el historial de cada socio
  const propias = await deps.pruebas.listar();
  const ancla = propias.reduce((m, p) => Math.max(m, p.booking_id), 0);
  if (!ancla) return { ok: false, error: 'Necesito una reserva de referencia para acotar la búsqueda: haz antes una reserva de prueba (puedes cancelarla después).' };
  const desde = Math.max(0, ancla - DIAS_ATRAS * RVID_POR_DIA);

  // 3) Socios (si se continúa un cálculo, ya se sabe cuáles faltan por revisar)
  let ids: number[];
  let sociosTotal: number;
  if (previo) {
    ids = previo.pendientes;
    sociosTotal = previo.socios_total;
  } else {
    const cl = await paginar(deps, c, 'clients', ['clients'], () => false);     // la lista de socios se lee siempre entera
    if (cl.error || cl.truncado) return { ok: false, error: `No se pudo leer la lista completa de socios (${cl.error ?? 'demasiadas páginas'}).`, forma: cl.forma };
    const idDe = (x: any) => x?.id ?? x?.Id ?? x?.client_id;
    ids = cl.items.filter((x: any) => !x?.deactivation_date && idDe(x) != null).map((x: any) => Number(idDe(x)));
    sociosTotal = ids.length;
  }

  // 4) Historial de cada socio: reservas confirmadas de ESA clase, día y hora
  const encontrados: number[] = previo ? [...previo.reservas_socios] : [];
  const incidencias: string[] = [];
  const hechos = new Set<number>();
  let enEspera = previo?.en_espera ?? 0;
  let campos: string[] | null = null;
  let corte: string | null = null;                 // motivo por el que se paró antes de acabar (bloqueo o cupo agotado)
  const paraSeguir = () => vencido() || corte !== null;
  await enParalelo(ids, PARALELO, async (id) => {
    let h;
    try {
      h = await paginar(deps, c, `clients/${id}/booking-history?id_from=${desde}`, ['bookings', 'history'], paraSeguir);
    } catch (e) {
      if (e instanceof ErrorAimHarder) { corte = e.message; return; }     // el freno de seguridad saltó: se conserva lo hecho
      throw e;
    }
    if (h.error || h.truncado) { if (incidencias.length < 5) incidencias.push(`socio ${id}: ${h.error ?? 'historial incompleto'}`); return; }
    hechos.add(id);
    for (const b of h.items) {
      if (!campos && b && typeof b === 'object') campos = Object.keys(b);
      const coincide = b?.day === fecha && String(b?.time ?? '').slice(0, 5) === hora && Number(b?.class?.id) === Number(clase.class_id) && !b?.cancellation_date;
      if (!coincide) continue;
      if (b?.state === 'waiting_list') enEspera++; else encontrados.push(Number(b?.id));
    }
  }, paraSeguir);
  const pendientes = ids.filter(id => !hechos.has(id));
  const revisados = (previo?.socios_revisados ?? 0) + hechos.size;

  // 5) Invitados (solo cuando ya se han revisado todos los socios): los nuestros y, si se puede, los de otros
  const invitadosPropios = propias.filter(p => !p.cancelada && p.fecha === fecha && p.hora === hora).length;
  let invitadosOtros: number | null = null;
  let invitadosError: string | null = null;
  if (pendientes.length === 0) {
    const nuestros = new Set(propias.map(p => p.booking_id));
    const gi = await paginar(deps, c, `guests?id_from=${desde}`, ['guests'], () => false);
    if (gi.error || gi.truncado) invitadosError = gi.error ?? 'lista de invitados demasiado larga';
    else {
      invitadosOtros = gi.items.filter((g: any) =>
        g?.booking_day === fecha && String(g?.booking_time ?? '').slice(0, 5) === hora && /rack/i.test(String(g?.activity ?? ''))
        && !g?.cancellation_date && !nuestros.has(Number(g?.id)) && !['PT', 'PRUEBA'].includes(String(g?.name ?? ''))).length;
    }
  }

  const socios = encontrados.length;
  const total = socios + invitadosPropios + (invitadosOtros ?? 0);
  const completo = pendientes.length === 0;
  return {
    ok: true, fecha, hora, aforo: clase.aforo, socios, invitados_propios: invitadosPropios, invitados_otros: invitadosOtros, invitados_error: invitadosError,
    en_espera: enEspera, total, libres: (clase.aforo ?? 0) - total, completo,
    socios_total: sociosTotal, socios_revisados: revisados, pendientes, solicitudes: c.solicitudes, reintentos_429: c.reintentos,
    limite: c.ultimoLimite, segundos: Math.round((deps.reloj() - inicio) / 100) / 10, ancla, desde, campos_historial: campos, incidencias,
    reservas_socios: encontrados, corte, uso: deps.uso.estado(),
  };
}

export async function manejar(req: Request, deps: Deps): Promise<Response> {
  const responder = (cuerpo: unknown, estado = 200) =>
    new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return responder({ error: 'Usa POST' }, 405);
  try {
    if (!(await deps.esAdmin(req.headers.get('Authorization')))) {
      return responder({ error: 'Solo el administrador puede usar esta función.' }, 403);
    }
    const cuerpo: any = await req.json().catch(() => ({}));

    if (cuerpo?.accion === 'prueba_listar') return responder({ ok: true, pruebas: await deps.pruebas.listar() });   // no llama a AimHarder
    await deps.uso.cargar();                     // cuánto se ha usado la última hora y si hay un bloqueo vigente

    if (cuerpo?.accion === 'uso_reiniciar') {
      await deps.uso.reiniciar();                // el administrador da por terminado el bloqueo (lo decide él)
      return responder({ ok: true, uso: deps.uso.estado() });
    }

    if (cuerpo?.accion === 'estado') {
      const r = await llamarAimHarder(deps, 'GET', `calendar/${deps.hoy()}`);
      const ok = r.estado === 200;
      // `limite`: cabeceras de límite de uso que haya enviado AimHarder (sirven para ajustar el ritmo)
      return responder({ ok, http: r.estado, mensaje: ok ? 'Conexión correcta con AimHarder' : mensajeApi(r), limite: r.cab ?? null, uso: deps.uso.estado(), caducidad: await deps.almacen.caducidad() });
    }

    if (cuerpo?.accion === 'calendario') {
      const fecha = String(cuerpo.fecha ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return responder({ ok: false, error: 'Fecha no válida (usa AAAA-MM-DD).' });
      const r = await llamarAimHarder(deps, 'GET', `calendar/${fecha}`);
      if (r.estado !== 200) return responder({ ok: false, http: r.estado, error: mensajeApi(r) });
      const clases = extraerClases(r.json);
      if (!clases) {
        return responder({ ok: false, error: 'La respuesta de AimHarder no tiene el formato esperado.', forma: Object.keys(r.json ?? {}), crudo: ocultarTokens(JSON.stringify(r.json)).slice(0, 1500) });
      }
      return responder({ ok: true, fecha, clases, resumen: { total: clases.length, rack: clases.filter((c: any) => c.es_rack).length } });
    }

    if (cuerpo?.accion === 'prueba_reservar') return responder(await reservarPrueba(deps, String(cuerpo.fecha ?? ''), String(cuerpo.hora ?? '')));
    if (cuerpo?.accion === 'prueba_cancelar') return responder(await cancelarPruebas(deps));
    if (cuerpo?.accion === 'prueba_diagnostico') return responder(await diagnosticoPruebas(deps));
    if (cuerpo?.accion === 'ocupacion') return responder(await calcularOcupacion(deps, String(cuerpo.fecha ?? ''), String(cuerpo.hora ?? ''), cuerpo.previo ?? null));

    return responder({ error: 'Acción no válida.' }, 400);
  } catch (e: any) {
    if (e instanceof ErrorAimHarder) return responder({ ok: false, error: e.message, uso: deps.uso.estado() });
    return responder({ ok: false, error: ocultarTokens(String(e?.message ?? e)) }, 500);
  } finally {
    await deps.uso.guardar().catch(() => { /* si no se puede apuntar, no se rompe la respuesta */ });
  }
}

// ── Arranque en Supabase (Deno). En Node (tests) esta parte no se ejecuta. ─────────
declare const Deno: any;
if (typeof Deno !== 'undefined') {
  Deno.serve(async (req: Request) => {
    const { createClient } = await import('npm:@supabase/supabase-js@2');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

    const almacen: AlmacenTokens = {
      async leer() {
        const { data, error } = await admin.from('aimharder_tokens').select('access_token, refresh_token').eq('id', 1).maybeSingle();
        // Si la tabla no existe NO se sigue: renovar sin poder guardar perdería los tokens.
        if (error) throw new ErrorAimHarder('Falta la tabla aimharder_tokens: ejecuta sql/04_aimharder_tokens.sql en Supabase.', 500);
        if (data) return { access: data.access_token, refresh: data.refresh_token };
        const access = Deno.env.get('AIMHARDER_ACCESS_TOKEN'), refresh = Deno.env.get('AIMHARDER_REFRESH_TOKEN');
        return access && refresh ? { access, refresh } : null;
      },
      async guardar(t, exp) {
        const { error } = await admin.from('aimharder_tokens').upsert({
          id: 1, access_token: t.access, refresh_token: t.refresh,
          access_expira: exp.access, refresh_expira: exp.refresh, updated_at: new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
      },
      async caducidad() {
        const { data } = await admin.from('aimharder_tokens').select('access_expira, refresh_expira').eq('id', 1).maybeSingle();
        return data ? { access: data.access_expira, refresh: data.refresh_expira } : null;
      },
    };

    const pruebas: AlmacenPruebas = {
      async registrar(p) {
        const { error } = await admin.from('aimharder_pruebas').insert(p);
        if (error) throw new Error(error.message);
      },
      async listar() {
        const { data, error } = await admin.from('aimharder_pruebas').select('booking_id, fecha, hora, schedule_id, cancelada').order('id', { ascending: true });
        if (error) throw new ErrorAimHarder('Falta la tabla aimharder_pruebas: ejecuta sql/05_aimharder_pruebas.sql en Supabase.', 500);
        return data ?? [];
      },
      async marcarCancelada(booking_id) {
        await admin.from('aimharder_pruebas').update({ cancelada: new Date().toISOString() }).eq('booking_id', booking_id);
      },
    };

    const almacenUso: AlmacenUso = {
      async leer() {
        const ahora = Date.now();
        const hace1h = new Date(ahora - 3600000).toISOString();
        const recientes = await admin.from('aimharder_uso').select('llamadas').gte('at', hace1h);
        // Si la tabla no existe NO se sigue: sin freno de seguridad se podría alargar el bloqueo de AimHarder.
        if (recientes.error) throw new ErrorAimHarder('Falta la tabla aimharder_uso: ejecuta sql/06_aimharder_uso.sql en Supabase.', 500);
        const vigentes = await admin.from('aimharder_uso').select('bloqueo_hasta').gt('bloqueo_hasta', new Date(ahora).toISOString());
        const usadas = (recientes.data ?? []).reduce((t: number, f: any) => t + (f.llamadas ?? 0), 0);
        const hastas = (vigentes.data ?? []).map((f: any) => Date.parse(f.bloqueo_hasta)).filter((ms: number) => ms > ahora);
        return { usadas, bloqueoHasta: hastas.length ? Math.max(...hastas) : null };
      },
      async guardar(f) {
        const { error } = await admin.from('aimharder_uso').insert({
          llamadas: f.llamadas, limitadas: f.limitadas, bloqueo_hasta: f.bloqueoHasta !== null ? new Date(f.bloqueoHasta).toISOString() : null,
        });
        if (error) throw new Error(error.message);
      },
      async quitarBloqueo() {
        await admin.from('aimharder_uso').update({ bloqueo_hasta: null }).gt('bloqueo_hasta', new Date().toISOString());
      },
    };

    return manejar(req, {
      fetchFn: fetch,
      almacen,
      pruebas,
      uso: crearControlUso(almacenUso, () => Date.now()),
      pausa: (ms: number) => new Promise<void>(r => setTimeout(r, ms)),
      reloj: () => Date.now(),
      hoy: () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date()),
      ahoraMadrid: () => new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }).format(new Date()),
      async esAdmin(authorization) {
        const jwt = (authorization ?? '').replace(/^Bearer\s+/i, '');
        if (!jwt) return false;
        const { data, error } = await admin.auth.getUser(jwt);
        if (error || !data?.user) return false;                       // la anon key no es un usuario
        const { data: perfil } = await admin.from('perfiles').select('rol').eq('id', data.user.id).maybeSingle();
        return perfil?.rol === 'admin';
      },
    });
  });
}
