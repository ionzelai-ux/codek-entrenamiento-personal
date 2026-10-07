// Clientes: lista con filtros + ficha (datos, bonos, días fijos, créditos y sesiones).
import { S, bus, esAdmin, entrenadorDe, nombreCompleto, clienteDe, entrenadorFiltroId } from './store.js';
import { esc, abrirModal, dialogo, toast, fmtEUR, fmtFecha, fmtFechaDia, textoDias, etiquetaMetodo, filtroEntrenadorHTML } from './util.js';
import {
  hoyISO, creditos, consumoPorBono, estadoEfectivo, estadoPago, estadoCobro, edad, camposPendientes, tieneLesionActiva,
  incidenciasCliente, revisionDatos, esDiferido, deudaDiferida, modoDiferido,
} from './logica.js';
import {
  modalCliente, modalConvertir, modalBono, modalEditarBono, modalGenerar, modalCambiarHorario, modalSesion, cambiarEstadoSesion,
  modalTarifaDiferido, modalCobrarSesiones, modalPagoRecibido, modalModoDiferido,
} from './modales.js';

const ETIQUETA = { reservada: 'RESERV.', hecha: 'HECHA', no_vino: 'NO VINO', auto: 'AUTO' };

// Clientes que pasan todos los filtros salvo el de pago (sirve también para el contador de cobros).
function base() {
  const f = entrenadorFiltroId();
  const t = S.cli.texto.trim().toLowerCase();
  return S.clientes.filter(c => (S.cli.archivados || c.activo)
    && (!f || c.entrenador_id === f)
    && (S.cli.estado === 'todos' || c.estado === S.cli.estado)
    && (S.cli.origen === 'todos' || c.origen === S.cli.origen)
    && (!S.cli.pendientes || camposPendientes(c).length > 0)
    && (!t || `${nombreCompleto(c)} ${c.telefono || ''} ${c.email || ''}`.toLowerCase().includes(t)));
}
function filtrados() {
  const hoy = hoyISO();
  return base()
    .filter(c => {
      const f = S.cli.pago;
      if (f === 'todos') return true;
      if (f === 'solicitud') return c.pago_diferido === 'solicitado';                     // solicitudes de «paga después» por aprobar
      if (f === 'deuda') return !!deudaDiferida(c)?.debe;                                // aprobados con algo por cobrar
      return estadoCobro(c, hoy)?.clave === f;
    })
    .sort((a, b) => nombreCompleto(a).localeCompare(nombreCompleto(b), 'es'));
}

// «3 pendientes · 825 € por cobrar · 2 por renovar · 2 con sesiones por cobrar»: pulsando cada parte se filtra la lista.
function cobrosHTML() {
  const hoy = hoyISO();
  let pend = 0, importe = 0, renovar = 0, deuda = 0, deudaImporte = 0, sinTarifa = 0, solicitudes = 0;
  for (const c of base().filter(x => x.activo)) {
    const e = estadoCobro(c, hoy);
    if (e?.clave === 'pendiente') { pend++; importe += e.importe; } else if (e?.clave === 'renovar') renovar++;
    const d = deudaDiferida(c);
    if (d?.debe) { deuda++; if (d.importe === null) sinTarifa++; else deudaImporte += d.importe; }
    if (c.pago_diferido === 'solicitado') solicitudes++;
  }
  if (!pend && !renovar && !deuda && !(solicitudes && esAdmin())) return '';
  const boton = (v, txt) => `<button class="cobro-link" data-acc="filtro" data-k="pago" data-v="${v}">${txt}</button>`;
  return `<div class="cobro-strip">💶 ${[
    pend ? boton('pendiente', `<b>${pend}</b> pendiente${pend === 1 ? '' : 's'} · <b>${fmtEUR(importe)}</b> por cobrar`) : '',
    renovar ? boton('renovar', `<b>${renovar}</b> por renovar`) : '',
    deuda ? boton('deuda', `<b>${deuda}</b> con algo por cobrar${deudaImporte ? ` · <b>${fmtEUR(deudaImporte)}</b>` : ''}${sinTarifa ? ` (${sinTarifa} sin tarifa)` : ''}`) : '',
    solicitudes && esAdmin() ? boton('solicitud', `⏳ <b>${solicitudes}</b> solicitud${solicitudes === 1 ? '' : 'es'} de «paga después»`) : '',
  ].filter(Boolean).join(' · ')}</div>`;
}

