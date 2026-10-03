import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDias, diaSemana, lunesDe, primerDiaMes, ultimoDiaMes, edad, normalizaUsuario, nombreUsuario,
  precioHoraSugerido, precioBonoSugerido, estadoEfectivo, creditos, estadoPago,
  solapan, buscarConflictos, generarFechas, repartirCarriles, agrupar, sumar, camposPendientes,
  estadoCobro, facturacionMes,
  comisionBono, esDeclaradoPorDefecto, bonosLiquidablesMes, liquidacionMes, totalesComisiones, agruparComisionesPorEntrenador,
  entrenadoresConComision, DEFAULT_CONFIG_COMISIONES, tieneLesionActiva, comisionManual, lineasManualesMes,
  consumoPorBono, precioSesionEstimado, incidenciasCliente, solapesEntrenadores, revisionDatos, deudaDiferida, planCobroSesiones, planPagoRecibido, modoDiferido,
  sesionesCambiables, horaNueva, planCambioHorario, diasFijosActualizados, etiquetaMes,
} from '../js/logica.js';
// Los ejemplos de la fórmula (82,28 €, 176,31 €…) se calcularon con el 35 % de Seguridad Social: se fija aquí para que sigan siendo exactos
// aunque cambie el valor por defecto (ahora 32,5; hay un test aparte para eso).
const CFG_35 = { ...DEFAULT_CONFIG_COMISIONES, ss_pct: 35 };

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
  assert.deepEqual(r, { total: 12, hechas: 2, reservadas: 1, noVino: 1, restantes: 10, libres: 9, sinBono: 0 });
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
  const completo = { apellidos: 'Ejemplo', telefono: '600', email: 'a@b.c', fecha_nacimiento: '1990-01-01', lesiones: 'Ninguna', estado: 'efectivo', bonos: [{ metodo_pago: 'efectivo' }] };
  assert.deepEqual(camposPendientes(completo), []);
  assert.deepEqual(camposPendientes({ ...completo, apellidos: '  ', email: null }), ['apellidos', 'email']);
  // cliente sin bono / con un bono sin método de pago
  assert.deepEqual(camposPendientes({ ...completo, bonos: [] }), ['bono']);
  assert.deepEqual(camposPendientes({ ...completo, bonos: [{ metodo_pago: 'tarjeta' }, { metodo_pago: null }] }), ['método de pago']);
  assert.deepEqual(camposPendientes({ ...completo, bonos: undefined }), ['bono']);
});

test('info pendiente: un potencial necesita sesiones, veces por semana e importe', () => {
  const pot = { apellidos: 'X', telefono: '6', email: 'e', fecha_nacimiento: '1990-01-01', lesiones: 'Ninguna', estado: 'potencial' };
  assert.deepEqual(camposPendientes(pot), ['sesiones que quiere', 'veces por semana', 'importe estimado']);
  assert.deepEqual(camposPendientes({ ...pot, pot_sesiones_bono: 8, pot_veces_semana: 2, pot_precio: 336 }), []);
  assert.deepEqual(camposPendientes({ ...pot, pot_sesiones_bono: 8, pot_veces_semana: 2, pot_precio: 0 }), ['importe estimado']);
});

test('info pendiente: lesiones cuenta como pendiente hasta que se escribe algo (aunque sea "Ninguna")', () => {
  const base = { apellidos: 'X', telefono: '6', email: 'e', fecha_nacimiento: '1990-01-01', estado: 'potencial', pot_sesiones_bono: 8, pot_veces_semana: 2, pot_precio: 336 };
  assert.deepEqual(camposPendientes(base), ['lesiones o molestias'], 'sin lesiones ni siquiera puesto');
  assert.deepEqual(camposPendientes({ ...base, lesiones: '' }), ['lesiones o molestias']);
  assert.deepEqual(camposPendientes({ ...base, lesiones: '  ' }), ['lesiones o molestias']);
  assert.deepEqual(camposPendientes({ ...base, lesiones: 'Ninguna' }), []);
  assert.deepEqual(camposPendientes({ ...base, lesiones: 'Molestia de rodilla derecha' }), []);
});

