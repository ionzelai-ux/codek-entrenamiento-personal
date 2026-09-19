// Clientes: lista con filtros + ficha (datos, bonos, días fijos, créditos y sesiones).
import { S, bus, esAdmin, entrenadorDe, nombreCompleto, clienteDe, entrenadorFiltroId } from './store.js';
import { esc, dialogo, toast, fmtEUR, fmtFecha, fmtFechaDia, textoDias } from './util.js';
import { hoyISO, creditos, estadoEfectivo, estadoPago, edad } from './logica.js';
import { modalCliente, modalConvertir, modalBono, modalGenerar, modalSesion, cambiarEstadoSesion } from './modales.js';

const ETIQUETA = { reservada: 'RESERV.', hecha: 'HECHA', no_vino: 'NO VINO', auto: 'AUTO' };

function filtrados() {
  const f = entrenadorFiltroId();
  const t = S.cli.texto.trim().toLowerCase();
  return S.clientes
    .filter(c => (S.cli.archivados || c.activo)
      && (!f || c.entrenador_id === f)
      && (S.cli.estado === 'todos' || c.estado === S.cli.estado)
      && (S.cli.origen === 'todos' || c.origen === S.cli.origen)
      && (!t || `${nombreCompleto(c)} ${c.telefono || ''} ${c.email || ''}`.toLowerCase().includes(t)))
    .sort((a, b) => nombreCompleto(a).localeCompare(nombreCompleto(b), 'es'));
}

const chipsTipo = c => `
  <span class="chip ${c.estado === 'efectivo' ? 'verde' : 'amarillo'}">${c.estado === 'efectivo' ? 'CLIENTE' : 'POTENCIAL'}</span>
  <span class="chip ${c.origen === 'codek' ? 'granate' : 'gris'}">${c.origen === 'codek' ? 'CODEK' : 'EXTERNO'}</span>`;

function itemHTML(c) {
  let extra;
  if (c.estado === 'efectivo') {
    const cr = creditos(c);
    if (!cr.total) extra = '<div class="credit-text">Sin bono</div>';
    else {
      const pct = (cr.restantes / cr.total) * 100;
      const color = cr.restantes === 0 ? 'var(--red)' : pct <= 25 ? 'var(--yellow)' : 'var(--green-light)';
      extra = `<div class="credit-row"><div class="credit-bar"><div class="credit-fill" style="width:${pct}%;background:${color}"></div></div>
        <span class="credit-text">quedan ${cr.restantes}${cr.reservadas ? ` · ${cr.reservadas}🟡` : ''}</span></div>`;
    }
  } else {
    extra = `<div class="credit-text">${c.pot_precio ? '≈ ' + fmtEUR(c.pot_precio) : 'Sin estimación'}${c.pot_sesiones_bono ? ` · ${c.pot_sesiones_bono} ses/mes` : ''}</div>`;
  }
  return `<div class="client-item ${S.cliSel === c.id ? 'active' : ''} ${c.activo ? '' : 'archivado'}" data-acc="cli-sel" data-id="${c.id}">
    <div class="client-name">${esc(nombreCompleto(c))}</div>
    <div class="chips">${chipsTipo(c)}${esAdmin() && !entrenadorFiltroId() ? `<span class="chip" style="border-color:${entrenadorDe(c.entrenador_id)?.color};color:${entrenadorDe(c.entrenador_id)?.color}">${esc(entrenadorDe(c.entrenador_id)?.nombre || '')}</span>` : ''}${c.activo ? '' : '<span class="chip gris">ARCHIVADO</span>'}</div>
    ${extra}</div>`;
}
function listaHTML() {
  const l = filtrados();
  return l.length ? l.map(itemHTML).join('') : '<div class="vacio">Sin resultados</div>';
}

function seg(k, opciones) {
  return `<div class="seg seg-sm">${opciones.map(([v, l]) =>
    `<button class="${S.cli[k] === v ? 'on' : ''}" data-acc="filtro" data-k="${k}" data-v="${v}">${l}</button>`).join('')}</div>`;
}