// Fila de pago de la lista: estado + fecha/importe (+ botón para marcar pagado, solo el administrador).
const CHIP_COBRO = {
  pendiente: ['pendiente', 'PENDIENTE DE PAGO'], programado: ['amarillo', 'PAGO PROGRAMADO'],
  renovar: ['rojo', 'RENOVAR'], pagado: ['verde', 'PAGADO'],
};
function pagoHTML(c) {
  const e = estadoCobro(c, hoyISO());
  if (!e || e.clave === 'sin_bono') return '';
  if (esDiferido(c) && e.clave !== 'pendiente' && e.clave !== 'programado') return '';   // sus cobros ya pagados no hace falta repetirlos
  const [clase, texto] = CHIP_COBRO[e.clave];
  const detalle = e.clave === 'renovar' ? `último bono ${fmtEUR(e.importe)}`
    : `${e.clave === 'pendiente' ? 'vence' : 'pago'} ${fmtFecha(e.fecha)} · <b>${fmtEUR(e.importe)}</b>${e.n > 1 ? ` (${e.n} bonos)` : ''}`;
  const boton = e.clave === 'pendiente' && esAdmin()
    ? `<button class="btn btn-sm btn-cobrar" data-acc="cli-cobrar" data-id="${c.id}" title="Confirmar que se ha cobrado">✓ Marcar pagado</button>` : '';
  return `<div class="pago-row"><span class="chip ${clase}">${texto}</span><span class="pago-txt">${detalle}</span>${boton}</div>`;
}

// «Entrena y paga después»: aprobado por el administrador, o solicitado y pendiente de aprobar.
const chipDiferido = c => (c.pago_diferido === 'aprobado' ? '<span class="chip diferido" title="Entrena y paga después (autorizado por el administrador)">PAGA DESPUÉS</span>'
  : c.pago_diferido === 'solicitado' ? '<span class="chip pendiente" title="Pendiente de que el administrador lo apruebe">⏳ PAGA DESPUÉS · SIN APROBAR</span>' : '');

const chipsTipo = c => `
  <span class="chip ${c.estado === 'efectivo' ? 'verde' : 'amarillo'}">${c.estado === 'efectivo' ? 'CLIENTE' : 'POTENCIAL'}</span>
  <span class="chip ${c.origen === 'codek' ? 'granate' : 'gris'}">${c.origen === 'codek' ? 'CODEK' : 'EXTERNO'}</span>${c.estado === 'efectivo' ? chipDiferido(c) : ''}`;

