// Resumen (solo admin): facturación prevista (este mes y el siguiente), y por mes, entrenador y origen.
import { S, bus, entrenadorDe, nombreCompleto } from './store.js';
import { esc, nombreMes, fmtEUR, fmtFecha } from './util.js';
import { agrupar, sumar, facturacionMes, hoyISO, primerDiaMes } from './logica.js';

const fila = (nombre, r, color = '') => `<tr>
  <td>${color ? `<i class="tc" style="background:${color}"></i>` : ''}${esc(nombre)}</td>
  <td class="num">${r.efectivos}</td><td class="num">${r.potenciales}</td>
  <td class="num verde">${fmtEUR(r.cobrado)}</td><td class="num amarillo">${fmtEUR(r.pendiente)}</td>
  <td class="num azul">${fmtEUR(r.programado)}</td><td class="num">${fmtEUR(r.estimado)}</td></tr>`;

const cabecera = primera => `<thead><tr><th>${primera}</th><th class="num">Clientes</th><th class="num">Potenciales</th>
  <th class="num">Cobrado</th><th class="num">Pendiente de cobro</th><th class="num">Pago programado</th><th class="num">Estimado potenciales</th></tr></thead>`;

const ESTADO = { pagado: ['verde', 'PAGADO'], pendiente: ['pendiente', 'PENDIENTE'], programado: ['amarillo', 'PROGRAMADO'] };

// Tarjeta de un mes: total previsto, reparto por estado y cada bono con su fecha de pago.
function panelMes(f, etiqueta) {
  const pct = k => (f.total ? (f[k] / f.total) * 100 : 0);
  const filas = f.filas.map(({ cliente, bono, estado, importe }) => {
    const e = entrenadorDe(cliente.entrenador_id);
    const [clase, texto] = ESTADO[estado];
    return `<tr><td class="num">${fmtFecha(bono.fecha_pago).slice(0, 5)}</td>
      <td>${esc(nombreCompleto(cliente))}${e ? ` <span class="prev-entr" style="color:${e.color}">${esc(e.nombre)}</span>` : ''}</td>
      <td class="num">${fmtEUR(importe)}</td><td><span class="chip ${clase}">${texto}</span></td></tr>`;
  }).join('');
  return `<div class="prev">
    <div class="prev-mes">${nombreMes(f.mes).toUpperCase()}<span>${etiqueta}</span></div>
    <div class="prev-total">${fmtEUR(f.total)}</div>
    <div class="prev-bar" title="Pagado · pendiente · programado">
      <i style="width:${pct('pagado')}%;background:var(--green-light)"></i><i style="width:${pct('pendiente')}%;background:var(--yellow)"></i><i style="width:${pct('programado')}%;background:var(--blue-light)"></i>
    </div>
    <div class="prev-ley">
      <span><i style="background:var(--green-light)"></i>Pagado <b>${fmtEUR(f.pagado)}</b></span>
      <span><i style="background:var(--yellow)"></i>Pendiente de cobro <b>${fmtEUR(f.pendiente)}</b></span>
      <span><i style="background:var(--blue-light)"></i>Programado <b>${fmtEUR(f.programado)}</b></span>
    </div>
    ${filas ? `<div class="tabla-wrap"><table class="tabla tabla-prev"><tbody>${filas}</tbody></table></div>` : '<div class="vacio">Ningún pago con fecha en este mes</div>'}
  </div>`;
}

export function renderResumen(el) {
  const mes = S.resumenMes, hoy = hoyISO();
  const porEntr = agrupar(S.clientes, c => c.entrenador_id, mes, hoy);
  const porOrigen = agrupar(S.clientes, c => c.origen, mes, hoy);
  const total = sumar(porEntr.values());
  const vacio = { efectivos: 0, potenciales: 0, cobrado: 0, pendiente: 0, programado: 0, estimado: 0 };
  const este = facturacionMes(S.clientes, hoy.slice(0, 7), hoy);
  const siguiente = facturacionMes(S.clientes, primerDiaMes(hoy, 1).slice(0, 7), hoy);

  el.innerHTML = `
    <div class="section-title">Facturación prevista</div>
    <div class="prevs">${panelMes(este, 'ESTE MES')}${panelMes(siguiente, 'MES SIGUIENTE')}</div>
    <p class="hint" style="margin-bottom:26px">Cada bono cuenta en el mes de su <b>fecha de pago</b>. «Pagado» = lo has confirmado tú; «Pendiente de cobro» = la fecha ya llegó y aún no lo has marcado;
      «Programado» = fecha de pago futura.</p>

    <div class="section-title">Detalle por mes</div>
    <div class="cal-nav" style="margin-bottom:18px">
      <button class="cal-btn" data-acc="res-prev" aria-label="Mes anterior">◀</button>
      <div class="cal-month-lbl">${nombreMes(mes).toUpperCase()}</div>
      <button class="cal-btn" data-acc="res-next" aria-label="Mes siguiente">▶</button>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="kpi-n verde">${fmtEUR(total.cobrado)}</div><div class="kpi-l">Cobrado (confirmado)</div></div>
      <div class="kpi"><div class="kpi-n amarillo">${fmtEUR(total.pendiente)}</div><div class="kpi-l">Pendiente de cobro</div></div>
      <div class="kpi"><div class="kpi-n azul">${fmtEUR(total.programado)}</div><div class="kpi-l">Pago programado</div></div>
      <div class="kpi"><div class="kpi-n">${fmtEUR(total.estimado)}</div><div class="kpi-l">Estimado si cierran los potenciales</div></div>
      <div class="kpi"><div class="kpi-n">${total.efectivos}</div><div class="kpi-l">Clientes activos · ${total.potenciales} potenciales</div></div>
    </div>
    <div class="section-title">Por entrenador</div>
    <div class="tabla-wrap"><table class="tabla">${cabecera('Entrenador')}<tbody>
      ${S.entrenadores.map(e => fila(e.nombre, porEntr.get(e.id) || vacio, e.color)).join('')}
    </tbody></table></div>
    <div class="section-title" style="margin-top:24px">Por origen</div>
    <div class="tabla-wrap"><table class="tabla">${cabecera('Origen')}<tbody>
      ${fila('Clientes Codek', porOrigen.get('codek') || vacio)}
      ${fila('Clientes externos', porOrigen.get('externo') || vacio)}
    </tbody></table></div>
    <p class="hint" style="margin-top:14px">Los importes se reparten por la fecha de pago del bono. «Cobrado» = confirmado por ti con «Marcar pagado». «Pendiente de cobro» = fecha de pago ya llegada
      pero sin confirmar. «Pago programado» = fecha posterior a hoy. «Estimado» = precio que pagarían los potenciales activos (sin límite de mes).</p>`;
}

const moverMes = n => { S.resumenMes = primerDiaMes(S.resumenMes + '-01', n).slice(0, 7); bus.repintar(); };
export const accionesResumen = {
  'res-prev': () => moverMes(-1),
  'res-next': () => moverMes(1),
};
