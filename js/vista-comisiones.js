// Liquidación de comisiones de los entrenadores.
// ADMINISTRADOR: los porcentajes y el trato de cada bono (declarado / pago en nómina) se pueden tocar aquí mismo y
// todo se recalcula al momento, como una hoja de cálculo; se guarda en Supabase para la próxima vez. Un bono se puede
// excluir de la liquidación normal: baja a «Ajustes manuales», donde se escribe a mano cuántas clases ha dado el
// entrenador y a qué precio (y, si hace falta, otro % de comisión). También se pueden añadir líneas manuales sueltas.
// ENTRENADOR: ve la misma pestaña pero solo con SUS bonos cobrados y como una SIMULACIÓN. Parte de lo que el
// administrador ha decidido sobre lo suyo (exclusiones, ajustes manuales, nómina / efectivo: solo lectura en la base
// de datos) y encima puede jugar con todo —«Incluir», «declarado», «efectivo / nómina», los porcentajes y los ajustes—
// para ver cómo salen los números, pero NADA de lo que cambie se guarda («↺ Restablecer» vuelve a lo del administrador).
import { S, bus, esAdmin, puedeVerComisiones, entrenadorDe, nombreCompleto, entrenadorFiltroId } from './store.js';
import { esc, fmtEUR, fmtFecha, nombreMes, etiquetaMetodo, toast, dialogo, filtroEntrenadorHTML } from './util.js';
import { modalAnticipo } from './modales.js';
import {
  hoyISO, primerDiaMes, liquidacionMes, lineasManualesMes, totalesComisiones, entrenadoresConComision,
  anticiposDelMes, totalAnticipos, repartoNomina, DEFAULT_CONFIG_COMISIONES,
} from './logica.js';
import { instantaneaLiquidacion, estaCerrada, csvLiquidacion, nombreArchivo } from './liquidacion.js';
import { hojaLiquidacionHTML } from './liquidacion-doc.js';

export async function cargarComisiones() {
  const admin = esAdmin();
  // El entrenador juega con lo que ya tiene en pantalla: si vuelve a la pestaña no se le borran sus pruebas.
  if (!admin && S.comisiones.cargado) { await cargarCierres(admin); bus.repintar(); return; }
  S.comisiones.cargando = true;
  bus.repintar();
  try {
    S.comisiones.config = (await S.api.obtenerConfigComisiones()) || { ...DEFAULT_CONFIG_COMISIONES };
  } catch (e) {
    if (admin) toast(e.message, true);   // un entrenador simplemente parte de los valores por defecto
    if (!S.comisiones.config) S.comisiones.config = { ...DEFAULT_CONFIG_COMISIONES };   // para poder seguir viendo la pantalla
  }
  // Lo que el administrador ha decidido (el entrenador solo recibe lo suyo: lo impone la base de datos, sql/15).
  try { S.comisiones.overrides = new Map((await S.api.listarOverridesComisiones()).map(o => [o.bono_id, o])); }
  catch (e) { S.comisiones.overrides = new Map(); if (admin) toast(e.message, true); }
  // Las líneas manuales van aparte: si aún no se ha ejecutado sql/12, el resto de la pantalla sigue funcionando.
  try { S.comisiones.libres = await S.api.listarLineasManuales(); }
  catch (e) { S.comisiones.libres = []; if (admin) toast(`Ajustes manuales no disponibles: ${e.message}`, true); }
  // Igual con los anticipos (sql/18): si aún no existe la tabla, lo demás sigue funcionando.
  try { S.comisiones.anticipos = await S.api.listarAnticipos(); }
  catch (e) { S.comisiones.anticipos = []; if (admin) toast(`Anticipos no disponibles: ${e.message}`, true); }
  // Y con la nómina de cada entrenador y el reparto nómina / efectivo (sql/21).
  try { S.comisiones.nominas = await S.api.listarNominasComision(); }
  catch (e) { S.comisiones.nominas = []; if (admin) toast(`Nóminas no disponibles: ${e.message}`, true); }
  await cargarCierres(admin);
  S.comisiones.cargando = false;
  S.comisiones.cargado = true;
  bus.repintar();
}

// Liquidaciones cerradas (sql/23): si aún no existe la tabla, lo demás sigue funcionando (sin poder cerrar).
async function cargarCierres(admin) {
  try { S.comisiones.cierres = await S.api.listarCierresLiquidacion(); S.comisiones.cierresDisponibles = true; }
  catch (e) { S.comisiones.cierres = []; S.comisiones.cierresDisponibles = false; if (admin) toast(`Cerrar liquidaciones no disponible: ${e.message}`, true); }
}

function datos() {
  const config = S.comisiones.config || DEFAULT_CONFIG_COMISIONES;
  const filtro = entrenadorFiltroId();
  const idsConComision = new Set(entrenadoresConComision(S.entrenadores).map(e => e.id));
  const visible = id => idsConComision.has(id) && (!filtro || id === filtro);
  // Lo que se cobra en nómina o en efectivo ya no se elige bono a bono: se reparte sobre el total del mes (ver repartoNomina).
  // Por eso aquí todo se calcula sin el paso de la Seguridad Social, aunque algún bono guardado dijera «nómina».
  const overridesObj = Object.fromEntries([...S.comisiones.overrides].map(([k, o]) => [k, { ...o, pago_entrenador: 'efectivo' }]));
  const filas = liquidacionMes(S.clientes.filter(c => visible(c.entrenador_id)), S.comisiones.mes, config, overridesObj);
  const lineas = lineasManualesMes(filas, S.comisiones.libres.filter(l => visible(l.entrenador_id)).map(l => ({ ...l, pago_entrenador: 'efectivo' })), S.comisiones.mes, config, overridesObj);
  const anticipos = anticiposDelMes(S.comisiones.anticipos, S.comisiones.mes).filter(a => visible(a.entrenador_id));
  return { config, filtro, filas, lineas, anticipos, entrenadores: S.entrenadores.filter(e => visible(e.id)) };
}

const plural = (n, uno, varios) => (n === 1 ? uno : varios);