function itemHTML(c) {
  let extra;
  const dif = c.estado === 'efectivo' ? deudaDiferida(c) : null;
  if (dif) {
    const texto = dif.modo === 'cuenta'
      ? (dif.debe ? `debe <b>${dif.importe === null ? 'sin tarifa' : fmtEUR(dif.importe)}</b> · ${dif.n} ${dif.n === 1 ? 'sesión' : 'sesiones'} · pagado ${fmtEUR(dif.pagado)}`
        : dif.aFavor > 0 ? `saldo a favor <b>${fmtEUR(dif.aFavor)}</b>` : 'al día ✓')
      : (dif.debe ? `debe <b>${dif.n}</b> ${dif.n === 1 ? 'sesión' : 'sesiones'}${dif.importe === null ? ' · sin tarifa' : ` · <b>${fmtEUR(dif.importe)}</b>`}` : 'al día ✓');
    extra = `<div class="pago-row"><span class="pago-txt">${texto}${dif.reservadas ? ` · ${dif.reservadas}🟡` : ''}</span></div>`;
  } else if (c.estado === 'efectivo') {
    const cr = creditos(c);
    if (!cr.total) extra = `<div class="credit-text">Sin bono${cr.hechas ? ` · ${cr.hechas} hechas` : ''}</div>`;
    else {
      const pct = (cr.restantes / cr.total) * 100;
      const color = cr.restantes === 0 ? 'var(--red)' : pct <= 25 ? 'var(--yellow)' : 'var(--green-light)';
      extra = `<div class="credit-row"><div class="credit-bar"><div class="credit-fill" style="width:${pct}%;background:${color}"></div></div>
        <span class="credit-text">${cr.sinBono ? `hechas ${cr.hechas} · bonos ${cr.total}` : `quedan ${cr.restantes}`}${cr.reservadas ? ` · ${cr.reservadas}🟡` : ''}</span></div>`;
    }
  } else {
    extra = `<div class="credit-text">${c.pot_precio ? '≈ ' + fmtEUR(c.pot_precio) : 'Sin estimación'}${c.pot_sesiones_bono ? ` · ${c.pot_sesiones_bono} ses/mes` : ''}</div>`;
  }
  return `<div class="client-item ${S.cliSel === c.id ? 'active' : ''} ${c.activo ? '' : 'archivado'}" data-acc="cli-sel" data-id="${c.id}">
    ${esAdmin() ? `<button class="item-borrar" data-acc="cli-borrar" data-id="${c.id}" title="Eliminar ficha" aria-label="Eliminar ficha">🗑</button>` : ''}
    <div class="client-name">${esc(nombreCompleto(c))}</div>
    <div class="chips">${chipsTipo(c)}${c.estado === 'efectivo' && c.activo && !dif && creditos(c).sinBono ? `<span class="chip rojo" title="Tiene sesiones hechas que ningún bono cubre">⚠ ${creditos(c).sinBono} SIN BONO</span>` : ''}${tieneLesionActiva(c.lesiones) ? '<span class="chip lesion" title="Tiene lesiones o limitaciones registradas">🩹 LESIÓN</span>' : ''}${esAdmin() && !entrenadorFiltroId() ? `<span class="chip" style="border-color:${entrenadorDe(c.entrenador_id)?.color};color:${entrenadorDe(c.entrenador_id)?.color}">${esc(entrenadorDe(c.entrenador_id)?.nombre || '')}</span>` : ''}${c.activo ? '' : '<span class="chip gris">ARCHIVADO</span>'}${c.activo && camposPendientes(c).length ? '<span class="chip pendiente" title="Faltan datos por completar">INFO PENDIENTE</span>' : ''}</div>
    ${pagoHTML(c)}
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

// Panel «Entrena y paga después» de la ficha (solo clientes). Es una excepción: el entrenador la solicita y la aprueba
// el administrador (la base de datos también lo impone). Estados: no → solicitado → aprobado.
function panelDiferidoHTML(c) {
  const admin = esAdmin(), t = c.tarifa_sesion != null && c.tarifa_sesion !== '' ? Number(c.tarifa_sesion) : null;
  const tarifa = t === null ? 'sin tarifa' : `${fmtEUR(t)}/sesión`;
  const quien = esc(entrenadorDe(c.entrenador_id)?.nombre || 'El entrenador');
  let cuerpo;
  if (c.pago_diferido === 'aprobado') {
    const modo = modoDiferido(c) === 'cuenta' ? 'a cuenta (pagos recibidos, sin cuadrar sesiones; su comisión se pone a mano)' : 'por sesión';
    cuerpo = `<span>✅ <b>Entrena y paga después</b> · autorizado por el administrador · ${esc(tarifa)} · <b>${modo}</b></span>
      ${admin ? `<span class="dif-acciones"><button class="btn btn-sm btn-secondary" data-acc="dif-modo" data-id="${c.id}">Cambiar modalidad</button>
        <button class="btn btn-sm btn-secondary" data-acc="dif-tarifa" data-id="${c.id}">Cambiar tarifa</button>
        <button class="btn btn-sm btn-secondary" data-acc="dif-retirar" data-id="${c.id}">Retirar autorización</button></span>` : ''}`;
  } else if (c.pago_diferido === 'solicitado') {
    cuerpo = admin
      ? `<span>⏳ <b>${quien} solicita</b> que este cliente entrene y pague después · ${esc(tarifa)}</span>
         <span class="dif-acciones"><button class="btn btn-sm btn-cobrar" data-acc="dif-aprobar" data-id="${c.id}">✓ Aprobar</button>
         <button class="btn btn-sm btn-secondary" data-acc="dif-rechazar" data-id="${c.id}">Rechazar</button></span>`
      : `<span>⏳ <b>Solicitud enviada</b> · pendiente de que el administrador la apruebe. Mientras tanto se trata como un cliente normal.</span>
         <span class="dif-acciones"><button class="btn btn-sm btn-secondary" data-acc="dif-retirar" data-id="${c.id}">Retirar solicitud</button></span>`;
  } else {
    cuerpo = `<label class="check"><input type="checkbox" data-acc="dif-pedir" data-id="${c.id}">
      <span>Entrena y paga después <span class="hint">(excepcional: ${admin ? 'lo autorizas tú' : 'lo tiene que aprobar el administrador'})</span></span></label>`;
  }
  return `<div class="dif-panel">${cuerpo}</div>`;
}

function fichaHTML(c) {
  const efe = c.estado === 'efectivo';
  const dif = efe ? deudaDiferida(c) : null;
  const cr = creditos(c);
  const hoy = hoyISO();
  const pagado = (c.bonos || []).reduce((t, b) => t + (Number(b.precio) || 0), 0);
  const ed = edad(c.fecha_nacimiento);

  let alertas = '';
  const sinBono = efe ? incidenciasCliente(c).find(i => i.clave === 'sesiones_sin_bono') : null;
  if (sinBono) {
    alertas += `<div class="alert alert-danger alert-flex"><span>⚠ <b>SESIONES SIN BONO</b> — ${esc(sinBono.texto)}</span>
      <button class="btn btn-sm btn-secondary" data-acc="cli-bono" data-id="${c.id}">+ Nuevo bono</button></div>`;
  }
  if (String(c.lesiones || '').trim()) {
    alertas += `<div class="alert alert-lesion"><span>🩹 <b>LESIONES / LIMITACIONES</b> — ${esc(c.lesiones)}</span>
      <button class="btn btn-sm btn-secondary" data-acc="cli-editar" data-id="${c.id}">Editar</button></div>`;
  }
  const pendiente = camposPendientes(c);
  if (pendiente.length) {
    alertas += `<div class="alert alert-pendiente"><span>📝 <b>INFO PENDIENTE</b> — falta: ${esc(pendiente.join(', '))}.</span>
      <button class="btn btn-sm btn-secondary" data-acc="cli-editar" data-id="${c.id}">Completar</button></div>`;
  }
  if (!c.activo) alertas += '<div class="alert alert-warn">ARCHIVADO — no aparece en las listas normales.</div>';
  if (efe) {
    if (dif) {
      // Entrena y paga después: no se avisa de «sin bono»; se avisa de lo que debe.
      const cuenta = dif.modo === 'cuenta';
      const texto = cuenta
        ? (dif.valor === null ? `lleva ${dif.n} ${dif.n === 1 ? 'sesión hecha' : 'sesiones hechas'} y ha pagado ${fmtEUR(dif.pagado)} (falta indicar su tarifa por sesión)`
          : dif.debe ? `debe <b>${fmtEUR(dif.importe)}</b>: ${dif.n} ${dif.n === 1 ? 'sesión' : 'sesiones'} × ${fmtEUR(dif.tarifa)} = ${fmtEUR(dif.valor)} − ${fmtEUR(dif.pagado)} pagado`
          : dif.aFavor > 0 ? `tiene un saldo a favor de <b>${fmtEUR(dif.aFavor)}</b> (ha pagado más de lo que lleva hecho)` : 'está al día, no debe nada')
        : (dif.debe ? `debe <b>${dif.n}</b> ${dif.n === 1 ? 'sesión' : 'sesiones'}${dif.importe === null ? ' (falta indicar su tarifa por sesión)' : ` (${fmtEUR(dif.importe)} a ${fmtEUR(dif.tarifa)}/sesión)`}` : 'no debe nada ahora mismo');
      const boton = !esAdmin() ? ''
        : cuenta ? `<button class="btn btn-sm btn-cobrar" data-acc="cli-pago-recibido" data-id="${c.id}">💶 Pago recibido…</button>`
        : dif.n ? `<button class="btn btn-sm btn-cobrar" data-acc="cli-cobrar-sesiones" data-id="${c.id}">💶 Marcar como cobradas…</button>` : '';
      alertas += `<div class="alert alert-diferido alert-flex"><span>💶 <b>PAGA DESPUÉS${cuenta ? ' · A CUENTA' : ''}</b> — ${texto}.</span>${boton}</div>`;
    } else if (!cr.total) alertas += '<div class="alert alert-warn">Sin bono: añade uno para poder registrar sesiones.</div>';
    else if (cr.restantes === 0) alertas += '<div class="alert alert-danger">⚠ BONO AGOTADO — el cliente necesita renovar.</div>';
    else if (cr.restantes <= 2) alertas += `<div class="alert alert-warn">⚡ Solo quedan ${cr.restantes} sesión${cr.restantes === 1 ? '' : 'es'} — avisa al cliente.</div>`;
    if (!dif && cr.libres < 0) alertas += `<div class="alert alert-warn">Hay ${-cr.libres} sesión${cr.libres === -1 ? '' : 'es'} reservada${cr.libres === -1 ? '' : 's'} de más para los créditos que quedan.</div>`;
    const cobro = estadoCobro(c, hoy);
    if (cobro?.clave === 'pendiente') {
      alertas += `<div class="alert alert-warn alert-flex"><span>💶 <b>PENDIENTE DE PAGO</b> — ${fmtEUR(cobro.importe)}${cobro.n > 1 ? ` (${cobro.n} bonos)` : ''}, con fecha de pago ${fmtFecha(cobro.fecha)}.</span>
        ${esAdmin() ? `<button class="btn btn-sm btn-cobrar" data-acc="cli-cobrar" data-id="${c.id}">✓ Marcar pagado</button>` : ''}</div>`;
    }
    for (const b of c.bonos || []) if (estadoPago(b, hoy) === 'programado') {
      alertas += `<div class="alert alert-info">💶 Pago programado el ${fmtFecha(b.fecha_pago)} (${fmtEUR(b.precio)}).</div>`;
    }
  }

  const botones = `
    <button class="btn btn-secondary btn-sm btn-w" data-acc="cli-editar" data-id="${c.id}">✎ Editar ficha</button>
    ${efe ? `<button class="btn btn-primary btn-sm btn-w" data-acc="cli-sesion" data-id="${c.id}">+ Sesión</button>
      <button class="recharge-btn" data-acc="cli-bono" data-id="${c.id}">+ Nuevo bono</button>
      <button class="btn btn-secondary btn-sm btn-w" data-acc="cli-generar" data-id="${c.id}">⚙ Generar sesiones</button>
      <button class="btn btn-secondary btn-sm btn-w" data-acc="cli-horario" data-id="${c.id}">🕘 Cambiar horario en bloque</button>`
      : `<button class="btn btn-primary btn-sm btn-w" data-acc="cli-convertir" data-id="${c.id}">✔ Convertir en cliente</button>`}
    <button class="btn btn-secondary btn-sm btn-w" data-acc="cli-archivar" data-id="${c.id}">${c.activo ? '🗄 Archivar' : '↩ Reactivar'}</button>
    ${esAdmin() ? `<button class="btn btn-danger btn-sm btn-w" data-acc="cli-borrar" data-id="${c.id}">🗑 Eliminar ficha</button>` : ''}`;

  let cuerpo = '';
  if (efe) {
    const pct = cr.total > 0 ? Math.min(100, (cr.hechas / cr.total) * 100) : 0;
    const barColor = cr.restantes === 0 ? 'var(--red)' : cr.restantes <= 2 ? 'var(--yellow)' : 'var(--green-light)';
    const CHIP_BONO = { pagado: ['verde', 'PAGADO'], pendiente: ['pendiente', 'PENDIENTE DE PAGO'], programado: ['amarillo', 'PAGO PROGRAMADO'] };
    const consumo = consumoPorBono(c);
    const bonos = [...(c.bonos || [])].sort((a, b) => b.fecha_pago.localeCompare(a.fecha_pago)).map(b => {
      const e = estadoPago(b, hoy), [clase, texto] = CHIP_BONO[e];
      const uso = consumo.porBono.get(b.id);
      const esCobro = b.tipo === 'cobro';
      return `
      <div class="bono-row">
        <span>${fmtFecha(b.fecha_pago)} · ${b.sesiones > 0
          ? `${esCobro ? 'cobro de' : 'bono de'} <b>${b.sesiones}</b> ${b.sesiones === 1 ? 'sesión' : 'sesiones'} · ${fmtEUR(b.precio / b.sesiones)}/ses`
          : '<b>pago a cuenta</b>'}
          ${dif ? '' : `<span class="chip ${uso.usadas >= uso.total ? 'rojo' : 'gris'}" title="Sesiones hechas que se descuentan de este bono">usadas ${uso.usadas} de ${uso.total}</span>`}
          <span class="chip ${clase}">${texto}${e === 'pagado' ? ` ${fmtFecha(b.pagado_el).slice(0, 5)}` : ''}</span>
          ${b.metodo_pago ? `<span class="chip">${etiquetaMetodo(b.metodo_pago)}</span>` : ''}</span>
        ${esCobro ? `<span><span style="color:var(--green-light)">${fmtEUR(b.precio)}</span>
          ${esAdmin() ? `<button class="btn btn-sm btn-secondary" data-acc="cobro-deshacer" data-id="${b.id}" title="Las sesiones vuelven a quedar por cobrar">↩ Deshacer cobro</button>` : ''}</span>` : `
        <span><span style="color:var(--green-light)">${fmtEUR(b.precio)}</span>
          ${esAdmin() ? (e === 'pagado'
            ? `<button class="btn btn-sm btn-secondary" data-acc="bono-pagar" data-id="${b.id}" data-v="0" title="Volver a dejarlo sin confirmar">Deshacer pago</button>`
            : `<button class="btn btn-sm btn-cobrar" data-acc="bono-pagar" data-id="${b.id}" data-v="1" title="Confirmar que se ha cobrado">✓ Marcar pagado</button>`) : ''}
          <button class="btn btn-sm btn-secondary" data-acc="bono-editar" data-id="${b.id}" title="Cambiar sesiones, importe, fechas o método de pago">✎ Editar</button>
          <button class="sess-del" data-acc="bono-borrar" data-id="${b.id}" title="Eliminar bono">✕</button></span>`}
      </div>`;
    }).join('') || '<span style="opacity:.4">Sin bonos</span>';

    const cron = [...(c.sesiones || [])].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora));
    const numero = new Map();
    let k = 0;
    for (const s of cron) { const e = estadoEfectivo(s); if (e === 'hecha' || e === 'auto') numero.set(s.id, ++k); }
    const filas = [...cron].reverse().map(s => {
      const e = estadoEfectivo(s);
      return `<div class="sess-entry">
        <span class="sess-num">${numero.has(s.id) ? '#' + numero.get(s.id) : '—'}</span>
        <span class="sess-date">${fmtFechaDia(s.fecha)}</span><span class="sess-time">${s.hora}</span>
        <span class="sess-status ${e}">${ETIQUETA[e]}</span>${dif && s.cobro_bono_id ? '<span class="chip verde sess-cobrada" title="Sesión ya cobrada">COBRADA</span>' : ''}
        <div class="sess-actions">
          <button class="s-btn b" data-acc="ses-estado" data-id="${s.id}" data-v="reservada" title="Reservada">R</button>
          <button class="s-btn d" data-acc="ses-estado" data-id="${s.id}" data-v="hecha" title="Hecha">✓</button>
          <button class="s-btn m" data-acc="ses-estado" data-id="${s.id}" data-v="no_vino" title="No vino">✗</button>
        </div>
        <span class="sess-note">${esc(s.nota || '')}</span>
        <button class="sess-del" data-acc="ses-editar" data-id="${s.id}" title="Editar / eliminar">✎</button>
      </div>`;
    }).join('') || '<div class="vacio">Sin sesiones registradas</div>';

    // Quien paga después no tiene «créditos»: lo que importa es el balance de lo que debe y lo ya cobrado.
    const widget = dif && dif.modo === 'cuenta' ? `
      <div class="credit-widget balance">
        <div class="cw-row">
          <div class="cw-stat"><div class="cw-num" style="color:var(--red-light)">${dif.n}</div><div class="cw-label">Realizadas${dif.valor === null ? '' : ` · ${fmtEUR(dif.valor)}`}</div></div>
          <div class="cw-stat"><div class="cw-num" style="color:var(--green-light)">${fmtEUR(dif.pagado)}</div><div class="cw-label">Pagado</div></div>
          <div class="cw-stat"><div class="cw-num" style="color:${dif.debe ? '#ff6b6b' : 'var(--green-light)'}">${dif.importe === null ? '—' : fmtEUR(dif.importe)}</div><div class="cw-label">${dif.aFavor > 0 ? `Saldo a favor · ${fmtEUR(dif.aFavor)}` : 'Por cobrar'}</div></div>
          <div class="cw-stat"><div class="cw-num" style="color:var(--yellow)">${dif.reservadas}</div><div class="cw-label">Reservadas</div></div>
        </div>
        <div class="dif-pend">Balance en euros: <b>${dif.n} ${dif.n === 1 ? 'sesión' : 'sesiones'}${dif.tarifa === null ? '' : ` × ${fmtEUR(dif.tarifa)}`}</b> menos lo pagado. Los pagos se apuntan con «Pago recibido» y no hace falta que cuadren con sesiones concretas.</div>
      </div>` : dif ? `
      <div class="credit-widget balance">
        <div class="cw-row">
          <div class="cw-stat"><div class="cw-num" style="color:var(--red-light)">${cr.hechas}</div><div class="cw-label">Realizadas</div></div>
          <div class="cw-stat"><div class="cw-num" style="color:var(--green-light)">${dif.cobradas}</div><div class="cw-label">Cobradas · ${fmtEUR(dif.cobrado)}</div></div>
          <div class="cw-stat"><div class="cw-num" style="color:${dif.n ? '#ff6b6b' : 'var(--green-light)'}">${dif.n}</div><div class="cw-label">Por cobrar · ${dif.importe === null ? 'sin tarifa' : fmtEUR(dif.importe)}</div></div>
          <div class="cw-stat"><div class="cw-num" style="color:var(--yellow)">${dif.reservadas}</div><div class="cw-label">Reservadas</div></div>
        </div>
        ${dif.n ? `<div class="dif-pend"><b>Sesiones por cobrar:</b> ${dif.pendientes.map(s => fmtFechaDia(s.fecha)).join(' · ')}</div>` : ''}
      </div>` : `
      <div class="credit-widget">
        <div class="cw-row">
          <div class="cw-stat"><div class="cw-num" style="color:var(--green-light)">${cr.restantes}</div><div class="cw-label">Quedan</div></div>
          <div class="cw-stat"><div class="cw-num" style="color:var(--yellow)">${cr.reservadas}</div><div class="cw-label">Reservadas</div></div>
          <div class="cw-stat"><div class="cw-num" style="color:var(--red-light)">${cr.hechas}</div><div class="cw-label">Realizadas${cr.sinBono ? ` · <span class="cw-aviso">${cr.sinBono} sin bono</span>` : ''}</div></div>
          <div class="cw-stat"><div class="cw-num" style="color:#666">${cr.noVino}</div><div class="cw-label">No vino</div></div>
        </div>
        <div class="big-bar"><div class="big-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
      </div>`;
    cuerpo = `
      ${widget}
      <div class="section-title">Días fijos</div>
      <div class="dias-txt">${(c.dias_fijos || []).length ? esc(textoDias(c.dias_fijos)) : '<span style="opacity:.4">Sin días fijos</span>'}</div>
      <div class="section-title" style="margin-top:20px">Bonos</div>
      <div class="bono-history">${bonos}${!dif && consumo.sinBono ? `
        <div class="bono-row bono-sin"><span>⚠ <b>${consumo.sinBono}</b> ${consumo.sinBono === 1 ? 'sesión hecha' : 'sesiones hechas'} que ningún bono cubre</span>
          <button class="recharge-btn" data-acc="cli-bono" data-id="${c.id}">+ Nuevo bono</button></div>` : ''}</div>
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
    ${efe && c.activo ? panelDiferidoHTML(c) : ''}
    ${cuerpo}`;
}

// ── Revisión de datos ─────────────────────────────────────────────────────
// Clientes que se revisan: los activos que se están viendo (respeta el filtro de entrenador).
const clientesARevisar = () => { const f = entrenadorFiltroId(); return S.clientes.filter(c => c.activo && (!f || c.entrenador_id === f)); };
const cuentaNivel = (rev, nivel) => rev.reduce((t, r) => t + r.incidencias.filter(i => i.nivel === nivel).length, 0);

function revisarBotonHTML() {
  const rev = revisionDatos(clientesARevisar());
  const graves = rev.filter(r => r.incidencias.some(i => i.nivel === 'alta')).length;
  const aRevisar = rev.filter(r => r.incidencias.some(i => i.nivel === 'media')).length;
  const resumen = graves ? `<span class="rev-n rev-alta">${graves} grave${graves === 1 ? '' : 's'}</span>`
    : aRevisar ? `<span class="rev-n rev-media">${aRevisar} a revisar</span>` : '<span class="rev-n rev-ok">todo en orden ✓</span>';
  return `<button class="btn btn-secondary btn-sm btn-w" data-acc="cli-revisar">🔍 Revisar datos · ${resumen}</button>`;
}

const ICONO_NIVEL = { alta: '🔴', media: '🟡', info: 'ℹ️' };
function modalRevision() {
  const rev = revisionDatos(clientesARevisar());
  const graves = cuentaNivel(rev, 'alta'), medias = cuentaNivel(rev, 'media'), infos = cuentaNivel(rev, 'info');
  const cuerpo = rev.length ? rev.map(r => `
    <div class="rev-cli">
      <button type="button" class="rev-nombre" data-abrir="${r.cliente.id}">${esc(nombreCompleto(r.cliente))}
        ${esAdmin() ? `<span class="prev-entr" style="color:${entrenadorDe(r.cliente.entrenador_id)?.color || '#888'}">${esc(entrenadorDe(r.cliente.entrenador_id)?.nombre || '')}</span>` : ''}</button>
      <ul class="rev-inc">${r.incidencias.map(i => `<li class="rev-${i.nivel}">${ICONO_NIVEL[i.nivel]} ${esc(i.texto)}</li>`).join('')}</ul>
    </div>`).join('')
    : '<div class="alert alert-ok">✔ No se ha encontrado ninguna incoherencia en los clientes que estás viendo.</div>';
  const m = abrirModal(`
    <div class="modal-title">Revisión de datos</div>
    <p class="sub">${rev.length ? `${graves} grave${graves === 1 ? '' : 's'} · ${medias} a revisar · ${infos} aviso${infos === 1 ? '' : 's'} · en ${rev.length} cliente${rev.length === 1 ? '' : 's'}` : 'Todo cuadra'}</p>
    <div class="rev-lista">${cuerpo}</div>
    <p class="hint" style="margin-top:10px">Se comprueba: sesiones hechas sin bono que las cubra, reservas sin crédito, reservas pasadas sin confirmar (cuentan como hechas),
      sesiones repetidas, solapes del mismo entrenador y datos aproximados. Pulsa un nombre para abrir su ficha.</p>
    <div class="modal-actions"><button type="button" class="btn btn-secondary" data-cerrar>Cerrar</button></div>`, 'modal-lg');
  m.el.querySelector('[data-cerrar]').addEventListener('click', m.cerrar);
  m.el.addEventListener('click', e => {
    const b = e.target.closest('[data-abrir]');
    if (!b) return;
    S.cliSel = b.dataset.abrir;
    m.cerrar();
    bus.repintar();
  });
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
        ${esAdmin() ? filtroEntrenadorHTML(S.entrenadores, S.filtroEntr) : ''}
        ${seg('estado', [['todos', 'Todos'], ['potencial', 'Potenciales'], ['efectivo', 'Clientes']])}
        ${seg('origen', [['todos', 'Todos'], ['codek', 'Codek'], ['externo', 'Externos']])}
        ${seg('pago', [['todos', 'Pago: todos'], ['pendiente', 'Pendiente'], ['programado', 'Programado'], ['pagado', 'Pagado'], ['renovar', 'Renovar'],
          ...(S.cli.pago === 'deuda' ? [['deuda', 'Por cobrar']] : []), ...(S.cli.pago === 'solicitud' ? [['solicitud', 'Solicitudes']] : [])])}
        <label class="check check-sm"><input type="checkbox" data-acc="cli-pendientes" ${S.cli.pendientes ? 'checked' : ''}> Solo con info pendiente</label>
        <label class="check check-sm"><input type="checkbox" data-acc="cli-archivados" ${S.cli.archivados ? 'checked' : ''}> Ver archivados</label>
        ${revisarBotonHTML()}
        <div data-cobros>${cobrosHTML()}</div>
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
  const cobros = document.querySelector('[data-cobros]');
  if (cobros) cobros.innerHTML = cobrosHTML();
}

// Vuelve un cliente a «pago normal» tras confirmar (rechazar una solicitud, retirarla o retirar una autorización).
async function cambiarPagoDiferido(c, titulo, ok, aviso, mensaje) {
  const si = await dialogo({ titulo, mensaje: `<p>${mensaje(esc(nombreCompleto(c)))}</p>`, ok });
  if (!si) return;
  await S.api.guardarCliente({ id: c.id, pago_diferido: 'no' });
  await bus.recargar();
  toast(aviso);
}

// Confirma el cobro (solo el administrador; la base de datos también lo impide a los demás).
async function marcarPagados(bonos, mensaje) {
  const ok = await dialogo({ titulo: 'Marcar como pagado', mensaje, ok: 'Sí, está pagado' });
  if (!ok) return;
  const hoy = hoyISO();
  for (const b of bonos) await S.api.actualizarBono(b.id, { pagado_el: hoy });
  await bus.recargar();
  toast('Pago confirmado');
}

export const accionesClientes = {
  'cli-sel': t => { S.cliSel = t.dataset.id; bus.repintar(); },
  'cli-volver': () => { S.cliSel = null; bus.repintar(); },
  'cli-revisar': () => modalRevision(),
  // «Entrena y paga después»: el entrenador lo solicita, el administrador lo aprueba o lo rechaza.
  'dif-pedir': t => { t.checked = false; modalTarifaDiferido(clienteDe(t.dataset.id), 'pedir'); },
  'dif-aprobar': t => modalTarifaDiferido(clienteDe(t.dataset.id), 'aprobar'),
  'dif-tarifa': t => modalTarifaDiferido(clienteDe(t.dataset.id), 'tarifa'),
  'dif-rechazar': t => cambiarPagoDiferido(clienteDe(t.dataset.id), 'Rechazar solicitud', 'Rechazar', 'Solicitud rechazada', nombre => `¿Rechazar que <b>${nombre}</b> entrene y pague después? Seguirá como un cliente normal.`),
  'dif-retirar': t => {
    const c = clienteDe(t.dataset.id);
    return c.pago_diferido === 'aprobado'
      ? cambiarPagoDiferido(c, 'Retirar autorización', 'Retirar', 'Autorización retirada', nombre => `¿Retirar la autorización de <b>${nombre}</b>? Volverá a tratarse como un cliente normal (lo que deba aparecerá como «sesiones sin bono» hasta que se registre un bono).`)
      : cambiarPagoDiferido(c, 'Retirar solicitud', 'Retirar', 'Solicitud retirada', nombre => `¿Retirar la solicitud para <b>${nombre}</b>?`);
  },
  'cli-cobrar-sesiones': t => modalCobrarSesiones(clienteDe(t.dataset.id)),
  'cli-pago-recibido': t => modalPagoRecibido(clienteDe(t.dataset.id)),
  'dif-modo': t => modalModoDiferido(clienteDe(t.dataset.id)),
  'cobro-deshacer': async t => {
    const c = clienteDe(S.cliSel), b = c?.bonos.find(x => x.id === t.dataset.id);
    if (!esAdmin() || !b) return;
    const n = (c.sesiones || []).filter(s => s.cobro_bono_id === b.id).length;
    const ok = await dialogo({ titulo: 'Deshacer cobro', ok: 'Deshacer cobro', peligro: true,
      mensaje: n === 0 ? `<p>Se anulará el pago de <b>${fmtEUR(b.precio)}</b> y volverá a sumarse a lo que debe. ¿Seguro?</p>`
        : `<p>Se anulará el cobro de <b>${fmtEUR(b.precio)}</b> y ${n === 1 ? 'su sesión' : `sus ${n} sesiones`} ${n === 1 ? 'volverá' : 'volverán'} a quedar <b>por cobrar</b>. ¿Seguro?</p>` });
    if (!ok) return;
    await S.api.eliminarBono(b.id);
    await bus.recargar();
    toast('Cobro deshecho');
  },
  'filtro': t => { S.cli[t.dataset.k] = t.dataset.v; bus.repintar(); },
  'cli-archivados': t => { S.cli.archivados = t.checked; bus.repintar(); },
  'cli-pendientes': t => { S.cli.pendientes = t.checked; bus.repintar(); },
  'cli-cobrar': async t => {
    const c = clienteDe(t.dataset.id);
    const e = c && estadoCobro(c, hoyISO());
    if (!esAdmin() || e?.clave !== 'pendiente') return;
    await marcarPagados(e.bonos, `<p>¿Confirmas que <b>${esc(nombreCompleto(c))}</b> ha pagado <b>${fmtEUR(e.importe)}</b>${e.n > 1 ? ` (${e.n} bonos)` : ''}?</p>`);
  },
  'bono-pagar': async t => {
    const c = clienteDe(S.cliSel);
    const b = c?.bonos.find(x => x.id === t.dataset.id);
    if (!esAdmin() || !b) return;
    if (t.dataset.v === '1') return marcarPagados([b], `<p>¿Confirmas que <b>${esc(nombreCompleto(c))}</b> ha pagado el bono de <b>${fmtEUR(b.precio)}</b> (fecha de pago ${fmtFecha(b.fecha_pago)})?</p>`);
    const ok = await dialogo({ titulo: 'Deshacer pago', mensaje: `<p>El bono de <b>${fmtEUR(b.precio)}</b> volverá a quedar sin confirmar. ¿Seguro?</p>`, ok: 'Deshacer pago' });
    if (!ok) return;
    await S.api.actualizarBono(b.id, { pagado_el: null });
    await bus.recargar();
    toast('Pago deshecho');
  },
  'bono-editar': t => {
    const c = clienteDe(S.cliSel);
    const b = c?.bonos.find(x => x.id === t.dataset.id);
    if (b) modalEditarBono(b, c);
  },
  'cli-nuevo': () => modalCliente(),
  'cli-editar': t => modalCliente(clienteDe(t.dataset.id)),
  'cli-convertir': t => modalConvertir(clienteDe(t.dataset.id)),
  'cli-bono': t => modalBono(clienteDe(t.dataset.id)),
  'cli-generar': t => modalGenerar(clienteDe(t.dataset.id)),
  'cli-horario': t => modalCambiarHorario(clienteDe(t.dataset.id)),
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
    if (S.cliSel === c.id) S.cliSel = null;
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
