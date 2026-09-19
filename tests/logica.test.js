import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDias, diaSemana, lunesDe, primerDiaMes, ultimoDiaMes, edad, normalizaUsuario,
  precioHoraSugerido, precioBonoSugerido, estadoEfectivo, creditos, estadoPago,
  solapan, buscarConflictos, generarFechas, repartirCarriles, agrupar, sumar,
} from '../js/logica.js';

test('fechas: lunes, día de la semana y meses', () => {
  assert.equal(diaSemana('2026-09-20'), 7);          // domingo
  assert.equal(diaSemana('2026-09-21'), 1);          // lunes
  assert.equal(lunesDe('2026-09-20'), '2026-09-14');
  assert.equal(lunesDe('2026-09-14'), '2026-09-14');
  assert.equal(addDias('2026-12-31', 1), '2027-01-01');
  assert.equal(primerDiaMes('2026-09-19', 1), '2026-10-01');
  assert.equal(primerDiaMes('2026-01-15', -1), '2025-12-01');
  assert.equal(ultimoDiaMes('2028-02-10'), '2028-02-29');
});

test('edad y normalización de usuario', () => {
  assert.equal(edad('1990-09-20', '2026-09-19'), 35);
  assert.equal(edad('1990-09-19', '2026-09-19'), 36);
  assert.equal(edad(''), null);
  assert.equal(normalizaUsuario('  Jesús '), 'jesus');
});

test('tarifas sugeridas según los precios estándar', () => {
  assert.equal(precioHoraSugerido(4), 45);
  assert.equal(precioHoraSugerido(8), 42);
  assert.equal(precioHoraSugerido(12), 40);
  assert.equal(precioHoraSugerido(16), 38);
  assert.equal(precioHoraSugerido(40), 37);
  assert.equal(precioHoraSugerido(10), 42);   // entre tramos: el tramo inferior
  assert.equal(precioHoraSugerido(2), 45);    // por debajo del mínimo: tarifa más alta
  assert.equal(precioBonoSugerido(16), 608);
  assert.equal(precioBonoSugerido(8), 336);
  assert.equal(precioBonoSugerido(0), 0);
  assert.equal(precioBonoSugerido('abc'), 0);
});

const ses = (fecha, hora, estado, extra = {}) => ({ fecha, hora, estado, duracion_min: 60, ...extra });

test('una reserva pasada sin confirmar cuenta como auto', () => {
  const ahora = new Date(2026, 8, 19, 12, 0);
  assert.equal(estadoEfectivo(ses('2026-09-19', '10:00', 'reservada'), ahora), 'auto');
  assert.equal(estadoEfectivo(ses('2026-09-19', '11:30', 'reservada'), ahora), 'reservada'); // aún no ha terminado
  assert.equal(estadoEfectivo(ses('2026-09-18', '10:00', 'no_vino'), ahora), 'no_vino');
});

test('créditos: hechas y auto consumen; reservadas y no_vino no', () => {
  const ahora = new Date(2026, 8, 19, 12, 0);
  const c = {
    bonos: [{ sesiones: 8 }, { sesiones: 4 }],
    sesiones: [
      ses('2026-09-01', '10:00', 'hecha'),
      ses('2026-09-03', '10:00', 'reservada'),  // pasada → auto
      ses('2026-09-05', '10:00', 'no_vino'),
      ses('2026-09-25', '10:00', 'reservada'),  // futura
    ],
  };
  const r = creditos(c, ahora);
  assert.deepEqual(r, { total: 12, hechas: 2, reservadas: 1, noVino: 1, restantes: 10, libres: 9 });
});

test('créditos: nunca negativos y libres puede indicar sobrereserva', () => {
  const ahora = new Date(2026, 8, 19, 12, 0);
  const c = { bonos: [{ sesiones: 1 }], sesiones: [ses('2026-09-25', '10:00', 'reservada'), ses('2026-09-26', '10:00', 'reservada')] };
  const r = creditos(c, ahora);
  assert.equal(r.restantes, 1);
  assert.equal(r.libres, -1);
  assert.equal(creditos({}).total, 0);
});

test('pago: cobrado si la fecha ya llegó, programado si es futura', () => {
  assert.equal(estadoPago({ fecha_pago: '2026-09-19' }, '2026-09-19'), 'cobrado');
  assert.equal(estadoPago({ fecha_pago: '2026-10-01' }, '2026-09-19'), 'programado');
});