function fichaHTML(c) {
  const efe = c.estado === 'efectivo';
  const cr = creditos(c);
  const hoy = hoyISO();
  const pagado = (c.bonos || []).reduce((t, b) => t + (Number(b.precio) || 0), 0);
  const ed = edad(c.fecha_nacimiento);

  let alertas = '';
  if (!c.activo) alertas += '<div class="alert alert-warn">ARCHIVADO — no aparece en las listas normales.</div>';
  if (efe) {
    if (!cr.total) alertas += '<div class="alert alert-warn">Sin bono: añade uno para poder registrar sesiones.</div>';
    else if (cr.restantes === 0) alertas += '<div class="alert alert-danger">⚠ BONO AGOTADO — el cliente necesita renovar.</div>';
    else if (cr.restantes <= 2) alertas += `<div class="alert alert-warn">⚡ Solo quedan ${cr.restantes} sesión${cr.restantes === 1 ? '' : 'es'} — avisa al cliente.</div>`;
    if (cr.libres < 0) alertas += `<div class="alert alert-warn">Hay ${-cr.libres} sesión${cr.libres === -1 ? '' : 'es'} reservada${cr.libres === -1 ? '' : 's'} de más para los créditos que quedan.</div>`;
    for (const b of c.bonos || []) if (estadoPago(b, hoy) === 'programado') {
      alertas += `<div class="alert alert-info">💶 Pago programado el ${fmtFecha(b.fecha_pago)} (${fmtEUR(b.precio)}).</div>`;
    }
  }

  const botones = `
    <button class="btn btn-secondary btn-sm btn-w" data-acc="cli-editar" data-id="${c.id}">✎ Editar ficha</button>
    ${efe ? `<button class="btn btn-primary btn-sm btn-w" data-acc="cli-sesion" data-id="${c.id}">+ Sesión</button>
      <button class="recharge-btn" data-acc="cli-bono" data-id="${c.id}">+ Nuevo bono</button>
      <button class="btn btn-secondary btn-sm btn-w" data-acc="cli-generar" data-id="${c.id}">⚙ Generar sesiones</button>`
      : `<button class="btn btn-primary btn-sm btn-w" data-acc="cli-convertir" data-id="${c.id}">✔ Convertir en cliente</button>`}
    <button class="btn btn-secondary btn-sm btn-w" data-acc="cli-archivar" data-id="${c.id}">${c.activo ? '🗄 Archivar' : '↩ Reactivar'}</button>
    ${esAdmin() ? `<button class="btn btn-danger btn-sm btn-w" data-acc="cli-borrar" data-id="${c.id}">✕ Eliminar</button>` : ''}`;

  let cuerpo = '';
  if (efe) {
    const pct = cr.total > 0 ? Math.min(100, (cr.hechas / cr.total) * 100) : 0;
    const barColor = cr.restantes === 0 ? 'var(--red)' : cr.restantes <= 2 ? 'var(--yellow)' : 'var(--green-light)';
    const bonos = [...(c.bonos || [])].sort((a, b) => b.fecha_pago.localeCompare(a.fecha_pago)).map(b => `
      <div class="bono-row">
        <span>${fmtFecha(b.fecha_pago)} · <b>${b.sesiones}</b> sesiones · ${fmtEUR(b.precio / b.sesiones)}/ses
          <span class="chip ${estadoPago(b, hoy) === 'cobrado' ? 'verde' : 'amarillo'}">${estadoPago(b, hoy) === 'cobrado' ? 'COBRADO' : 'PAGO PROGRAMADO'}</span></span>
        <span><span style="color:var(--green-light)">${fmtEUR(b.precio)}</span>
          <button class="sess-del" data-acc="bono-borrar" data-id="${b.id}" title="Eliminar bono">✕</button></span>
      </div>`).join('') || '<span style="opacity:.4">Sin bonos</span>';

    const cron = [...(c.sesiones || [])].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
    const numero = new Map();
    let k = 0;
    for (const s of cron) { const e = estadoEfectivo(s); if (e === 'hecha' || e === 'auto') numero.set(s.id, ++k); }
    const filas = [...cron].reverse().map(s => {
      const e = estadoEfectivo(s);
      return `<div class="sess-entry">
        <span class="sess-num">${numero.has(s.id) ? '#' + numero.get(s.id) : '—'}</span>
        <span class="sess-date">${fmtFechaDia(s.fecha)}</span><span class="sess-time">${s.hora}</span>
        <span class="sess-status ${e}">${ETIQUETA[e]}</span>
        <div class="sess-actions">
          <button class="s-btn b" data-acc="ses-estado" data-id="${s.id}" data-v="reservada" title="Reservada">R</button>
          <button class="s-btn d" data-acc="ses-estado" data-id="${s.id}" data-v="hecha" title="Hecha">✓</button>
          <button class="s-btn m" data-acc="ses-estado" data-id="${s.id}" data-v="no_vino" title="No vino">✗</button>
        </div>
        <span class="sess-note">${esc(s.nota || '')}</span>
        <button class="sess-del" data-acc="ses-editar" data-id="${s.id}" title="Editar / eliminar">✎</button>
      </div>`;
    }).join('') || '<div class="vacio">Sin sesiones registradas</div>';

    cuerpo = `
      <div class="credit-widget">
        <div class="cw-row">
          <div class="cw-stat"><div class="cw-num" style="color:var(--green-light)">${cr.restantes}</div><div class="cw-label">Quedan</div></div>
          <div class="cw-stat"><div class="cw-num" style="color:var(--yellow)">${cr.reservadas}</div><div class="cw-label">Reservadas</div></div>
          <div class="cw-stat"><div class="cw-num" style="color:var(--red-light)">${cr.hechas}</div><div class="cw-label">Realizadas</div></div>
          <div class="cw-stat"><div class="cw-num" style="color:#666">${cr.noVino}</div><div class="cw-label">No vino</div></div>
        </div>
        <div class="big-bar"><div class="big-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
      </div>
      <div class="section-title">Días fijos</div>
      <div class="dias-txt">${(c.dias_fijos || []).length ? esc(textoDias(c.dias_fijos)) : '<span style="opacity:.4">Sin días fijos</span>'}</div>
      <div class="section-title" style="margin-top:20px">Bonos</div>
      <div class="bono-history">${bonos}</div>
      <div class="section-title" style="margin-top:20px">Historial de sesiones</div>
      <div class="sess-list">${filas}</div>`;
  } else {
    cuerpo = `
      <div class="section-title">Lo que le interesa</div>
      <div class="chips">
        <span class="chip">${c.pot_sesiones_bono ? c.pot_sesiones_bono + ' sesiones/mes' : 'Bono sin definir'}</span>
        <span class="chip">${c.pot_veces_semana ? c.pot_veces_semana + ' veces/semana' : 'Frecuencia sin definir'}</span>
        <span class="chip verde">${c.pot_precio ? 'Pagaría ' + fmtEUR(c.pot_precio) : 'Sin precio estimado'}</span>
      </div>
      <p class="hint" style="margin-top:14px">Cuando cierre el acuerdo, pulsa «Convertir en cliente» para registrar el bono, el pago y los días fijos.</p>`;
  }

  return `
    <button class="btn btn-secondary btn-sm volver" data-acc="cli-volver">← Clientes</button>
    ${alertas}
    <div class="client-header">
      <div>
        <div class="client-title">${esc(nombreCompleto(c))}</div>
        <div class="chips" style="margin-top:8px">${chipsTipo(c)}
          <span class="chip">🏋 ${esc(entrenadorDe(c.entrenador_id)?.nombre || '—')}</span>
          ${efe ? `<span class="chip verde">${fmtEUR(pagado)} en bonos</span>` : ''}</div>
        <div class="client-meta">
          ${c.telefono ? `<a class="meta-chip" href="tel:${esc(c.telefono)}">📞 ${esc(c.telefono)}</a>` : ''}
          ${c.email ? `<a class="meta-chip" href="mailto:${esc(c.email)}">✉ ${esc(c.email)}</a>` : ''}
          ${c.fecha_nacimiento ? `<span class="meta-chip">🎂 ${fmtFecha(c.fecha_nacimiento)}${ed != null ? ` (${ed} años)` : ''}</span>` : ''}
          ${c.notas ? `<span class="meta-chip">${esc(c.notas)}</span>` : ''}
        </div>
      </div>
      <div class="client-actions">${botones}</div>
    </div>
    ${cuerpo}`;
}

