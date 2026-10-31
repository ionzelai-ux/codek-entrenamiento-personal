// Clientes en pausa: no cuentan en renovaciones previstas, pagos programados, avisos de renovar ni en el estimado.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  estaPausado, pausaVigente, textoPausa, marcasBono, proyectarRenovaciones, facturacionMes, agrupar, estadoCobro,
} from '../js/logica.js';

const AHORA = new Date(2026, 9, 8, 12, 0);   // jueves 8 oct 2026, 12:00
const HOY = '2026-10-08';
const LUN_JUE = [{ dia: 1, hora: '10:00' }, { dia: 4, hora: '10:00' }];
const ses = (id, fecha, estado = 'reservada', hora = '10:00') => ({ id, fecha, hora, estado, duracion_min: 60 });
const bono = (id, sesiones, precio, inicio, extra = {}) => ({ id, sesiones, precio, fecha_pago: inicio, fecha_inicio: inicio, tipo: 'bono', ...extra });
const cli = (extra = {}) => ({
  id: 'c1', nombre: 'Lola', apellidos: 'Ejemplo', estado: 'efectivo', activo: true, pago_diferido: 'no', dias_fijos: LUN_JUE, entrenador_id: 'e1',
  bonos: [bono('b1', 4, 180, '2026-10-01', { pagado_el: '2026-10-01' })],
  sesiones: [ses('s1', '2026-10-01', 'hecha'), ses('s2', '2026-10-05', 'hecha'), ses('s3', '2026-10-08'), ses('s4', '2026-10-12'), ses('s5', '2026-10-15')],
  ...extra,
});

test('pausa: está pausado entre «desde» y el día de vuelta (ese día ya no); sin día de vuelta, hasta que se reanude', () => {
  const c = cli({ pausado: true, pausa_desde: '2026-10-05', pausa_hasta: '2026-11-02' });
  assert.deepEqual(['2026-10-04', '2026-10-05', '2026-11-01', '2026-11-02'].map(f => estaPausado(c, f)), [false, true, true, false]);
  const abierta = cli({ pausado: true, pausa_desde: '2026-10-05' });
  assert.equal(estaPausado(abierta, '2027-06-01'), true);
  assert.equal(estaPausado(cli(), HOY), false);                                    // sin pausa
  assert.equal(estaPausado(cli({ pausado: false, pausa_desde: '2026-10-05' }), HOY), false);
});

test('pausa vigente: en curso o por empezar; una pausa cuyo día de vuelta ya pasó se da por terminada', () => {
  assert.equal(pausaVigente(cli({ pausado: true, pausa_desde: '2026-10-20' }), HOY), true);          // empieza más adelante
  assert.equal(pausaVigente(cli({ pausado: true, pausa_hasta: '2026-10-08' }), HOY), false);         // vuelve hoy
  assert.equal(pausaVigente(cli({ pausado: true, pausa_hasta: '2026-10-09' }), HOY), true);
  assert.equal(pausaVigente(cli(), HOY), false);
});

test('texto de la pausa: motivo, desde cuándo y cuándo vuelve', () => {
  const f = iso => iso.split('-').reverse().join('/');
  assert.equal(textoPausa(cli({ pausa_motivo: 'enferma', pausa_desde: '2026-10-05', pausa_hasta: '2026-11-02' }), f), 'enferma · desde el 05/10/2026 · vuelve el 02/11/2026');
  assert.equal(textoPausa(cli({ pausa_motivo: '', pausa_desde: '2026-10-05' }), f), 'desde el 05/10/2026 · sin fecha de vuelta');
});

test('proyección: en pausa sin día de vuelta no se proyecta nada; sin pausa sí', () => {
  assert.ok(proyectarRenovaciones([cli()], HOY, '2027-01-31', AHORA).filas.length > 0);
  const pausado = cli({ pausado: true, pausa_desde: HOY });
  const r = proyectarRenovaciones([pausado], HOY, '2027-01-31', AHORA);
  assert.deepEqual([r.filas.length, r.sinEstimar.length], [0, 0]);
});

test('proyección: con día de vuelta se proyecta como si empezara ese día (la renovación no cae dentro de la pausa)', () => {
  const pausado = cli({ pausado: true, pausa_desde: HOY, pausa_hasta: '2026-11-03' });   // vuelve el martes 3 nov
  const { filas } = proyectarRenovaciones([pausado], HOY, '2027-01-31', AHORA);
  assert.ok(filas.length > 0);
  assert.ok(filas.every(f => f.fecha >= '2026-11-03'), filas.map(f => f.fecha).join());
  assert.equal(filas[0].fecha, '2026-11-03');   // su bono ya estaba reservado antes de la pausa: renueva al volver
});

