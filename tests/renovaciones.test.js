// Renovaciones: marcas de penúltima / última sesión, bono vigente y proyección de ingresos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { marcasBono, bonoVigente, planProximoBono, proyectarRenovaciones, aplicaRenovacion, precioBonoSugerido } from '../js/logica.js';

const AHORA = new Date(2026, 9, 8, 12, 0);   // jueves 8 oct 2026, 12:00
const HOY = '2026-10-08';
const LUN_JUE = [{ dia: 1, hora: '10:00' }, { dia: 4, hora: '10:00' }];
const ses = (id, fecha, estado = 'reservada', hora = '10:00') => ({ id, fecha, hora, estado, duracion_min: 60 });
const bono = (id, sesiones, precio, inicio, extra = {}) => ({ id, sesiones, precio, fecha_pago: inicio, fecha_inicio: inicio, tipo: 'bono', ...extra });
const cli = (extra = {}) => ({
  id: 'c1', nombre: 'Paula', apellidos: 'Ejemplo', estado: 'efectivo', activo: true, pago_diferido: 'no', dias_fijos: LUN_JUE,
  bonos: [bono('b1', 4, 180, '2026-10-01')],
  sesiones: [ses('s1', '2026-10-01', 'hecha'), ses('s2', '2026-10-05', 'hecha'), ses('s3', '2026-10-08'), ses('s4', '2026-10-12'), ses('s5', '2026-10-15')],
  ...extra,
});

test('marcas: la penúltima y la última sesión que cubre el bono (la de hoy sin confirmar ya cuenta como hecha)', () => {
  const m = marcasBono([cli()], AHORA);
  assert.equal(m.get('s3'), 'penultima');     // 8 oct: 3.ª de 4 (pasó su hora → cuenta como hecha)
  assert.equal(m.get('s4'), 'ultima');        // 12 oct: 4.ª de 4
  assert.equal(m.has('s1'), false);
  assert.equal(m.has('s5'), false);           // la 5.ª ya no tiene bono: no es marca de renovación
});

test('marcas: bono de una sesión solo tiene «última»; si ya compró el siguiente no se marca nada antes', () => {
  const uno = cli({ bonos: [bono('b1', 1, 45, '2026-10-12')], sesiones: [ses('s4', '2026-10-12')] });
  assert.deepEqual([...marcasBono([uno], AHORA)], [['s4', 'ultima']]);
  const dos = cli({ bonos: [bono('b1', 4, 180, '2026-10-01'), bono('b2', 4, 180, '2026-10-20')],
    sesiones: [ses('s1', '2026-10-01', 'hecha'), ses('s2', '2026-10-05', 'hecha'), ses('s3', '2026-10-08'), ses('s4', '2026-10-12'), ses('s5', '2026-10-15'), ses('s6', '2026-10-19'), ses('s7', '2026-10-22'), ses('s8', '2026-10-26')] });
  const m = marcasBono([dos], AHORA);
  assert.equal(m.has('s3'), false);
  assert.equal(m.has('s4'), false);
  assert.equal(m.get('s7'), 'penultima');
  assert.equal(m.get('s8'), 'ultima');
});

test('marcas: no_vino no gasta crédito; los que pagan después y los potenciales no se marcan; no_renueva sí (es un aviso de clase)', () => {
  const noVino = cli({ sesiones: [ses('s1', '2026-10-01', 'hecha'), ses('s2', '2026-10-05', 'no_vino'), ses('s3', '2026-10-08'), ses('s4', '2026-10-12'), ses('s5', '2026-10-15')] });
  assert.equal(marcasBono([noVino], AHORA).get('s4'), 'penultima');
  assert.equal(marcasBono([noVino], AHORA).get('s5'), 'ultima');
  assert.equal(marcasBono([cli({ pago_diferido: 'aprobado' })], AHORA).size, 0);
  assert.equal(marcasBono([cli({ estado: 'potencial' })], AHORA).size, 0);
  assert.equal(marcasBono([cli({ no_renueva: true })], AHORA).size, 2);
});

test('bono vigente: el que se está gastando, con lo reservado y lo que falta por reservar y por realizar', () => {
  const c = cli({ bonos: [bono('b1', 8, 336, '2026-10-01')],
    sesiones: [ses('s1', '2026-10-01', 'hecha'), ses('s2', '2026-10-05', 'hecha'), ses('s3', '2026-10-08'), ses('s4', '2026-10-12'), ses('s5', '2026-10-15')] });
  const v = bonoVigente(c, AHORA);
  assert.deepEqual({ total: v.total, hechas: v.hechas, reservadas: v.reservadas, pendReserva: v.pendReserva, pendRealizar: v.pendRealizar },
    { total: 8, hechas: 3, reservadas: 2, pendReserva: 3, pendRealizar: 5 });
});

