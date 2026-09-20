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
export interface Deps {
  esAdmin(authorization: string | null): Promise<boolean>;
  almacen: AlmacenTokens;
  pruebas: AlmacenPruebas;
  fetchFn: typeof fetch;
  hoy(): string;
  ahoraMadrid(): string;           // 'AAAA-MM-DD HH:MM' en hora de Madrid
}
interface Respuesta { estado: number; json: any }

export class ErrorAimHarder extends Error {
  estado: number;
  constructor(mensaje: string, estado = 500) { super(mensaje); this.estado = estado; }
}

export const ocultarTokens = (texto: string): string => texto.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]');

async function pedir(fetchFn: typeof fetch, metodo: string, ruta: string, token: string, cuerpo?: unknown): Promise<Respuesta> {
  const r = await fetchFn(`${API}/${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let json: any;
  try { json = JSON.parse(texto); } catch { json = { _texto: texto.slice(0, 300) }; }
  return { estado: r.status, json };
}

const caducado = (r: Respuesta): boolean =>
  r.estado === 401 || (r.estado === 403 && /expir|caduc/i.test(JSON.stringify(r.json)));

// Renueva los tokens. La pareja anterior queda invalidada, así que se guarda ANTES de usarla.
async function renovar(deps: Deps, t: Tokens): Promise<Tokens> {
  const r = await pedir(deps.fetchFn, 'GET', 'auth/tokens/refresh', t.refresh);
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

export async function llamarAimHarder(deps: Deps, metodo: string, ruta: string, cuerpo?: unknown): Promise<Respuesta> {
  let t = await deps.almacen.leer();
  if (!t) throw new ErrorAimHarder('Faltan los tokens: crea los secretos AIMHARDER_ACCESS_TOKEN y AIMHARDER_REFRESH_TOKEN en Supabase (Edge Functions → Secrets).', 500);
  let r = await pedir(deps.fetchFn, metodo, ruta, t.access, cuerpo);
  if (caducado(r)) {                        // token de acceso caducado: se renueva una vez y se reintenta
    t = await renovar(deps, t);
    r = await pedir(deps.fetchFn, metodo, ruta, t.access, cuerpo);
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
  return {
    ok: true, booking_id: Number(id), schedule_id: clase.schedule_id, aforo: clase.aforo,
    mensaje: `Reserva de prueba creada (nº ${id}) en «Rack libre» ${hora} del ${fecha}. Mira en AimHarder si las plazas ocupadas han subido.`,
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

    if (cuerpo?.accion === 'estado') {
      const r = await llamarAimHarder(deps, 'GET', `calendar/${deps.hoy()}`);
      const ok = r.estado === 200;
      return responder({ ok, http: r.estado, mensaje: ok ? 'Conexión correcta con AimHarder' : mensajeApi(r), caducidad: await deps.almacen.caducidad() });
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
    if (cuerpo?.accion === 'prueba_listar') return responder({ ok: true, pruebas: await deps.pruebas.listar() });

    return responder({ error: 'Acción no válida.' }, 400);
  } catch (e: any) {
    if (e instanceof ErrorAimHarder) return responder({ ok: false, error: e.message });
    return responder({ ok: false, error: ocultarTokens(String(e?.message ?? e)) }, 500);
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

    return manejar(req, {
      fetchFn: fetch,
      almacen,
      pruebas,
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
