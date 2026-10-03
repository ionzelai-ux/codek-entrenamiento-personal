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
import {
  hoyISO, primerDiaMes, liquidacionMes, lineasManualesMes, totalesComisiones, entrenadoresConComision,
  DEFAULT_CONFIG_COMISIONES,
} from './logica.js';

export async function cargarComisiones() {
  const admin = esAdmin();
  // El entrenador juega con lo que ya tiene en pantalla: si vuelve a la pestaña no se le borran sus pruebas.
  if (!admin && S.comisiones.cargado) { bus.repintar(); return; }
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
  S.comisiones.cargando = false;
  S.comisiones.cargado = true;
  bus.repintar();
}

function datos() {
  const config = S.comisiones.config || DEFAULT_CONFIG_COMISIONES;
  const filtro = entrenadorFiltroId();
  const idsConComision = new Set(entrenadoresConComision(S.entrenadores).map(e => e.id));
  const visible = id => idsConComision.has(id) && (!filtro || id === filtro);
  const overridesObj = Object.fromEntries(S.comisiones.overrides);
  const filas = liquidacionMes(S.clientes.filter(c => visible(c.entrenador_id)), S.comisiones.mes, config, overridesObj);
  const lineas = lineasManualesMes(filas, S.comisiones.libres.filter(l => visible(l.entrenador_id)), S.comisiones.mes, config, overridesObj);
  return { config, filtro, filas, lineas, entrenadores: S.entrenadores.filter(e => visible(e.id)) };
}

const plural = (n, uno, varios) => (n === 1 ? uno : varios);

const cabeceraTabla = () => `<thead><tr>
  <th title="Desmarca para pasar este bono a «Ajustes manuales»">Incluir</th><th>Cliente</th><th class="num">Pagado el</th><th>Origen</th><th class="num">Importe</th>
  <th>Declarado (IVA)</th><th>${esAdmin() ? 'Se le paga en' : 'Lo cobro en'}</th><th class="num">Base</th><th class="num">Comisión</th>
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
    <td><div class="seg seg-sm seg-inline">
      <button class="${f.pagoEntrenador === 'efectivo' ? 'on' : ''}" data-acc="com-pago" data-bono="${b.id}" data-v="efectivo">Efectivo</button>
      <button class="${f.pagoEntrenador === 'nomina' ? 'on' : ''}" data-acc="com-pago" data-bono="${b.id}" data-v="nomina">Nómina</button>
    </div></td>
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
    <td><div class="seg seg-sm seg-inline">
      <button class="${l.pagoEntrenador === 'efectivo' ? 'on' : ''}" data-acc="com-man-pago" data-man="${k}" data-v="efectivo">Efectivo</button>
      <button class="${l.pagoEntrenador === 'nomina' ? 'on' : ''}" data-acc="com-man-pago" data-man="${k}" data-v="nomina">Nómina</button>
    </div></td>
    <td class="num verde"><b>${fmtEUR(l.comision)}</b></td>
    <td class="com-man-accion">${accion}</td>
  </tr>`;
}

function seccionManualHTML(entrenadorId, lineas) {
  const tabla = lineas.length
    ? `<div class="tabla-wrap"><table class="tabla tabla-com tabla-man"><thead><tr>
        <th>Concepto</th><th>Clases</th><th>€ / clase</th><th class="num">Importe</th><th>% comisión</th><th>Declarado (IVA)</th><th>Se le paga en</th><th class="num">Comisión</th><th></th>
      </tr></thead><tbody>${lineas.map(lineaManualHTML).join('')}</tbody></table></div>
      <p class="hint">Importe = clases × € por clase. El % vacío usa el del origen del cliente (el que se ve en gris); después se aplican los mismos descuentos que arriba.</p>`
    : '<div class="hint">Aquí aparecen los bonos que excluyes (desmarcando «Incluir») y las líneas que añadas a mano.</div>';
  return `<div class="section-mini com-man-titulo">Ajustes manuales</div>${tabla}
    <button class="btn btn-secondary btn-sm" style="margin-top:8px" data-acc="com-man-nueva" data-ent="${entrenadorId}">+ Añadir línea manual</button>`;
}

const subtotalHTML = t => `<div class="com-subtotal">Facturado ${fmtEUR(t.importe)} · Comisión total <b>${fmtEUR(t.comision)}</b>
  (efectivo ${fmtEUR(t.efectivo)} · nómina ${fmtEUR(t.nomina)}) · ${t.n} ${plural(t.n, 'bono', 'bonos')}${t.manuales
    ? ` · <span class="com-aviso">${t.manuales} ${plural(t.manuales, 'ajuste manual', 'ajustes manuales')}: ${fmtEUR(t.comisionManual)}</span>` : ''}</div>`;

