// Liquidación de comisiones de los entrenadores (solo administrador).
// Los porcentajes y el trato de cada bono (declarado / pago en nómina) se pueden tocar aquí mismo y
// todo se recalcula al momento, como una hoja de cálculo; se guarda en Supabase para la próxima vez.
import { S, bus, esAdmin, entrenadorDe, nombreCompleto, entrenadorFiltroId } from './store.js';
import { esc, fmtEUR, fmtFecha, nombreMes, etiquetaMetodo, toast } from './util.js';
import {
  hoyISO, primerDiaMes, liquidacionMes, totalesComisiones, agruparComisionesPorEntrenador, entrenadoresConComision,
  DEFAULT_CONFIG_COMISIONES,
} from './logica.js';

export async function cargarComisiones() {
  S.comisiones.cargando = true;
  bus.repintar();
  try {
    const [config, overrides] = await Promise.all([S.api.obtenerConfigComisiones(), S.api.listarOverridesComisiones()]);
    S.comisiones.config = config || { ...DEFAULT_CONFIG_COMISIONES };
    S.comisiones.overrides = new Map(overrides.map(o => [o.bono_id, o]));
  } catch (e) {
    toast(e.message, true);
    if (!S.comisiones.config) S.comisiones.config = { ...DEFAULT_CONFIG_COMISIONES };   // para poder seguir viendo la pantalla
  } finally {
    S.comisiones.cargando = false;
    S.comisiones.cargado = true;
    bus.repintar();
  }
}

function datos() {
  const config = S.comisiones.config || DEFAULT_CONFIG_COMISIONES;
  const filtro = entrenadorFiltroId();
  const idsConComision = new Set(entrenadoresConComision(S.entrenadores).map(e => e.id));
  const clientesVisibles = S.clientes.filter(c => idsConComision.has(c.entrenador_id) && (!filtro || c.entrenador_id === filtro));
  const overridesObj = Object.fromEntries(S.comisiones.overrides);
  return { config, filtro, filas: liquidacionMes(clientesVisibles, S.comisiones.mes, config, overridesObj) };
}

const CABECERA_TABLA = `<thead><tr>
  <th>Cliente</th><th class="num">Pagado el</th><th>Origen</th><th class="num">Importe</th>
  <th>Declarado (IVA)</th><th>Se le paga en</th><th class="num">Base</th><th class="num">Comisión</th>
</tr></thead>`;