export function renderClientes(el) {
  const c = S.cliSel ? clienteDe(S.cliSel) : null;
  if (S.cliSel && !c) S.cliSel = null;
  const texto = el.querySelector('[data-filtro-texto]')?.value ?? S.cli.texto;
  el.innerHTML = `
    <div class="split ${c ? 'con-ficha' : ''}">
      <aside class="lista">
        <button class="btn btn-primary btn-w" data-acc="cli-nuevo">+ Nueva ficha</button>
        <input class="form-input" data-filtro-texto placeholder="Buscar nombre, teléfono, email…" value="${esc(texto)}">
        ${seg('estado', [['todos', 'Todos'], ['potencial', 'Potenciales'], ['efectivo', 'Clientes']])}
        ${seg('origen', [['todos', 'Todos'], ['codek', 'Codek'], ['externo', 'Externos']])}
        <label class="check check-sm"><input type="checkbox" data-acc="cli-archivados" ${S.cli.archivados ? 'checked' : ''}> Ver archivados</label>
        <div class="lista-items">${listaHTML()}</div>
      </aside>
      <section class="ficha">${c ? fichaHTML(c) : '<div class="empty-state"><div class="ico">🏋️</div><p>Selecciona una ficha</p><p style="font-size:9px;opacity:.4">o crea una nueva</p></div>'}</section>
    </div>`;
}