test('solapes: mismo día y franjas que se pisan', () => {
  assert.ok(solapan(ses('2026-09-21', '10:00'), ses('2026-09-21', '10:30')));
  assert.ok(solapan(ses('2026-09-21', '10:00'), ses('2026-09-21', '10:00')));
  assert.ok(!solapan(ses('2026-09-21', '10:00'), ses('2026-09-21', '11:00')));   // pegadas, sin solape
  assert.ok(!solapan(ses('2026-09-21', '10:00'), ses('2026-09-22', '10:00')));
});

test('conflictos: ignoran la propia sesión y las que no vinieron', () => {
  const nueva = ses('2026-09-21', '10:00');
  const ex = [
    { id: 'a', ...ses('2026-09-21', '10:00', 'reservada') },
    { id: 'b', ...ses('2026-09-21', '10:00', 'no_vino') },
    { id: 'c', ...ses('2026-09-21', '12:00', 'reservada') },
  ];
  assert.deepEqual(buscarConflictos(nueva, ex).map(x => x.id), ['a']);
  assert.deepEqual(buscarConflictos(nueva, ex, 'a'), []);
});

test('generar fechas: respeta días fijos, orden y cantidad', () => {
  // 2026-09-19 es sábado. Lunes y miércoles a las 10:00, 5 sesiones.
  const f = generarFechas({ desde: '2026-09-19', dias: [{ dia: 3, hora: '10:00' }, { dia: 1, hora: '10:00' }], cantidad: 5 });
  assert.deepEqual(f.map(x => x.fecha), ['2026-09-21', '2026-09-23', '2026-09-28', '2026-09-30', '2026-10-05']);
  assert.ok(f.every(x => x.hora === '10:00'));
});

test('generar fechas: incluye el día de inicio si coincide y admite dos franjas el mismo día', () => {
  const f = generarFechas({ desde: '2026-09-21', dias: [{ dia: 1, hora: '18:00' }, { dia: 1, hora: '09:00' }], cantidad: 3 });
  assert.deepEqual(f, [
    { fecha: '2026-09-21', hora: '09:00' }, { fecha: '2026-09-21', hora: '18:00' }, { fecha: '2026-09-28', hora: '09:00' },
  ]);
});

test('generar fechas: entradas inválidas no rompen ni ciclan', () => {
  assert.deepEqual(generarFechas({ desde: '2026-09-19', dias: [], cantidad: 4 }), []);
  assert.deepEqual(generarFechas({ desde: '2026-09-19', dias: [{ dia: 1, hora: '10:00' }], cantidad: 0 }), []);
  assert.deepEqual(generarFechas({ desde: '2026-09-19', dias: [{ dia: 9, hora: '10:00' }], cantidad: 3 }), []);
});

test('carriles: bloques solapados se reparten, los separados no', () => {
  const r = repartirCarriles([
    { id: 1, ini: 600, fin: 660 }, { id: 2, ini: 600, fin: 660 }, { id: 3, ini: 630, fin: 690 },
    { id: 4, ini: 900, fin: 960 },
  ]);
  const por = Object.fromEntries(r.map(x => [x.id, x]));
  assert.equal(por[1].lanes, 3);
  assert.equal(new Set([por[1].lane, por[2].lane, por[3].lane]).size, 3);
  assert.equal(por[4].lanes, 1);
  assert.equal(por[4].lane, 0);
});

test('resumen: cobrado, programado y estimado por entrenador', () => {
  const cl = [
    { entrenador_id: 'e1', activo: true, estado: 'efectivo', bonos: [{ fecha_pago: '2026-09-05', precio: 300 }, { fecha_pago: '2026-09-25', precio: 100 }, { fecha_pago: '2026-08-05', precio: 999 }] },
    { entrenador_id: 'e1', activo: true, estado: 'potencial', pot_precio: 336, bonos: [] },
    { entrenador_id: 'e2', activo: false, estado: 'potencial', pot_precio: 500, bonos: [] },
    { entrenador_id: 'e2', activo: true, estado: 'efectivo', bonos: [] },
  ];
  const g = agrupar(cl, c => c.entrenador_id, '2026-09', '2026-09-19');
  assert.deepEqual(g.get('e1'), { efectivos: 1, potenciales: 1, cobrado: 300, programado: 100, estimado: 336 });
  assert.deepEqual(g.get('e2'), { efectivos: 1, potenciales: 0, cobrado: 0, programado: 0, estimado: 0 });
  assert.deepEqual(sumar(g.values()), { efectivos: 2, potenciales: 1, cobrado: 300, programado: 100, estimado: 336 });
});
