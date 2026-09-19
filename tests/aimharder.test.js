import test from 'node:test';
import assert from 'node:assert/strict';
import { llamarAimHarder, manejar, extraerClases, ocultarTokens, ErrorAimHarder } from '../supabase/functions/aimharder-probe/index.ts';

const JWT = (n) => `eyJhbGciOiJIUzI1NiJ9.eyJuIjoi${n}In0.firma${n}`;   // aspecto de token
const json = (cuerpo, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado });

// Almacén en memoria + API simulada que registra cada llamada
function entorno({ tokens = { access: JWT('A1'), refresh: JWT('R1') }, respuestas = [], falloGuardar = false, admin = true } = {}) {
  const llamadas = [];
  let guardado = null;
  const cola = [...respuestas];
  const deps = {
    esAdmin: async () => admin,
    hoy: () => '2026-09-21',
    fetchFn: async (url, init) => {
      llamadas.push({ url: String(url), auth: init?.headers?.Authorization, metodo: init?.method });
      const sig = cola.shift();
      if (!sig) throw new Error('llamada inesperada a ' + url);
      return sig;
    },
    almacen: {
      leer: async () => (guardado ? { access: guardado.t.access, refresh: guardado.t.refresh } : tokens),
      guardar: async (t, exp) => { if (falloGuardar) throw new Error('sin tabla'); guardado = { t, exp }; },
      caducidad: async () => (guardado ? guardado.exp : null),
    },
  };
  return { deps, llamadas, guardado: () => guardado };
}
const post = (cuerpo, cabeceras = {}) => new Request('https://x/fn', { method: 'POST', body: JSON.stringify(cuerpo), headers: { Authorization: 'Bearer usuario', ...cabeceras } });
const CLASES = { appointments: [
  { schedule_id: 11, time: '10:00', name: 'Entrenamiento Funcional + Calistenia', duration: '01:00', limit: 12, room_name: 'Sala', room_capacity: 12, class_id: 1, cancelled: 0 },
  { schedule_id: 12, time: '11:00', name: 'Rack libre', duration: '01:00', limit: 4, room_name: 'Rack', room_capacity: 4, class_id: 2, cancelled: 0 },
] };

test('llamar: con el token vigente no renueva nada', async () => {
  const e = entorno({ respuestas: [json(CLASES)] });
  const r = await llamarAimHarder(e.deps, 'GET', 'calendar/2026-09-21');
  assert.equal(r.estado, 200);
  assert.equal(e.llamadas.length, 1);
  assert.equal(e.llamadas[0].url, 'https://api.aimharder.com/calendar/2026-09-21');
  assert.equal(e.llamadas[0].auth, `Bearer ${JWT('A1')}`);
  assert.equal(e.guardado(), null);
});

test('llamar: token caducado → renueva, guarda la pareja nueva y reintenta con ella', async () => {
  const e = entorno({ respuestas: [
    json({ error: { code: 401, message: 'token expired' } }, 401),
    json({ 'access-token': JWT('A2'), 'access-token-expires-at': '2026-10-01 10:00:00', 'refresh-token': JWT('R2'), 'refresh-token-expires-at': '2027-01-01 10:00:00' }),
    json(CLASES),
  ] });
  const r = await llamarAimHarder(e.deps, 'GET', 'calendar/2026-09-21');
  assert.equal(r.estado, 200);
  assert.equal(e.llamadas.length, 3);
  assert.equal(e.llamadas[1].url, 'https://api.aimharder.com/auth/tokens/refresh');
  assert.equal(e.llamadas[1].auth, `Bearer ${JWT('R1')}`, 'renueva con el refresh token');
  assert.equal(e.llamadas[2].auth, `Bearer ${JWT('A2')}`, 'reintenta con el access token nuevo');
  assert.deepEqual(e.guardado().t, { access: JWT('A2'), refresh: JWT('R2') });
  assert.equal(e.guardado().exp.refresh, '2027-01-01 10:00:00');
});

test('llamar: si no se puede renovar, error claro y sin tokens en el mensaje', async () => {
  const e = entorno({ respuestas: [json({}, 401), json({ error: { message: 'refresh caducado' } }, 401)] });
  await assert.rejects(() => llamarAimHarder(e.deps, 'GET', 'x'), err => {
    assert.ok(err instanceof ErrorAimHarder);
    assert.match(err.message, /No se pudieron renovar/);
    assert.ok(!/eyJ/.test(err.message));
    return true;
  });
});