function grupoHTML(e, filas, lineas) {
  const t = totalesComisiones(filas, lineas);
  return `<div class="com-grupo">
    <div class="com-grupo-title"><i class="tc" style="background:${e.color || '#888'}"></i>${esc(e.nombre)}
      <span class="com-grupo-total">${fmtEUR(t.comision)}</span></div>
    ${tablaFilasHTML(filas.filter(f => !f.excluido))}
    ${seccionManualHTML(e.id, lineas)}
    ${subtotalHTML(t)}
  </div>`;
}

function resultadoHTML() {
  const { filtro, filas, lineas, entrenadores } = datos();
  if (filtro && !entrenadoresConComision(S.entrenadores).some(e => e.id === filtro)) {
    return `<div class="vacio">${esc(entrenadorDe(filtro)?.nombre || 'Este entrenador')} no está, por ahora, en el sistema de comisiones.</div>`;
  }
  const grupos = entrenadores.map(e => grupoHTML(e, filas.filter(f => f.cliente.entrenador_id === e.id), lineas.filter(l => l.entrenador_id === e.id)));
  if (filtro) return grupos.join('');
  return `${grupos.join('')}
    <div class="com-total-general">TOTAL A LIQUIDAR <span>${fmtEUR(totalesComisiones(filas, lineas).comision)}</span></div>`;
}

// Repinta resultados sin que se note: conserva el campo en el que se está escribiendo (con lo escrito tal cual,
// por ejemplo «12,» a medias) y el punto de escritura.
function refrescarTabla() {
  const cont = document.querySelector('[data-comisiones-tabla]');
  if (!cont) return;
  const a = document.activeElement;
  const foco = a && cont.contains(a) && a.dataset?.man && a.dataset.campo
    ? { man: a.dataset.man, campo: a.dataset.campo, valor: a.value, ini: a.selectionStart, fin: a.selectionEnd } : null;
  cont.innerHTML = resultadoHTML();
  if (!foco) return;
  const n = cont.querySelector(`[data-man="${foco.man}"][data-campo="${foco.campo}"]`);
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
      ${campo('ss_pct', 'Seguridad Social si se paga en nómina')}
    </div>
    <div class="cfg-acciones">
      ${admin ? `<button class="btn btn-secondary btn-sm" data-acc="com-guardar-config">💾 Guardar condiciones</button>
        <span class="hint">Se recalcula al momento; guarda para que se recuerde la próxima vez.</span>`
        : '<span class="hint">Se recalcula al momento. Es solo una prueba: no se guarda.</span>'}
    </div>
    <p class="hint" style="margin-top:6px">Fórmula: importe del bono → si está declarado, se divide entre 1&nbsp;+&nbsp;IVA/100 → si se paga en nómina, se
      divide (sobre lo anterior) entre 1&nbsp;+&nbsp;Seg. Social/100 → sobre esa base se aplica el % de comisión según el origen del cliente.</p>`;
}

// Aviso fijo del entrenador: es una simulación, nada se guarda.
const avisoSimulacionHTML = () => `<div class="alert alert-info alert-flex com-simulacion"><span>🧮 <b>SIMULACIÓN</b> — Parte de lo que ha decidido el administrador sobre lo tuyo: tus bonos cobrados de cada mes, lo que está excluido y sus ajustes manuales.
  Encima puedes jugar con todo —«Incluir», «declarado», «efectivo / nómina», los porcentajes y los ajustes— para ver cómo salen los números: <b>nada de lo que cambies se guarda</b>
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
const aNumero = texto => { const t = String(texto).trim().replace(',', '.'); const n = Number(t); return t === '' || !Number.isFinite(n) ? null : n; };

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

const moverMesCom = n => { S.comisiones.mes = primerDiaMes(S.comisiones.mes + '-01', n).slice(0, 7); bus.repintar(); };

export const accionesComisiones = {
  'com-mes-prev': () => moverMesCom(-1),
  'com-mes-next': () => moverMesCom(1),
  'com-declarado': t => guardarOverride(t.dataset.bono, { declarado: t.checked }),
  'com-pago': t => guardarOverride(t.dataset.bono, { pago_entrenador: t.dataset.v }),
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
  'com-man-pago': t => cambiarManual(t.dataset.man, { pago_entrenador: t.dataset.v }),
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
