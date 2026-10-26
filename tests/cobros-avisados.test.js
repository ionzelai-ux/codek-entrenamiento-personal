// Cobros que avisa el entrenador y valida el administrador.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cobroAvisado, bonosAvisados, bonosAvisables, resumenPorValidar, cambiosValidarCobro, estadoPago, avisosDiferido } from '../js/logica.js';

const b = (id, precio, extra = {}) => ({ id, sesiones: 4, precio, fecha_pago: '2026-10-20', fecha_inicio: '2026-10-20', tipo: 'bono', metodo_pago: 'tarjeta', pagado_el: null, ...extra });
const cli = (id, bonos, extra = {}) => ({ id, nombre: id, activo: true, estado: 'efectivo', bonos, ...extra });

test('un bono avisado sigue sin estar pagado: solo cuenta como «por validar»', () => {
  const avisado = b('b1', 180, { cobro_avisado_el: '2026-10-24', cobro_avisado_metodo: 'efectivo' });
  assert.equal(cobroAvisado(avisado), true);
  assert.equal(estadoPago(avisado, '2026-10-26'), 'pendiente');   // el estado de pago real no cambia hasta validarlo
  assert.equal(cobroAvisado(b('b2', 180)), false);
  assert.equal(cobroAvisado(b('b3', 180, { cobro_avisado_el: '2026-10-24', pagado_el: '2026-10-25' })), false);   // ya validado
  assert.equal(cobroAvisado(b('b4', 50, { tipo: 'cobro', cobro_avisado_el: '2026-10-24' })), false);
});

test('bonos que el entrenador todavía puede avisar: sin pagar, sin aviso, normales y por orden de fecha de pago', () => {
  const c = cli('c', [
    b('nuevo', 336, { fecha_pago: '2026-11-20' }),
    b('viejo', 180),
    b('pagado', 180, { pagado_el: '2026-10-01' }),
    b('avisado', 180, { cobro_avisado_el: '2026-10-24' }),
    b('cuenta', 50, { tipo: 'cobro', sesiones: 0 }),
  ]);
  assert.deepEqual(bonosAvisables(c).map(x => x.id), ['viejo', 'nuevo']);
  assert.deepEqual(bonosAvisados(c).map(x => x.id), ['avisado']);
});

test('resumen por validar: nº de bonos, importe y clientes; los archivados no cuentan', () => {
  const a = cli('a', [b('a1', 180, { cobro_avisado_el: '2026-10-24' }), b('a2', 336, { cobro_avisado_el: '2026-10-25' })]);
  const z = cli('z', [b('z1', 240, { cobro_avisado_el: '2026-10-26' })]);
  const arch = cli('x', [b('x1', 999, { cobro_avisado_el: '2026-10-26' })], { activo: false });
  const sin = cli('s', [b('s1', 100)]);
  const r = resumenPorValidar([a, z, arch, sin]);
  assert.equal(r.n, 3);
  assert.equal(r.importe, 756);
  assert.deepEqual(r.filas.map(f => f.cliente.id), ['a', 'z']);
  assert.deepEqual(resumenPorValidar([sin]), { n: 0, importe: 0, filas: [] });
});

test('resumen por validar: también cuentan los avisos de los clientes que pagan después', () => {
  const a = cli('a', [b('a1', 180, { cobro_avisado_el: '2026-10-24' })], { avisos: [{ id: 'x1', importe: 40, fecha: '2026-10-26', metodo: 'tarjeta', sesion_ids: ['s1'] }] });
  const z = cli('z', [], { pago_diferido: 'aprobado', avisos: [{ id: 'x2', importe: 100.5, fecha: '2026-10-26', metodo: 'efectivo', sesion_ids: [] }] });
  const r = resumenPorValidar([a, z, cli('s', [b('s1', 50)])]);
  assert.equal(r.n, 3);
  assert.equal(r.importe, 320.5);
  assert.deepEqual(r.filas.map(f => [f.cliente.id, f.bonos.length, f.avisos.length]), [['a', 1, 1], ['z', 0, 1]]);
  assert.deepEqual(avisosDiferido(z).map(x => x.id), ['x2']);
  assert.deepEqual(avisosDiferido({}), []);
});

test('validar: queda pagado el día que recibió el dinero y con el método real; el administrador puede cambiar ambos', () => {
  const av = b('b1', 180, { cobro_avisado_el: '2026-10-24', cobro_avisado_metodo: 'efectivo', metodo_pago: 'tarjeta' });
  assert.deepEqual(cambiosValidarCobro(av), { pagado_el: '2026-10-24', metodo_pago: 'efectivo' });
  assert.deepEqual(cambiosValidarCobro(av, { fecha: '2026-10-23', metodo: 'transferencia' }), { pagado_el: '2026-10-23', metodo_pago: 'transferencia' });
  assert.deepEqual(cambiosValidarCobro(b('b2', 1, { cobro_avisado_el: '2026-10-24' })), { pagado_el: '2026-10-24', metodo_pago: 'tarjeta' });   // sin método avisado: el del bono
});