const cabeceraTabla = () => `<thead><tr>
  <th title="Desmarca para pasar este bono a «Ajustes manuales»">Incluir</th><th>Cliente</th><th class="num">Pagado el</th><th>Origen</th><th class="num">Importe</th>
  <th>Declarado (IVA)</th><th class="num">Base</th><th class="num">Comisión</th>
</tr></thead>`;

function filaHTML(f) {
  const c = f.cliente, b = f.bono;
  return `<tr>
    <td class="com-incluir"><input type="checkbox" data-acc="com-incluir" data-bono="${b.id}" checked aria-label="Incluir en la liquidación" title="Incluido en la liquidación. Desmárcalo para ajustarlo a mano"></td>
    <td>${esc(nombreCompleto(c))}</td>
    <td class="num">${fmtFecha(b.pagado_el)}</td>
    <td><span class="chip ${c.origen === 'codek' ? 'granate' : 'gris'}">${c.origen === 'codek' ? 'CODEK' : 'EXTERNO'}</span> <span class="hint">${f.pct}%</span></td>
    <td class="num">${fmtEUR(b.precio)}</td>
    <td><label class="check check-sm"><input type="checkbox" data-acc="com-declarado" data-bono="${b.id}" ${f.declarado ? 'checked' : ''}>
      declarado</label>${b.metodo_pago ? ` <span class="hint">pagó: ${esc(etiquetaMetodo(b.metodo_pago))}</span>` : ''}</td>
    <td class="num">${fmtEUR(f.base)}</td>
    <td class="num verde"><b>${fmtEUR(f.comision)}</b></td>
  </tr>`;
}

const tablaFilasHTML = filas => filas.length
  ? `<div class="tabla-wrap"><table class="tabla tabla-com">${cabeceraTabla()}<tbody>${filas.map(filaHTML).join('')}</tbody></table></div>`
  : `<div class="vacio">${esAdmin() ? 'Sin bonos en la liquidación normal este mes' : 'Todavía no hay bonos cobrados este mes'}</div>`;

// ── Ajustes manuales ──────────────────────────────────────────────────────
// Clave de una línea: «b:<id del bono>» (bono excluido) o «l:<id>» (línea suelta).
const claveLinea = l => `${l.tipo === 'bono' ? 'b' : 'l'}:${l.id}`;

const entradaNum = (key, campo, valor, placeholder = '') =>
  `<input class="form-input man-in" type="text" inputmode="decimal" autocomplete="off" data-man="${key}" data-campo="${campo}" value="${esc(valor ?? '')}" placeholder="${esc(placeholder)}">`;

function lineaManualHTML(l) {
  const k = claveLinea(l);
  const concepto = l.tipo === 'bono'
    ? `${esc(l.concepto)} <span class="chip gris">BONO EXCLUIDO</span><div class="hint">pagó ${fmtEUR(l.bono.precio)} el ${fmtFecha(l.bono.pagado_el)}</div>`
    : `<input class="form-input man-in man-concepto" type="text" autocomplete="off" data-man="${k}" data-campo="concepto" value="${esc(l.concepto)}" placeholder="Concepto (p. ej. clases sueltas)">`;
  const accion = l.tipo === 'bono'
    ? `<button class="btn btn-sm btn-secondary" data-acc="com-reincluir" data-bono="${l.id}" title="Volver a la liquidación normal">↩ Incluir</button>`
    : `<button class="sess-del" data-acc="com-man-borrar" data-man="${k}" title="Eliminar línea" aria-label="Eliminar línea">✕</button>`;
  return `<tr>
    <td class="man-concepto-td">${concepto}</td>
    <td>${entradaNum(k, 'clases', l.clases, '0')}</td>
    <td>${entradaNum(k, 'precio', l.precio, '0,00')}</td>
    <td class="num">${fmtEUR(l.importe)}</td>
    <td>${entradaNum(k, 'pct', l.pct_manual, String(l.pctDefecto))}</td>
    <td><label class="check check-sm"><input type="checkbox" data-acc="com-man-declarado" data-man="${k}" ${l.declarado ? 'checked' : ''}> declarado</label></td>
    <td class="num verde"><b>${fmtEUR(l.comision)}</b></td>
    <td class="com-man-accion">${accion}</td>
  </tr>`;
}

function seccionManualHTML(entrenadorId, lineas) {
  const tabla = lineas.length
    ? `<div class="tabla-wrap"><table class="tabla tabla-com tabla-man"><thead><tr>
        <th>Concepto</th><th>Clases</th><th>€ / clase</th><th class="num">Importe</th><th>% comisión</th><th>Declarado (IVA)</th><th class="num">Comisión</th><th></th>
      </tr></thead><tbody>${lineas.map(lineaManualHTML).join('')}</tbody></table></div>
      <p class="hint">Importe = clases × € por clase. El % vacío usa el del origen del cliente (el que se ve en gris); después se aplican los mismos descuentos que arriba.</p>`
    : '<div class="hint">Aquí aparecen los bonos que excluyes (desmarcando «Incluir») y las líneas que añadas a mano.</div>';
  return `<div class="section-mini com-man-titulo">Ajustes manuales</div>${tabla}
    <button class="btn btn-secondary btn-sm" style="margin-top:8px" data-acc="com-man-nueva" data-ent="${entrenadorId}">+ Añadir línea manual</button>`;
}

