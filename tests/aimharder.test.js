import test from 'node:test';
import assert from 'node:assert/strict';
import {
  llamarAimHarder, manejar, extraerClases, ocultarTokens, ErrorAimHarder, reservarPrueba, cancelarPruebas,
} from '../supabase/functions/aimharder-probe/index.ts';

const JWT = (n) => `eyJhbGciOiJIUzI1NiJ9.eyJuIjoi${n}In0.firma${n}`;   // aspecto de token
const json = (cuerpo, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado });

// Almacén en memoria + API simulada que registra cada llamada
function entorno({ tokens = { access: JWT('A1'), refresh: JWT('R1') }, respuestas = [], falloGuardar = false, admin = true,
  ahora = '2026-09-20 18:00', pruebasIniciales = [], falloRegistrar = false } = {}) {
  const llamadas = [];
  let guardado = null;
  const cola = [...respuestas];
  const pruebas = pruebasIniciales.map(p => ({ schedule_id: 1, fecha: '2026-09-21', hora: '11:00', cancelada: null, ...p }));
  const deps = {
    esAdmin: async () => admin,
    hoy: () => '2026-09-21',
    ahoraMadrid: () => ahora,
    pruebas: {
      registrar: async p => { if (falloRegistrar) throw new Error('sin tabla'); pruebas.push({ ...p, cancelada: null }); },
      listar: async () => pruebas.map(p => ({ ...p })),
      marcarCancelada: async id => { pruebas.find(p => p.booking_id === id).cancelada = 'hoy'; },
    },
    fetchFn: async (url, init) => {
      llamadas.push({ url: String(url), auth: init?.headers?.Authorization, metodo: init?.method, cuerpo: init?.body ? JSON.parse(init.body) : undefined });
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
  return { deps, llamadas, guardado: () => guardado, pruebas };
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

// Forma REAL de la respuesta de AimHarder (capturada en producción): { data: [...], pagination, info }
const REAL = { data: [
  { schedule_id: 1386476, time: '07:00', name: 'Entreno personal', description: 'Entrenamiento personal', duration: 60, limit: 3, waitlist_count: null, cancelled: false, show_cancelled_class: false, class_id: 44627, room_id: null, room_name: null, room_capacity: null, staff_id: null, staff_name: null, is_event: false, is_public: false },
  { schedule_id: 1392828, time: '08:00', name: 'Entrenamiento Funcional + Calistenia', description: 'Entrenamiento Grupal por bloques', duration: 60, limit: 12, cancelled: false, class_id: 37385, room_name: null, is_public: true },
  { schedule_id: 1402616, time: '08:00', name: 'Rack libre', description: 'Entrenamiento libre en nuestro Rack multifuncional', duration: 60, limit: 4, cancelled: false, class_id: 38710, room_name: null, is_public: true },
], pagination: { nextCursor: null }, info: { version: '1.0' } };

test('respuesta real de AimHarder: la lista está directamente en "data"', () => {
  const c = extraerClases(REAL);
  assert.equal(c.length, 3);
  const rack = c.find(x => x.es_rack);
  assert.deepEqual([rack.schedule_id, rack.hora, rack.aforo, rack.duracion], [1402616, '08:00', 4, '60 min']);
  assert.equal(c.filter(x => x.es_rack).length, 1);
  assert.equal(c.find(x => x.es_personal).nombre, 'Entreno personal');
  assert.equal(c[1].es_rack, false);
  assert.equal(c[0].sala, '');          // room_name null → cadena vacía
  assert.equal(c[0].publica, false);
});

test('manejar: calendario con la respuesta real devuelve las clases y el resumen', async () => {
  const e = entorno({ respuestas: [json(REAL)] });
  const d = await (await manejar(post({ accion: 'calendario', fecha: '2026-09-21' }), e.deps)).json();
  assert.equal(d.ok, true);
  assert.deepEqual(d.resumen, { total: 3, rack: 1 });
});

// ── Fase 2: reservas de prueba ────────────────────────────────────────────
const CAL_11 = { data: [
  { schedule_id: 900, time: '11:00', name: 'Entrenamiento Funcional + Calistenia', duration: 60, limit: 12, cancelled: false },
  { schedule_id: 1402700, time: '11:00', name: 'Rack libre', duration: 60, limit: 4, cancelled: false, class_id: 38710 },
] };

test('prueba: reserva un invitado «PRUEBA PT» en el Rack libre de esa hora y la apunta', async () => {
  const e = entorno({ respuestas: [json(CAL_11), json({ data: { message: 'The class has been booked successfully', id: 8989 } }), json({ data: { id: 8989, state: 'confirmed' } })] });
  const r = await reservarPrueba(e.deps, '2026-09-21', '11:00');
  assert.equal(r.ok, true);
  assert.equal(r.booking_id, 8989);
  assert.equal(r.estado_reserva, 'confirmed');
  assert.equal(e.llamadas[2].url, 'https://api.aimharder.com/bookings/8989');
  assert.equal(r.schedule_id, 1402700, 'usa el horario del Rack libre, no el de la clase funcional');
  const reserva = e.llamadas[1];
  assert.equal(reserva.metodo, 'POST');
  assert.equal(reserva.url, 'https://api.aimharder.com/classes/booking/guest');
  assert.deepEqual([reserva.cuerpo.schedule_id, reserva.cuerpo.booking_date, reserva.cuerpo.name, reserva.cuerpo.first_surname], [1402700, '2026-09-21', 'PRUEBA', 'PT']);
  assert.deepEqual(e.pruebas.map(p => [p.booking_id, p.fecha, p.hora, p.cancelada]), [[8989, '2026-09-21', '11:00', null]]);
});

test('prueba: menos de 3 horas de margen → se rechaza sin tocar AimHarder', async () => {
  const e = entorno({ ahora: '2026-09-21 08:30', respuestas: [] });
  const r = await reservarPrueba(e.deps, '2026-09-21', '11:00');
  assert.equal(r.ok, false);
  assert.match(r.error, /3 horas/);
  assert.equal(e.llamadas.length, 0);
  // exactamente 3 h sí vale
  const ok = entorno({ ahora: '2026-09-21 08:00', respuestas: [json(CAL_11), json({ data: { id: 1 } })] });
  assert.equal((await reservarPrueba(ok.deps, '2026-09-21', '11:00')).ok, true);
});

test('prueba: datos mal escritos, hora sin Rack libre o clases duplicadas', async () => {
  const e = entorno();
  assert.equal((await reservarPrueba(e.deps, '21/09/2026', '11:00')).ok, false);
  assert.equal((await reservarPrueba(e.deps, '2026-09-21', '11')).ok, false);
  assert.equal(e.llamadas.length, 0);
  const sin = entorno({ respuestas: [json(CAL_11)] });
  const r = await reservarPrueba(sin.deps, '2026-09-21', '11:30');
  assert.match(r.error, /No hay ninguna clase «Rack libre»/);
  assert.equal(sin.llamadas.length, 1, 'solo consultó el calendario');
  const dup = entorno({ respuestas: [json({ data: [...CAL_11.data, { schedule_id: 5, time: '11:00', name: 'Rack libre', limit: 4 }] })] });
  assert.match((await reservarPrueba(dup.deps, '2026-09-21', '11:00')).error, /no sé cuál usar/);
});

test('prueba: si AimHarder rechaza la reserva (p. ej. aforo completo) se devuelve su mensaje y no se apunta nada', async () => {
  const e = entorno({ respuestas: [json(CAL_11), json({ error: { code: 422, message: 'The class is full.' } }, 422)] });
  const r = await reservarPrueba(e.deps, '2026-09-21', '11:00');
  assert.deepEqual([r.ok, r.http, r.error, r.aforo], [false, 422, 'The class is full.', 4]);
  assert.equal(e.pruebas.length, 0);
});

test('prueba: máximo 6 reservas activas a la vez', async () => {
  const activas = Array.from({ length: 6 }, (_, i) => ({ booking_id: 100 + i }));
  const e = entorno({ pruebasIniciales: activas, respuestas: [] });
  const r = await reservarPrueba(e.deps, '2026-09-21', '11:00');
  assert.equal(r.ok, false);
  assert.match(r.error, /6 reservas de prueba activas/);
  assert.equal(e.llamadas.length, 0);
});

test('prueba: si no se puede apuntar la reserva, se cancela al momento (no queda huérfana)', async () => {
  const e = entorno({ falloRegistrar: true, respuestas: [json(CAL_11), json({ data: { id: 7777 } }), json({ data: { message: 'ok' } })] });
  const r = await reservarPrueba(e.deps, '2026-09-21', '11:00');
  assert.equal(r.ok, false);
  assert.match(r.error, /cancelado/);
  assert.equal(e.llamadas[2].url, 'https://api.aimharder.com/classes/booking/cancel');
  assert.equal(e.llamadas[2].cuerpo.booking_id, 7777);
});

test('cancelar: solo las reservas de prueba apuntadas y aún activas', async () => {
  const e = entorno({
    pruebasIniciales: [{ booking_id: 11 }, { booking_id: 12, cancelada: 'ayer' }, { booking_id: 13 }],
    respuestas: [json({ data: { message: 'cancelled' } }), json({ data: { message: 'cancelled' } })],
  });
  const r = await cancelarPruebas(e.deps);
  assert.equal(r.ok, true);
  assert.equal(r.canceladas, 2);
  assert.deepEqual(e.llamadas.map(l => l.cuerpo.booking_id), [11, 13], 'nunca toca la 12 (ya cancelada) ni ninguna otra');
  assert.ok(e.llamadas.every(l => l.url === 'https://api.aimharder.com/classes/booking/cancel'));
  assert.ok(e.pruebas.every(p => p.cancelada));
});

test('cancelar: 404 cuenta como hecha; 409 (ventana vencida) se informa y se conserva', async () => {
  const e = entorno({
    pruebasIniciales: [{ booking_id: 21 }, { booking_id: 22 }],
    respuestas: [json({ error: { message: 'Booking not found' } }, 404), json({ error: { code: 409, message: 'Cancellation window has expired' } }, 409)],
  });
  const r = await cancelarPruebas(e.deps);
  assert.equal(r.ok, false);
  assert.equal(r.canceladas, 1);
  assert.match(r.resultados[1].error, /Cancellation window/);
  assert.equal(e.pruebas.find(p => p.booking_id === 21).cancelada !== null, true);
  assert.equal(e.pruebas.find(p => p.booking_id === 22).cancelada, null, 'la que falló sigue pendiente');
});

test('cancelar: sin pruebas activas no llama a AimHarder', async () => {
  const e = entorno({ respuestas: [] });
  const r = await cancelarPruebas(e.deps);
  assert.equal(r.canceladas, 0);
  assert.equal(e.llamadas.length, 0);
});

test('manejar: las acciones de prueba exigen ser administrador', async () => {
  for (const accion of ['prueba_reservar', 'prueba_cancelar', 'prueba_listar']) {
    const e = entorno({ admin: false, respuestas: [] });
    const r = await manejar(post({ accion, fecha: '2026-09-21', hora: '11:00' }), e.deps);
    assert.equal(r.status, 403, accion);
    assert.equal(e.llamadas.length, 0, accion);
  }
});

test('prueba: si AimHarder pone la reserva en lista de espera (aforo superado) se muestra', async () => {
  const e = entorno({ respuestas: [json(CAL_11), json({ data: { id: 31 } }), json({ data: { id: 31, state: 'waiting_list' } })] });
  const r = await reservarPrueba(e.deps, '2026-09-21', '11:00');
  assert.equal(r.ok, true);
  assert.equal(r.estado_reserva, 'waiting_list');
  assert.match(r.mensaje, /waiting_list/);
});

test('prueba: si no se puede leer el estado, la reserva sigue siendo válida', async () => {
  const e = entorno({ respuestas: [json(CAL_11), json({ data: { id: 32 } }), json({ error: { message: 'nope' } }, 500)] });
  const r = await reservarPrueba(e.deps, '2026-09-21', '11:00');
  assert.equal(r.ok, true);
  assert.equal(r.estado_reserva, null);
  assert.equal(e.pruebas.length, 1);
});

test('manejar: reservar, listar y cancelar de extremo a extremo', async () => {
  const e = entorno({ respuestas: [json(CAL_11), json({ data: { id: 555 } }), json({ data: { state: 'confirmed' } }), json({ data: { message: 'cancelled' } })] });
  const a = await (await manejar(post({ accion: 'prueba_reservar', fecha: '2026-09-21', hora: '11:00' }), e.deps)).json();
  assert.equal(a.ok, true);
  const l = await (await manejar(post({ accion: 'prueba_listar' }), e.deps)).json();
  assert.deepEqual(l.pruebas.map(p => [p.booking_id, p.cancelada]), [[555, null]]);
  const c = await (await manejar(post({ accion: 'prueba_cancelar' }), e.deps)).json();
  assert.equal(c.canceladas, 1);
});

test('prueba: los errores nunca incluyen tokens', async () => {
  const e = entorno({ respuestas: [json(CAL_11), json({ error: { message: `no vale ${JWT('A1')}` } }, 422)] });
  const t = await (await manejar(post({ accion: 'prueba_reservar', fecha: '2026-09-21', hora: '11:00' }), e.deps)).text();
  assert.ok(!t.includes('eyJ'));
});

test('extraerClases y ocultarTokens', () => {
  assert.equal(extraerClases({ foo: 1 }), null);
  assert.equal(extraerClases({ data: { appointments: [{ name: 'RACK LIBRE' }] } })[0].es_rack, true);
  assert.equal(ocultarTokens(`a ${JWT('X')} b`), 'a [token] b');
});