test('llamar: si AimHarder renueva pero no se puede guardar, avisa con IMPORTANTE', async () => {
  const e = entorno({ falloGuardar: true, respuestas: [json({}, 401), json({ 'access-token': JWT('A2'), 'refresh-token': JWT('R2') })] });
  await assert.rejects(() => llamarAimHarder(e.deps, 'GET', 'x'), /IMPORTANTE/);
});

test('llamar: sin tokens configurados, dice qué secretos faltan', async () => {
  const e = entorno({ tokens: null, respuestas: [] });
  await assert.rejects(() => llamarAimHarder(e.deps, 'GET', 'x'), /AIMHARDER_ACCESS_TOKEN/);
  assert.equal(e.llamadas.length, 0);
});

test('un error que no es de caducidad (p. ej. 404) no provoca renovar tokens', async () => {
  const e = entorno({ respuestas: [json({ error: { message: 'no existe' } }, 404)] });
  const r = await llamarAimHarder(e.deps, 'GET', 'x');
  assert.equal(r.estado, 404);
  assert.equal(e.llamadas.length, 1);
});

test('manejar: quien no es administrador recibe 403 y no se llama a AimHarder', async () => {
  const e = entorno({ admin: false, respuestas: [] });
  const r = await manejar(post({ accion: 'calendario', fecha: '2026-09-21' }), e.deps);
  assert.equal(r.status, 403);
  assert.equal(e.llamadas.length, 0);
});

test('manejar: OPTIONS (CORS) y método distinto de POST', async () => {
  const e = entorno();
  const o = await manejar(new Request('https://x/fn', { method: 'OPTIONS' }), e.deps);
  assert.equal(o.status, 204);
  assert.match(o.headers.get('Access-Control-Allow-Headers'), /authorization/);
  const g = await manejar(new Request('https://x/fn', { method: 'GET' }), e.deps);
  assert.equal(g.status, 405);
});

test('manejar: calendario devuelve las clases y marca el Rack libre', async () => {
  const e = entorno({ respuestas: [json(CLASES)] });
  const r = await manejar(post({ accion: 'calendario', fecha: '2026-09-21' }), e.deps);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.resumen.total, 2);
  assert.equal(d.resumen.rack, 1);
  const rack = d.clases.find(c => c.es_rack);
  assert.deepEqual([rack.schedule_id, rack.hora, rack.aforo], [12, '11:00', 4]);
});

test('manejar: fecha inválida y acción inválida', async () => {
  const e = entorno();
  const f = await (await manejar(post({ accion: 'calendario', fecha: '21/09/2026' }), e.deps)).json();
  assert.equal(f.ok, false);
  assert.equal(e.llamadas.length, 0);
  const a = await manejar(post({ accion: 'reservar' }), e.deps);
  assert.equal(a.status, 400);
});

test('manejar: estado comprueba la conexión y devuelve solo fechas de caducidad', async () => {
  const e = entorno({ respuestas: [json(CLASES)] });
  const d = await (await manejar(post({ accion: 'estado' }), e.deps)).json();
  assert.equal(d.ok, true);
  assert.match(d.mensaje, /correcta/);
  assert.equal(e.llamadas[0].url, 'https://api.aimharder.com/calendar/2026-09-21');
});

test('manejar: una respuesta con forma inesperada no filtra tokens en el diagnóstico', async () => {
  const e = entorno({ respuestas: [json({ raro: true, token: JWT('SECRETO'), otro: 'ok' })] });
  const texto = await (await manejar(post({ accion: 'calendario', fecha: '2026-09-21' }), e.deps)).text();
  assert.ok(!texto.includes('eyJ'), 'no debe salir nada con forma de token');
  assert.match(texto, /formato esperado/);
});

test('ningún camino de error devuelve los tokens guardados', async () => {
  const e = entorno({ respuestas: [json({ error: { message: `fallo con ${JWT('A1')}` } }, 500)] });
  const texto = await (await manejar(post({ accion: 'estado' }), e.deps)).text();
  assert.ok(!texto.includes('eyJ'));
});

test('extraerClases y ocultarTokens', () => {
  assert.equal(extraerClases({ foo: 1 }), null);
  assert.equal(extraerClases({ data: { appointments: [{ name: 'RACK LIBRE' }] } })[0].es_rack, true);
  assert.equal(ocultarTokens(`a ${JWT('X')} b`), 'a [token] b');
});
