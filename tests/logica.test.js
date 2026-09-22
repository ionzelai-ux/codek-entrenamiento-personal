import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDias, diaSemana, lunesDe, primerDiaMes, ultimoDiaMes, edad, normalizaUsuario, nombreUsuario,
  precioHoraSugerido, precioBonoSugerido, estadoEfectivo, creditos, estadoPago,
  solapan, buscarConflictos, generarFechas, repartirCarriles, agrupar, sumar, camposPendientes,
  estadoCobro, facturacionMes,
  comisionBono, esDeclaradoPorDefecto, bonosLiquidablesMes, liquidacionMes, totalesComisiones, agruparComisionesPorEntrenador,
  entrenadoresConComision, DEFAULT_CONFIG_COMISIONES,
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

test('nombre de usuario: acepta "eduardo" y también "eduardo@dominio"', () => {
  assert.equal(nombreUsuario('Eduardo'), 'eduardo');
  assert.equal(nombreUsuario('admin@codek-ep.app'), 'admin');
  assert.equal(nombreUsuario(' Jesús@Codek-EP.app '), 'jesus');
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

test('pago: pendiente si la fecha llegó y nadie lo confirmó, programado si es futura, pagado si lo confirmó el admin', () => {
  assert.equal(estadoPago({ fecha_pago: '2026-09-19' }, '2026-09-19'), 'pendiente');
  assert.equal(estadoPago({ fecha_pago: '2026-09-01', pagado_el: null }, '2026-09-19'), 'pendiente');
  assert.equal(estadoPago({ fecha_pago: '2026-10-01' }, '2026-09-19'), 'programado');
  assert.equal(estadoPago({ fecha_pago: '2026-09-01', pagado_el: '2026-09-03' }, '2026-09-19'), 'pagado');
  assert.equal(estadoPago({ fecha_pago: '2026-10-01', pagado_el: '2026-09-15' }, '2026-09-19'), 'pagado', 'pagado por adelantado');
});

// Cliente efectivo con un bono de `n` sesiones y `hechas` ya realizadas
const cliPago = (bonos, hechas = 0) => ({
  estado: 'efectivo', bonos,
  sesiones: Array.from({ length: hechas }, (_, i) => ({ fecha: `2026-08-${String(i + 1).padStart(2, '0')}`, hora: '10:00', estado: 'hecha' })),
});
const HOY = '2026-09-19', AHORA = new Date(2026, 8, 19, 12, 0);

test('cobro del cliente: pendiente > programado > renovar > pagado', () => {
  const pend = estadoCobro(cliPago([{ sesiones: 8, precio: 275, fecha_pago: '2026-09-01' }], 2), HOY, AHORA);
  assert.deepEqual([pend.clave, pend.importe, pend.fecha, pend.n], ['pendiente', 275, '2026-09-01', 1]);

  const prog = estadoCobro(cliPago([{ sesiones: 8, precio: 275, fecha_pago: '2026-10-01' }]), HOY, AHORA);
  assert.deepEqual([prog.clave, prog.importe, prog.fecha], ['programado', 275, '2026-10-01']);

  const ok = estadoCobro(cliPago([{ sesiones: 8, precio: 275, fecha_pago: '2026-09-01', pagado_el: '2026-09-02' }], 3), HOY, AHORA);
  assert.deepEqual([ok.clave, ok.importe], ['pagado', 275]);

  const renovar = estadoCobro(cliPago([{ sesiones: 8, precio: 275, fecha_pago: '2026-09-01', pagado_el: '2026-09-02' }], 6), HOY, AHORA);
  assert.equal(renovar.clave, 'renovar', 'quedan 2 → toca renovar');
  assert.equal(renovar.importe, 275, 'con el importe del último bono como referencia');
  assert.equal(estadoCobro(cliPago([{ sesiones: 8, precio: 275, fecha_pago: '2026-09-01', pagado_el: '2026-09-02' }], 5), HOY, AHORA).clave, 'pagado', 'quedan 3 → todavía no');
  assert.equal(estadoCobro(cliPago([{ sesiones: 8, precio: 275, fecha_pago: '2026-09-01', pagado_el: '2026-09-02' }], 8), HOY, AHORA).clave, 'renovar', 'agotado');
});

test('cobro del cliente: varios pendientes se suman; sin bono; potencial no aplica', () => {
  const dos = estadoCobro(cliPago([
    { sesiones: 8, precio: 275, fecha_pago: '2026-08-01' }, { sesiones: 8, precio: 275, fecha_pago: '2026-09-01' },
  ]), HOY, AHORA);
  assert.deepEqual([dos.clave, dos.importe, dos.fecha, dos.n], ['pendiente', 550, '2026-08-01', 2]);
  assert.equal(estadoCobro(cliPago([]), HOY, AHORA).clave, 'sin_bono');
  assert.equal(estadoCobro({ estado: 'potencial', bonos: [] }, HOY, AHORA), null);
});

test('cobro del cliente: si ya hay un bono nuevo programado no se pide renovar; un pendiente manda sobre todo', () => {
  const renovado = estadoCobro(cliPago([
    { sesiones: 8, precio: 275, fecha_pago: '2026-09-01', pagado_el: '2026-09-02' }, { sesiones: 8, precio: 275, fecha_pago: '2026-10-01' },
  ], 7), HOY, AHORA);
  assert.equal(renovado.clave, 'programado');
  const debe = estadoCobro(cliPago([{ sesiones: 8, precio: 275, fecha_pago: '2026-09-01' }], 7), HOY, AHORA);
  assert.equal(debe.clave, 'pendiente', 'aunque queden pocas sesiones, primero se cobra');
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

test('info pendiente: ficha completa no falta nada; cada hueco se nombra', () => {
  const completo = { apellidos: 'Remón', telefono: '600', email: 'a@b.c', fecha_nacimiento: '1990-01-01', estado: 'efectivo', bonos: [{ metodo_pago: 'efectivo' }] };
  assert.deepEqual(camposPendientes(completo), []);
  assert.deepEqual(camposPendientes({ ...completo, apellidos: '  ', email: null }), ['apellidos', 'email']);
  // cliente sin bono / con un bono sin método de pago
  assert.deepEqual(camposPendientes({ ...completo, bonos: [] }), ['bono']);
  assert.deepEqual(camposPendientes({ ...completo, bonos: [{ metodo_pago: 'tarjeta' }, { metodo_pago: null }] }), ['método de pago']);
  assert.deepEqual(camposPendientes({ ...completo, bonos: undefined }), ['bono']);
});

test('info pendiente: un potencial necesita sesiones, veces por semana e importe', () => {
  const pot = { apellidos: 'X', telefono: '6', email: 'e', fecha_nacimiento: '1990-01-01', estado: 'potencial' };
  assert.deepEqual(camposPendientes(pot), ['sesiones que quiere', 'veces por semana', 'importe estimado']);
  assert.deepEqual(camposPendientes({ ...pot, pot_sesiones_bono: 8, pot_veces_semana: 2, pot_precio: 336 }), []);
  assert.deepEqual(camposPendientes({ ...pot, pot_sesiones_bono: 8, pot_veces_semana: 2, pot_precio: 0 }), ['importe estimado']);
});

test('resumen: cobrado (confirmado), pendiente, programado y estimado por entrenador', () => {
  const cl = [
    { entrenador_id: 'e1', activo: true, estado: 'efectivo', bonos: [
      { fecha_pago: '2026-09-05', precio: 300, pagado_el: '2026-09-06' },   // pagado
      { fecha_pago: '2026-09-10', precio: 50 },                             // pendiente (ya llegó, sin confirmar)
      { fecha_pago: '2026-09-25', precio: 100 },                            // programado
      { fecha_pago: '2026-08-05', precio: 999 }] },                         // otro mes
    { entrenador_id: 'e1', activo: true, estado: 'potencial', pot_precio: 336, bonos: [] },
    { entrenador_id: 'e2', activo: false, estado: 'potencial', pot_precio: 500, bonos: [] },
    { entrenador_id: 'e2', activo: true, estado: 'efectivo', bonos: [] },
  ];
  const g = agrupar(cl, c => c.entrenador_id, '2026-09', '2026-09-19');
  assert.deepEqual(g.get('e1'), { efectivos: 1, potenciales: 1, cobrado: 300, pendiente: 50, programado: 100, estimado: 336 });
  assert.deepEqual(g.get('e2'), { efectivos: 1, potenciales: 0, cobrado: 0, pendiente: 0, programado: 0, estimado: 0 });
  assert.deepEqual(sumar(g.values()), { efectivos: 2, potenciales: 1, cobrado: 300, pendiente: 50, programado: 100, estimado: 336 });
});

test('facturación prevista: este mes y el siguiente según las fechas de pago', () => {
  const cl = [
    { id: 'a', bonos: [
      { id: 1, fecha_pago: '2026-09-05', precio: 300, pagado_el: '2026-09-06' },
      { id: 2, fecha_pago: '2026-09-28', precio: 100.5 },
      { id: 3, fecha_pago: '2026-10-01', precio: 275 }] },
    { id: 'b', bonos: [
      { id: 4, fecha_pago: '2026-09-12', precio: 50 },
      { id: 5, fecha_pago: '2026-10-15', precio: 40, pagado_el: '2026-09-18' },
      { id: 6, fecha_pago: '2026-11-01', precio: 999 }] },
  ];
  const sep = facturacionMes(cl, '2026-09', '2026-09-19');
  assert.deepEqual([sep.total, sep.pagado, sep.pendiente, sep.programado], [450.5, 300, 50, 100.5]);
  assert.deepEqual(sep.filas.map(f => f.bono.id), [1, 4, 2], 'ordenadas por fecha de pago');
  assert.deepEqual(sep.filas.map(f => f.estado), ['pagado', 'pendiente', 'programado']);
  const oct = facturacionMes(cl, '2026-10', '2026-09-19');
  assert.deepEqual([oct.total, oct.pagado, oct.pendiente, oct.programado], [315, 40, 0, 275]);
  assert.equal(facturacionMes(cl, '2026-12', '2026-09-19').total, 0);
});

// ── Comisiones de los entrenadores ──────────────────────────────────────────
const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: ${a} ≈ ${b}`);

test('declarado por defecto: tarjeta y transferencia sí, efectivo no', () => {
  assert.equal(esDeclaradoPorDefecto('tarjeta'), true);
  assert.equal(esDeclaradoPorDefecto('transferencia'), true);
  assert.equal(esDeclaradoPorDefecto('efectivo'), false);
  assert.equal(esDeclaradoPorDefecto(undefined), false);
});

test('comisión de un bono: cliente Codek con tarjeta, pagado en nómina (ejemplo de Jon)', () => {
  // 336 € ÷ 1,21 = 277,685950... ÷ 1,35 = 205,693296... × 40% = 82,277318...
  const r = comisionBono({ precio: 336, metodo_pago: 'tarjeta' }, 'codek', DEFAULT_CONFIG_COMISIONES, { pago_entrenador: 'nomina' });
  assert.equal(r.declarado, true);
  assert.equal(r.pagoEntrenador, 'nomina');
  assert.equal(r.pct, 40);
  cerca(r.base, 205.693296, 'base tras IVA y Seguridad Social');
  cerca(r.comision, 82.277318, 'comisión');
});

test('comisión de un bono: mismo caso pero pagado en efectivo (sin descuento de Seguridad Social)', () => {
  // 336 € ÷ 1,21 = 277,685950... × 40% = 111,074380...
  const r = comisionBono({ precio: 336, metodo_pago: 'tarjeta' }, 'codek', DEFAULT_CONFIG_COMISIONES);
  assert.equal(r.pagoEntrenador, 'efectivo', 'sin override, por defecto efectivo');
  cerca(r.base, 277.685950, 'base tras IVA, sin Seguridad Social');
  cerca(r.comision, 111.074380, 'comisión');
});

test('comisión de un bono: cliente externo en efectivo, sin declarar (comisión más alta, sin descuentos)', () => {
  const r = comisionBono({ precio: 480, metodo_pago: 'efectivo' }, 'externo', DEFAULT_CONFIG_COMISIONES);
  assert.equal(r.declarado, false);
  assert.equal(r.pct, 60);
  assert.equal(r.base, 480, 'sin IVA porque no está declarado');
  assert.equal(r.comision, 288, '480 × 60%');
});

test('comisión de un bono: Jon puede tratar un pago en efectivo como declarado aunque el método real sea efectivo', () => {
  // 480 € ÷ 1,21 = 396,694214... × 60% = 238,016528...
  const r = comisionBono({ precio: 480, metodo_pago: 'efectivo' }, 'externo', DEFAULT_CONFIG_COMISIONES, { declarado: true });
  assert.equal(r.declarado, true);
  cerca(r.base, 396.694214, 'base tras IVA aunque el método real sea efectivo');
  cerca(r.comision, 238.016528, 'comisión');
});

test('bonos liquidables de un mes: solo los confirmados como pagados ese mes, ordenados por fecha de confirmación', () => {
  const cl = [
    { nombre: 'Zoe', apellidos: '', origen: 'codek', bonos: [{ id: 1, precio: 100, pagado_el: '2026-09-05' }, { id: 2, precio: 50, pagado_el: '2026-08-20' }] },
    { nombre: 'Ana', apellidos: '', origen: 'externo', bonos: [{ id: 3, precio: 200, pagado_el: '2026-09-02' }, { id: 4, precio: 80 }] },   // sin confirmar
  ];
  const filas = bonosLiquidablesMes(cl, '2026-09');
  assert.deepEqual(filas.map(f => f.bono.id), [3, 1], 'por fecha de confirmación, no por nombre');
});

test('liquidación de un mes: aplica los overrides guardados por bono y dedup por id', () => {
  const cl = [
    { entrenador_id: 'edu', nombre: 'Pablo', apellidos: '', origen: 'externo', bonos: [{ id: 'b1', precio: 480, metodo_pago: 'efectivo', pagado_el: '2026-09-18' }] },
  ];
  const sinOverride = liquidacionMes(cl, '2026-09', DEFAULT_CONFIG_COMISIONES);
  assert.equal(sinOverride[0].comision, 288);
  const conOverride = liquidacionMes(cl, '2026-09', DEFAULT_CONFIG_COMISIONES, { b1: { declarado: true, pago_entrenador: 'nomina' } });
  // 480 ÷ 1,21 = 396,694214... ÷ 1,35 = 293,847566... × 60% = 176,308539...
  cerca(conOverride[0].comision, 176.308539, 'con declarado + nómina');
});

test('totales: importe, comisión y desglose efectivo/nómina', () => {
  const filas = [
    { bono: { precio: 300 }, comision: 120, pagoEntrenador: 'efectivo' },
    { bono: { precio: 200 }, comision: 74, pagoEntrenador: 'nomina' },
  ];
  assert.deepEqual(totalesComisiones(filas), { importe: 500, comision: 194, efectivo: 120, nomina: 74, n: 2 });
});

test('agrupar por entrenador: cada fila va con su entrenador', () => {
  const filas = [
    { cliente: { entrenador_id: 'edu' }, comision: 10 },
    { cliente: { entrenador_id: 'jes' }, comision: 20 },
    { cliente: { entrenador_id: 'edu' }, comision: 5 },
  ];
  const g = agruparComisionesPorEntrenador(filas);
  assert.equal(g.get('edu').length, 2);
  assert.equal(g.get('jes').length, 1);
});

test('entrenadores con comisión: por defecto todos, salvo el que se haya desactivado', () => {
  const entrenadores = [{ id: 'edu', aplica_comisiones: true }, { id: 'jes', aplica_comisiones: false }, { id: 'nueva' }];
  assert.deepEqual(entrenadoresConComision(entrenadores).map(e => e.id), ['edu', 'nueva']);
});
