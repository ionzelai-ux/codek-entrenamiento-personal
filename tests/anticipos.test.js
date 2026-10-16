// Anticipos a los entrenadores: se restan de la comisión del mes en que se descuentan.
import test from 'node:test';
import assert from 'node:assert/strict';
import { anticiposDelMes, totalAnticipos, importeAPagar, mesDeFecha } from '../js/logica.js';

const A = [
  { id: 'a1', entrenador_id: 'e1', fecha: '2026-10-15', mes: '2026-10', importe: 200 },
  { id: 'a2', entrenador_id: 'e1', fecha: '2026-10-28', mes: '2026-11', importe: '50.50' },
  { id: 'a3', entrenador_id: 'e1', fecha: '2026-10-30', mes: '2026-10', importe: 100 },
];

test('anticipos: cada uno cuenta en el mes en que se descuenta (no necesariamente el de su fecha)', () => {
  assert.deepEqual(anticiposDelMes(A, '2026-10').map(a => a.id), ['a1', 'a3']);
  assert.deepEqual(anticiposDelMes(A, '2026-11').map(a => a.id), ['a2']);
  assert.deepEqual(anticiposDelMes(A, '2026-09'), []);
  assert.deepEqual(anticiposDelMes(undefined, '2026-10'), []);
});

test('anticipos: total y lo que queda por pagar (comisión − anticipos), con céntimos bien redondeados', () => {
  assert.equal(totalAnticipos(anticiposDelMes(A, '2026-10')), 300);
  assert.equal(totalAnticipos(anticiposDelMes(A, '2026-11')), 50.5);   // importe llegado como texto
  assert.equal(totalAnticipos([]), 0);
  assert.equal(importeAPagar(545.6, anticiposDelMes(A, '2026-10')), 245.6);
  assert.equal(importeAPagar(100.1, [{ importe: 0.2 }]), 99.9);
  assert.equal(importeAPagar(545.6, []), 545.6);
});

test('anticipos: si se adelanta más de lo que cobra, sale en negativo (se pasa al mes siguiente)', () => {
  assert.equal(importeAPagar(120, anticiposDelMes(A, '2026-10')), -180);
});

test('mes de una fecha', () => {
  assert.equal(mesDeFecha('2026-10-16'), '2026-10');
  assert.equal(mesDeFecha(''), '');
  assert.equal(mesDeFecha(null), '');
});
