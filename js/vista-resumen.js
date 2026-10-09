// Resumen (solo admin): facturación de dos meses seguidos (por defecto este y el siguiente, navegable hacia
// atrás y adelante), y detalle por mes, entrenador y origen. Todo respeta el entrenador elegido.
import { S, bus, entrenadorDe, nombreCompleto, entrenadorFiltroId } from './store.js';
import { esc, nombreMes, fmtEUR, fmtFecha, filtroEntrenadorHTML } from './util.js';
import { agrupar, sumar, facturacionMes, etiquetaMes, hoyISO, primerDiaMes, ultimoDiaMes, deudaDiferida, proyectarRenovaciones } from './logica.js';

const MESES_PROYECCION = 6;                                   // además del mes en curso
const redondeo = n => Math.round(n * 100) / 100;
const sumaImportes = filas => redondeo(filas.reduce((t, r) => t + r.importe, 0));

const fila = (nombre, r, color = '') => `<tr>
  <td>${color ? `<i class="tc" style="background:${color}"></i>` : ''}${esc(nombre)}</td>
  <td class="num">${r.efectivos}</td><td class="num">${r.potenciales}</td>
  <td class="num verde">${fmtEUR(r.cobrado)}</td><td class="num amarillo">${fmtEUR(r.pendiente)}</td>
  <td class="num azul">${fmtEUR(r.programado)}</td><td class="num">${fmtEUR(r.estimado)}</td></tr>`;

const cabecera = primera => `<thead><tr><th>${primera}</th><th class="num">Clientes</th><th class="num">Potenciales</th>
  <th class="num">Cobrado</th><th class="num">Pendiente de cobro</th><th class="num">Pago programado</th><th class="num">Estimado potenciales</th></tr></thead>`;

const ESTADO = { pagado: ['verde', 'PAGADO'], pendiente: ['pendiente', 'PENDIENTE'], programado: ['amarillo', 'PROGRAMADO'] };

// Lo que deben los clientes que entrenan y pagan después (no depende del mes: es el saldo de ahora mismo).
function deudasHTML(clientes) {
  const filas = clientes.filter(c => c.activo).map(c => ({ c, d: deudaDiferida(c) })).filter(x => x.d?.debe);
  if (!filas.length) return '';
  const total = filas.reduce((t, x) => t + (x.d.importe || 0), 0), sinTarifa = filas.filter(x => x.d.importe === null).length;
  const cuerpo = filas.sort((a, b) => nombreCompleto(a.c).localeCompare(nombreCompleto(b.c), 'es')).map(({ c, d }) => {
    const e = entrenadorDe(c.entrenador_id);
    return `<tr><td>${esc(nombreCompleto(c))}${e ? ` <span class="prev-entr" style="color:${e.color}">${esc(e.nombre)}</span>` : ''}${d.modo === 'cuenta' ? ' <span class="hint">(a cuenta)</span>' : ''}</td>
      <td class="num">${d.n}</td><td class="num">${d.tarifa === null ? '—' : fmtEUR(d.tarifa)}</td>
      <td class="num amarillo"><b>${d.importe === null ? 'sin tarifa' : fmtEUR(d.importe)}</b></td></tr>`;
  }).join('');
  return `<div class="section-title" style="margin-top:8px">Por cobrar · entrenan y pagan después</div>
    <div class="tabla-wrap"><table class="tabla"><thead><tr><th>Cliente</th><th class="num">Sesiones</th><th class="num">Tarifa</th><th class="num">Por cobrar</th></tr></thead>
      <tbody>${cuerpo}</tbody>
      <tfoot><tr><td><b>Total</b></td><td class="num">${filas.reduce((t, x) => t + x.d.n, 0)}</td><td></td>
        <td class="num amarillo"><b>${fmtEUR(total)}</b>${sinTarifa ? ` <span class="hint">(+ ${sinTarifa} sin tarifa)</span>` : ''}</td></tr></tfoot></table></div>
    <p class="hint" style="margin-bottom:26px">Lo que falta por cobrar: por sesión, las sesiones hechas sin cobrar × su tarifa; a cuenta, sesiones hechas × tarifa − lo ya pagado. Se apunta desde la ficha del cliente
      («Marcar como cobradas» o «Pago recibido»); entonces pasa a «Cobrado».</p>`;
}

const nombreConEntr = cliente => {
  const e = entrenadorDe(cliente.entrenador_id);
  return `${esc(nombreCompleto(cliente))}${e ? ` <span class="prev-entr" style="color:${e.color}">${esc(e.nombre)}</span>` : ''}`;
};

