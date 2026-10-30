// Nómina del entrenador: la comisión se reparte entre nómina y efectivo después de restar anticipos y coste empresa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { repartoNomina } from '../js/logica.js';

const NOMINA = { bruto: 500, coste_empresa: 670, parte_nomina: 0 };   // nómina de ejemplo: bruto 500 + 170 de SS de la empresa

test('reparto: comisión − anticipos − coste empresa = lo que queda; todo en efectivo si no se elige nómina', () => {
  const r = repartoNomina({ comision: 1300, anticipos: 200, nomina: NOMINA, ssPct: 32.5 });
  assert.equal(r.queda, 430);                    // 1300 − 200 − 670
  assert.equal(r.enNomina, 0);
  assert.equal(r.efectivo, 430);
  assert.equal(r.brutoExtra, 0);
  assert.equal(r.brutoNuevo, 500);
});

test('reparto: lo que va a nómina se suma al bruto sin la SS de la empresa (importe ÷ 1,325)', () => {
  const todo = repartoNomina({ comision: 1300, anticipos: 200, nomina: NOMINA, parteNomina: 430, ssPct: 32.5 });
  assert.equal(todo.enNomina, 430);
  assert.equal(todo.brutoExtra, 324.53);         // 430 ÷ 1,325
  assert.equal(todo.ssExtra, 105.47);            // lo que se lleva la SS de la empresa
  assert.equal(todo.efectivo, 0);
  assert.equal(todo.brutoNuevo, 824.53);         // 500 + 324,53
  assert.equal(todo.costeNominaNuevo, 1100);     // 670 + 430: la empresa gasta exactamente comisión − anticipos
  const parte = repartoNomina({ comision: 1300, anticipos: 200, nomina: NOMINA, parteNomina: 100, ssPct: 32.5 });
  assert.deepEqual([parte.enNomina, parte.brutoExtra, parte.efectivo], [100, 75.47, 330]);
});

test('reparto: nómina + efectivo + anticipos siempre suman la comisión (nada se pierde ni se inventa)', () => {
  for (const parte of [0, 1, 99.99, 250, 430, 9999]) {
    const r = repartoNomina({ comision: 1300, anticipos: 200, nomina: NOMINA, parteNomina: parte, ssPct: 32.5 });
    assert.equal(Math.round((r.costeNominaNuevo + r.efectivo + r.anticipos) * 100) / 100, 1300, `parte ${parte}`);
  }
});

test('reparto: si pide más nómina de lo que queda se limita; si la comisión no cubre la nómina no se reparte nada', () => {
  assert.equal(repartoNomina({ comision: 1300, anticipos: 200, nomina: NOMINA, parteNomina: 9999, ssPct: 32.5 }).enNomina, 430);
  const corto = repartoNomina({ comision: 500, anticipos: 200, nomina: NOMINA, parteNomina: 100, ssPct: 32.5 });
  assert.equal(corto.queda, -370);
  assert.equal(corto.descubierto, 370);
  assert.deepEqual([corto.enNomina, corto.efectivo, corto.brutoExtra], [0, 0, 0]);
});

test('reparto: usa la parte en nómina guardada con la nómina y, sin nómina apuntada, no resta nada', () => {
  assert.equal(repartoNomina({ comision: 1000, nomina: { ...NOMINA, parte_nomina: 100 }, ssPct: 32.5 }).enNomina, 100);
  assert.equal(repartoNomina({ comision: 1000, nomina: { ...NOMINA, parte_nomina: 100 }, parteNomina: 0, ssPct: 32.5 }).enNomina, 0);   // lo escrito en pantalla manda
  const sin = repartoNomina({ comision: 1000, anticipos: 200, ssPct: 32.5 });
  assert.deepEqual([sin.coste, sin.queda, sin.efectivo], [0, 800, 800]);
});