// ── Anticipos ─────────────────────────────────────────────────────────────
// Dinero adelantado al entrenador: se resta de su comisión del mes en que se descuenta. Solo el administrador los gestiona;
// el entrenador ve los suyos (no se pueden tocar ni en su simulación: son hechos, no pruebas).
function seccionAnticiposHTML(entrenadorId, lista) {
  const admin = esAdmin();
  const tabla = lista.length
    ? `<div class="tabla-wrap"><table class="tabla tabla-com"><thead><tr><th class="num">Fecha</th><th>Nota</th><th>Se descuenta de</th><th class="num">Importe</th>${admin ? '<th></th>' : ''}</tr></thead><tbody>
      ${lista.map(a => `<tr><td class="num">${fmtFecha(a.fecha)}</td><td>${esc(a.concepto || 'Anticipo')}</td><td>${esc(nombreMes(a.mes))}</td>
        <td class="num" style="color:var(--red-light)"><b>−${fmtEUR(a.importe)}</b></td>
        ${admin ? `<td class="com-man-accion"><button class="btn btn-sm btn-secondary" data-acc="com-ant-pasar" data-id="${a.id}" title="Descontarlo en la liquidación del mes siguiente">→ Mes siguiente</button>
          <button class="sess-del" data-acc="com-ant-editar" data-id="${a.id}" title="Editar anticipo" aria-label="Editar anticipo">✎</button>
          <button class="sess-del" data-acc="com-ant-borrar" data-id="${a.id}" title="Eliminar anticipo" aria-label="Eliminar anticipo">✕</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div>`
    : `<div class="hint">${admin ? 'Aquí aparece el dinero que le adelantes en efectivo o como sea, para restarlo de su comisión.' : 'Sin anticipos este mes.'}</div>`;
  return `<div class="section-mini com-man-titulo">Anticipos entregados</div>${tabla}
    ${admin ? `<button class="btn btn-secondary btn-sm" style="margin-top:8px" data-acc="com-ant-nuevo" data-ent="${entrenadorId}">+ Registrar anticipo</button>` : ''}`;
}

// ── Nómina y reparto ──────────────────────────────────────────────────────
// Un entrenador con nómina cobra como mínimo esa nómina. A su comisión del mes se le restan los anticipos y el COSTE EMPRESA de la
// nómina; lo que queda lo reparte el administrador entre nómina (se suma al bruto, sin la SS de la empresa) y efectivo.
// El administrador apunta el bruto, el coste empresa y cuánto va a nómina; el entrenador ve lo suyo y puede probar su reparto.
const nominaDe = (entrenadorId, mes = S.comisiones.mes) => (S.comisiones.nominas || []).find(n => n.entrenador_id === entrenadorId && n.mes === mes) || null;
const nominaAnterior = entrenadorId => (S.comisiones.nominas || []).filter(n => n.entrenador_id === entrenadorId && n.mes < S.comisiones.mes)
  .sort((a, b) => b.mes.localeCompare(a.mes))[0] || null;
const fmtNum = n => (n === null || n === undefined || n === '' || Number(n) === 0 ? '' : String(Math.round(Number(n) * 100) / 100).replace('.', ','));
const entradaNomina = (entrenadorId, campo, valor, label, editable, placeholder = '0,00') => `<label class="nom-campo"><span>${label}</span>${editable
  ? `<input class="form-input man-in" type="text" inputmode="decimal" autocomplete="off" data-nom="${entrenadorId}" data-campo="${campo}" value="${esc(fmtNum(valor))}" placeholder="${esc(placeholder)}">`
  : `<b>${fmtEUR(valor || 0)}</b>`}</label>`;
const filaReparto = (txt, valor, { signo = '', clase = '', detalle = '' } = {}) => `<tr class="${clase}"><td>${txt}${detalle ? ` <span class="hint">${detalle}</span>` : ''}</td><td class="num">${signo}${fmtEUR(Math.abs(valor))}</td></tr>`;

function seccionNominaHTML(entrenadorId, comision, anticiposLista) {
  const admin = esAdmin(), config = S.comisiones.config || DEFAULT_CONFIG_COMISIONES;
  const nom = nominaDe(entrenadorId);
  const r = repartoNomina({ comision, anticipos: totalAnticipos(anticiposLista), nomina: nom, ssPct: config.ss_pct });
  const previa = !nom && admin ? nominaAnterior(entrenadorId) : null;
  const campos = `<div class="nom-grid">
      ${entradaNomina(entrenadorId, 'bruto', nom?.bruto, 'Bruto de su nómina (€)', admin)}
      ${entradaNomina(entrenadorId, 'coste_empresa', nom?.coste_empresa, 'Coste empresa de la nómina (€)', admin)}
      ${entradaNomina(entrenadorId, 'parte_nomina', nom?.parte_nomina, 'De lo que queda, en nómina (€)', true)}</div>`;
  const aviso = !nom
    ? `<div class="hint" style="margin:6px 0">${admin ? 'No hay nómina apuntada este mes: no se resta nada de su comisión.' : 'Todavía no hay nómina apuntada este mes.'}
        ${previa ? `<button class="btn btn-sm btn-secondary" data-acc="com-nom-copiar" data-ent="${entrenadorId}">Copiar la de ${esc(nombreMes(previa.mes))} (coste ${fmtEUR(previa.coste_empresa)})</button>` : ''}</div>` : '';
  return `<div class="section-mini com-man-titulo">Nómina y reparto</div>${campos}${aviso}
    ${repartoHTML(r, !!nom, config.ss_pct, !!totalAnticipos(anticiposLista))}
    ${admin ? '' : '<div class="hint">Puedes probar cuánto pasar a nómina; es solo una prueba, no se guarda.</div>'}`;
}

// La tabla del reparto (comisión − anticipos − coste empresa = queda → nómina / efectivo), con su aviso si la comisión no cubre la nómina.
// La usan la liquidación abierta (calculada al momento) y la cerrada (la copia guardada).
function repartoHTML(r, hayNomina, ssPct, hayAnticipos) {
  const filas = [
    filaReparto('Comisión del mes', r.comision),
    r.anticipos ? filaReparto('Anticipos ya entregados', r.anticipos, { signo: '−' }) : '',
    hayNomina ? filaReparto('Coste empresa de su nómina', r.coste, { signo: '−', detalle: `bruto ${fmtEUR(r.bruto)} + SS de la empresa ${fmtEUR(r.coste - r.bruto)}` }) : '',
    filaReparto('Queda por repartir', r.queda, { signo: r.queda < 0 ? '−' : '', clase: r.queda < 0 ? 'rep-total rep-neg' : 'rep-total' }),
    r.queda > 0 ? filaReparto('→ En nómina', r.enNomina, { detalle: r.enNomina ? `se suman <b>${fmtEUR(r.brutoExtra)}</b> al bruto (${fmtEUR(r.enNomina)} ÷ ${(1 + ssPct / 100).toLocaleString('es-ES', { maximumFractionDigits: 3 })}; la SS de la empresa se lleva ${fmtEUR(r.ssExtra)})` : '' }) : '',
    r.queda > 0 ? filaReparto('→ En efectivo', r.efectivo, { clase: 'rep-efectivo' }) : '',
  ].join('');
  const resultado = r.queda > 0 && r.enNomina && hayNomina
    ? `<div class="hint" style="margin-top:6px">Su nómina quedaría en <b>${fmtEUR(r.brutoNuevo)}</b> de bruto (${fmtEUR(r.bruto)} + ${fmtEUR(r.brutoExtra)}), con un coste empresa total de <b>${fmtEUR(r.costeNominaNuevo)}</b>.</div>` : '';
  const alerta = r.descubierto
    ? `<div class="alert alert-warn" style="margin-top:8px">⚠ Su comisión no cubre la nómina: faltan <b>${fmtEUR(r.descubierto)}</b>. Su nómina es el mínimo que cobra, así que este mes no queda nada por repartir.
        ${hayAnticipos ? 'Si hay anticipos, puedes pasarlos al mes siguiente con «→ Mes siguiente».' : ''}</div>` : '';
  return `<div class="tabla-wrap"><table class="tabla tabla-reparto"><tbody>${filas}</tbody></table></div>${resultado}${alerta}`;
}

const subtotalHTML = t => `<div class="com-subtotal">Facturado ${fmtEUR(t.importe)} · Comisión total <b>${fmtEUR(t.comision)}</b>
  · ${t.n} ${plural(t.n, 'bono', 'bonos')}${t.manuales
    ? ` · <span class="com-aviso">${t.manuales} ${plural(t.manuales, 'ajuste manual', 'ajustes manuales')}: ${fmtEUR(t.comisionManual)}</span>` : ''}</div>`;

// Lo que queda por repartir de un entrenador este mes (comisión − anticipos − coste empresa de su nómina).
function quedaDe(e, filas, lineas, anticipos) {
  const cierre = cierreDe(e.id);
  if (cierre) return cierre.datos.reparto.queda;   // cerrada: lo que se guardó, no lo que saldría ahora
  const config = S.comisiones.config || DEFAULT_CONFIG_COMISIONES;
  return repartoNomina({ comision: totalesComisiones(filas, lineas).comision, anticipos: totalAnticipos(anticipos), nomina: nominaDe(e.id), ssPct: config.ss_pct }).queda;
}

// ── Cerrar la liquidación (sql/23) ────────────────────────────────────────
// Una liquidación cerrada es la copia fija que se guardó: se enseña esa copia (solo lectura) y la base de datos impide tocar lo que la cambiaría.
const registroCierre = (entrenadorId, mes = S.comisiones.mes) => (S.comisiones.cierres || []).find(c => c.entrenador_id === entrenadorId && c.mes === mes) || null;
const cierreDe = (entrenadorId, mes = S.comisiones.mes) => { const c = registroCierre(entrenadorId, mes); return estaCerrada(c) ? c : null; };

const botonesExportar = e => `<button class="btn btn-secondary btn-sm" data-acc="com-imprimir" data-ent="${e.id}" title="Abre la hoja lista para imprimir o guardar como PDF">🖨 Imprimir / PDF</button>
  <button class="btn btn-secondary btn-sm" data-acc="com-csv" data-ent="${e.id}" title="Descarga una hoja que se abre en Excel">⬇ Excel (CSV)</button>`;

// Barra de una liquidación abierta (solo el administrador): borrador para imprimir y botón de cerrar.
function barraAbiertaHTML(e) {
  if (!esAdmin()) return '';
  const reg = registroCierre(e.id);
  const reabierta = reg?.reabierta_el ? `<span class="hint">Reabierta el ${fmtFecha(String(reg.reabierta_el).slice(0, 10))} (${reg.reaperturas} ${reg.reaperturas === 1 ? 'vez' : 'veces'}): corrígela y vuelve a cerrarla.</span>` : '';
  const cerrar = S.comisiones.cierresDisponibles === false ? '' : `<button class="btn btn-primary btn-sm" data-acc="com-cerrar" data-ent="${e.id}" title="Guarda una copia fija y bloquea este mes">🔒 Cerrar liquidación</button>`;
  return `<div class="com-barra">${reabierta}${botonesExportar(e)}${cerrar}</div>`;
}

const filaBonoCerradaHTML = b => `<tr><td>${esc(b.cliente)}</td><td class="num">${fmtFecha(b.pagado_el)}</td>
  <td><span class="chip ${b.origen === 'codek' ? 'granate' : 'gris'}">${b.origen === 'codek' ? 'CODEK' : 'EXTERNO'}</span> <span class="hint">${b.pct}%</span></td>
  <td class="num">${fmtEUR(b.importe)}</td><td>${b.declarado ? 'declarado' : 'sin declarar'}${b.metodo_pago ? ` <span class="hint">pagó: ${esc(etiquetaMetodo(b.metodo_pago))}</span>` : ''}</td>
  <td class="num">${fmtEUR(b.base)}</td><td class="num verde"><b>${fmtEUR(b.comision)}</b></td></tr>`;

function grupoCerradoHTML(e, cierre) {
  const d = cierre.datos, admin = esAdmin();
  const quien = d.cerrada_por ? ` por <b>${esc(d.cerrada_por)}</b>` : '';
  const veces = cierre.reaperturas ? ` · reabierta ${cierre.reaperturas} ${cierre.reaperturas === 1 ? 'vez' : 'veces'}` : '';
  const bonos = d.bonos.length
    ? `<div class="tabla-wrap"><table class="tabla tabla-com"><thead><tr><th>Cliente</th><th class="num">Pagado el</th><th>Origen</th><th class="num">Importe</th><th>Declarado (IVA)</th><th class="num">Base</th><th class="num">Comisión</th></tr></thead>
       <tbody>${d.bonos.map(filaBonoCerradaHTML).join('')}</tbody></table></div>`
    : '<div class="vacio">Sin bonos en la liquidación normal este mes</div>';
  const manuales = d.manuales.length
    ? `<div class="section-mini com-man-titulo">Ajustes manuales</div><div class="tabla-wrap"><table class="tabla tabla-com"><thead><tr><th>Concepto</th><th class="num">Clases</th><th class="num">€ / clase</th><th class="num">Importe</th><th class="num">% comisión</th><th>Declarado (IVA)</th><th class="num">Comisión</th></tr></thead>
       <tbody>${d.manuales.map(l => `<tr><td>${esc(l.concepto)}${l.bono_excluido ? ' <span class="chip gris">BONO EXCLUIDO</span>' : ''}</td><td class="num">${l.clases ?? ''}</td><td class="num">${l.precio === null ? '' : fmtEUR(l.precio)}</td>
         <td class="num">${fmtEUR(l.importe)}</td><td class="num">${l.pct}%</td><td>${l.declarado ? 'declarado' : 'sin declarar'}</td><td class="num verde"><b>${fmtEUR(l.comision)}</b></td></tr>`).join('')}</tbody></table></div>` : '';
  const anticipos = d.anticipos.length
    ? `<div class="section-mini com-man-titulo">Anticipos entregados</div><div class="tabla-wrap"><table class="tabla tabla-com"><thead><tr><th class="num">Fecha</th><th>Nota</th><th class="num">Importe</th></tr></thead>
       <tbody>${d.anticipos.map(a => `<tr><td class="num">${fmtFecha(a.fecha)}</td><td>${esc(a.concepto || 'Anticipo')}</td><td class="num" style="color:var(--red-light)"><b>−${fmtEUR(a.importe)}</b></td></tr>`).join('')}</tbody></table></div>` : '';
  const nomina = d.nomina
    ? `<div class="nom-grid">${entradaNomina(e.id, 'bruto', d.nomina.bruto, 'Bruto de su nómina (€)', false)}${entradaNomina(e.id, 'coste_empresa', d.nomina.coste_empresa, 'Coste empresa de la nómina (€)', false)}${entradaNomina(e.id, 'parte_nomina', d.nomina.parte_nomina, 'De lo que queda, en nómina (€)', false)}</div>` : '';
  return `<div class="com-grupo cerrado">
    <div class="com-grupo-title"><i class="tc" style="background:${e.color || '#888'}"></i>${esc(e.nombre)} <span class="chip cerrada">🔒 CERRADA</span>
      <span class="com-grupo-total" title="Lo que quedaba por repartir al cerrar">${fmtEUR(d.reparto.queda)}</span></div>
    <div class="com-cerrada"><span>🔒 <b>LIQUIDACIÓN CERRADA</b> el ${fmtFecha(String(cierre.cerrada_el).slice(0, 10))}${quien}${veces}. Es una copia fija: no cambia aunque cambien precios, porcentajes o clientes, y no se puede modificar.</span>
      <span class="com-barra">${botonesExportar(e)}${admin ? `<button class="btn btn-secondary btn-sm" data-acc="com-reabrir" data-ent="${e.id}" title="Desbloquea este mes para corregirlo">🔓 Reabrir</button>` : ''}</span></div>
    ${bonos}${manuales}
    ${subtotalHTML(d.totales)}${anticipos}
    <div class="section-mini com-man-titulo">Nómina y reparto</div>${nomina}${repartoHTML(d.reparto, !!d.nomina, d.config.ss_pct, false)}
  </div>`;
}

function grupoHTML(e, filas, lineas, anticipos) {
  const t = totalesComisiones(filas, lineas);
  return `<div class="com-grupo">
    <div class="com-grupo-title"><i class="tc" style="background:${e.color || '#888'}"></i>${esc(e.nombre)}
      <span class="com-grupo-total" title="Comisión − anticipos − coste empresa de su nómina = lo que queda por repartir">${fmtEUR(quedaDe(e, filas, lineas, anticipos))}</span></div>
    ${barraAbiertaHTML(e)}
    ${tablaFilasHTML(filas.filter(f => !f.excluido))}
    ${seccionManualHTML(e.id, lineas)}
    ${subtotalHTML(t)}
    ${seccionAnticiposHTML(e.id, anticipos)}
    ${seccionNominaHTML(e.id, t.comision, anticipos)}
  </div>`;
}

function resultadoHTML() {
  const { filtro, filas, lineas, anticipos, entrenadores } = datos();
  if (filtro && !entrenadoresConComision(S.entrenadores).some(e => e.id === filtro)) {
    return `<div class="vacio">${esc(entrenadorDe(filtro)?.nombre || 'Este entrenador')} no está, por ahora, en el sistema de comisiones.</div>`;
  }
  const delEntr = e => [filas.filter(f => f.cliente.entrenador_id === e.id), lineas.filter(l => l.entrenador_id === e.id), anticipos.filter(a => a.entrenador_id === e.id)];
  const grupos = entrenadores.map(e => (cierreDe(e.id) ? grupoCerradoHTML(e, cierreDe(e.id)) : grupoHTML(e, ...delEntr(e))));
  if (filtro) return grupos.join('');
  return `${grupos.join('')}
    <div class="com-total-general">TOTAL POR REPARTIR <span>${fmtEUR(entrenadores.reduce((t, e) => t + quedaDe(e, ...delEntr(e)), 0))}</span></div>`;
}

// Repinta resultados sin que se note: conserva el campo en el que se está escribiendo (con lo escrito tal cual,
// por ejemplo «12,» a medias) y el punto de escritura.
const selectorCampo = el => (el.dataset.nom ? `[data-nom="${el.dataset.nom}"][data-campo="${el.dataset.campo}"]` : `[data-man="${el.dataset.man}"][data-campo="${el.dataset.campo}"]`);
function refrescarTabla() {
  const cont = document.querySelector('[data-comisiones-tabla]');
  if (!cont) return;
  const a = document.activeElement;
  const foco = a && cont.contains(a) && (a.dataset?.man || a.dataset?.nom) && a.dataset.campo
    ? { sel: selectorCampo(a), valor: a.value, ini: a.selectionStart, fin: a.selectionEnd } : null;
  cont.innerHTML = resultadoHTML();
  if (!foco) return;
  const n = cont.querySelector(foco.sel);
  if (!n) return;
  n.value = foco.valor;
  n.focus();
  try { n.setSelectionRange(foco.ini, foco.fin); } catch { /* no todos los tipos lo admiten */ }
}

function panelConfigHTML(config) {
  const campo = (key, label) => `<label class="cfg-campo"><span>${esc(label)}</span>
    <div class="cfg-input"><input class="form-input" type="number" step="0.1" min="0" max="100" data-cfg="${key}" value="${config[key]}"><span>%</span></div></label>`;
  const admin = esAdmin();
  return `
    <div class="section-title">${admin ? 'Condiciones de la comisión' : 'Condiciones pactadas (puedes probar otras)'}</div>
    <div class="cfg-grid">
      ${campo('comision_codek', 'Comisión · cliente Codek')}
      ${campo('comision_externo', 'Comisión · cliente externo')}
      ${campo('iva_pct', 'IVA a extraer si está declarado')}
      ${campo('ss_pct', 'Seguridad Social de la empresa (parte en nómina)')}
    </div>
    <div class="cfg-acciones">
      ${admin ? `<button class="btn btn-secondary btn-sm" data-acc="com-guardar-config">💾 Guardar condiciones</button>
        <span class="hint">Se recalcula al momento; guarda para que se recuerde la próxima vez.</span>`
        : '<span class="hint">Se recalcula al momento. Es solo una prueba: no se guarda.</span>'}
    </div>
    <p class="hint" style="margin-top:6px">Fórmula: importe del bono → si está declarado, se divide entre 1&nbsp;+&nbsp;IVA/100 → sobre esa base se aplica el % de comisión según
      el origen del cliente (= comisión del mes). Después se restan los anticipos y el coste empresa de su nómina, y lo que queda se reparte entre
      nómina (se suma al bruto dividido entre 1&nbsp;+&nbsp;Seg. Social/100) y efectivo.</p>`;
}

// Aviso fijo del entrenador: es una simulación, nada se guarda.
const avisoSimulacionHTML = () => `<div class="alert alert-info alert-flex com-simulacion"><span>🧮 <b>SIMULACIÓN</b> — Parte de lo que ha decidido el administrador sobre lo tuyo: tus bonos cobrados de cada mes, lo que está excluido y sus ajustes manuales.
  Encima puedes jugar con todo —«Incluir», «declarado», cuánto pasar a nómina, los porcentajes y los ajustes— para ver cómo salen los números: <b>nada de lo que cambies se guarda</b>
  ni modifica tu liquidación, que confirma el administrador.</span>
  <button class="btn btn-sm btn-secondary" data-acc="com-reset" title="Vuelve a lo que ha decidido el administrador">↺ Restablecer</button></div>`;

export function renderComisiones(el) {
  if (!puedeVerComisiones()) { el.innerHTML = ''; return; }
  if (!S.comisiones.cargado) { el.innerHTML = '<div class="vacio">Cargando…</div>'; return; }
  const admin = esAdmin();
  el.innerHTML = `
    ${admin ? `<div class="resumen-filtro">${filtroEntrenadorHTML(S.entrenadores, S.filtroEntr)}</div>` : avisoSimulacionHTML()}
    ${panelConfigHTML(S.comisiones.config || DEFAULT_CONFIG_COMISIONES)}
    <div class="cal-nav" style="margin:22px 0 18px">
      <button class="cal-btn" data-acc="com-mes-prev" aria-label="Mes anterior">◀</button>
      <div class="cal-month-lbl">${nombreMes(S.comisiones.mes).toUpperCase()}</div>
      <button class="cal-btn" data-acc="com-mes-next" aria-label="Mes siguiente">▶</button>
    </div>
    <div data-comisiones-tabla>${resultadoHTML()}</div>`;
}

// El campo de texto no se puede repintar entero en cada tecla (perdería el foco): solo se actualiza la tabla.
export function alCambiarConfig(el) {
  const val = parseFloat(el.value);
  S.comisiones.config = { ...(S.comisiones.config || DEFAULT_CONFIG_COMISIONES), [el.dataset.cfg]: Number.isFinite(val) ? val : 0 };
  refrescarTabla();
}

async function guardarOverride(bonoId, cambios) {
  const actual = S.comisiones.overrides.get(bonoId) || { bono_id: bonoId, declarado: null, pago_entrenador: 'efectivo', excluido: false };
  S.comisiones.overrides.set(bonoId, { ...actual, ...cambios });   // recalcula al momento
  refrescarTabla();
  if (!esAdmin()) return;   // las pruebas de un entrenador se quedan en pantalla: nunca se guardan
  try {
    S.comisiones.overrides.set(bonoId, await S.api.guardarOverrideComision(bonoId, cambios));
  } catch (e) {
    toast('No se pudo guardar: ' + e.message, true);
  }
}

// ── Edición de las líneas manuales ────────────────────────────────────────
// Los campos de una línea se llaman igual en la pantalla (clases, precio, pct, concepto, declarado, pago_entrenador),
// pero en un bono excluido se guardan en columnas con otro nombre (manual_clases…).
const COLUMNA_BONO = { clases: 'manual_clases', precio: 'manual_precio', pct: 'manual_pct' };
const aColumnas = (tipo, cambios) => (tipo === 'b'
  ? Object.fromEntries(Object.entries(cambios).map(([k, v]) => [COLUMNA_BONO[k] ?? k, v])) : cambios);
const tipoYId = key => [key[0], key.slice(2)];
// Se admite que se escriba «40%», «35 €» o «1.5» / «1,5»: los símbolos y espacios se ignoran (si no, un «40%» se leía como vacío y se aplicaba el % por defecto).
const aNumero = texto => { const t = String(texto).replace(/[%€\s]/g, '').replace(',', '.'); const n = Number(t); return t === '' || !Number.isFinite(n) ? null : n; };

function aplicarLocal(key, cambios) {
  const [tipo, id] = tipoYId(key);
  if (tipo === 'b') {
    const actual = S.comisiones.overrides.get(id) || { bono_id: id, declarado: null, pago_entrenador: 'efectivo', excluido: false };
    S.comisiones.overrides.set(id, { ...actual, ...aColumnas('b', cambios) });
  } else {
    const i = S.comisiones.libres.findIndex(l => l.id === id);
    if (i >= 0) S.comisiones.libres[i] = { ...S.comisiones.libres[i], ...cambios };
  }
}
// No se sustituye lo local por lo que devuelva el servidor: si ya se está escribiendo en otro campo se perdería.
async function persistirManual(key, cambios) {
  if (!esAdmin()) return;   // las pruebas de un entrenador se quedan en pantalla: nunca se guardan
  const [tipo, id] = tipoYId(key);
  try {
    if (tipo === 'b') await S.api.guardarOverrideComision(id, aColumnas('b', cambios));
    else await S.api.actualizarLineaManual(id, cambios);
  } catch (e) {
    toast('No se pudo guardar: ' + e.message, true);
  }
}
async function cambiarManual(key, cambios) {
  aplicarLocal(key, cambios);
  refrescarTabla();
  await persistirManual(key, cambios);
}

const valorDeCampo = el => (el.dataset.campo === 'concepto' ? el.value : aNumero(el.value));
// Mientras se escribe se recalcula al momento (evento input); al soltar el campo se guarda (evento change).
export function alEditarManual(el) {
  aplicarLocal(el.dataset.man, { [el.dataset.campo]: valorDeCampo(el) });
  refrescarTabla();
}
export function alGuardarManual(el) {
  return persistirManual(el.dataset.man, { [el.dataset.campo]: valorDeCampo(el) });
}

// ── Edición de la nómina (bruto, coste empresa y cuánto pasa a nómina) ─────
// La fila del mes se crea vacía en pantalla si no existe; el administrador la guarda al soltar el campo, el entrenador solo la prueba.
function filaNomina(entrenadorId) {
  let n = nominaDe(entrenadorId);
  if (!n) {
    n = { id: `local-${Date.now()}`, entrenador_id: entrenadorId, mes: S.comisiones.mes, bruto: 0, coste_empresa: 0, parte_nomina: 0 };
    S.comisiones.nominas = [...(S.comisiones.nominas || []), n];
  }
  return n;
}
const guardarNomina = async n => {
  try { await S.api.guardarNominaComision({ entrenador_id: n.entrenador_id, mes: n.mes, bruto: n.bruto, coste_empresa: n.coste_empresa, parte_nomina: n.parte_nomina }); }
  catch (e) { toast('No se pudo guardar: ' + e.message, true); }
};
export function alEditarNomina(el) {
  filaNomina(el.dataset.nom)[el.dataset.campo] = Math.max(0, aNumero(el.value) ?? 0);
  refrescarTabla();
}
export async function alGuardarNomina(el) {
  if (!esAdmin()) return;   // las pruebas de un entrenador se quedan en pantalla: nunca se guardan
  await guardarNomina(filaNomina(el.dataset.nom));
}

// Lo que se ve ahora de un entrenador y mes, como copia (para cerrarlo o para imprimir el borrador).
function instantaneaDe(entrenadorId) {
  const { config, filas, lineas, anticipos } = datos();
  const entrenador = entrenadorDe(entrenadorId) || { id: entrenadorId, nombre: '' };
  return instantaneaLiquidacion({
    entrenador, mes: S.comisiones.mes, config,
    filas: filas.filter(f => f.cliente.entrenador_id === entrenadorId), lineas: lineas.filter(l => l.entrenador_id === entrenadorId),
    anticipos: anticipos.filter(a => a.entrenador_id === entrenadorId), nomina: nominaDe(entrenadorId),
  });
}
const paraExportar = entrenadorId => { const cierre = cierreDe(entrenadorId); return { cierre, snap: cierre ? cierre.datos : instantaneaDe(entrenadorId) }; };

const moverMesCom = n => { S.comisiones.mes = primerDiaMes(S.comisiones.mes + '-01', n).slice(0, 7); bus.repintar(); };

export const accionesComisiones = {
  'com-mes-prev': () => moverMesCom(-1),
  'com-mes-next': () => moverMesCom(1),
  'com-declarado': t => guardarOverride(t.dataset.bono, { declarado: t.checked }),
  // Desmarcar «Incluir» pasa el bono a «Ajustes manuales» y deja el cursor en «Clases» para rellenarlo.
  'com-incluir': async t => {
    const bono = t.dataset.bono, excluir = !t.checked;
    await guardarOverride(bono, { excluido: excluir });
    if (!excluir) return;
    const campo = document.querySelector(`[data-man="b:${bono}"][data-campo="clases"]`);
    campo?.scrollIntoView({ block: 'center' });
    campo?.focus();
  },
  'com-reincluir': t => guardarOverride(t.dataset.bono, { excluido: false }),
  'com-man-declarado': t => cambiarManual(t.dataset.man, { declarado: t.checked }),
  'com-man-nueva': async t => {
    // El entrenador crea la línea solo en pantalla (con un id local); el administrador la guarda de verdad.
    const nueva = esAdmin()
      ? await S.api.crearLineaManual({ mes: S.comisiones.mes, entrenador_id: t.dataset.ent })
      : { id: `local-${Date.now()}`, mes: S.comisiones.mes, entrenador_id: t.dataset.ent, concepto: '', clases: null, precio: null, pct: null, declarado: false, pago_entrenador: 'efectivo' };
    S.comisiones.libres.push(nueva);
    refrescarTabla();
    const campo = document.querySelector(`[data-man="l:${nueva.id}"][data-campo="concepto"]`);
    campo?.scrollIntoView({ block: 'center' });
    campo?.focus();
  },
  'com-man-borrar': async t => {
    const [, id] = tipoYId(t.dataset.man);
    const l = S.comisiones.libres.find(x => x.id === id);
    const ok = await dialogo({ titulo: 'Eliminar línea manual', mensaje: `<p>¿Eliminar la línea «${esc(l?.concepto || 'sin concepto')}»?${esAdmin() ? ' No se puede deshacer.' : ' (Solo en tu simulación.)'}</p>`, ok: 'Eliminar', peligro: true });
    if (!ok) return;
    if (esAdmin()) await S.api.eliminarLineaManual(id);
    S.comisiones.libres = S.comisiones.libres.filter(x => x.id !== id);
    refrescarTabla();
  },
  // Nómina: copiar la del mes anterior (bruto y coste empresa; la parte en nómina empieza en 0)
  'com-nom-copiar': async t => {
    if (!esAdmin()) return;
    const prev = nominaAnterior(t.dataset.ent);
    if (!prev) return;
    const n = filaNomina(t.dataset.ent);
    Object.assign(n, { bruto: prev.bruto, coste_empresa: prev.coste_empresa, parte_nomina: 0 });
    refrescarTabla();
    await guardarNomina(n);
  },
  // Anticipos a los entrenadores (solo administrador)
  'com-ant-nuevo': t => modalAnticipo(t.dataset.ent),
  'com-ant-editar': t => { const a = S.comisiones.anticipos.find(x => x.id === t.dataset.id); if (a) modalAnticipo(a.entrenador_id, a); },
  'com-ant-pasar': async t => {
    const a = S.comisiones.anticipos.find(x => x.id === t.dataset.id);
    if (!a || !esAdmin()) return;
    const mes = primerDiaMes(a.mes + '-01', 1).slice(0, 7);
    const guardado = await S.api.actualizarAnticipo(a.id, { mes });
    S.comisiones.anticipos = S.comisiones.anticipos.map(x => (x.id === a.id ? guardado : x));
    refrescarTabla();
    toast(`Anticipo de ${fmtEUR(a.importe)} pasado a ${nombreMes(mes)}`);
  },
  'com-ant-borrar': async t => {
    const a = S.comisiones.anticipos.find(x => x.id === t.dataset.id);
    if (!a || !esAdmin()) return;
    const ok = await dialogo({ titulo: 'Eliminar anticipo', mensaje: `<p>¿Eliminar el anticipo de <b>${fmtEUR(a.importe)}</b> del ${fmtFecha(a.fecha)}? Dejará de restarse de su comisión. No se puede deshacer.</p>`, ok: 'Eliminar', peligro: true });
    if (!ok) return;
    await S.api.eliminarAnticipo(a.id);
    S.comisiones.anticipos = S.comisiones.anticipos.filter(x => x.id !== a.id);
    refrescarTabla();
  },
  // Cerrar la liquidación (solo administrador): guarda una copia fija y bloquea el mes en la base de datos
  'com-cerrar': async t => {
    if (!esAdmin()) return;
    const e = entrenadorDe(t.dataset.ent), mes = S.comisiones.mes;
    const snap = instantaneaDe(t.dataset.ent), r = snap.reparto;
    const nom = nominaDe(t.dataset.ent);
    const ok = await dialogo({ titulo: 'Cerrar liquidación', ok: 'Cerrar y bloquear', mensaje: `<p>¿Cerrar la liquidación de <b>${esc(nombreMes(mes))}</b> de <b>${esc(e?.nombre || '')}</b>?</p>
      <p>Comisión <b>${fmtEUR(r.comision)}</b>${r.anticipos ? ` − anticipos ${fmtEUR(r.anticipos)}` : ''}${r.coste ? ` − coste empresa ${fmtEUR(r.coste)}` : ''} = queda por repartir <b>${fmtEUR(r.queda)}</b>
        (${fmtEUR(r.enNomina)} en nómina · ${fmtEUR(r.efectivo)} en efectivo).</p>
      <p>Se guarda tal cual y <b>ya no se podrá modificar</b>: ni los bonos cobrados ese mes, ni los ajustes, anticipos y nómina de ese mes. Si hace falta corregir algo, podrás reabrirla (queda apuntado).</p>
      ${r.descubierto ? `<p class="hint" style="color:var(--yellow)">⚠ La comisión no cubre la nómina (faltan ${fmtEUR(r.descubierto)}).</p>` : ''}` });
    if (!ok) return;
    if (nom) await S.api.guardarNominaComision({ entrenador_id: nom.entrenador_id, mes: nom.mes, bruto: nom.bruto, coste_empresa: nom.coste_empresa, parte_nomina: nom.parte_nomina });   // por si había algo sin soltar
    const guardada = await S.api.cerrarLiquidacion({ entrenador_id: t.dataset.ent, mes, datos: { ...snap, cerrada_por: S.perfil.nombre } });
    S.comisiones.cierres = [...(S.comisiones.cierres || []).filter(c => c.id !== guardada.id), guardada];
    bus.repintar();
    toast(`Liquidación de ${nombreMes(mes)} de ${e?.nombre || ''} cerrada`);
  },
  'com-reabrir': async t => {
    if (!esAdmin()) return;
    const cierre = cierreDe(t.dataset.ent), e = entrenadorDe(t.dataset.ent);
    if (!cierre) return;
    const ok = await dialogo({ titulo: 'Reabrir liquidación', ok: 'Reabrir', peligro: true, mensaje: `<p>¿Reabrir la liquidación de <b>${esc(nombreMes(cierre.mes))}</b> de <b>${esc(e?.nombre || '')}</b>?</p>
      <p>Se desbloquea ese mes y vuelve a calcularse con los datos de ahora. <b>Queda apuntado que se reabrió.</b> Para guardarla de nuevo hay que volver a cerrarla.</p>` });
    if (!ok) return;
    const guardada = await S.api.reabrirLiquidacion(cierre.id);
    S.comisiones.cierres = S.comisiones.cierres.map(c => (c.id === guardada.id ? guardada : c));
    bus.repintar();
    toast('Liquidación reabierta');
  },
  // Imprimir / guardar como PDF y exportar a Excel: de la copia fija si está cerrada, y si no, de lo que se ve ahora (borrador)
  'com-imprimir': t => {
    const { snap, cierre } = paraExportar(t.dataset.ent);
    const url = URL.createObjectURL(new Blob([hojaLiquidacionHTML(snap, { cerrada: cierre, cerradaPor: snap.cerrada_por })], { type: 'text/html;charset=utf-8' }));
    if (!window.open(url, '_blank')) toast('El navegador ha bloqueado la ventana de impresión: permite las ventanas emergentes para esta página.', true);
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  },
  'com-csv': t => {
    const { snap, cierre } = paraExportar(t.dataset.ent);
    const url = URL.createObjectURL(new Blob([csvLiquidacion(snap, { cerradaEl: cierre?.cerrada_el, borrador: !cierre })], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: nombreArchivo(snap, 'csv') });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
  // Entrenador: vuelve a lo que ha decidido el administrador (borra solo sus pruebas)
  'com-reset': async () => { S.comisiones.cargado = false; await cargarComisiones(); toast('Pruebas restablecidas'); },
  'com-guardar-config': async () => {
    if (!esAdmin()) return;
    try {
      S.comisiones.config = await S.api.guardarConfigComisiones(S.comisiones.config || DEFAULT_CONFIG_COMISIONES);
      toast('Condiciones guardadas');
    } catch (e) { toast(e.message, true); }
  },
};