function filaHTML(f) {
  const c = f.cliente, b = f.bono;
  return `<tr>
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
  ? `<div class="tabla-wrap"><table class="tabla tabla-com">${CABECERA_TABLA}<tbody>${filas.map(filaHTML).join('')}</tbody></table></div>`
  : '<div class="vacio">Sin bonos confirmados como pagados ese mes</div>';

const subtotalHTML = t => `<div class="com-subtotal">Facturado ${fmtEUR(t.importe)} · Comisión total <b>${fmtEUR(t.comision)}</b>
  (efectivo ${fmtEUR(t.efectivo)} · nómina ${fmtEUR(t.nomina)}) · ${t.n} bono${t.n === 1 ? '' : 's'}</div>`;

function grupoHTML(entrenadorId, filas) {
  const e = entrenadorDe(entrenadorId);
  const t = totalesComisiones(filas);
  return `<div class="com-grupo">
    <div class="com-grupo-title"><i class="tc" style="background:${e?.color || '#888'}"></i>${esc(e?.nombre || 'Sin entrenador')}
      <span class="com-grupo-total">${fmtEUR(t.comision)}</span></div>
    ${tablaFilasHTML(filas)}
    ${subtotalHTML(t)}
  </div>`;
}

function resultadoHTML() {
  const { filtro, filas } = datos();
  if (filtro && !entrenadoresConComision(S.entrenadores).some(e => e.id === filtro)) {
    return `<div class="vacio">${esc(entrenadorDe(filtro)?.nombre || 'Este entrenador')} no está, por ahora, en el sistema de comisiones.</div>`;
  }
  if (!filas.length) return `<div class="vacio">No hay bonos confirmados como pagados en ${nombreMes(S.comisiones.mes)}${filtro ? '' : ', para ningún entrenador'}.</div>`;
  if (filtro) return `${tablaFilasHTML(filas)}${subtotalHTML(totalesComisiones(filas))}`;
  const grupos = agruparComisionesPorEntrenador(filas);
  const orden = S.entrenadores.map(e => e.id).filter(id => grupos.has(id));
  for (const id of grupos.keys()) if (!orden.includes(id)) orden.push(id);   // por si acaso, aunque no debería faltar ninguno
  return `${orden.map(id => grupoHTML(id, grupos.get(id))).join('')}
    <div class="com-total-general">TOTAL A LIQUIDAR <span>${fmtEUR(totalesComisiones(filas).comision)}</span></div>`;
}

function refrescarTabla() {
  const cont = document.querySelector('[data-comisiones-tabla]');
  if (cont) cont.innerHTML = resultadoHTML();
}

function panelConfigHTML(config) {
  const campo = (key, label) => `<label class="cfg-campo"><span>${esc(label)}</span>
    <div class="cfg-input"><input class="form-input" type="number" step="0.1" min="0" max="100" data-cfg="${key}" value="${config[key]}"><span>%</span></div></label>`;
  return `
    <div class="section-title">Condiciones de la comisión</div>
    <div class="cfg-grid">
      ${campo('comision_codek', 'Comisión · cliente Codek')}
      ${campo('comision_externo', 'Comisión · cliente externo')}
      ${campo('iva_pct', 'IVA a extraer si está declarado')}
      ${campo('ss_pct', 'Seguridad Social si se paga en nómina')}
    </div>
    <div class="cfg-acciones">
      <button class="btn btn-secondary btn-sm" data-acc="com-guardar-config">💾 Guardar condiciones</button>
      <span class="hint">Se recalcula al momento; guarda para que se recuerde la próxima vez.</span>
    </div>
    <p class="hint" style="margin-top:6px">Fórmula: importe del bono → si está declarado, se divide entre 1&nbsp;+&nbsp;IVA/100 → si se paga en nómina, se
      divide (sobre lo anterior) entre 1&nbsp;+&nbsp;Seg. Social/100 → sobre esa base se aplica el % de comisión según el origen del cliente.</p>`;
}

export function renderComisiones(el) {
  if (!esAdmin()) { el.innerHTML = ''; return; }
  if (!S.comisiones.cargado) { el.innerHTML = '<div class="vacio">Cargando…</div>'; return; }
  el.innerHTML = `
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
  const actual = S.comisiones.overrides.get(bonoId) || { bono_id: bonoId, declarado: null, pago_entrenador: 'efectivo' };
  S.comisiones.overrides.set(bonoId, { ...actual, ...cambios });   // recalcula al momento
  refrescarTabla();
  try {
    S.comisiones.overrides.set(bonoId, await S.api.guardarOverrideComision(bonoId, cambios));
  } catch (e) {
    toast('No se pudo guardar: ' + e.message, true);
  }
}

const moverMesCom = n => { S.comisiones.mes = primerDiaMes(S.comisiones.mes + '-01', n).slice(0, 7); bus.repintar(); };

export const accionesComisiones = {
  'com-mes-prev': () => moverMesCom(-1),
  'com-mes-next': () => moverMesCom(1),
  'com-declarado': t => guardarOverride(t.dataset.bono, { declarado: t.checked }),
  'com-pago': t => guardarOverride(t.dataset.bono, { pago_entrenador: t.dataset.v }),
  'com-guardar-config': async () => {
    try {
      S.comisiones.config = await S.api.guardarConfigComisiones(S.comisiones.config || DEFAULT_CONFIG_COMISIONES);
      toast('Condiciones guardadas');
    } catch (e) { toast(e.message, true); }
  },
};
