// Hoja de una liquidación para imprimir o guardar como PDF (se abre en una pestaña aparte y lanza el diálogo de impresión).
// Es una página completa con su propio estilo claro, pensada para papel: no depende de la app.
import { esc, fmtEUR, fmtFecha, nombreMes } from './util.js';

const CSS = `
  *{box-sizing:border-box} body{font:13px/1.45 Arial,Helvetica,sans-serif;color:#111;margin:0;padding:28px 34px;background:#fff}
  h1{font-size:20px;margin:0 0 2px;letter-spacing:.5px} h2{font-size:13px;margin:22px 0 6px;text-transform:uppercase;letter-spacing:1px;color:#8B2020;border-bottom:2px solid #8B2020;padding-bottom:3px}
  .sub{color:#555;margin:0 0 4px} .sello{display:inline-block;margin:8px 0 0;padding:3px 10px;border:2px solid #1d7a3a;color:#1d7a3a;font-weight:700;letter-spacing:1px;font-size:12px}
  .sello.borrador{border-color:#b26a00;color:#b26a00}
  table{width:100%;border-collapse:collapse;margin:0 0 4px} th,td{padding:5px 7px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}
  th{font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:#555;border-bottom:1px solid #999} .n{text-align:right;white-space:nowrap}
  tfoot td{font-weight:700;border-top:1px solid #999;border-bottom:0} .vacio{color:#777;font-style:italic;padding:4px 0}
  .reparto td{border-bottom:1px solid #eee} .reparto .total td{font-weight:700;font-size:15px;border-top:2px solid #111;border-bottom:2px solid #111}
  .reparto .neg td{color:#b00020} .hint{color:#666;font-size:11.5px;margin-top:6px}
  .barra{margin:0 0 18px} .barra button{font:inherit;padding:7px 16px;cursor:pointer}
  @media print{.barra{display:none} body{padding:0} h2{break-after:avoid} tr{break-inside:avoid}}`;

const tabla = (cabeceras, filas, pie = '') => `<table><thead><tr>${cabeceras.map(([t, n]) => `<th${n ? ' class="n"' : ''}>${t}</th>`).join('')}</tr></thead><tbody>${filas.join('')}</tbody>${pie}</table>`;
const td = (v, n = false) => `<td${n ? ' class="n"' : ''}>${v}</td>`;