// Al escribir en el buscador solo se redibuja la lista (así no se pierde el foco).
export function alBuscar(valor) {
  S.cli.texto = valor;
  const cont = document.querySelector('.lista-items');
  if (cont) cont.innerHTML = listaHTML();
}

export const accionesClientes = {
  'cli-sel': t => { S.cliSel = t.dataset.id; bus.repintar(); },
  'cli-volver': () => { S.cliSel = null; bus.repintar(); },
  'filtro': t => { S.cli[t.dataset.k] = t.dataset.v; bus.repintar(); },
  'cli-archivados': t => { S.cli.archivados = t.checked; bus.repintar(); },
  'cli-nuevo': () => modalCliente(),
  'cli-editar': t => modalCliente(clienteDe(t.dataset.id)),
  'cli-convertir': t => modalConvertir(clienteDe(t.dataset.id)),
  'cli-bono': t => modalBono(clienteDe(t.dataset.id)),
  'cli-generar': t => modalGenerar(clienteDe(t.dataset.id)),
  'cli-sesion': t => modalSesion({ clienteId: t.dataset.id, fecha: hoyISO() }),
  'cli-archivar': async t => {
    const c = clienteDe(t.dataset.id);
    const ok = await dialogo({
      titulo: c.activo ? 'Archivar ficha' : 'Reactivar ficha',
      mensaje: `<p>${c.activo ? `¿Archivar a <b>${esc(nombreCompleto(c))}</b>? Dejará de aparecer en las listas, pero no se pierde nada.` : `¿Reactivar a <b>${esc(nombreCompleto(c))}</b>?`}</p>`,
      ok: c.activo ? 'Archivar' : 'Reactivar',
    });
    if (!ok) return;
    await S.api.guardarCliente({ id: c.id, activo: !c.activo });
    await bus.recargar();
    toast(c.activo ? 'Ficha archivada' : 'Ficha reactivada');
  },
  'cli-borrar': async t => {
    const c = clienteDe(t.dataset.id);
    const ok = await dialogo({
      titulo: 'Eliminar ficha',
      mensaje: `<p>¿Eliminar a <b>${esc(nombreCompleto(c))}</b> con todos sus bonos y sesiones? <b>No se puede deshacer.</b> Si solo quieres ocultarlo, archívalo.</p>`,
      ok: 'Eliminar definitivamente', peligro: true,
    });
    if (!ok) return;
    await S.api.eliminarCliente(c.id);
    S.cliSel = null;
    await bus.recargar();
    toast('Ficha eliminada');
  },
  'bono-borrar': async t => {
    const ok = await dialogo({ titulo: 'Eliminar bono', mensaje: '<p>¿Eliminar este bono? Se descontarán sus sesiones del total del cliente.</p>', ok: 'Eliminar', peligro: true });
    if (!ok) return;
    await S.api.eliminarBono(t.dataset.id);
    await bus.recargar();
    toast('Bono eliminado');
  },
  'ses-estado': t => {
    const s = clienteDe(S.cliSel)?.sesiones.find(x => x.id === t.dataset.id);
    if (s) return cambiarEstadoSesion(s, t.dataset.v);
  },
  'ses-editar': t => {
    const s = clienteDe(S.cliSel)?.sesiones.find(x => x.id === t.dataset.id);
    if (s) modalSesion({ sesion: s });
  },
};
