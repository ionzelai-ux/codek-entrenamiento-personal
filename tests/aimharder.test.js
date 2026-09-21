import test from 'node:test';
import assert from 'node:assert/strict';
import {
  llamarAimHarder, manejar, extraerClases, ocultarTokens, ErrorAimHarder, reservarPrueba, cancelarPruebas, diagnosticoPruebas,
  calcularOcupacion, crearControlUso,
} from '../supabase/functions/aimharder-probe/index.ts';

const JWT = (n) => `eyJhbGciOiJIUzI1NiJ9.eyJuIjoi${n}In0.firma${n}`;   // aspecto de token
const json = (cuerpo, estado = 200) => new Response(JSON.stringify(cuerpo), { status: estado });

// Almacén en memoria + API simulada que registra cada llamada
function entorno({ tokens = { access: JWT('A1'), refresh: JWT('R1') }, respuestas = [], falloGuardar = false, admin = true,
  ahora = '2026-09-20 18:00', pruebasIniciales = [], falloRegistrar = false, enrutador = null, msPorLlamadaReloj = 0,
  usadasIniciales = 0, bloqueoInicial = null } = {}) {
  const llamadas = [];
  let guardado = null;
  const almacenUso = {
    filas: [],
    leer: async () => ({ usadas: usadasIniciales, bloqueoHasta: bloqueoInicial }),
    guardar: async f => { almacenUso.filas.push(f); },
    quitarBloqueo: async () => { bloqueoInicial = null; },
  };
  const cola = [...respuestas];
  const pruebas = pruebasIniciales.map(p => ({ schedule_id: 1, fecha: '2026-09-21', hora: '11:00', cancelada: null, ...p }));
  let relojMs = 0;
  const pausas = [];
  const deps = {
    esAdmin: async () => admin,
    hoy: () => '2026-09-21',
    ahoraMadrid: () => ahora,
    uso: crearControlUso(almacenUso, () => 0),
    pausa: async ms => { pausas.push(ms); },
    reloj: () => { relojMs += msPorLlamadaReloj; return relojMs; },
    pruebas: {
      registrar: async p => { if (falloRegistrar) throw new Error('sin tabla'); pruebas.push({ ...p, cancelada: null }); },
      listar: async () => pruebas.map(p => ({ ...p })),
      marcarCancelada: async id => { pruebas.find(p => p.booking_id === id).cancelada = 'hoy'; },
    },
    fetchFn: async (url, init) => {
      llamadas.push({ url: String(url), auth: init?.headers?.Authorization, metodo: init?.method, cuerpo: init?.body ? JSON.parse(init.body) : undefined });
      if (enrutador) return enrutador(String(url).replace('https://api.aimharder.com/', ''), llamadas.length);
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
  return { deps, llamadas, guardado: () => guardado, pruebas, pausas, almacenUso };
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

test('llamar: «Token has expired» con HTTP 400 (caso real) también renueva y reintenta', async () => {
  const e = entorno({ respuestas: [
    json({ error: { code: 400, message: 'Token has expired' } }, 400),
    json({ 'access-token': JWT('A2'), 'refresh-token': JWT('R2') }),
    json(CLASES),
  ] });
  const r = await llamarAimHarder(e.deps, 'GET', 'calendar/2026-09-21');
  assert.equal(r.estado, 200);
  assert.equal(e.llamadas[1].url, 'https://api.aimharder.com/auth/tokens/refresh');
  assert.equal(e.llamadas[2].auth, `Bearer ${JWT('A2')}`);
});

test('llamar: un 400 que NO habla de caducidad no renueva nada', async () => {
  const e = entorno({ respuestas: [json({ error: { message: 'Bad request' } }, 400)] });
  const r = await llamarAimHarder(e.deps, 'GET', 'x');
  assert.equal(r.estado, 400);
  assert.equal(e.llamadas.length, 1);
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

test('diagnóstico: estado de cada reserva, invitados propios y clase; sin datos de otros invitados ni tokens', async () => {
  const e = entorno({
    pruebasIniciales: [{ booking_id: 41, schedule_id: 1402700 }, { booking_id: 42, schedule_id: 1402700 }, { booking_id: 40, schedule_id: 1402700, cancelada: 'ayer' }],
    respuestas: [
      json({ data: { id: 41, state: 'confirmed', booked_by: { type: 'api' }, class: { id: 38710, name: 'Rack libre' } } }),
      json({ data: { id: 42, state: 'waiting_list', cancellation_date: null } }),
      json({ data: { guests: [
        { id: 41, name: 'PRUEBA', first_surname: 'PT', email: null, mobile_number: null },
        { id: 42, name: 'PRUEBA', first_surname: 'PT' },
        { id: 41, name: 'María', email: 'maria@ejemplo.com', mobile_number: '600111222' },   // otro invitado: jamás debe salir
      ] } }),
      json(CAL_11),
      json([{ id: 38710, name: 'Rack libre', description: 'Entrenamiento libre', cancellation_time: '60 min', secreto: JWT('Z') }]),
    ],
  });
  const d = await diagnosticoPruebas(e.deps);
  assert.equal(d.ok, true);
  assert.deepEqual(d.estados.map(x => [x.booking_id, x.estado]), [[41, 'confirmed'], [42, 'waiting_list']], 'ignora la ya cancelada');
  assert.equal(d.estados[0].hecha_por, 'api');
  assert.equal(d.invitados.encontrados, 2);
  assert.deepEqual(d.clase, { nombre: 'Rack libre', aforo: 4, hora: '11:00', schedule_id: 1402700 });
  assert.match(d.clase_cruda, /cancellation_time/);
  const texto = JSON.stringify(d);
  assert.ok(!texto.includes('maria') && !texto.includes('María') && !texto.includes('600111222'), 'no filtra datos de otros invitados');
  assert.ok(!texto.includes('eyJ'), 'no filtra tokens');
  assert.equal(e.llamadas[2].url, 'https://api.aimharder.com/guests?id_from=41&id_to=42');
});

test('diagnóstico: sin reservas de prueba activas no llama a AimHarder; solo el administrador', async () => {
  const e = entorno({ respuestas: [] });
  const d = await diagnosticoPruebas(e.deps);
  assert.equal(d.ok, false);
  assert.equal(e.llamadas.length, 0);
  const n = entorno({ admin: false });
  assert.equal((await manejar(post({ accion: 'prueba_diagnostico' }), n.deps)).status, 403);
});

// ── Cálculo de ocupación ──────────────────────────────────────────────────
const RACK = 38710;
const CAL_RACK = { data: [
  { schedule_id: 1156163, time: '11:00', name: 'Rack libre', duration: 60, limit: 4, cancelled: false, class_id: RACK },
  { schedule_id: 1156164, time: '12:00', name: 'Rack libre', duration: 60, limit: 4, cancelled: false, class_id: RACK },
] };
const reserva = (id, extra = {}) => ({ id, day: '2026-09-21', time: '11:00', class: { id: RACK, name: 'Rack libre' }, state: 'confirmed', cancellation_date: null, ...extra });
const pagina = (items, siguiente = null) => json({ data: items, pagination: { nextCursor: siguiente }, info: { version: '1.0' } });

// API simulada: responde según la dirección. `socios` = { idSocio: [páginas de reservas] }
function apiSocios({ socios, listaClientes, guests = [], calendario = CAL_RACK, fallos = {} }) {
  const vistos429 = new Set();
  return (ruta) => {
    if (ruta.startsWith('calendar/')) return json(calendario);
    if (ruta === 'clients') return pagina(listaClientes.slice(0, 2), listaClientes.length > 2 ? 'c2' : null);
    if (ruta.startsWith('clients?cursor=c2')) return pagina(listaClientes.slice(2));
    let m = ruta.match(/^clients\/(\d+)\/booking-history\?id_from=(\d+)(?:&cursor=(\w+))?$/);
    if (m) {
      const [, id, , cursor] = m;
      if (fallos[id] === 429 && !vistos429.has(id)) { vistos429.add(id); return json({ error: { message: 'Too Many Requests' } }, 429); }
      if (fallos[id] === 500) return json({ error: { message: 'boom' } }, 500);
      const paginas = socios[id] ?? [[]];
      const n = cursor ? Number(cursor.replace('p', '')) : 0;
      return pagina(paginas[n], n + 1 < paginas.length ? `p${n + 1}` : null);
    }
    if (ruta.startsWith('guests')) return pagina(guests);
    throw new Error('ruta inesperada: ' + ruta);
  };
}
const clientes = [
  { id: 1, name: 'Ana Secreta', email: 'ana@ejemplo.com', mobile_number: '600111222' }, { id: 2, name: 'Beto Privado', email: 'beto@ejemplo.com' },
  { id: 3, name: 'Carla Baja', deactivation_date: '2026-01-01' }, { id: 4, name: 'Dani Reservado' },
];

test('ocupación: suma socios confirmados (solo esa clase, día y hora), cuenta nuestros invitados y calcula plazas libres', async () => {
  const e = entorno({
    pruebasIniciales: [{ booking_id: 143035051, fecha: '2026-09-21', hora: '11:00' }, { booking_id: 143035052, fecha: '2026-09-21', hora: '11:00', cancelada: 'ayer' }, { booking_id: 143035053, fecha: '2026-10-05', hora: '11:00' }],
    enrutador: apiSocios({
      listaClientes: clientes,
      socios: {
        1: [[reserva(1), reserva(2, { day: '2026-09-22' }), reserva(3, { time: '12:00' })], [reserva(4, { class: { id: 999 } })]],   // 2 páginas: solo cuenta la 1
        2: [[reserva(5), reserva(6, { state: 'waiting_list' }), reserva(7, { cancellation_date: '2026-09-20 10:00:00' })]],          // confirmada + en espera + cancelada
        4: [[]],
      },
    }),
  });
  const r = await calcularOcupacion(e.deps, '2026-09-21', '11:00');
  assert.equal(r.ok, true);
  assert.equal(r.socios, 2, 'reservas 1 y 5; ni otro día/hora/clase, ni en espera, ni canceladas');
  assert.deepEqual(r.reservas_socios.sort(), [1, 5]);
  assert.equal(r.en_espera, 1);
  assert.equal(r.invitados_propios, 1, 'solo la nuestra activa de ese día y hora');
  assert.equal(r.total, 3);
  assert.equal(r.libres, 1);
  assert.equal(r.aforo, 4);
  assert.equal(r.socios_total, 3, 'el socio dado de baja no se consulta');
  assert.equal(r.socios_revisados, 3);
  assert.equal(r.completo, true);
  assert.equal(r.desde, 143035053 - 45 * 400000);
});

test('ocupación: acota el historial con id_from y pide las páginas siguientes de los socios', async () => {
  const e = entorno({
    pruebasIniciales: [{ booking_id: 150000000 }],
    enrutador: apiSocios({ listaClientes: clientes.slice(0, 1), socios: { 1: [[reserva(1)], [reserva(2)]] } }),
  });
  await calcularOcupacion(e.deps, '2026-09-21', '11:00');
  const urls = e.llamadas.map(l => l.url.replace('https://api.aimharder.com/', ''));
  assert.ok(urls.includes(`clients/1/booking-history?id_from=${150000000 - 18000000}`));
  assert.ok(urls.includes(`clients/1/booking-history?id_from=${150000000 - 18000000}&cursor=p1`));
  assert.ok(urls.includes('clients?cursor=c2') === false, 'con un solo socio no hay segunda página de la lista');
});

test('ocupación: pagina la lista de socios y cuenta invitados de otros (no los «PT»/«PRUEBA»)', async () => {
  const e = entorno({
    pruebasIniciales: [{ booking_id: 143000000 }],
    enrutador: apiSocios({
      listaClientes: clientes, socios: {},
      guests: [
        { id: 900, booking_day: '2026-09-21', booking_time: '11:00:00', activity: 'Rack libre', name: 'Visita', cancellation_date: null },
        { id: 901, booking_day: '2026-09-21', booking_time: '11:00:00', activity: 'Rack libre', name: 'PT', cancellation_date: null },       // nuestro
        { id: 902, booking_day: '2026-09-21', booking_time: '11:00:00', activity: 'Rack libre', name: 'Otra', cancellation_date: '2026-09-20' }, // cancelada
        { id: 903, booking_day: '2026-09-21', booking_time: '11:00:00', activity: 'Entreno personal', name: 'Entreno' },                        // otra clase
      ],
    }),
  });
  const r = await calcularOcupacion(e.deps, '2026-09-21', '11:00');
  assert.equal(r.socios_total, 3);
  assert.equal(r.invitados_otros, 1);
  assert.equal(r.invitados_propios, 1, 'la reserva de referencia también es nuestra y cae ese día y hora');
  assert.equal(r.total, 2);
});

test('ocupación: reintenta los 429 (demasiadas peticiones) y avisa de los socios que no se pudieron leer', async () => {
  const e = entorno({
    pruebasIniciales: [{ booking_id: 143000000 }],
    enrutador: apiSocios({
      listaClientes: clientes, socios: { 1: [[reserva(1)]], 2: [[reserva(2)]], 4: [[reserva(3)]] }, fallos: { 1: 429, 4: 500 },
    }),
  });
  const r = await calcularOcupacion(e.deps, '2026-09-21', '11:00');
  assert.equal(r.reintentos_429, 1);
  assert.equal(r.socios, 2, 'el 429 se reintenta y cuenta; el 500 no');
  assert.equal(r.completo, false, 'hay un socio sin revisar → el resultado no es fiable');
  assert.match(r.incidencias[0], /socio 4/);
});

test('ocupación: si se agota el tiempo devuelve lo que falta y se puede continuar sin repetir trabajo', async () => {
  const socios = { 1: [[reserva(1)]], 2: [[reserva(5)]], 4: [[reserva(9, { day: '2026-09-22' })]] };
  const primera = entorno({
    msPorLlamadaReloj: 40000,                       // el reloj avanza deprisa: la tanda se agota enseguida
    pruebasIniciales: [{ booking_id: 143000000 }],
    enrutador: apiSocios({ listaClientes: clientes, socios }),
  });
  const a = await calcularOcupacion(primera.deps, '2026-09-21', '11:00');
  assert.equal(a.ok, true);
  assert.equal(a.completo, false);
  assert.ok(a.pendientes.length > 0);
  assert.equal(a.socios_revisados + a.pendientes.length, a.socios_total, 'cada socio o está revisado o está pendiente');
  assert.equal(a.invitados_otros, null, 'los invitados solo se cuentan al terminar');
  assert.equal(a.total, a.socios + a.invitados_propios, 'el total parcial no incluye lo que no se ha mirado');

  // Se continúa con el estado devuelto (reloj normal): no vuelve a pedir la lista de socios ni a los ya revisados
  const segunda = entorno({
    pruebasIniciales: [{ booking_id: 143000000 }],
    enrutador: apiSocios({ listaClientes: clientes, socios }),
  });
  const previo = { pendientes: a.pendientes, reservas_socios: a.reservas_socios, en_espera: a.en_espera, socios_revisados: a.socios_revisados, socios_total: a.socios_total, solicitudes: a.solicitudes, reintentos_429: a.reintentos_429 };
  const b = await calcularOcupacion(segunda.deps, '2026-09-21', '11:00', previo);
  assert.equal(b.completo, true);
  assert.deepEqual(b.pendientes, []);
  assert.equal(b.socios_revisados, b.socios_total);
  assert.equal(b.socios, 2, 'socios 1 y 2; el 4 tiene su reserva otro día');
  assert.ok(!segunda.llamadas.some(l => l.url.endsWith('/clients')), 'no vuelve a leer la lista de socios');
  assert.equal(segunda.llamadas.filter(l => l.url.includes('booking-history')).length, a.pendientes.length, 'solo revisa los pendientes');
});

test('ocupación: honra Retry-After, separa las peticiones y avisa de las cabeceras de límite', async () => {
  const e = entorno({ pruebasIniciales: [{ booking_id: 143000000 }], enrutador: null });
  let primera = true;
  e.deps.fetchFn = async (url) => {
    const ruta = String(url).replace('https://api.aimharder.com/', '');
    e.llamadas.push({ url: String(url) });
    if (ruta.startsWith('calendar/')) return json(CAL_RACK);
    if (ruta === 'clients') return pagina([{ id: 1 }]);
    if (ruta.includes('booking-history') && primera) {
      primera = false;
      return new Response(JSON.stringify({ error: { message: 'Too many requests' } }), { status: 429, headers: { 'Retry-After': '7', 'X-RateLimit-Limit': '100', 'X-Otra': 'no' } });
    }
    if (ruta.includes('booking-history')) return pagina([reserva(1)]);
    return pagina([]);
  };
  const r = await calcularOcupacion(e.deps, '2026-09-21', '11:00');
  assert.equal(r.socios, 1);
  assert.equal(r.reintentos_429, 1);
  assert.ok(e.pausas.some(ms => ms >= 7000 && ms <= 7500), `esperó lo que pidió AimHarder: ${e.pausas}`);
  assert.deepEqual(r.limite, { 'retry-after': '7', 'x-ratelimit-limit': '100' }, 'solo devuelve las cabeceras de límite de uso');
});

test('ocupación: una lista cortada por el tope de páginas no se da por completa', async () => {
  const e = entorno({ pruebasIniciales: [{ booking_id: 143000000 }] });
  e.deps.fetchFn = async (url) => {
    const ruta = String(url).replace('https://api.aimharder.com/', '');
    e.llamadas.push({ url: String(url) });
    if (ruta.startsWith('calendar/')) return json(CAL_RACK);
    if (ruta.startsWith('clients?cursor') || ruta === 'clients') return json({ data: [{ id: 1 }], pagination: { nextCursor: 'siempre' } });   // no termina nunca
    return pagina([]);
  };
  const r = await calcularOcupacion(e.deps, '2026-09-21', '11:00');
  assert.equal(r.ok, false);
  assert.match(r.error, /lista completa de socios/);
});

test('ocupación: si falla la lista de invitados lo dice y no inventa el número', async () => {
  const e = entorno({
    pruebasIniciales: [{ booking_id: 143000000 }],
    enrutador: (ruta) => {
      if (ruta.startsWith('guests')) return json({ error: { message: 'boom' } }, 500);
      return apiSocios({ listaClientes: clientes.slice(0, 1), socios: { 1: [[reserva(1)]] } })(ruta);
    },
  });
  const r = await calcularOcupacion(e.deps, '2026-09-21', '11:00');
  assert.equal(r.completo, true);
  assert.equal(r.invitados_otros, null);
  assert.match(r.invitados_error, /HTTP 500/);
});

const limitando = (e, cabeceras = {}) => {
  e.deps.fetchFn = async (url) => {
    e.llamadas.push({ url: String(url) });
    return new Response(JSON.stringify({ error: { message: 'Too many requests' } }), { status: 429, headers: cabeceras });
  };
};

// ── Freno de seguridad ────────────────────────────────────────────────────
test('freno: un 429 con Retry-After largo activa el bloqueo, se apunta y no se vuelve a llamar', async () => {
  const e = entorno({ pruebasIniciales: [{ booking_id: 1 }] });
  limitando(e, { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' });
  const d = await (await manejar(post({ accion: 'ocupacion', fecha: '2026-09-21', hora: '11:00' }), e.deps)).json();
  assert.equal(d.ok, false);
  assert.match(d.error, /no se harán más peticiones hasta las/);
  assert.equal(e.llamadas.length, 1, 'una sola petición real: no insiste');
  assert.ok(d.uso.bloqueoHasta, 'el bloqueo queda indicado');
  assert.deepEqual(e.almacenUso.filas.map(f => [f.llamadas, f.limitadas, f.bloqueoHasta !== null]), [[1, 1, true]], 'se apunta en la base de datos');
});

test('freno: dos 429 seguidos sin Retry-After también frenan (después de un solo reintento)', async () => {
  const e = entorno({ pruebasIniciales: [{ booking_id: 1 }] });
  limitando(e);
  const d = await (await manejar(post({ accion: 'ocupacion', fecha: '2026-09-21', hora: '11:00' }), e.deps)).json();
  assert.equal(d.ok, false);
  assert.equal(e.llamadas.length, 2);
  assert.ok(d.uso.bloqueoHasta);
});

test('freno: una ráfaga corta (Retry-After pequeño) se espera y se reintenta sin bloquear', async () => {
  const ruteo = apiSocios({ listaClientes: clientes.slice(0, 1), socios: { 1: [[reserva(1)]] } });
  let primera = true;
  const e = entorno({
    pruebasIniciales: [{ booking_id: 143000000 }],
    enrutador: (ruta, n) => {
      if (primera && ruta.startsWith('calendar/')) { primera = false; return new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }); }
      return ruteo(ruta, n);
    },
  });
  const r = await calcularOcupacion(e.deps, '2026-09-21', '11:00');
  assert.equal(r.ok, true, 'tras esperar 2 s el cálculo sigue');
  assert.equal(r.socios, 1);
  assert.equal(r.reintentos_429, 1);
  assert.equal(e.deps.uso.estado().bloqueoHasta, null, 'una ráfaga corta no bloquea');
  assert.ok(e.pausas.some(ms => ms >= 2000), 'esperó lo que pidió AimHarder');
});

test('freno: con un bloqueo vigente en la base de datos no se hace NINGUNA petición', async () => {
  const e = entorno({ bloqueoInicial: 3_000_000_000_000, pruebasIniciales: [{ booking_id: 5 }], respuestas: [] });      // bloqueo muy en el futuro
  for (const accion of ['estado', 'calendario', 'ocupacion', 'prueba_reservar', 'prueba_cancelar', 'prueba_diagnostico']) {
    const d = await (await manejar(post({ accion, fecha: '2026-09-21', hora: '11:00' }), e.deps)).json();
    assert.equal(d.ok, false, accion);
    assert.match(d.error, /hasta las/, accion);
  }
  assert.equal(e.llamadas.length, 0);
});

test('freno: cupo de la última hora agotado → no se llama y se explica', async () => {
  const e = entorno({ usadasIniciales: 90, respuestas: [] });
  const d = await (await manejar(post({ accion: 'estado' }), e.deps)).json();
  assert.equal(d.ok, false);
  assert.match(d.error, /Cupo de peticiones de la última hora agotado \(90\/90\)/);
  assert.equal(e.llamadas.length, 0);
  assert.deepEqual([d.uso.usadas, d.uso.limite], [90, 90]);
});

test('freno: cada invocación apunta cuántas peticiones hizo y "estado" informa del uso', async () => {
  const e = entorno({ usadasIniciales: 10, respuestas: [json(CAL_RACK)] });
  const d = await (await manejar(post({ accion: 'estado' }), e.deps)).json();
  assert.equal(d.ok, true);
  assert.deepEqual(d.uso, { usadas: 11, limite: 90, bloqueoHasta: null });
  assert.deepEqual(e.almacenUso.filas, [{ llamadas: 1, limitadas: 0, bloqueoHasta: null }]);
});

test('freno: listar las pruebas no cuenta ni consulta el uso (no llama a AimHarder)', async () => {
  const e = entorno({ pruebasIniciales: [{ booking_id: 5 }], respuestas: [] });
  const d = await (await manejar(post({ accion: 'prueba_listar' }), e.deps)).json();
  assert.equal(d.ok, true);
  assert.deepEqual(e.almacenUso.filas, []);
});

test('freno: el administrador puede quitar el bloqueo local; otros no', async () => {
  const e = entorno({ bloqueoInicial: 3_000_000_000_000, respuestas: [json(CAL_RACK)] });
  const antes = await (await manejar(post({ accion: 'estado' }), e.deps)).json();
  assert.equal(antes.ok, false);
  const r = await (await manejar(post({ accion: 'uso_reiniciar' }), e.deps)).json();
  assert.equal(r.ok, true);
  assert.equal(r.uso.bloqueoHasta, null);
  const despues = await (await manejar(post({ accion: 'estado' }), e.deps)).json();
  assert.equal(despues.ok, true);
  const n = entorno({ admin: false, bloqueoInicial: 3_000_000_000_000 });
  assert.equal((await manejar(post({ accion: 'uso_reiniciar' }), n.deps)).status, 403);
});

test('freno: si el cupo se agota a mitad del cálculo de ocupación, devuelve lo hecho y se puede continuar', async () => {
  const e = entorno({
    usadasIniciales: 86,                                           // quedan 4: calendario + 2 páginas de socios + 1 historial
    pruebasIniciales: [{ booking_id: 143000000 }],
    enrutador: apiSocios({ listaClientes: clientes, socios: { 1: [[reserva(1)]], 2: [[reserva(5)]], 4: [[reserva(9)]] } }),
  });
  await e.deps.uso.cargar();                                        // (lo que hace `manejar` al empezar cada petición)
  const r = await calcularOcupacion(e.deps, '2026-09-21', '11:00');
  assert.equal(r.ok, true);
  assert.equal(r.completo, false);
  assert.match(r.corte, /Cupo de peticiones/);
  assert.equal(r.socios_revisados, 1);
  assert.equal(r.pendientes.length, 2, 'los otros dos socios quedan pendientes, no se pierden');
  assert.equal(r.socios, 1, 'lo ya encontrado se conserva');
  assert.equal(r.invitados_otros, null);
});

test('freno: el bloqueo no se pierde aunque la petición que lo provoca sea la última', async () => {
  const e = entorno({ pruebasIniciales: [{ booking_id: 1 }] });
  limitando(e, { 'Retry-After': '90' });
  await manejar(post({ accion: 'estado' }), e.deps);
  const siguiente = entorno({ bloqueoInicial: e.almacenUso.filas[0].bloqueoHasta, respuestas: [] });
  const d = await (await manejar(post({ accion: 'estado' }), siguiente.deps)).json();
  assert.equal(d.ok, false);
  assert.equal(siguiente.llamadas.length, 0, 'lo apuntado en una invocación frena a la siguiente');
});

test('estado: devuelve las cabeceras de límite de uso si AimHarder las envía', async () => {
  const e = entorno({});
  e.deps.fetchFn = async () => new Response(JSON.stringify(CAL_RACK), { status: 200, headers: { 'X-RateLimit-Limit': '100', 'X-RateLimit-Remaining': '97', 'Content-Type': 'application/json' } });
  const d = await (await manejar(post({ accion: 'estado' }), e.deps)).json();
  assert.equal(d.ok, true);
  assert.deepEqual(d.limite, { 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '97' });
});

test('ocupación: el estado para continuar se valida', async () => {
  const e = entorno({ pruebasIniciales: [{ booking_id: 1 }], enrutador: apiSocios({ listaClientes: clientes, socios: {} }) });
  const r = await calcularOcupacion(e.deps, '2026-09-21', '11:00', { pendientes: ['x; drop'], reservas_socios: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /no es válido/);
});

test('ocupación: sin reserva de referencia, sin Rack libre a esa hora o con lista de socios inesperada', async () => {
  const sin = entorno({ enrutador: apiSocios({ listaClientes: clientes, socios: {} }) });
  assert.match((await calcularOcupacion(sin.deps, '2026-09-21', '11:00')).error, /reserva de referencia/);
  const otra = entorno({ pruebasIniciales: [{ booking_id: 1 }], enrutador: apiSocios({ listaClientes: clientes, socios: {} }) });
  assert.match((await calcularOcupacion(otra.deps, '2026-09-21', '15:00')).error, /No hay ninguna clase «Rack libre»/);
  const rara = entorno({ pruebasIniciales: [{ booking_id: 1 }], enrutador: (ruta) => (ruta.startsWith('calendar/') ? json(CAL_RACK) : json({ algo: 1 })) });
  const r = await calcularOcupacion(rara.deps, '2026-09-21', '11:00');
  assert.equal(r.ok, false);
  assert.deepEqual(r.forma, ['algo']);
  assert.equal((await calcularOcupacion(sin.deps, 'ayer', '11:00')).ok, false);
});

test('ocupación: la respuesta nunca contiene nombres, emails, teléfonos ni tokens; solo el administrador', async () => {
  const e = entorno({
    pruebasIniciales: [{ booking_id: 143000000 }],
    enrutador: apiSocios({ listaClientes: clientes, socios: { 1: [[reserva(1)]] } }),
  });
  const texto = await (await manejar(post({ accion: 'ocupacion', fecha: '2026-09-21', hora: '11:00' }), e.deps)).text();
  for (const secreto of ['Ana Secreta', 'ana@ejemplo.com', '600111222', 'Beto', 'eyJ']) assert.ok(!texto.includes(secreto), secreto);
  assert.match(texto, /"socios":1/);
  const n = entorno({ admin: false });
  assert.equal((await manejar(post({ accion: 'ocupacion', fecha: '2026-09-21', hora: '11:00' }), n.deps)).status, 403);
  assert.equal(n.llamadas.length, 0);
});

test('renovación con peticiones simultáneas: solo una renueva y las demás usan el token nuevo', async () => {
  let renovaciones = 0;
  const e = entorno({
    enrutador: (ruta, n) => {
      if (ruta === 'auth/tokens/refresh') { renovaciones++; return json({ 'access-token': JWT('A2'), 'refresh-token': JWT('R2') }); }
      // Todo lo que llega con el token viejo se rechaza por caducado; con el nuevo funciona
      return json({ data: [] });
    },
  });
  const original = e.deps.fetchFn;
  e.deps.fetchFn = async (url, init) => {
    if (!String(url).endsWith('auth/tokens/refresh') && init.headers.Authorization === `Bearer ${JWT('A1')}`) {
      e.llamadas.push({ url: String(url), auth: init.headers.Authorization });
      return json({ error: { message: 'expired' } }, 401);
    }
    return original(url, init);
  };
  const resultados = await Promise.all([1, 2, 3, 4].map(i => llamarAimHarder(e.deps, 'GET', `x/${i}`)));
  assert.ok(resultados.every(r => r.estado === 200));
  assert.equal(renovaciones, 1, 'una sola renovación aunque cuatro peticiones vieran el token caducado');
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