// snap = instantaneaLiquidacion(...). cerrada = la fila de liquidaciones_cerradas (o null si es un borrador).
export function hojaLiquidacionHTML(snap, { cerrada = null, cerradaPor = '' } = {}) {
  const r = snap.reparto, borrador = !cerrada;
  const bonos = snap.bonos.length
    ? tabla([['Cliente'], ['Origen'], ['Pagado el', 1], ['Importe', 1], ['Declarado'], ['Base', 1], ['%', 1], ['Comisión', 1]],
      snap.bonos.map(b => `<tr>${td(esc(b.cliente))}${td(b.origen === 'codek' ? 'Codek' : 'Externo')}${td(fmtFecha(b.pagado_el), 1)}${td(fmtEUR(b.importe), 1)}${td(b.declarado ? 'sí' : 'no')}${td(fmtEUR(b.base), 1)}${td(`${b.pct}%`, 1)}${td(fmtEUR(b.comision), 1)}</tr>`),
      `<tfoot><tr><td colspan="3">${snap.totales.n} bono${snap.totales.n === 1 ? '' : 's'}</td>${td(fmtEUR(snap.bonos.reduce((s, b) => s + b.importe, 0)), 1)}<td colspan="3"></td>${td(fmtEUR(snap.totales.comision - snap.totales.comisionManual), 1)}</tr></tfoot>`)
    : '<div class="vacio">Ningún bono cobrado este mes en la liquidación normal.</div>';
  const manuales = snap.manuales.length
    ? tabla([['Concepto'], ['Clases', 1], ['€ / clase', 1], ['Importe', 1], ['%', 1], ['Declarado'], ['Comisión', 1]],
      snap.manuales.map(l => `<tr>${td(esc(l.concepto) + (l.bono_excluido ? ' <i>(bono excluido)</i>' : ''))}${td(l.clases ?? '', 1)}${td(l.precio === null ? '' : fmtEUR(l.precio), 1)}${td(fmtEUR(l.importe), 1)}${td(`${l.pct}%`, 1)}${td(l.declarado ? 'sí' : 'no')}${td(fmtEUR(l.comision), 1)}</tr>`),
      `<tfoot><tr><td colspan="6">${snap.totales.manuales} ajuste${snap.totales.manuales === 1 ? '' : 's'} manual${snap.totales.manuales === 1 ? '' : 'es'}</td>${td(fmtEUR(snap.totales.comisionManual), 1)}</tr></tfoot>`)
    : '<div class="vacio">Sin ajustes manuales.</div>';
  const anticipos = snap.anticipos.length
    ? tabla([['Fecha'], ['Nota'], ['Importe', 1]], snap.anticipos.map(a => `<tr>${td(fmtFecha(a.fecha))}${td(esc(a.concepto || 'Anticipo'))}${td(`−${fmtEUR(a.importe)}`, 1)}</tr>`))
    : '<div class="vacio">Sin anticipos.</div>';
  const fr = (txt, v, clase = '', signo = '') => `<tr class="${clase}">${td(txt)}${td(`${signo}${fmtEUR(Math.abs(v))}`, 1)}</tr>`;
  const filasReparto = [
    fr('Comisión del mes (IVA fuera y % aplicado)', r.comision),
    r.anticipos ? fr('Anticipos ya entregados', r.anticipos, '', '−') : '',
    snap.nomina ? fr(`Coste empresa de su nómina <small>(bruto ${fmtEUR(r.bruto)} + SS de la empresa ${fmtEUR(r.coste - r.bruto)})</small>`, r.coste, '', '−') : '',
    fr('Queda por repartir', r.queda, r.queda < 0 ? 'total neg' : 'total', r.queda < 0 ? '−' : ''),
    r.queda > 0 ? fr('→ En nómina', r.enNomina) : '',
    r.queda > 0 ? fr('→ En efectivo', r.efectivo) : '',
  ].join('');
  const nomina = snap.nomina && r.queda > 0 && r.enNomina
    ? `<p class="hint">Su nómina queda en ${fmtEUR(r.brutoNuevo)} de bruto (${fmtEUR(r.bruto)} + ${fmtEUR(r.brutoExtra)}: ${fmtEUR(r.enNomina)} ÷ ${(1 + snap.config.ss_pct / 100).toLocaleString('es-ES', { maximumFractionDigits: 3 })}), con un coste empresa total de ${fmtEUR(r.costeNominaNuevo)}.</p>` : '';
  const aviso = r.descubierto ? `<p class="hint"><b>La comisión no cubre la nómina:</b> faltan ${fmtEUR(r.descubierto)}; este mes no queda nada por repartir.</p>` : '';
  const cond = snap.config;
  const estado = cerrada
    ? `<span class="sello">LIQUIDACIÓN CERRADA el ${esc(fmtFecha(String(cerrada.cerrada_el).slice(0, 10)))}${cerradaPor ? ` por ${esc(cerradaPor)}` : ''}</span>${cerrada.reaperturas ? ` <span class="sub">· reabierta ${cerrada.reaperturas} ${cerrada.reaperturas === 1 ? 'vez' : 'veces'}</span>` : ''}`
    : '<span class="sello borrador">BORRADOR · SIN CERRAR</span>';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Liquidación ${esc(snap.entrenador.nombre)} · ${esc(nombreMes(snap.mes))}</title><style>${CSS}</style></head><body>
<div class="barra"><button onclick="window.print()">🖨 Imprimir / guardar como PDF</button></div>
<h1>CODEK · Liquidación de comisiones</h1>
<p class="sub"><b>${esc(snap.entrenador.nombre)}</b> · ${esc(nombreMes(snap.mes))}</p>
<div>${estado}</div>
<h2>Bonos cobrados</h2>${bonos}
<h2>Ajustes manuales</h2>${manuales}
<h2>Anticipos entregados</h2>${anticipos}
<h2>Reparto</h2><table class="reparto"><tbody>${filasReparto}</tbody></table>${nomina}${aviso}
<p class="hint">Condiciones aplicadas: comisión ${cond.comision_codek}% cliente Codek · ${cond.comision_externo}% cliente externo · IVA ${cond.iva_pct}% (si el pago está declarado) · Seguridad Social de la empresa ${cond.ss_pct}% (parte en nómina).</p>
<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},400)})</script>
</body></html>`;
}
