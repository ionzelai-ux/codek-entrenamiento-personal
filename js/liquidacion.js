// Cierre de la liquidación de un entrenador y mes (sql/23): la copia fija que se guarda y su exportación a CSV.
// Todo son funciones puras: la pantalla (vista-comisiones.js) las usa para cerrar, para enseñar lo cerrado y para imprimir.
import { totalesComisiones, repartoNomina } from './logica.js';

const redondeo = n => Math.round((Number(n) || 0) * 100) / 100;

// Copia fija de lo que se ve en la pantalla de un entrenador y un mes. Se guarda tal cual en la base de datos y desde entonces
// la pantalla enseña ESTO (no vuelve a calcular), así que no cambia aunque después cambien precios, porcentajes o clientes.
//   filas / lineas = liquidacionMes y lineasManualesMes de ese entrenador · anticipos = los de ese mes · nomina = su fila del mes (o null)
export function instantaneaLiquidacion({ entrenador, mes, config, filas, lineas, anticipos, nomina }) {
  const t = totalesComisiones(filas, lineas);
  const reparto = repartoNomina({ comision: t.comision, anticipos: anticipos.reduce((s, a) => s + (Number(a.importe) || 0), 0), nomina, ssPct: config.ss_pct });
  return {
    version: 1,
    mes,
    entrenador: { id: entrenador.id, nombre: entrenador.nombre },
    config: { comision_codek: Number(config.comision_codek), comision_externo: Number(config.comision_externo), iva_pct: Number(config.iva_pct), ss_pct: Number(config.ss_pct) },
    bonos: filas.filter(f => !f.excluido).map(f => ({
      cliente: `${f.cliente.nombre} ${f.cliente.apellidos || ''}`.trim(), origen: f.cliente.origen, pagado_el: f.bono.pagado_el,
      metodo_pago: f.bono.metodo_pago || null, importe: redondeo(f.bono.precio), declarado: !!f.declarado, pct: Number(f.pct),
      base: redondeo(f.base), comision: redondeo(f.comision),
    })),
    manuales: lineas.map(l => ({
      concepto: l.concepto || '', bono_excluido: l.tipo === 'bono', pagado_el: l.tipo === 'bono' ? l.bono.pagado_el : null,
      clases: l.clases ?? null, precio: l.precio ?? null, importe: redondeo(l.importe), pct: Number(l.pct), declarado: !!l.declarado, comision: redondeo(l.comision),
    })),
    anticipos: anticipos.map(a => ({ fecha: a.fecha, concepto: a.concepto || '', importe: redondeo(a.importe) })),
    nomina: nomina ? { bruto: redondeo(nomina.bruto), coste_empresa: redondeo(nomina.coste_empresa), parte_nomina: redondeo(nomina.parte_nomina) } : null,
    totales: { importe: redondeo(t.importe), comision: redondeo(t.comision), comisionManual: redondeo(t.comisionManual), n: t.n, manuales: t.manuales },
    reparto,
  };
}

// Una liquidación está cerrada si existe su fila y no se ha reabierto (reabierta_el vacío).
export const estaCerrada = cierre => !!cierre && !cierre.reabierta_el;

// ── Exportación a CSV (se abre en Excel: separador «;», decimales con coma y BOM para las tildes) ──
const num = n => (n === null || n === undefined || n === '' ? '' : String(redondeo(n)).replace('.', ','));
const celda = v => { const s = String(v ?? ''); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const fechaES = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

export function csvLiquidacion(snap, { cerradaEl = null, borrador = false } = {}) {
  const f = [];
  const fila = (...c) => f.push(c.map(celda).join(';'));
  fila('LIQUIDACIÓN DE COMISIONES', snap.entrenador.nombre, snap.mes);
  fila(borrador ? 'BORRADOR (sin cerrar)' : `CERRADA el ${fechaES(cerradaEl)}`);
  fila();
  fila('BONOS COBRADOS');
  fila('Cliente', 'Origen', 'Pagado el', 'Importe', 'Declarado (IVA)', 'Base', '% comisión', 'Comisión');
  for (const b of snap.bonos) fila(b.cliente, b.origen === 'codek' ? 'Codek' : 'Externo', fechaES(b.pagado_el), num(b.importe), b.declarado ? 'sí' : 'no', num(b.base), num(b.pct), num(b.comision));
  fila();
  fila('AJUSTES MANUALES');
  fila('Concepto', 'Clases', '€ / clase', 'Importe', '% comisión', 'Declarado (IVA)', 'Comisión');
  for (const l of snap.manuales) fila(l.bono_excluido ? `${l.concepto} (bono excluido)` : l.concepto, num(l.clases), num(l.precio), num(l.importe), num(l.pct), l.declarado ? 'sí' : 'no', num(l.comision));
  fila();
  fila('ANTICIPOS');
  fila('Fecha', 'Nota', 'Importe');
  for (const a of snap.anticipos) fila(fechaES(a.fecha), a.concepto, num(a.importe));
  fila();
  const r = snap.reparto;
  fila('REPARTO');
  fila('Comisión del mes', num(r.comision));
  fila('Anticipos', num(-r.anticipos));
  if (snap.nomina) fila('Coste empresa de su nómina', num(-r.coste));
  fila('Queda por repartir', num(r.queda));
  fila('En nómina', num(r.enNomina));
  fila('En efectivo', num(r.efectivo));
  if (snap.nomina) { fila(); fila('NÓMINA', 'Bruto', num(r.bruto), 'Bruto nuevo', num(r.brutoNuevo)); fila('', 'Coste empresa', num(r.coste), 'Coste empresa nuevo', num(r.costeNominaNuevo)); }
  return '﻿' + f.join('\r\n') + '\r\n';
}

export const nombreArchivo = (snap, ext) => `liquidacion-${snap.mes}-${String(snap.entrenador.nombre).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.${ext}`;