test('proyección: lo que le falta por entrenar se cuenta desde que vuelve, no desde ahora', () => {
  const pocas = cli({ sesiones: [ses('s1', '2026-10-01', 'hecha'), ses('s2', '2026-10-05', 'hecha')], pausado: true, pausa_desde: HOY, pausa_hasta: '2026-11-03' });
  const { filas } = proyectarRenovaciones([pocas], HOY, '2026-12-31', AHORA);
  assert.equal(filas[0].fecha, '2026-11-09');   // le faltan 2: jue 5 nov y lun 9 nov (sin la pausa habría renovado el 12 oct)
  const sinPausa = proyectarRenovaciones([cli({ sesiones: pocas.sesiones })], HOY, '2026-12-31', AHORA).filas[0].fecha;
  assert.equal(sinPausa, '2026-10-12');
});

test('proyección: una pausa que empieza más adelante aparta las renovaciones que caen dentro', () => {
  const luego = cli({ pausado: true, pausa_desde: '2026-10-20', pausa_hasta: '2026-11-16' });
  const { filas } = proyectarRenovaciones([luego], HOY, '2026-12-31', AHORA);
  assert.equal(filas[0].fecha, '2026-10-12');                                              // antes de la pausa: sigue igual
  assert.ok(filas.every(f => f.fecha < '2026-10-20' || f.fecha >= '2026-11-16'), filas.map(f => f.fecha).join());
});

test('avisos del calendario: un cliente en pausa no marca penúltima ni última sesión', () => {
  assert.ok(marcasBono([cli()], AHORA).size > 0);
  assert.equal(marcasBono([cli({ pausado: true, pausa_desde: HOY })], AHORA).size, 0);
});

test('facturación: el pago programado dentro de la pausa no cuenta; lo cobrado, lo pendiente y lo programado tras volver, sí', () => {
  const bonos = [bono('b1', 4, 180, '2026-10-01', { pagado_el: '2026-10-01' }), bono('b2', 8, 336, '2026-10-20'), bono('b3', 8, 336, '2026-11-10'), bono('b4', 4, 100, '2026-10-06')];
  const c = cli({ bonos, pausado: true, pausa_desde: HOY, pausa_hasta: '2026-11-02' });
  const oct = facturacionMes([c], '2026-10', HOY);
  assert.deepEqual([oct.pagado, oct.pendiente, oct.programado, oct.total], [180, 100, 0, 280]);   // el programado del 20 oct se queda fuera
  const nov = facturacionMes([c], '2026-11', HOY);
  assert.equal(nov.programado, 336);                                                              // el del 10 nov es tras su vuelta
  assert.equal(facturacionMes([cli({ bonos })], '2026-10', HOY).programado, 336);                 // sin pausa cuenta
});

test('resumen por entrenador: en pausa no cuenta como cliente ni como potencial, ni su pago programado', () => {
  const lola = cli({ pausado: true, pausa_desde: HOY, bonos: [bono('b2', 8, 336, '2026-10-20')] });
  const potencial = cli({ id: 'c2', estado: 'potencial', pot_precio: 300, pausado: true, pausa_desde: HOY, bonos: [] });
  const otra = cli({ id: 'c3', bonos: [bono('b9', 4, 180, '2026-10-20')] });
  const r = agrupar([lola, potencial, otra], c => c.entrenador_id, '2026-10', HOY).get('e1');
  assert.deepEqual([r.efectivos, r.potenciales, r.estimado, r.programado], [1, 0, 0, 180]);
});

test('lista de clientes: en pausa sale «pausado» (salvo que deba algo vencido); sus pagos programados no se esperan', () => {
  const c = cli({ pausado: true, pausa_desde: HOY, pausa_hasta: '2026-12-01', bonos: [bono('b1', 4, 180, '2026-10-01', { pagado_el: '2026-10-01' }), bono('b2', 8, 336, '2026-10-20')] });
  assert.equal(estadoCobro(c, HOY, AHORA).clave, 'pausado');
  const debe = cli({ pausado: true, pausa_desde: HOY, bonos: [bono('b1', 4, 180, '2026-10-01')] });   // venció el 1 oct y no se ha cobrado
  assert.equal(estadoCobro(debe, HOY, AHORA).clave, 'pendiente');
  const futura = cli({ pausado: true, pausa_desde: '2026-10-15', pausa_hasta: '2026-11-15', bonos: [bono('b1', 4, 180, '2026-10-01', { pagado_el: '2026-10-01' }), bono('b2', 8, 336, '2026-10-20')] });
  assert.notEqual(estadoCobro(futura, HOY, AHORA).clave, 'programado');   // el pago del 20 oct cae dentro de su pausa
});