// Tarjeta de un mes: total previsto (lo ya contratado + las renovaciones que se prevén), reparto por estado y cada bono
// con su fecha de pago. `prev` = renovaciones previstas con fecha en ese mes (proyectarRenovaciones).
function panelMes(f, etiqueta, prev = []) {
  const previsto = sumaImportes(prev), total = redondeo(f.total + previsto);
  const pct = k => (total ? (f[k] / total) * 100 : 0);
  const filas = f.filas.map(({ cliente, bono, estado, importe }) => {
    const [clase, texto] = ESTADO[estado];
    return `<tr><td class="num">${fmtFecha(bono.fecha_pago).slice(0, 5)}</td><td>${nombreConEntr(cliente)}</td>
      <td class="num">${fmtEUR(importe)}</td><td><span class="chip ${clase}">${texto}</span></td></tr>`;
  }).join('') + prev.map(r => `<tr class="fila-prevista"><td class="num">${fmtFecha(r.fecha).slice(0, 5)}</td><td>${nombreConEntr(r.cliente)}</td>
      <td class="num">${fmtEUR(r.importe)}</td><td><span class="chip prevista" title="Renovación que se prevé: no es un pago registrado">PREVISTO</span></td></tr>`).join('');
  return `<div class="prev">
    <div class="prev-mes">${nombreMes(f.mes).toUpperCase()}<span>${etiqueta}</span></div>
    <div class="prev-total">${fmtEUR(total)}</div>
    <div class="prev-bar" title="Pagado · pendiente · programado · renovación prevista">
      <i style="width:${pct('pagado')}%;background:var(--green-light)"></i><i style="width:${pct('pendiente')}%;background:var(--yellow)"></i><i style="width:${pct('programado')}%;background:var(--blue-light)"></i><i class="prev-prevista" style="width:${total ? (previsto / total) * 100 : 0}%"></i>
    </div>
    <div class="prev-ley">
      <span><i style="background:var(--green-light)"></i>Pagado <b>${fmtEUR(f.pagado)}</b></span>
      <span><i style="background:var(--yellow)"></i>Pendiente de cobro <b>${fmtEUR(f.pendiente)}</b></span>
      <span><i style="background:var(--blue-light)"></i>Programado <b>${fmtEUR(f.programado)}</b></span>
      <span><i class="prev-prevista"></i>Renovación prevista <b>${fmtEUR(previsto)}</b></span>
    </div>
    ${filas ? `<div class="tabla-wrap"><table class="tabla tabla-prev"><tbody>${filas}</tbody></table></div>` : '<div class="vacio">Ningún pago con fecha en este mes</div>'}
  </div>`;
}

// Proyección de los próximos meses: lo que ya está contratado (bonos con fecha de pago en el mes) más las renovaciones que
// se prevén. Se da por hecho que todos renuevan salvo los marcados «no va a renovar»; no es una cifra segura.
function proyeccionHTML(clientes, proy, hoy) {
  const meses = Array.from({ length: MESES_PROYECCION + 1 }, (_, i) => primerDiaMes(hoy, i).slice(0, 7));
  const filasMes = meses.map(mes => {
    const real = facturacionMes(clientes, mes, hoy).total, prev = proy.filas.filter(r => r.fecha.slice(0, 7) === mes);
    return { mes, real, prev, previsto: sumaImportes(prev) };
  });
  const tot = filasMes.reduce((t, x) => ({ real: t.real + x.real, previsto: t.previsto + x.previsto }), { real: 0, previsto: 0 });
  const tabla = filasMes.map(({ mes, real, previsto }) => `<tr><td>${nombreMes(mes).toUpperCase()}${mes === hoy.slice(0, 7) ? ' <span class="hint">(este mes)</span>' : ''}</td>
    <td class="num">${fmtEUR(real)}</td><td class="num">${fmtEUR(previsto)}</td><td class="num"><b>${fmtEUR(redondeo(real + previsto))}</b></td></tr>`).join('');
  const detalle = filasMes.filter(x => x.prev.length).map(({ mes, prev, previsto }) => `
    <div class="section-title" style="margin-top:14px">${nombreMes(mes).toUpperCase()} · ${fmtEUR(previsto)}</div>
    <div class="tabla-wrap"><table class="tabla tabla-prev"><tbody>${prev.map(r => `<tr><td class="num">${fmtFecha(r.fecha).slice(0, 5)}</td><td>${nombreConEntr(r.cliente)}</td>
      <td>${r.sesiones} ${r.sesiones === 1 ? 'sesión' : 'sesiones'}${r.cambiado ? ' <span class="chip amarillo">CAMBIA DE BONO</span>' : ''}${r.numero > 1 ? ` <span class="hint">· renovación nº ${r.numero}</span>` : ''}</td>
      <td class="num">${fmtEUR(r.importe)}</td></tr>`).join('')}</tbody></table></div>`).join('');
  const sin = proy.sinEstimar.length
    ? `<p class="hint proy-aviso">No se han podido proyectar (faltan sus días fijos o sesiones reservadas para saber cuándo se les acaba el bono): ${proy.sinEstimar.map(c => esc(nombreCompleto(c))).join(', ')}.</p>` : '';
  return `<div class="section-title">Proyección · este mes y los ${MESES_PROYECCION} siguientes</div>
    <div class="tabla-wrap"><table class="tabla"><thead><tr><th>Mes</th><th class="num">Ya contratado</th><th class="num">Renovaciones previstas</th><th class="num">Total previsto</th></tr></thead>
      <tbody>${tabla}</tbody>
      <tfoot><tr><td><b>Total</b></td><td class="num">${fmtEUR(redondeo(tot.real))}</td><td class="num">${fmtEUR(redondeo(tot.previsto))}</td><td class="num"><b>${fmtEUR(redondeo(tot.real + tot.previsto))}</b></td></tr></tfoot></table></div>
    <details class="proy-det"><summary>Ver qué clientes se prevé que renueven, mes a mes</summary>${detalle || '<div class="vacio">Ninguna renovación prevista</div>'}</details>
    <p class="hint proy-aviso">Estimación: se da por hecho que <b>todos los clientes con bono renuevan</b> el día que se les acaba (la fecha de su última clase, o la que salga de sus días fijos), con el mismo bono —o el que hayas indicado en «Cambiar el próximo bono»—,
      y que siguen renovando cada vez que lo gastan. Quien tenga marcado «No va a renovar» no cuenta. No incluye potenciales ni clientes que pagan después.</p>${sin}`;
}