test('lesión activa: "ninguna" y similares no cuentan como alarma; lo demás sí', () => {
  for (const t of [null, undefined, '', '  ', 'Ninguna', 'ninguna.', 'Ningunas', 'No', 'NO', 'Nada', 'Sin lesiones', 'sin lesión']) {
    assert.equal(tieneLesionActiva(t), false, `no debería alarmar: ${JSON.stringify(t)}`);
  }
  for (const t of ['Molestia de rodilla derecha', 'No puede levantar peso por encima de la cabeza', 'Hernia discal L4-L5']) {
    assert.equal(tieneLesionActiva(t), true, `debería alarmar: ${JSON.stringify(t)}`);
  }
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

test('etiqueta de mes: este, siguiente, pasado (también cruzando de año) o nada', () => {
  assert.equal(etiquetaMes('2026-10', '2026-10-02'), 'ESTE MES');
  assert.equal(etiquetaMes('2026-11', '2026-10-02'), 'MES SIGUIENTE');
  assert.equal(etiquetaMes('2026-09', '2026-10-02'), 'MES PASADO');
  assert.equal(etiquetaMes('2026-08', '2026-10-02'), '');
  assert.equal(etiquetaMes('2027-01', '2026-12-31'), 'MES SIGUIENTE');
  assert.equal(etiquetaMes('2026-12', '2027-01-05'), 'MES PASADO');
});

// ── Revisión de datos: que las cifras se puedan creer ─────────────────────────
const AHORA_REV = new Date(2026, 9, 2, 12, 0);   // 2 oct 2026
const sx = (id, fecha, hora, estado = 'hecha', extra = {}) => ({ id, fecha, hora, estado, duracion_min: 60, ...extra });

// Cliente con un bono corto: un bono de 3 sesiones (105 €) y 5 hechas + 1 no vino + 1 reservada
const clienteBonoCorto = () => ({
  id: 'cli', nombre: 'Paula', apellidos: 'Ejemplo', estado: 'efectivo', activo: true, entrenador_id: 'edu',
  bonos: [{ id: 'b1', sesiones: 3, precio: 105, fecha_pago: '2026-09-15', fecha_inicio: '2026-09-15', metodo_pago: 'efectivo' }],
  sesiones: [
    sx('1', '2026-09-14', '10:30'), sx('2', '2026-09-17', '11:15'), sx('3', '2026-09-18', '10:30'), sx('4', '2026-09-21', '11:00'),
    sx('x', '2026-09-25', '10:30', 'no_vino'), sx('5', '2026-09-30', '10:00'), sx('6', '2026-10-05', '11:00', 'reservada'),
  ],
});

test('créditos: 5 hechas con un bono de 3 → quedan 0 pero 2 están sin bono (antes esto quedaba escondido)', () => {
  const cr = creditos(clienteBonoCorto(), AHORA_REV);
  assert.deepEqual([cr.total, cr.hechas, cr.reservadas, cr.noVino, cr.restantes, cr.libres, cr.sinBono], [3, 5, 1, 1, 0, -1, 2]);
  const bien = creditos({ bonos: [{ sesiones: 8 }], sesiones: [sx('a', '2026-09-14', '10:00'), sx('b', '2026-09-15', '10:00')] }, AHORA_REV);
  assert.equal(bien.sinBono, 0);
  assert.equal(bien.restantes, 6);
});

test('consumo por bono: las hechas se reparten por orden entre los bonos y lo que sobra queda sin bono', () => {
  const c = { ...clienteBonoCorto(), bonos: [
    { id: 'nuevo', sesiones: 8, precio: 280, fecha_pago: '2026-10-01', fecha_inicio: '2026-10-01' },
    { id: 'b1', sesiones: 3, precio: 105, fecha_pago: '2026-09-15', fecha_inicio: '2026-09-15' }] };
  const { porBono, sinBono } = consumoPorBono(c, AHORA_REV);
  assert.deepEqual(porBono.get('b1'), { usadas: 3, total: 3 }, 'el antiguo se gasta primero');
  assert.deepEqual(porBono.get('nuevo'), { usadas: 2, total: 8 });
  assert.equal(sinBono, 0);
  assert.equal(consumoPorBono(clienteBonoCorto(), AHORA_REV).sinBono, 2);
  assert.equal(consumoPorBono({}, AHORA_REV).sinBono, 0);
});

test('precio por sesión estimado: el del último bono, o nada si no hay bonos', () => {
  assert.equal(precioSesionEstimado(clienteBonoCorto()), 35);
  assert.equal(precioSesionEstimado({ bonos: [{ sesiones: 8, precio: 336, fecha_pago: '2026-01-01' }, { sesiones: 4, precio: 180, fecha_pago: '2026-05-01' }] }), 45);
  assert.equal(precioSesionEstimado({ bonos: [] }), null);
});

test('revisión: bono de 3 con 5 hechas → sesiones sin bono (≈ 70 €) y una reservada sin crédito', () => {
  const inc = incidenciasCliente(clienteBonoCorto(), AHORA_REV);
  const sinBono = inc.find(i => i.clave === 'sesiones_sin_bono');
  assert.equal(sinBono.nivel, 'alta');
  assert.match(sinBono.texto, /5 sesiones.*suman 3.*2 sesiones sin bono.*70,00/);
  const reservada = inc.find(i => i.clave === 'reservadas_de_mas');
  assert.equal(reservada.nivel, 'media');
  assert.match(reservada.texto, /1 sesión reservada sin crédito.*agotado/);
  assert.equal(inc[0].nivel, 'alta', 'lo más grave primero');
});

test('revisión: un cliente sin bono pero con sesiones (sin ningún bono todavía), un potencial con sesiones y un cliente sin nada', () => {
  const nora = { id: 'n', nombre: 'Nora', estado: 'efectivo', bonos: [], sesiones: ['07', '08', '11', '17', '18'].map(d => sx('n' + d, `2026-09-${d}`, '10:00', 'hecha', { nota: 'Hora no registrada' })) };
  const i = incidenciasCliente(nora, AHORA_REV);
  assert.equal(i[0].clave, 'sesiones_sin_bono');
  assert.equal(i[0].nivel, 'alta');
  assert.match(i[0].texto, /5 sesiones.*ningún bono/);
  assert.ok(i.some(x => x.clave === 'hora_aproximada' && x.nivel === 'info'));
  assert.equal(incidenciasCliente({ id: 'p', estado: 'potencial', bonos: [], sesiones: [sx('a', '2026-10-09', '10:00', 'reservada')] }, AHORA_REV)[0].clave, 'potencial_con_datos');
  assert.equal(incidenciasCliente({ id: 'p', estado: 'potencial', bonos: [], sesiones: [] }, AHORA_REV).length, 0);
  assert.equal(incidenciasCliente({ id: 'v', estado: 'efectivo', bonos: [], sesiones: [] }, AHORA_REV)[0].clave, 'sin_bono');
});

test('revisión: un cliente en orden no genera ninguna incidencia', () => {
  const ok = { id: 'ok', nombre: 'Ok', estado: 'efectivo', activo: true, entrenador_id: 'edu',
    bonos: [{ id: 'b', sesiones: 8, precio: 336, fecha_pago: '2026-09-01', fecha_inicio: '2026-09-01', metodo_pago: 'tarjeta' }],
    sesiones: [sx('a', '2026-09-14', '10:00'), sx('b', '2026-09-21', '10:00'), sx('c', '2026-10-05', '10:00', 'reservada')] };
  assert.deepEqual(incidenciasCliente(ok, AHORA_REV), []);
});

test('revisión: reservas pasadas sin confirmar, sesiones repetidas y bonos sin método de pago', () => {
  const c = { id: 'c', estado: 'efectivo', bonos: [{ id: 'b', sesiones: 8, precio: 336, fecha_pago: '2026-09-01' }], sesiones: [
    sx('a', '2026-09-28', '10:00', 'reservada'),                         // pasó y nadie la confirmó → cuenta como hecha
    sx('b', '2026-10-05', '10:00', 'reservada'), sx('c', '2026-10-05', '10:00', 'reservada'),   // repetida
  ] };
  const claves = incidenciasCliente(c, AHORA_REV).map(i => i.clave);
  assert.deepEqual(claves.sort(), ['bono_sin_metodo', 'duplicadas', 'sin_confirmar'].sort());
});

test('revisión de todos: solapes del mismo entrenador (ignorando horas sin registrar y «no vino») y orden por gravedad', () => {
  const mk = (id, ent, sesiones, extra = {}) => ({ id, nombre: id, apellidos: '', estado: 'efectivo', activo: true, entrenador_id: ent,
    bonos: [{ id: 'b' + id, sesiones: 20, precio: 800, fecha_pago: '2026-09-01', metodo_pago: 'efectivo' }], sesiones, ...extra });
  const a = mk('A', 'edu', [sx('a1', '2026-10-06', '10:00', 'reservada')]);
  const b = mk('B', 'edu', [sx('b1', '2026-10-06', '10:30', 'reservada')]);                 // choca con A
  const c = mk('C', 'edu', [sx('c1', '2026-10-06', '10:00', 'no_vino')]);                  // no vino: no cuenta
  const d = mk('D', 'edu', [sx('d1', '2026-10-06', '10:00', 'hecha', { nota: 'Hora no registrada' })]);   // hora inventada: no cuenta
  const e = mk('E', 'jes', [sx('e1', '2026-10-06', '10:15', 'reservada')]);                 // otro entrenador: no choca
  const sol = solapesEntrenadores([a, b, c, d, e]);
  assert.deepEqual(sol.map(p => [p.a.cliente.id, p.b.cliente.id]), [['A', 'B']]);
  const rev = revisionDatos([a, b, c, d, e, { ...mk('F', 'edu', []), activo: false }], AHORA_REV);
  const claves = Object.fromEntries(rev.map(r => [r.cliente.id, r.incidencias.map(i => i.clave)]));
  assert.deepEqual(claves.A, ['solape']);
  assert.deepEqual(claves.B, ['solape']);
  assert.deepEqual(claves.D, ['hora_aproximada']);
  assert.ok(!('C' in claves) && !('E' in claves) && !('F' in claves), 'los demás no aparecen (F está archivado)');
  assert.match(rev.find(r => r.cliente.id === 'A').incidencias[0].texto, /Coincide con B el 06\/10\/2026 a las 10:30/);
  // la gravedad ordena: una alta va antes que una media
  const grave = { ...mk('G', 'edu', []), bonos: [], sesiones: [sx('g1', '2026-09-14', '10:00')] };
  assert.equal(revisionDatos([a, b, grave], AHORA_REV)[0].cliente.id, 'G');
});

// ── Entrena y paga después ───────────────────────────────────────────────────
// El mismo caso sin el bono inicial: 5 hechas, 1 no vino, 1 reservada, tarifa 35 €
const clienteDiferida = (extra = {}) => ({
  id: 'cli', nombre: 'Paula', apellidos: 'Ejemplo', estado: 'efectivo', activo: true, entrenador_id: 'edu',
  pago_diferido: 'aprobado', tarifa_sesion: 35, bonos: [],
  sesiones: [
    sx('1', '2026-09-14', '10:30'), sx('2', '2026-09-17', '11:15'), sx('3', '2026-09-18', '10:30'), sx('4', '2026-09-21', '11:00'),
    sx('x', '2026-09-25', '10:30', 'no_vino'), sx('5', '2026-09-30', '10:00'), sx('6', '2026-10-05', '11:00', 'reservada'),
  ], ...extra,
});

test('deuda diferida: 5 hechas × 35 € = 175 € por cobrar; el «no vino» y la reservada no cuentan', () => {
  const d = deudaDiferida(clienteDiferida(), AHORA_REV);
  assert.deepEqual([d.n, d.importe, d.tarifa, d.cobradas, d.cobrado, d.reservadas], [5, 175, 35, 0, 0, 1]);
  assert.deepEqual(d.pendientes.map(s => s.id), ['1', '2', '3', '4', '5']);
});

test('deuda diferida: al cobrar 2 sesiones elegidas, la deuda baja justo esas 2 (aunque no sean las más antiguas)', () => {
  const c = clienteDiferida();
  const plan = planCobroSesiones(c, ['2', '4'], { fecha: '2026-10-02', metodo: 'efectivo' });
  assert.deepEqual(plan.sesionIds, ['2', '4']);
  assert.deepEqual(plan.bono, { cliente_id: 'cli', sesiones: 2, precio: 70, fecha_pago: '2026-10-02', fecha_inicio: '2026-09-17',
    metodo_pago: 'efectivo', pagado_el: '2026-10-02', tipo: 'cobro' }, 'importe por defecto = 2 × 35 €; ya pagado');
  // tras aplicarlo: el bono de cobro existe y las sesiones quedan enlazadas
  const tras = clienteDiferida({
    bonos: [{ id: 'cb', ...plan.bono }],
    sesiones: c.sesiones.map(s => (plan.sesionIds.includes(s.id) ? { ...s, cobro_bono_id: 'cb' } : s)),
  });
  const d = deudaDiferida(tras, AHORA_REV);
  assert.deepEqual(d.pendientes.map(s => s.id), ['1', '3', '5'], 'quedan por cobrar las otras tres');
  assert.deepEqual([d.n, d.importe, d.cobradas, d.cobrado], [3, 105, 2, 70]);
});

test('cobro: el importe se puede cambiar (descuento) y no hay plan sin sesiones elegidas', () => {
  const c = clienteDiferida();
  assert.equal(planCobroSesiones(c, ['1', '2'], { importe: 60, fecha: '2026-10-02', metodo: 'tarjeta' }).bono.precio, 60);
  assert.equal(planCobroSesiones(c, [], { fecha: '2026-10-02', metodo: 'efectivo' }), null);
  assert.equal(planCobroSesiones(c, ['no-existe'], { fecha: '2026-10-02', metodo: 'efectivo' }), null);
});

test('deuda diferida: sin tarifa no hay importe; con un bono normal este cubre primero las más antiguas; solo si está aprobado', () => {
  assert.equal(deudaDiferida(clienteDiferida({ tarifa_sesion: null }), AHORA_REV).importe, null);
  assert.equal(deudaDiferida(clienteDiferida({ tarifa_sesion: null }), AHORA_REV).n, 5);
  const conBono = clienteDiferida({ bonos: [{ id: 'b', sesiones: 2, precio: 70, tipo: 'bono' }] });
  assert.deepEqual(deudaDiferida(conBono, AHORA_REV).pendientes.map(s => s.id), ['3', '4', '5']);
  assert.equal(deudaDiferida(clienteDiferida({ pago_diferido: 'solicitado' }), AHORA_REV), null);
  assert.equal(deudaDiferida(clienteDiferida({ pago_diferido: 'no' }), AHORA_REV), null);
  assert.equal(deudaDiferida(clienteDiferida({ pago_diferido: undefined }), AHORA_REV), null);
});

test('info pendiente: quien paga después (aprobado) no necesita bono, pero uno solo solicitado sí', () => {
  const ficha = { apellidos: 'X', telefono: '6', email: 'e', fecha_nacimiento: '1990-01-01', lesiones: 'Ninguna', estado: 'efectivo', bonos: [] };
  assert.deepEqual(camposPendientes(ficha), ['bono']);
  assert.deepEqual(camposPendientes({ ...ficha, pago_diferido: 'aprobado' }), []);
  assert.deepEqual(camposPendientes({ ...ficha, pago_diferido: 'solicitado' }), ['bono']);
});

// ── Pago «a cuenta» (sin cuadrar con sesiones concretas) ─────────────────────
// 5 hechas a 54 € y 108 € ya pagados (el pago que ya había hecho)
const clienteACuenta = (extra = {}) => ({
  id: 'cta', nombre: 'Nora', apellidos: 'Ejemplo', estado: 'efectivo', activo: true, entrenador_id: 'edu',
  pago_diferido: 'aprobado', pago_diferido_modo: 'cuenta', tarifa_sesion: 54,
  bonos: [{ id: 'p1', sesiones: 2, precio: 108, fecha_pago: '2026-09-18', pagado_el: '2026-09-18', tipo: 'bono', metodo_pago: 'tarjeta' }],
  sesiones: ['07', '08', '11', '17', '18'].map(d => sx('c' + d, `2026-09-${d}`, '10:00')), ...extra,
});

test('a cuenta: debe (sesiones hechas × tarifa) − lo pagado, en euros y sin cuadrar sesiones', () => {
  const d = deudaDiferida(clienteACuenta(), AHORA_REV);
  assert.equal(d.modo, 'cuenta');
  assert.deepEqual([d.n, d.valor, d.pagado, d.importe, d.aFavor, d.debe], [5, 270, 108, 162, 0, true]);
  assert.deepEqual(d.pendientes, [], 'no hay sesiones «por cobrar» concretas');
  // un pago recibido de 100 € (cobro de 0 sesiones): ya no hace falta que cuadre con nada
  const plan = planPagoRecibido(clienteACuenta(), { importe: '100', fecha: '2026-10-03', metodo: 'efectivo' });
  assert.deepEqual(plan, { cliente_id: 'cta', sesiones: 0, precio: 100, fecha_pago: '2026-10-03', fecha_inicio: '2026-10-03', metodo_pago: 'efectivo', pagado_el: '2026-10-03', tipo: 'cobro' });
  const tras = clienteACuenta({ bonos: [...clienteACuenta().bonos, { id: 'p2', ...plan }] });
  const d2 = deudaDiferida(tras, AHORA_REV);
  assert.deepEqual([d2.pagado, d2.importe, d2.debe], [208, 62, true]);
  // paga de más → saldo a favor, y ya no debe nada
  const d3 = deudaDiferida(clienteACuenta({ bonos: [{ id: 'x', sesiones: 0, precio: 300, pagado_el: '2026-10-03', tipo: 'cobro' }] }), AHORA_REV);
  assert.deepEqual([d3.importe, d3.aFavor, d3.debe], [0, 30, false]);
  // un pago exacto: al día
  const d4 = deudaDiferida(clienteACuenta({ bonos: [{ id: 'x', sesiones: 0, precio: 270, pagado_el: '2026-10-03', tipo: 'cobro' }] }), AHORA_REV);
  assert.deepEqual([d4.importe, d4.aFavor, d4.debe], [0, 0, false]);
  // lo que no está confirmado como pagado no cuenta; con comas y decimales
  assert.equal(deudaDiferida(clienteACuenta({ bonos: [{ id: 'y', sesiones: 0, precio: 500, tipo: 'cobro' }] }), AHORA_REV).pagado, 0);
  assert.equal(planPagoRecibido(clienteACuenta(), { importe: '37,5', fecha: '2026-10-03', metodo: 'efectivo' }).precio, 37.5);
});

test('a cuenta: sin tarifa no hay importe; importes inválidos no generan pago; la modalidad por defecto es «sesion»', () => {
  const sin = deudaDiferida(clienteACuenta({ tarifa_sesion: null, bonos: [] }), AHORA_REV);
  assert.deepEqual([sin.valor, sin.importe, sin.debe], [null, null, true], 'hay sesiones hechas y nada pagado');
  assert.equal(deudaDiferida(clienteACuenta({ tarifa_sesion: null }), AHORA_REV).debe, false, 'con algo pagado y sin tarifa no se puede afirmar que deba');
  for (const importe of ['', '0', '-5', 'abc', null, undefined]) assert.equal(planPagoRecibido(clienteACuenta(), { importe, fecha: '2026-10-03', metodo: 'efectivo' }), null, `importe ${importe}`);
  assert.equal(planPagoRecibido(clienteACuenta(), { importe: '10', fecha: '', metodo: 'efectivo' }), null, 'sin fecha');
  assert.equal(modoDiferido({ pago_diferido_modo: 'cuenta' }), 'cuenta');
  assert.equal(modoDiferido({}), 'sesion');
  assert.equal(deudaDiferida(clienteDiferida(), AHORA_REV).modo, 'sesion');
  assert.equal(deudaDiferida(clienteDiferida(), AHORA_REV).debe, true);
});

test('a cuenta: sus pagos NO generan comisión automática (se pone a mano), los demás sí', () => {
  const normal = { id: 'n', nombre: 'Ok', apellidos: '', estado: 'efectivo', entrenador_id: 'edu', origen: 'codek', bonos: [{ id: 'bn', precio: 100, pagado_el: '2026-10-02', metodo_pago: 'efectivo', sesiones: 4 }] };
  const aCuenta = clienteACuenta({ bonos: [{ id: 'bc', sesiones: 0, precio: 100, pagado_el: '2026-10-02', tipo: 'cobro' }] });
  const porSesion = clienteDiferida({ bonos: [{ id: 'bs', sesiones: 2, precio: 70, pagado_el: '2026-10-02', tipo: 'cobro' }] });
  assert.deepEqual(bonosLiquidablesMes([normal, aCuenta, porSesion], '2026-10').map(f => f.bono.id).sort(), ['bn', 'bs']);
  // y si deja de estar a cuenta (o no está aprobado), vuelven a contar
  assert.ok(bonosLiquidablesMes([{ ...aCuenta, pago_diferido_modo: 'sesion' }], '2026-10').some(f => f.bono.id === 'bc'));
  assert.ok(bonosLiquidablesMes([{ ...aCuenta, pago_diferido: 'no' }], '2026-10').some(f => f.bono.id === 'bc'));
});

test('revisión: a cuenta avisa de lo que debe en euros y del saldo a favor', () => {
  const inc = incidenciasCliente(clienteACuenta(), AHORA_REV);
  assert.deepEqual(inc.map(i => i.clave), ['deuda_diferida']);
  assert.match(inc[0].texto, /5 sesiones hechas = 270,00.*pagado 108,00.*debe 162,00/);
  const favor = incidenciasCliente(clienteACuenta({ bonos: [{ id: 'x', sesiones: 0, precio: 300, pagado_el: '2026-10-03', tipo: 'cobro' }] }), AHORA_REV);
  assert.deepEqual(favor.map(i => i.clave), ['saldo_a_favor']);
  assert.match(favor[0].texto, /30,00.*saldo a favor/);
  assert.deepEqual(incidenciasCliente(clienteACuenta({ bonos: [{ id: 'x', sesiones: 0, precio: 270, pagado_el: '2026-10-03', tipo: 'cobro' }] }), AHORA_REV), []);
});

test('quien paga después no pasa a «RENOVAR»', () => {
  const pagado = { id: 'cb', sesiones: 5, precio: 175, fecha_pago: '2026-10-02', pagado_el: '2026-10-02', tipo: 'cobro' };
  const normal = { ...clienteDiferida({ pago_diferido: 'no', bonos: [pagado] }) };
  assert.equal(estadoCobro(normal, '2026-10-02', AHORA_REV).clave, 'renovar', 'un cliente normal con el bono gastado sí');
  assert.equal(estadoCobro(clienteDiferida({ bonos: [pagado] }), '2026-10-02', AHORA_REV).clave, 'pagado');
});

test('revisión: un cliente que paga después no sale como incoherente; una solicitud pendiente sí avisa', () => {
  const inc = incidenciasCliente(clienteDiferida(), AHORA_REV);
  assert.deepEqual(inc.map(i => [i.nivel, i.clave]), [['info', 'deuda_diferida']]);
  assert.match(inc[0].texto, /debe 5 sesiones.*175,00/);
  assert.ok(incidenciasCliente(clienteDiferida({ tarifa_sesion: null }), AHORA_REV).some(i => i.clave === 'sin_tarifa' && i.nivel === 'media'));
  // solicitado (aún no aprobado): se sigue tratando como un cliente normal (rojo) y además avisa de la solicitud
  const sol = incidenciasCliente(clienteDiferida({ pago_diferido: 'solicitado' }), AHORA_REV).map(i => i.clave);
  assert.ok(sol.includes('solicitud_pendiente') && sol.includes('sesiones_sin_bono'));
  // aprobado y sin deuda: nada que avisar
  const alDia = clienteDiferida({ sesiones: [sx('1', '2026-09-14', '10:00', 'hecha', { cobro_bono_id: 'cb' })], bonos: [{ id: 'cb', sesiones: 1, precio: 35, tipo: 'cobro', pagado_el: '2026-09-15' }] });
  assert.deepEqual(incidenciasCliente(alDia, AHORA_REV), []);
});

// ── Comisiones de los entrenadores ──────────────────────────────────────────
const cerca = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: ${a} ≈ ${b}`);

test('condiciones por defecto: 40 % Codek, 60 % externo, 21 % IVA y 32,5 % de Seguridad Social', () => {
  assert.deepEqual(DEFAULT_CONFIG_COMISIONES, { comision_codek: 40, comision_externo: 60, iva_pct: 21, ss_pct: 32.5 });
  // con el valor por defecto: 336 € declarado y en nómina, cliente Codek → 336 ÷ 1,21 ÷ 1,325 × 40 % = 83,8…
  const r = comisionBono({ precio: 336, metodo_pago: 'tarjeta' }, 'codek', DEFAULT_CONFIG_COMISIONES, { pago_entrenador: 'nomina' });
  cerca(r.comision, 336 / 1.21 / 1.325 * 0.4, 'con el 32,5 %');
  cerca(r.comision, 83.8332, 'valor numérico');
});

test('declarado por defecto: tarjeta y transferencia sí, efectivo no', () => {
  assert.equal(esDeclaradoPorDefecto('tarjeta'), true);
  assert.equal(esDeclaradoPorDefecto('transferencia'), true);
  assert.equal(esDeclaradoPorDefecto('efectivo'), false);
  assert.equal(esDeclaradoPorDefecto(undefined), false);
});

test('comisión de un bono: cliente Codek con tarjeta, pagado en nómina (ejemplo de Jon)', () => {
  // 336 € ÷ 1,21 = 277,685950... ÷ 1,35 = 205,693296... × 40% = 82,277318...
  const r = comisionBono({ precio: 336, metodo_pago: 'tarjeta' }, 'codek', CFG_35, { pago_entrenador: 'nomina' });
  assert.equal(r.declarado, true);
  assert.equal(r.pagoEntrenador, 'nomina');
  assert.equal(r.pct, 40);
  cerca(r.base, 205.693296, 'base tras IVA y Seguridad Social');
  cerca(r.comision, 82.277318, 'comisión');
});

test('comisión de un bono: mismo caso pero pagado en efectivo (sin descuento de Seguridad Social)', () => {
  // 336 € ÷ 1,21 = 277,685950... × 40% = 111,074380...
  const r = comisionBono({ precio: 336, metodo_pago: 'tarjeta' }, 'codek', CFG_35);
  assert.equal(r.pagoEntrenador, 'efectivo', 'sin override, por defecto efectivo');
  cerca(r.base, 277.685950, 'base tras IVA, sin Seguridad Social');
  cerca(r.comision, 111.074380, 'comisión');
});

test('comisión de un bono: cliente externo en efectivo, sin declarar (comisión más alta, sin descuentos)', () => {
  const r = comisionBono({ precio: 480, metodo_pago: 'efectivo' }, 'externo', CFG_35);
  assert.equal(r.declarado, false);
  assert.equal(r.pct, 60);
  assert.equal(r.base, 480, 'sin IVA porque no está declarado');
  assert.equal(r.comision, 288, '480 × 60%');
});

test('comisión de un bono: Jon puede tratar un pago en efectivo como declarado aunque el método real sea efectivo', () => {
  // 480 € ÷ 1,21 = 396,694214... × 60% = 238,016528...
  const r = comisionBono({ precio: 480, metodo_pago: 'efectivo' }, 'externo', CFG_35, { declarado: true });
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
  const sinOverride = liquidacionMes(cl, '2026-09', CFG_35);
  assert.equal(sinOverride[0].comision, 288);
  const conOverride = liquidacionMes(cl, '2026-09', CFG_35, { b1: { declarado: true, pago_entrenador: 'nomina' } });
  // 480 ÷ 1,21 = 396,694214... ÷ 1,35 = 293,847566... × 60% = 176,308539...
  cerca(conOverride[0].comision, 176.308539, 'con declarado + nómina');
});

test('totales: importe, comisión y desglose efectivo/nómina', () => {
  const filas = [
    { bono: { precio: 300 }, comision: 120, pagoEntrenador: 'efectivo' },
    { bono: { precio: 200 }, comision: 74, pagoEntrenador: 'nomina' },
  ];
  assert.deepEqual(totalesComisiones(filas), { importe: 500, comision: 194, efectivo: 120, nomina: 74, n: 2, excluidos: 0, importeExcluido: 0, manuales: 0, comisionManual: 0 });
});

test('comisión manual: clases × precio por clase, % del origen o el que se escriba, y los mismos descuentos', () => {
  const cfg = CFG_35;
  // 6 clases × 40 € = 240 €; cliente Codek (40 %), efectivo y sin declarar: 240 × 40 % = 96
  const a = comisionManual({ clases: 6, precio: 40, origen: 'codek', declarado: false, pago_entrenador: 'efectivo' }, cfg);
  assert.equal(a.importe, 240);
  assert.equal(a.pct, 40);
  assert.equal(a.pctDefecto, 40);
  assert.equal(a.comision, 96);
  // el % se puede escribir a mano (aquí 50 %) y deja de usarse el del origen
  const b = comisionManual({ clases: 6, precio: 40, pct: 50, origen: 'codek' }, cfg);
  assert.equal(b.pct, 50);
  assert.equal(b.pctDefecto, 40, 'se sigue conociendo el por defecto');
  assert.equal(b.comision, 120);
  // un 0 escrito a mano es un 0, no «vacío»
  assert.equal(comisionManual({ clases: 6, precio: 40, pct: 0, origen: 'codek' }, cfg).comision, 0);
  // declarado: 240 ÷ 1,21 = 198,347… × 40 % = 79,338…; y además nómina: ÷ 1,35 = 146,924… × 40 % = 58,769…
  cerca(comisionManual({ clases: 6, precio: 40, origen: 'codek', declarado: true }, cfg).comision, 79.338843, 'declarado');
  cerca(comisionManual({ clases: 6, precio: 40, origen: 'codek', declarado: true, pago_entrenador: 'nomina' }, cfg).comision, 58.769513, 'declarado y nómina');
  // sin origen conocido (línea suelta) se usa el de «externo»; vacío o texto raro = 0, sin romper nada
  assert.equal(comisionManual({ clases: 2, precio: 50, origen: 'externo' }, cfg).comision, 60);
  assert.equal(comisionManual({ clases: null, precio: undefined }, cfg).comision, 0);
  assert.equal(comisionManual({ clases: 'abc', precio: 40 }, cfg).importe, 0);
});

test('líneas manuales del mes: los bonos excluidos (con sus campos guardados) y las líneas libres de ese mes', () => {
  const cfg = CFG_35;
  const cl = [{ entrenador_id: 'edu', nombre: 'Nora', apellidos: '', origen: 'codek', bonos: [
    { id: 'b1', precio: 336, metodo_pago: 'efectivo', pagado_el: '2026-10-02' },
    { id: 'b2', precio: 100, metodo_pago: 'efectivo', pagado_el: '2026-10-03' }] }];
  const ov = { b1: { excluido: true, manual_clases: 6, manual_precio: 40 }, b2: { declarado: true } };
  const filas = liquidacionMes(cl, '2026-10', cfg, ov);
  const libres = [
    { id: 'l1', mes: '2026-10', entrenador_id: 'edu', concepto: 'Clases sueltas', clases: 2, precio: 50, pct: null, declarado: false, pago_entrenador: 'nomina' },
    { id: 'l2', mes: '2026-09', entrenador_id: 'edu', concepto: 'De otro mes', clases: 9, precio: 99, pct: null, declarado: false, pago_entrenador: 'efectivo' },
  ];
  const lineas = lineasManualesMes(filas, libres, '2026-10', cfg, ov);
  assert.deepEqual(lineas.map(l => [l.tipo, l.id]), [['bono', 'b1'], ['libre', 'l1']], 'solo el excluido y la libre de octubre');
  assert.equal(lineas[0].concepto, 'Nora');
  assert.equal(lineas[0].comision, 96, '6 × 40 € × 40 % (Codek)');
  assert.equal(lineas[0].pct_manual, null, 'sin % escrito: se ve el por defecto');
  // libre: 2 × 50 = 100 ÷ 1,35 (nómina) × 60 % (externo) = 44,44…
  cerca(lineas[1].comision, 44.444444, 'línea suelta con nómina');
  // un bono excluido sin rellenar todavía no comisiona nada
  const vacia = lineasManualesMes(filas, [], '2026-10', cfg, { b1: { excluido: true } });
  assert.equal(vacia[0].comision, 0);
  // totales: el bono incluido (b2, declarado: 100 ÷ 1,21 × 40 %) + las dos líneas manuales; el excluido no cuenta como bono
  const t = totalesComisiones(filas, lineas);
  assert.equal(t.n, 1);
  assert.equal(t.excluidos, 1);
  assert.equal(t.manuales, 2);
  cerca(t.comisionManual, 96 + 44.444444, 'solo lo manual');
  cerca(t.comision, 100 / 1.21 * 0.4 + 96 + 44.444444, 'comisión total = bono incluido + manuales');
  cerca(t.efectivo, 100 / 1.21 * 0.4 + 96, 'efectivo');
  cerca(t.nomina, 44.444444, 'nómina');
});

test('excluir un bono de la liquidación: no comisiona, y no entra en los totales (se resume aparte)', () => {
  const bono = { precio: 480, metodo_pago: 'efectivo' };
  const normal = comisionBono(bono, 'externo', CFG_35);
  const excl = comisionBono(bono, 'externo', CFG_35, { excluido: true });
  assert.equal(normal.excluido, false);
  assert.equal(normal.comision, 288);
  assert.equal(excl.excluido, true);
  assert.equal(excl.comision, 0);
  assert.equal(excl.base, 480, 'se sigue viendo la base para poder volver a incluirlo');
  // volver a incluirlo (excluido: false) lo deja como antes; el resto de ajustes se respeta
  assert.equal(comisionBono(bono, 'externo', CFG_35, { excluido: false, pago_entrenador: 'nomina' }).excluido, false);

  const filas = [
    { bono: { precio: 300 }, comision: 120, pagoEntrenador: 'efectivo', excluido: false },
    { bono: { precio: 200 }, comision: 0, pagoEntrenador: 'efectivo', excluido: true },
    { bono: { precio: 100 }, comision: 0, pagoEntrenador: 'nomina', excluido: true },
  ];
  assert.deepEqual(totalesComisiones(filas), { importe: 300, comision: 120, efectivo: 120, nomina: 0, n: 1, excluidos: 2, importeExcluido: 300, manuales: 0, comisionManual: 0 });
});

test('liquidación del mes: el override «excluido» llega a la fila y deja la comisión a cero', () => {
  const cl = [{ entrenador_id: 'edu', nombre: 'Ana', apellidos: '', origen: 'codek', bonos: [
    { id: 'b1', precio: 336, metodo_pago: 'tarjeta', pagado_el: '2026-10-02' }, { id: 'b2', precio: 100, metodo_pago: 'efectivo', pagado_el: '2026-10-03' }] }];
  const filas = liquidacionMes(cl, '2026-10', CFG_35, { b1: { excluido: true } });
  assert.deepEqual(filas.map(f => [f.bono.id, f.excluido, f.comision > 0]), [['b1', true, false], ['b2', false, true]]);
  assert.equal(totalesComisiones(filas).n, 1);
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

// ── Cambio de horario en bloque ─────────────────────────────────────────────
test('hora nueva: desplazar (antes/después), fijar, y fuera del día', () => {
  assert.equal(horaNueva('10:00', { modo: 'desplazar', minutos: -30 }), '09:30');
  assert.equal(horaNueva('10:00', { modo: 'desplazar', minutos: 30 }), '10:30');
  assert.equal(horaNueva('10:30', { modo: 'desplazar', minutos: -45 }), '09:45');
  assert.equal(horaNueva('00:15', { modo: 'desplazar', minutos: -30 }), null, 'antes de las 00:00');
  assert.equal(horaNueva('23:45', { modo: 'desplazar', minutos: 30 }), null, 'pasada la medianoche');
  assert.equal(horaNueva('10:00', { modo: 'fijar', hora: '9:30' }), '09:30');
  assert.equal(horaNueva('10:00', { modo: 'fijar', hora: '' }), null);
  assert.equal(horaNueva('10:00', { modo: 'desplazar', minutos: 'abc' }), null);
});

test('sesiones cambiables: solo reservadas que aún no han pasado, ordenadas', () => {
  const ahora = new Date(2026, 9, 2, 12, 0);
  const c = { sesiones: [
    { id: 'c', fecha: '2026-10-08', hora: '10:00', estado: 'reservada' },
    { id: 'a', fecha: '2026-10-05', hora: '10:00', estado: 'reservada' },
    { id: 'pasada', fecha: '2026-09-30', hora: '10:00', estado: 'reservada' },   // ya pasó sin confirmar → auto
    { id: 'hecha', fecha: '2026-10-06', hora: '10:00', estado: 'hecha' },
    { id: 'novino', fecha: '2026-10-07', hora: '10:00', estado: 'no_vino' },
  ] };
  assert.deepEqual(sesionesCambiables(c, ahora).map(s => s.id), ['a', 'c']);
  assert.deepEqual(sesionesCambiables({}, ahora), []);
});

test('plan de cambio: detecta choques con otras sesiones del entrenador, pero no con las que se mueven', () => {
  const s1 = { id: 's1', fecha: '2026-10-05', hora: '10:00', duracion_min: 60 };
  const s2 = { id: 's2', fecha: '2026-10-07', hora: '10:00', duracion_min: 60 };
  const ajena = { id: 'x', fecha: '2026-10-05', hora: '09:00', duracion_min: 60, estado: 'reservada' };   // 09:00–10:00
  const ajenaLibre = { id: 'y', fecha: '2026-10-07', hora: '08:00', duracion_min: 60, estado: 'reservada' };   // 08:00–09:00
  const plan = planCambioHorario([s1, s2], new Set(['s1', 's2']), { modo: 'desplazar', minutos: -30 }, [s1, s2, ajena, ajenaLibre]);
  assert.deepEqual(plan.map(p => p.hora_despues), ['09:30', '09:30']);
  assert.deepEqual(plan[0].conflictos.map(x => x.id), ['x'], '09:30–10:30 pisa a la de las 09:00');
  assert.deepEqual(plan[1].conflictos.map(x => x.id), [], '09:30–10:30 no pisa a la de las 08:00 (acaba a las 09:00)');
  // una sesión desmarcada no se evalúa (no se va a mover), y su hueco sigue ocupado para las demás
  const sin = planCambioHorario([s1, s2], new Set(['s2']), { modo: 'desplazar', minutos: -30 }, [s1, s2, ajena]);
  assert.deepEqual(sin[0].conflictos, [], 'desmarcada: no se evalúa');
  const entreSi = planCambioHorario([s1, { ...s2, fecha: '2026-10-05', hora: '09:00', id: 's3' }], new Set(['s1']), { modo: 'desplazar', minutos: -30 }, []);
  assert.deepEqual(entreSi[0].conflictos, [], 'sin existentes no hay choques');
});

test('plan de cambio: una sesión que se sale del día queda sin hora nueva y sin choques', () => {
  const s = { id: 's', fecha: '2026-10-05', hora: '00:15', duracion_min: 60 };
  const [p] = planCambioHorario([s], new Set(['s']), { modo: 'desplazar', minutos: -30 }, []);
  assert.equal(p.hora_despues, null);
  assert.deepEqual(p.conflictos, []);
});

test('días fijos: solo cambian los que coinciden con una sesión movida', () => {
  const dias = [{ dia: 1, hora: '10:00' }, { dia: 3, hora: '10:00' }, { dia: 4, hora: '19:00' }];
  // lunes 5 y miércoles 7 de octubre de 2026 pasan de 10:00 a 09:30
  const cambios = [
    { fecha: '2026-10-05', hora_antes: '10:00', hora_despues: '09:30' },
    { fecha: '2026-10-07', hora_antes: '10:00', hora_despues: '09:30' },
  ];
  assert.deepEqual(diasFijosActualizados(dias, cambios), [{ dia: 1, hora: '09:30' }, { dia: 3, hora: '09:30' }, { dia: 4, hora: '19:00' }]);
  // si solo se mueve la del lunes, el miércoles no se toca
  assert.deepEqual(diasFijosActualizados(dias, [cambios[0]]), [{ dia: 1, hora: '09:30' }, { dia: 3, hora: '10:00' }, { dia: 4, hora: '19:00' }]);
  // sin cambios reales (o sin días fijos) no cambia nada
  assert.deepEqual(diasFijosActualizados(dias, [{ fecha: '2026-10-05', hora_antes: '10:00', hora_despues: '10:00' }]), dias);
  assert.deepEqual(diasFijosActualizados(undefined, cambios), []);
});
