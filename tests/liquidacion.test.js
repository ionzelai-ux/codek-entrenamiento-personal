// Cierre de la liquidación: copia fija, exportación a CSV y hoja para imprimir. Cifras inventadas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { liquidacionMes, lineasManualesMes, DEFAULT_CONFIG_COMISIONES } from '../js/logica.js';
import { instantaneaLiquidacion, estaCerrada, csvLiquidacion, nombreArchivo } from '../js/liquidacion.js';
import { hojaLiquidacionHTML } from '../js/liquidacion-doc.js';

const CONFIG = { ...DEFAULT_CONFIG_COMISIONES };
const ENT = { id: 'e1', nombre: 'Eduardo' };
const cli = (id, nombre, origen, bonos) => ({ id, nombre, apellidos: 'Demo', origen, estado: 'efectivo', entrenador_id: 'e1', pago_diferido: 'no', bonos });
const bono = (id, precio, pagado_el, metodo_pago = 'tarjeta') => ({ id, precio, pagado_el, fecha_pago: pagado_el, fecha_inicio: pagado_el, metodo_pago, sesiones: 8, tipo: 'bono' });

const clientes = [
  cli('c1', 'Ana', 'externo', [bono('b1', 242, '2026-10-05')]),            // declarado: 242 ÷ 1,21 = 200 → 60 % = 120
  cli('c2', 'Luis', 'codek', [bono('b2', 100, '2026-10-12', 'efectivo')]),   // sin declarar: 100 → 40 % = 40
  cli('c3', 'Eva', 'externo', [bono('b3', 80, '2026-10-20', 'efectivo')]),   // se excluye: pasa a ajuste manual
];
const overrides = { b3: { excluido: true, manual_clases: 2, manual_precio: 30 } };
const libres = [{ id: 'l1', mes: '2026-10', entrenador_id: 'e1', concepto: 'Clases sueltas', clases: 4, precio: 15, pct: 100, declarado: false }];
const filas = liquidacionMes(clientes, '2026-10', CONFIG, overrides);
const lineas = lineasManualesMes(filas, libres, '2026-10', CONFIG, overrides);
const anticipos = [{ fecha: '2026-10-16', concepto: 'efectivo', importe: 50 }];
const nomina = { bruto: 100, coste_empresa: 132.5, parte_nomina: 0 };
const snap = instantaneaLiquidacion({ entrenador: ENT, mes: '2026-10', config: CONFIG, filas, lineas, anticipos, nomina });

test('copia fija: bonos que cuentan, líneas manuales (bono excluido + suelta), anticipos, nómina y totales', () => {
  assert.deepEqual(snap.bonos.map(b => [b.cliente, b.importe, b.base, b.comision]), [['Ana Demo', 242, 200, 120], ['Luis Demo', 100, 100, 40]]);
  assert.deepEqual(snap.manuales.map(l => [l.concepto, l.bono_excluido, l.importe, l.comision]), [['Eva Demo', true, 60, 36], ['Clases sueltas', false, 60, 60]]);
  assert.deepEqual(snap.anticipos, [{ fecha: '2026-10-16', concepto: 'efectivo', importe: 50 }]);
  assert.deepEqual(snap.nomina, { bruto: 100, coste_empresa: 132.5, parte_nomina: 0 });
  assert.deepEqual(snap.totales, { importe: 342, comision: 256, comisionManual: 96, n: 2, manuales: 2 });
  assert.equal(snap.entrenador.nombre, 'Eduardo');
});

test('copia fija: el reparto sale de comisión − anticipos − coste empresa', () => {
  assert.deepEqual([snap.reparto.comision, snap.reparto.anticipos, snap.reparto.coste, snap.reparto.queda], [256, 50, 132.5, 73.5]);
  assert.equal(snap.reparto.efectivo, 73.5);
});

test('copia fija: no cambia aunque después cambien los datos de origen (es un JSON independiente)', () => {
  const copia = JSON.parse(JSON.stringify(snap));
  clientes[0].bonos[0].precio = 999; anticipos[0].importe = 1; CONFIG.comision_externo = 10;
  assert.deepEqual(JSON.parse(JSON.stringify(snap)), copia);
  clientes[0].bonos[0].precio = 242; anticipos[0].importe = 50; CONFIG.comision_externo = 60;   // se deja todo como estaba para el resto de pruebas
});

test('sin nómina apuntada no se resta coste empresa; la copia guarda nomina = null', () => {
  const s = instantaneaLiquidacion({ entrenador: ENT, mes: '2026-10', config: CONFIG, filas, lineas, anticipos, nomina: null });
  assert.equal(s.nomina, null);
  assert.equal(s.reparto.queda, 206);
});

test('cerrada = existe la fila y no está reabierta', () => {
  assert.equal(estaCerrada(null), false);
  assert.equal(estaCerrada({ reabierta_el: null }), true);
  assert.equal(estaCerrada({ reabierta_el: '2026-11-02T10:00:00Z' }), false);
});

test('CSV: separador «;», decimales con coma, BOM para Excel y el reparto al final', () => {
  const csv = csvLiquidacion(snap, { cerradaEl: '2026-10-31T10:00:00Z' });
  assert.ok(csv.startsWith('﻿LIQUIDACIÓN DE COMISIONES;Eduardo;2026-10'));
  assert.ok(csv.includes('CERRADA el 31/10/2026'));
  assert.ok(csv.includes('Ana Demo;Externo;05/10/2026;242;sí;200;60;120'));
  assert.ok(csv.includes('Eva Demo (bono excluido);2;30;60;60;no;36'));
  assert.ok(csv.includes('Queda por repartir;73,5'));
  assert.ok(csv.includes('Anticipos;-50'));
  assert.ok(csv.includes('\r\n'));
  assert.ok(csvLiquidacion(snap, { borrador: true }).includes('BORRADOR (sin cerrar)'));
});

test('CSV: un texto con «;» o comillas se entrecomilla', () => {
  const raro = { ...snap, manuales: [{ ...snap.manuales[1], concepto: 'Clases; "sueltas"' }] };
  assert.ok(csvLiquidacion(raro).includes('"Clases; ""sueltas"""'));
});

test('nombre del archivo: liquidacion-AAAA-MM-entrenador.ext sin tildes ni espacios', () => {
  assert.equal(nombreArchivo({ mes: '2026-10', entrenador: { nombre: 'Jesús Pérez' } }, 'csv'), 'liquidacion-2026-10-jesus-perez.csv');
});

test('hoja para imprimir: cerrada lleva el sello con fecha y quién; borrador lo dice; el texto se escapa', () => {
  const cerrada = hojaLiquidacionHTML(snap, { cerrada: { cerrada_el: '2026-10-31T10:00:00Z', reaperturas: 1 }, cerradaPor: 'Jon' });
  assert.ok(cerrada.includes('LIQUIDACIÓN CERRADA el 31/10/2026 por Jon'));
  assert.ok(cerrada.includes('reabierta 1 vez'));
  assert.ok(cerrada.includes('Ana Demo') && cerrada.includes('Queda por repartir'));
  assert.ok(cerrada.includes('window.print()'));
  assert.ok(hojaLiquidacionHTML(snap).includes('BORRADOR · SIN CERRAR'));
  const xss = hojaLiquidacionHTML({ ...snap, bonos: [{ ...snap.bonos[0], cliente: '<img src=x onerror=alert(1)>' }] });
  assert.ok(!xss.includes('<img src=x'));
});