export function renderResumen(el) {
  const mes = S.resumenMes, hoy = hoyISO();
  const filtro = entrenadorFiltroId();                       // null = todos los entrenadores
  const clientes = filtro ? S.clientes.filter(c => c.entrenador_id === filtro) : S.clientes;
  const porEntr = agrupar(clientes, c => c.entrenador_id, mes, hoy);
  const porOrigen = agrupar(clientes, c => c.origen, mes, hoy);
  const total = sumar(porEntr.values());
  const vacio = { efectivos: 0, potenciales: 0, cobrado: 0, pendiente: 0, programado: 0, estimado: 0 };
  const base = S.resumenBase, sigBase = primerDiaMes(base + '-01', 1).slice(0, 7);
  const este = facturacionMes(clientes, base, hoy);
  const siguiente = facturacionMes(clientes, sigBase, hoy);
  // Renovaciones previstas: cubren la proyección a 6 meses y, si se navega más lejos, también las dos tarjetas de arriba.
  const hasta = [ultimoDiaMes(primerDiaMes(hoy, MESES_PROYECCION)), ultimoDiaMes(sigBase + '-01')].sort().pop();
  const proy = proyectarRenovaciones(clientes, hoy, hasta);
  const prevDe = mes => proy.filas.filter(r => r.fecha.slice(0, 7) === mes);

  el.innerHTML = `
    <div class="resumen-filtro">${filtroEntrenadorHTML(S.entrenadores, S.filtroEntr)}</div>
    <div class="section-title">Facturación prevista</div>
    <div class="cal-nav" style="margin-bottom:14px">
      <button class="cal-btn" data-acc="res-base-prev" aria-label="Meses anteriores">◀</button>
      <div class="cal-month-lbl">${nombreMes(base).toUpperCase()} – ${nombreMes(sigBase).toUpperCase()}</div>
      <button class="cal-btn" data-acc="res-base-next" aria-label="Meses siguientes">▶</button>
      ${base === hoy.slice(0, 7) ? '' : '<button class="btn btn-secondary btn-sm" data-acc="res-base-hoy">Hoy</button>'}
    </div>
    <div class="prevs">${panelMes(este, etiquetaMes(base, hoy), prevDe(base))}${panelMes(siguiente, etiquetaMes(sigBase, hoy), prevDe(sigBase))}</div>
    <p class="hint" style="margin-bottom:26px">Cada bono cuenta en el mes de su <b>fecha de pago</b>. «Pagado» = lo has confirmado tú; «Pendiente de cobro» = la fecha ya llegó y aún no lo has marcado;
      «Programado» = fecha de pago futura; «Renovación prevista» = lo que se estima que pagarán al acabárseles el bono (no es un pago registrado).</p>

    ${proyeccionHTML(clientes, proy, hoy)}
    ${deudasHTML(clientes)}
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
      ${S.entrenadores.filter(e => !filtro || e.id === filtro).map(e => fila(e.nombre, porEntr.get(e.id) || vacio, e.color)).join('')}
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
const moverBase = n => { S.resumenBase = primerDiaMes(S.resumenBase + '-01', n).slice(0, 7); bus.repintar(); };
export const accionesResumen = {
  'res-prev': () => moverMes(-1),
  'res-next': () => moverMes(1),
  'res-base-prev': () => moverBase(-1),
  'res-base-next': () => moverBase(1),
  'res-base-hoy': () => { S.resumenBase = hoyISO().slice(0, 7); bus.repintar(); },
};