test('bono vigente: con varios bonos es el primero que aún tiene sesiones; gastados todos, el último', () => {
  const dos = cli({ bonos: [bono('b1', 4, 180, '2026-09-01'), bono('b2', 8, 336, '2026-10-01')],
    sesiones: [ses('a', '2026-09-02', 'hecha'), ses('b', '2026-09-09', 'hecha'), ses('c', '2026-09-16', 'hecha'), ses('d', '2026-09-23', 'hecha'), ses('e', '2026-10-01', 'hecha'), ses('f', '2026-10-15')] });
  const v = bonoVigente(dos, AHORA);
  assert.equal(v.bono.id, 'b2');
  assert.deepEqual([v.total, v.hechas, v.reservadas, v.pendReserva, v.pendRealizar], [8, 1, 1, 6, 7]);
  const gastado = cli({ bonos: [bono('b1', 2, 90, '2026-09-01')], sesiones: [ses('a', '2026-09-02', 'hecha'), ses('b', '2026-09-09', 'hecha')] });
  assert.deepEqual([bonoVigente(gastado, AHORA).total, bonoVigente(gastado, AHORA).pendRealizar], [2, 0]);
  assert.equal(bonoVigente(cli({ bonos: [] }), AHORA), null);
});

test('próximo bono: igual que el último, o el que haya indicado (con su precio o el sugerido)', () => {
  assert.deepEqual([planProximoBono(cli()).sesiones, planProximoBono(cli()).precio, planProximoBono(cli()).cambiado], [4, 180, false]);
  const c8 = planProximoBono(cli({ proximo_bono_sesiones: 8, proximo_bono_precio: 300 }));
  assert.deepEqual([c8.sesiones, c8.precio, c8.cambiado], [8, 300, true]);
  const sug = planProximoBono(cli({ proximo_bono_sesiones: 8 }));
  assert.equal(sug.precio, precioBonoSugerido(8));
  assert.equal(planProximoBono(cli({ bonos: [] })), null);
});

test('proyección: cuando se acaba el bono renueva (mismo día de la última sesión) y se encadenan las siguientes con sus días fijos', () => {
  const { filas, sinEstimar } = proyectarRenovaciones([cli()], HOY, '2027-01-31', AHORA);
  assert.equal(sinEstimar.length, 0);
  assert.deepEqual(filas.slice(0, 3).map(f => [f.fecha, f.sesiones, f.importe, f.numero]), [
    ['2026-10-12', 4, 180, 1],   // 4.ª sesión del bono actual
    ['2026-10-26', 4, 180, 2],   // jue 15, lun 19, jue 22, lun 26
    ['2026-11-09', 4, 180, 3],   // jue 29, lun 2, jue 5, lun 9
  ]);
  assert.ok(filas.every(f => f.fecha <= '2027-01-31'));
});

test('proyección: si no están reservadas todas las sesiones, se completan con los días fijos', () => {
  const pocas = cli({ sesiones: [ses('s1', '2026-10-01', 'hecha')] });
  const { filas } = proyectarRenovaciones([pocas], HOY, '2026-10-31', AHORA);
  assert.equal(filas[0].fecha, '2026-10-12');   // lun 5, jue 8, lun 12
});

test('proyección: cambia de bono (4 → 8) y se sigue proyectando con el nuevo', () => {
  const { filas } = proyectarRenovaciones([cli({ proximo_bono_sesiones: 8, proximo_bono_precio: 336 })], HOY, '2026-12-31', AHORA);
  assert.deepEqual(filas.slice(0, 2).map(f => [f.fecha, f.sesiones, f.importe, f.cambiado]), [
    ['2026-10-12', 8, 336, true],
    ['2026-11-09', 8, 336, false],     // 8 sesiones desde el 13: jue 15 … lun 9 nov
  ]);
});

test('proyección: «no va a renovar», paga después, potenciales y archivados no cuentan', () => {
  const todos = [cli({ no_renueva: true }), cli({ id: 'c2', pago_diferido: 'aprobado' }), cli({ id: 'c3', estado: 'potencial' }), cli({ id: 'c4', activo: false })];
  assert.equal(proyectarRenovaciones(todos, HOY, '2027-03-31', AHORA).filas.length, 0);
  assert.equal(aplicaRenovacion(todos[0]), true);
  assert.equal(aplicaRenovacion(todos[3]), false);
});

test('proyección: bono ya agotado → se proyecta para hoy; sin días fijos ni sesiones suficientes → sin estimar', () => {
  const agotado = cli({ bonos: [bono('b1', 2, 90, '2026-09-01')], sesiones: [ses('a', '2026-09-02', 'hecha'), ses('b', '2026-09-09', 'hecha')] });
  assert.equal(proyectarRenovaciones([agotado], HOY, '2026-10-31', AHORA).filas[0].fecha, HOY);
  const sinDias = cli({ dias_fijos: [], sesiones: [ses('s1', '2026-10-01', 'hecha')] });
  const r = proyectarRenovaciones([sinDias], HOY, '2026-12-31', AHORA);
  assert.deepEqual([r.filas.length, r.sinEstimar.length], [0, 1]);
});

test('proyección: sin días fijos pero con todas las sesiones reservadas solo se proyecta la primera renovación', () => {
  const r = proyectarRenovaciones([cli({ dias_fijos: [] })], HOY, '2027-03-31', AHORA);
  assert.deepEqual(r.filas.map(f => f.fecha), ['2026-10-12']);
});
