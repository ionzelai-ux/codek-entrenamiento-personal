// Resumen (solo admin): facturación por mes, por entrenador y por origen (Codek / externo).
import { S, bus } from './store.js';
import { esc, nombreMes, fmtEUR } from './util.js';
import { agrupar, sumar, hoyISO, primerDiaMes } from './logica.js';

const fila = (nombre, r, color = '') => `<tr>
  <td>${color ? `<i class="tc" style="background:${color}"></i>` : ''}${esc(nombre)}</td>
  <td class="num">${r.efectivos}</td><td class="num">${r.potenciales}</td>
  <td class="num verde">${fmtEUR(r.cobrado)}</td><td class="num amarillo">${fmtEUR(r.programado)}</td>
  <td class="num">${fmtEUR(r.estimado)}</td></tr>`;

const cabecera = primera => `<thead><tr><th>${primera}</th><th class="num">Clientes</th><th class="num">Potenciales</th>
  <th class="num">Cobrado</th><th class="num">Pago programado</th><th class="num">Estimado potenciales</th></tr></thead>`;

export function renderResumen(el) {
  const mes = S.resumenMes, hoy = hoyISO();
  const porEntr = agrupar(S.clientes, c => c.entrenador_id, mes, hoy);
  const porOrigen = agrupar(S.clientes, c => c.origen, mes, hoy);
  const total = sumar(porEntr.values());
  const vacio = { efectivos: 0, potenciales: 0, cobrado: 0, programado: 0, estimado: 0 };

  el.innerHTML = `
    <div class="cal-nav" style="margin-bottom:18px">
      <button class="cal-btn" data-acc="res-prev" aria-label="Mes anterior">◀</button>
      <div class="cal-month-lbl">${nombreMes(mes).toUpperCase()}</div>
      <button class="cal-btn" data-acc="res-next" aria-label="Mes siguiente">▶</button>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="kpi-n verde">${fmtEUR(total.cobrado)}</div><div class="kpi-l">Cobrado este mes</div></div>
      <div class="kpi"><div class="kpi-n amarillo">${fmtEUR(total.programado)}</div><div class="kpi-l">Pago programado este mes</div></div>
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
    <p class="hint" style="margin-top:14px">«Cobrado» = bonos cuya fecha de pago cae en el mes y ya ha llegado. «Pago programado» = fecha de pago posterior a hoy.
      «Estimado» = precio que pagarían los potenciales activos (sin límite de mes).</p>`;
}

const moverMes = n => { S.resumenMes = primerDiaMes(S.resumenMes + '-01', n).slice(0, 7); bus.repintar(); };
export const accionesResumen = {
  'res-prev': () => moverMes(-1),
  'res-next': () => moverMes(1),
};
