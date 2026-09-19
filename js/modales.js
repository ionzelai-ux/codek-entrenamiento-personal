// Formularios en modal: sesión, ficha de cliente, convertir potencial, nuevo bono y
// generación de sesiones desde días fijos (con aviso de solapes).
import { S, bus, esAdmin, entrenadorDe, nombreCompleto, clienteDe, entrenadorFiltroId } from './store.js';
import { esc, abrirModal, dialogo, errorEnModal, toast, fmtFechaDia, fmtEUR, DIAS_SEM, textoDias, METODOS_PAGO } from './util.js';
import {
  hoyISO, precioBonoSugerido, precioHoraSugerido, buscarConflictos, generarFechas,
  creditos, estadoEfectivo, ocupaCredito,
} from './logica.js';
import { OPCIONES_BONO, DURACION_SESION_MIN } from './config.js';

// ── Piezas reutilizables ──────────────────────────────────────────────────
function segHTML(nombre, opciones, valor) {
  return `<div class="seg" data-seg="${nombre}">${opciones.map(([v, l]) =>
    `<button type="button" data-v="${v}" class="${v === valor ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function bindSeg(root, onChange) {
  root.querySelectorAll('.seg').forEach(seg => seg.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    onChange?.(seg.dataset.seg, b.dataset.v);
  }));
}
const segVal = (root, nombre) => root.querySelector(`.seg[data-seg="${nombre}"] button.on`)?.dataset.v || '';

function camposBono({ sesiones = '', precio = '', fechaPago = hoyISO(), fechaInicio = hoyISO() } = {}) {
  return `
    <div class="form-group">
      <label class="form-label">Sesiones del bono</label>
      <div class="bono-grid">${OPCIONES_BONO.map(n =>
        `<button type="button" class="bono-opt" data-n="${n}"><span class="bono-opt-num">${n}</span><span class="bono-opt-lbl">sesiones</span></button>`).join('')}</div>
      <input class="form-input" name="b_sesiones" type="number" min="1" step="1" value="${esc(sesiones)}" placeholder="Otro nº de sesiones">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Precio total del bono (€)</label>
        <input class="form-input" name="b_precio" type="number" min="0" step="0.01" value="${esc(precio)}">
        <div class="hint" data-hint-precio></div>
      </div>
      <div class="form-group">
        <label class="form-label">Fecha de pago</label>
        <input class="form-input" name="b_fecha_pago" type="date" value="${fechaPago}">
        <div class="hint">Hoy, o una fecha futura si paga más adelante</div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Método de pago *</label>
        ${segHTML('metodo_pago', METODOS_PAGO, '')}
      </div>
      <div class="form-group">
        <label class="form-label">Fecha de inicio del bono</label>
        <input class="form-input" name="b_fecha_inicio" type="date" value="${fechaInicio}">
      </div>
    </div>`;
}
function bindBono(root) {
  const ses = root.querySelector('[name=b_sesiones]');
  const pre = root.querySelector('[name=b_precio]');
  const hint = root.querySelector('[data-hint-precio]');
  let manual = pre.value !== '';
  const pintar = () => {
    const n = Number(ses.value);
    root.querySelectorAll('.bono-opt').forEach(b => b.classList.toggle('selected', Number(b.dataset.n) === n));
    if (!(n > 0)) { hint.textContent = ''; return; }
    let t = `Sugerido: ${fmtEUR(precioBonoSugerido(n))} (${precioHoraSugerido(n)} €/sesión)`;
    if (Number(pre.value) > 0) t += ` · Este: ${fmtEUR(pre.value / n)}/sesión`;
    hint.textContent = t;
  };
  root.querySelectorAll('.bono-opt').forEach(b => b.addEventListener('click', () => {
    ses.value = b.dataset.n;
    if (!manual) pre.value = precioBonoSugerido(b.dataset.n);
    pintar();
  }));
  ses.addEventListener('input', () => { if (!manual) pre.value = precioBonoSugerido(ses.value) || ''; pintar(); });
  pre.addEventListener('input', () => { manual = true; pintar(); });
  pintar();
}
function leerBono(root) {
  const v = n => root.querySelector(`[name=${n}]`).value;
  const sesiones = parseInt(v('b_sesiones'), 10);
  if (!(sesiones > 0)) throw new Error('Indica cuántas sesiones tiene el bono');
  if (v('b_precio') === '' || !(Number(v('b_precio')) >= 0)) throw new Error('Indica el precio del bono');
  if (!v('b_fecha_pago')) throw new Error('Indica la fecha de pago');
  const metodo_pago = segVal(root, 'metodo_pago');
  if (!metodo_pago) throw new Error('Indica el método de pago (efectivo, tarjeta o transferencia)');
  if (!v('b_fecha_inicio')) throw new Error('Indica la fecha de inicio del bono');
  return { sesiones, precio: Number(v('b_precio')), fecha_pago: v('b_fecha_pago'), fecha_inicio: v('b_fecha_inicio'), metodo_pago };
}

function camposDias(dias = []) {
  const mapa = new Map(dias.map(d => [d.dia, d.hora]));
  return `<div class="dias-fijos">${DIAS_SEM.map(([n, , nombre]) => `
    <div class="dia-fila ${mapa.has(n) ? 'on' : ''}" data-dia="${n}">
      <label class="dia-chk"><input type="checkbox" ${mapa.has(n) ? 'checked' : ''}><span>${nombre}</span></label>
      <input class="form-input dia-hora" type="time" value="${mapa.get(n) || '10:00'}" ${mapa.has(n) ? '' : 'disabled'}>
    </div>`).join('')}</div>`;
}
function bindDias(root, onChange) {
  root.querySelectorAll('.dia-fila').forEach(f => {
    const chk = f.querySelector('input[type=checkbox]'), h = f.querySelector('.dia-hora');
    chk.addEventListener('change', () => { h.disabled = !chk.checked; f.classList.toggle('on', chk.checked); onChange?.(); });
    h.addEventListener('input', () => onChange?.());
  });
}
function leerDias(root) {
  return [...root.querySelectorAll('.dia-fila')]
    .filter(f => f.querySelector('input[type=checkbox]').checked)
    .map(f => ({ dia: Number(f.dataset.dia), hora: f.querySelector('.dia-hora').value }))
    .filter(d => d.hora);
}
function bloqueDias(dias, { conGenerar = false } = {}) {
  const on = dias.length > 0;
  return `<div class="form-group" data-bloque-dias>
    <label class="check"><input type="checkbox" name="dias_on" ${on ? 'checked' : ''}> El cliente tiene días fijos</label>
    <div data-dias-wrap ${on ? '' : 'hidden'}>
      ${camposDias(dias)}
      ${conGenerar ? `<label class="check"><input type="checkbox" name="generar" ${on ? 'checked' : ''}> Generar las sesiones en el calendario (te aviso si hay solapes)</label>` : ''}
    </div></div>`;
}
function bindBloqueDias(root) {
  const chk = root.querySelector('[name=dias_on]'), wrap = root.querySelector('[data-dias-wrap]');
  const gen = root.querySelector('[name=generar]');
  chk.addEventListener('change', () => { wrap.hidden = !chk.checked; if (gen) gen.checked = chk.checked; });
  bindDias(wrap);
}
function leerBloqueDias(root) {
  if (!root.querySelector('[name=dias_on]').checked) return [];
  const d = leerDias(root.querySelector('[data-dias-wrap]'));
  if (!d.length) throw new Error('Marca al menos un día fijo, o desmarca "días fijos"');
  return d;
}

// Envuelve un submit: bloquea el botón, muestra errores dentro del modal.
function alEnviar(m, form, fn) {
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    errorEnModal(m.el, '');
    btn.disabled = true;
    try { await fn(); } catch (err) { errorEnModal(m.el, err.message || 'Error inesperado'); } finally { btn.disabled = false; }
  });
}
const acciones = (texto, extra = '') => `
  <div class="form-error" hidden></div>
  <div class="modal-actions">${extra}
    <button type="button" class="btn btn-secondary" data-cerrar>Cancelar</button>
    <button type="submit" class="btn btn-primary">${texto}</button>
  </div>`;
const bindCerrar = m => m.el.querySelectorAll('[data-cerrar]').forEach(b => b.addEventListener('click', m.cerrar));

// ── Sesión ────────────────────────────────────────────────────────────────
export function modalSesion({ sesion = null, fecha = hoyISO(), hora = '', clienteId = null } = {}) {
  const edit = !!sesion;
  const filtro = entrenadorFiltroId();
  const elegibles = S.clientes.filter(c => (edit ? c.id === sesion.cliente_id
    : c.activo && c.estado === 'efectivo' && (!filtro || c.entrenador_id === filtro)));
  if (!elegibles.length) { toast('No hay clientes efectivos a los que añadir sesiones.', true); return; }
  const seleccionado = edit ? sesion.cliente_id : (clienteId || elegibles[0].id);
  const etiqueta = c => nombreCompleto(c) + (esAdmin() && !filtro ? ` · ${entrenadorDe(c.entrenador_id)?.nombre || ''}` : '');
  const efectivo = edit ? estadoEfectivo(sesion) : null;

  const m = abrirModal(`
    <div class="modal-title">${edit ? 'Sesión' : 'Nueva sesión'}</div>
    <form novalidate>
      <div class="form-group"><label class="form-label">Cliente</label>
        <select class="form-input" name="cliente_id" ${edit ? 'disabled' : ''}>
          ${elegibles.map(c => `<option value="${c.id}" ${c.id === seleccionado ? 'selected' : ''}>${esc(etiqueta(c))}</option>`).join('')}
        </select></div>
      <div class="form-row3">
        <div class="form-group"><label class="form-label">Fecha</label><input class="form-input" name="fecha" type="date" value="${edit ? sesion.fecha : fecha}"></div>
        <div class="form-group"><label class="form-label">Hora</label><input class="form-input" name="hora" type="time" value="${edit ? sesion.hora : hora}"></div>
        <div class="form-group"><label class="form-label">Duración</label>
          <select class="form-input" name="duracion_min">${[30, 45, 60, 75, 90, 120].map(n =>
            `<option value="${n}" ${n === (edit ? sesion.duracion_min : DURACION_SESION_MIN) ? 'selected' : ''}>${n} min</option>`).join('')}</select></div>
      </div>
      <div class="form-group"><label class="form-label">Estado</label>
        ${segHTML('estado', [['reservada', '🟡 Reservada'], ['hecha', '🟢 Hecha'], ['no_vino', '🔴 No vino']], edit ? sesion.estado : 'reservada')}
        ${efectivo === 'auto' ? '<div class="hint">Esta reserva ya pasó sin confirmar: cuenta como hecha (auto). Confírmala o márcala como "No vino".</div>' : ''}
      </div>
      <div class="form-group"><label class="form-label">Nota (opcional)</label>
        <input class="form-input" name="nota" type="text" value="${esc(edit ? sesion.nota : '')}" placeholder="Pierna, cardio, técnica..."></div>
      ${acciones('Guardar', edit ? '<button type="button" class="btn btn-danger" data-borrar>Eliminar</button>' : '')}
    </form>`);
  const form = m.el.querySelector('form');
  bindSeg(m.el);
  bindCerrar(m);

  m.el.querySelector('[data-borrar]')?.addEventListener('click', async () => {
    const ok = await dialogo({ titulo: 'Eliminar sesión', mensaje: '<p>¿Eliminar esta sesión? No se puede deshacer.</p>', ok: 'Eliminar', peligro: true });
    if (!ok) return;
    await S.api.eliminarSesion(sesion.id);
    m.cerrar();
    await bus.recargar();
    toast('Sesión eliminada');
  });

  alEnviar(m, form, async () => {
    const cid = form.elements.cliente_id.value;
    const f = form.elements.fecha.value, h = form.elements.hora.value;
    if (!f) throw new Error('Indica la fecha');
    if (!h) throw new Error('Indica la hora');
    const cli = clienteDe(cid);
    const datos = {
      fecha: f, hora: h, duracion_min: Number(form.elements.duracion_min.value),
      estado: segVal(m.el, 'estado'), nota: form.elements.nota.value.trim() || null,
    };

    const existentes = await S.api.sesionesEntre(f, f, cli.entrenador_id);
    const conflictos = buscarConflictos({ ...datos, cliente_id: cid }, existentes, sesion?.id);
    if (conflictos.length) {
      const lista = conflictos.map(x => `<li><b>${esc(x.hora)}</b> · ${esc(nombreCompleto(x.clientes))}</li>`).join('');
      const ok = await dialogo({
        titulo: '⚠ Solape de horario',
        mensaje: `<p>${esc(entrenadorDe(cli.entrenador_id)?.nombre || 'El entrenador')} ya tiene sesión a esa hora:</p><ul class="dlg-lista">${lista}</ul><p>¿Guardar igualmente?</p>`,
        ok: 'Guardar igualmente',
      });
      if (!ok) return;
    }
    const antes = edit ? ocupaCredito(estadoEfectivo(sesion)) : false;
    if (!antes && ocupaCredito(datos.estado) && creditos(cli).libres < 1) {
      const ok = await dialogo({
        titulo: 'Sin créditos disponibles',
        mensaje: `<p>${esc(nombreCompleto(cli))} no tiene sesiones libres en su bono. ¿Guardar igualmente?</p>`,
        ok: 'Guardar igualmente',
      });
      if (!ok) return;
    }
    if (edit) await S.api.actualizarSesion(sesion.id, datos);
    else await S.api.crearSesiones([{ ...datos, cliente_id: cid }]);
    m.cerrar();
    await bus.recargar();
    toast('Sesión guardada');
  });
}

// Cambio rápido de estado desde la ficha (avisa si no quedan créditos).
export async function cambiarEstadoSesion(sesion, nuevo) {
  const cli = clienteDe(sesion.cliente_id);
  const antes = ocupaCredito(estadoEfectivo(sesion));
  if (!antes && ocupaCredito(nuevo) && cli && creditos(cli).libres < 1) {
    const ok = await dialogo({
      titulo: 'Sin créditos disponibles',
      mensaje: `<p>${esc(nombreCompleto(cli))} no tiene sesiones libres en su bono. ¿Continuar igualmente?</p>`,
      ok: 'Continuar',
    });
    if (!ok) return;
  }
  await S.api.actualizarSesion(sesion.id, { estado: nuevo });
  await bus.recargar();
}

// ── Ficha de cliente (alta / edición) ─────────────────────────────────────
export function modalCliente(cliente = null) {
  const edit = !!cliente;
  const c = cliente || {};
  const admin = esAdmin();
  const entrPorDefecto = c.entrenador_id || entrenadorFiltroId() || S.entrenadores[0]?.id || '';

  const m = abrirModal(`
    <div class="modal-title">${edit ? 'Editar ficha' : 'Nueva ficha'}</div>
    <form novalidate>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Nombre *</label><input class="form-input" name="nombre" value="${esc(c.nombre)}" autocomplete="off"></div>
        <div class="form-group"><label class="form-label">Apellidos *</label><input class="form-input" name="apellidos" value="${esc(c.apellidos)}" autocomplete="off"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Teléfono</label><input class="form-input" name="telefono" type="tel" value="${esc(c.telefono)}"></div>
        <div class="form-group"><label class="form-label">Email</label><input class="form-input" name="email" type="email" value="${esc(c.email)}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Fecha de nacimiento</label><input class="form-input" name="fecha_nacimiento" type="date" value="${esc(c.fecha_nacimiento)}"></div>
        ${admin ? `<div class="form-group"><label class="form-label">Entrenador</label>
          <select class="form-input" name="entrenador_id">${S.entrenadores.map(e =>
            `<option value="${e.id}" ${e.id === entrPorDefecto ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select></div>` : '<div></div>'}
      </div>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Tipo *</label>
          ${edit ? `<div class="chip-fijo">${c.estado === 'efectivo' ? 'Cliente' : 'Potencial'}</div>`
            : segHTML('estado', [['potencial', 'Potencial'], ['efectivo', 'Cliente']], 'potencial')}</div>
        <div class="form-group"><label class="form-label">Origen *</label>
          ${segHTML('origen', [['codek', 'Cliente Codek'], ['externo', 'Externo']], c.origen || '')}
          <div class="hint">Codek = lo hemos captado nosotros · Externo = lo trae el entrenador</div></div>
      </div>

      <div data-bloque="potencial">
        <div class="section-mini">Lo que le interesaría contratar</div>
        <div class="form-row3">
          <div class="form-group"><label class="form-label">Sesiones / mes</label>
            <input class="form-input" name="pot_sesiones_bono" type="number" min="1" list="lista-bonos" value="${esc(c.pot_sesiones_bono)}">
            <datalist id="lista-bonos">${OPCIONES_BONO.map(n => `<option value="${n}">`).join('')}</datalist></div>
          <div class="form-group"><label class="form-label">Veces / semana</label>
            <input class="form-input" name="pot_veces_semana" type="number" min="1" max="7" value="${esc(c.pot_veces_semana)}"></div>
          <div class="form-group"><label class="form-label">Pagaría (€)</label>
            <input class="form-input" name="pot_precio" type="number" min="0" step="0.01" value="${esc(c.pot_precio)}"></div>
        </div>
      </div>

      ${edit ? '' : `<div data-bloque="efectivo-nuevo" hidden>
        <div class="section-mini">Bono contratado</div>${camposBono()}</div>`}
      <div data-bloque="efectivo" hidden>
        <div class="section-mini">Días fijos</div>
        ${bloqueDias(c.dias_fijos || [], { conGenerar: !edit })}
      </div>

      <div class="form-group"><label class="form-label">Notas</label>
        <input class="form-input" name="notas" type="text" value="${esc(c.notas)}" placeholder="Objetivo, lesiones..."></div>
      ${acciones('Guardar')}
    </form>`, 'modal-lg');

  const form = m.el.querySelector('form');
  const q = s => m.el.querySelector(s);
  const estadoActual = () => (edit ? c.estado : segVal(m.el, 'estado'));
  const pintarBloques = () => {
    const e = estadoActual();
    q('[data-bloque=potencial]').hidden = e !== 'potencial';
    q('[data-bloque=efectivo]').hidden = e !== 'efectivo';
    const nuevo = q('[data-bloque=efectivo-nuevo]');
    if (nuevo) nuevo.hidden = e !== 'efectivo';
  };
  bindSeg(m.el, pintarBloques);
  bindCerrar(m);
  bindBloqueDias(m.el);
  if (!edit) bindBono(m.el);
  pintarBloques();

  // Precio estimado automático mientras no lo toque a mano
  const ps = form.elements.pot_sesiones_bono, pp = form.elements.pot_precio;
  let manual = pp.value !== '';
  ps.addEventListener('input', () => { if (!manual) pp.value = precioBonoSugerido(ps.value) || ''; });
  pp.addEventListener('input', () => { manual = true; });

  alEnviar(m, form, async () => {
    const v = n => form.elements[n].value.trim();
    if (!v('nombre')) throw new Error('El nombre es obligatorio');
    if (!v('apellidos')) throw new Error('Los apellidos son obligatorios');
    const origen = segVal(m.el, 'origen');
    if (!origen) throw new Error('Indica si es cliente Codek o externo');
    const estado = estadoActual();
    const entrenador_id = admin ? v('entrenador_id') : S.perfil.id;
    if (!entrenador_id) throw new Error('Elige el entrenador');

    const num = n => (v(n) === '' ? null : Number(v(n)));
    const datos = {
      nombre: v('nombre'), apellidos: v('apellidos'), telefono: v('telefono') || null, email: v('email') || null,
      fecha_nacimiento: v('fecha_nacimiento') || null, origen, notas: v('notas') || null,
    };
    if (!edit || admin) datos.entrenador_id = entrenador_id;
    if (estado === 'potencial') {
      Object.assign(datos, { pot_sesiones_bono: num('pot_sesiones_bono'), pot_veces_semana: num('pot_veces_semana'), pot_precio: num('pot_precio') });
    }
    const dias = estado === 'efectivo' ? leerBloqueDias(m.el) : [];
    if (estado === 'efectivo') datos.dias_fijos = dias;
    const bono = !edit && estado === 'efectivo' ? leerBono(m.el) : null;
    const generar = !edit && estado === 'efectivo' && dias.length > 0 && q('[name=generar]').checked;

    let guardado;
    if (edit) guardado = await S.api.guardarCliente({ id: c.id, ...datos });
    else guardado = await S.api.guardarCliente({ ...datos, estado });
    let bonoCreado = null;
    if (bono) {
      try { bonoCreado = await S.api.crearBono({ cliente_id: guardado.id, ...bono }); }
      catch (err) { toast('La ficha se creó pero el bono falló: ' + err.message, true); }
    }
    S.cliSel = guardado.id;
    m.cerrar();
    await bus.recargar();
    toast(edit ? 'Ficha actualizada' : 'Ficha creada');
    if (generar && bonoCreado) modalGenerar(clienteDe(guardado.id), { bono: bonoCreado, cantidad: bonoCreado.sesiones });
  });
}

// ── Potencial → cliente ───────────────────────────────────────────────────
export function modalConvertir(c) {
  const m = abrirModal(`
    <div class="modal-title">Convertir en cliente</div>
    <p class="sub">${esc(nombreCompleto(c))} pasa de potencial a cliente. Indica el bono que ha contratado.</p>
    <form novalidate>
      ${camposBono({ sesiones: c.pot_sesiones_bono || '', precio: c.pot_precio ?? '' })}
      <div class="section-mini">Días fijos</div>
      ${bloqueDias(c.dias_fijos || [], { conGenerar: true })}
      ${acciones('Convertir')}
    </form>`, 'modal-lg');
  const form = m.el.querySelector('form');
  bindCerrar(m); bindSeg(m.el); bindBono(m.el); bindBloqueDias(m.el);
  alEnviar(m, form, async () => {
    const bono = leerBono(m.el);
    const dias = leerBloqueDias(m.el);
    const generar = dias.length > 0 && m.el.querySelector('[name=generar]').checked;
    await S.api.guardarCliente({ id: c.id, estado: 'efectivo', dias_fijos: dias });
    const creado = await S.api.crearBono({ cliente_id: c.id, ...bono });
    m.cerrar();
    await bus.recargar();
    toast('Convertido en cliente');
    if (generar) modalGenerar(clienteDe(c.id), { bono: creado, cantidad: creado.sesiones });
  });
}

// ── Nuevo bono (renovación) ───────────────────────────────────────────────
export function modalBono(c) {
  const dias = c.dias_fijos || [];
  const m = abrirModal(`
    <div class="modal-title">Nuevo bono</div>
    <p class="sub">${esc(nombreCompleto(c))}</p>
    <form novalidate>
      ${camposBono()}
      ${dias.length
        ? `<label class="check"><input type="checkbox" name="generar" checked> Generar las sesiones según sus días fijos (${esc(textoDias(dias))})</label>`
        : '<div class="hint">Sin días fijos: podrás generar las sesiones más adelante desde la ficha.</div>'}
      ${acciones('Añadir bono')}
    </form>`, 'modal-lg');
  const form = m.el.querySelector('form');
  bindCerrar(m); bindSeg(m.el); bindBono(m.el);
  alEnviar(m, form, async () => {
    const bono = leerBono(m.el);
    const generar = !!m.el.querySelector('[name=generar]')?.checked;
    const creado = await S.api.crearBono({ cliente_id: c.id, ...bono });
    m.cerrar();
    await bus.recargar();
    toast('Bono añadido');
    if (generar) modalGenerar(clienteDe(c.id), { bono: creado, cantidad: creado.sesiones });
  });
}

// ── Generar sesiones desde días fijos ─────────────────────────────────────
export function modalGenerar(c, { bono = null, cantidad = null } = {}) {
  if (!c) return;
  const hoy = hoyISO();
  const ultimo = bono || [...(c.bonos || [])].sort((a, b) => a.fecha_inicio.localeCompare(b.fecha_inicio)).pop() || null;
  const desde0 = ultimo && ultimo.fecha_inicio > hoy ? ultimo.fecha_inicio : hoy;
  const cant0 = cantidad || Math.max(1, creditos(c).libres);
  const entr = entrenadorDe(c.entrenador_id)?.nombre || 'El entrenador';

  const m = abrirModal(`
    <div class="modal-title">Generar sesiones</div>
    <p class="sub">${esc(nombreCompleto(c))} · ${esc(entr)}</p>
    <form novalidate>
      <div class="form-row">
        <div class="form-group"><label class="form-label">Nº de sesiones</label><input class="form-input" name="cantidad" type="number" min="1" max="120" value="${cant0}"></div>
        <div class="form-group"><label class="form-label">Desde el día</label><input class="form-input" name="desde" type="date" value="${desde0}"></div>
      </div>
      <div class="form-group"><label class="form-label">Días fijos</label>${camposDias(c.dias_fijos || [])}</div>
      <div class="section-mini">Vista previa</div>
      <div class="gen-lista" data-preview></div>
      ${acciones('Crear sesiones')}
    </form>`, 'modal-lg');
  const form = m.el.querySelector('form');
  const preview = m.el.querySelector('[data-preview]');
  const btn = form.querySelector('button[type=submit]');
  bindCerrar(m);

  let filas = [], token = 0, temporizador = null;
  const marcadas = () => [...preview.querySelectorAll('input[data-i]:checked')].map(i => filas[Number(i.dataset.i)]);
  const actualizarBoton = () => {
    const n = marcadas().length;
    btn.disabled = n === 0;
    btn.textContent = n === 1 ? 'Crear 1 sesión' : `Crear ${n} sesiones`;
  };
  async function recalcular() {
    const mi = ++token;
    const fechas = generarFechas({ desde: form.elements.desde.value, dias: leerDias(m.el), cantidad: parseInt(form.elements.cantidad.value, 10) });
    if (!fechas.length) {
      filas = [];
      preview.innerHTML = '<div class="vacio">Marca al menos un día fijo y una cantidad.</div>';
      actualizarBoton();
      return;
    }
    const existentes = await S.api.sesionesEntre(fechas[0].fecha, fechas[fechas.length - 1].fecha, c.entrenador_id);
    if (mi !== token) return;
    filas = fechas.map(f => ({ ...f, conflictos: buscarConflictos({ fecha: f.fecha, hora: f.hora, duracion_min: DURACION_SESION_MIN }, existentes) }));
    const nConf = filas.filter(f => f.conflictos.length).length;
    preview.innerHTML = filas.map((f, i) => {
      const x = f.conflictos[0];
      return `<label class="gen-fila ${x ? 'conflicto' : ''}">
        <input type="checkbox" data-i="${i}" ${x ? '' : 'checked'}>
        <span class="gf-f">${fmtFechaDia(f.fecha)}</span><span class="gf-h">${f.hora}</span>
        ${x ? `<span class="gf-a">⚠ ${esc(entr)} ya tiene a ${esc(nombreCompleto(x.clientes))} a las ${esc(x.hora)}</span>` : ''}
      </label>`;
    }).join('') + (nConf ? `<div class="gen-aviso">⚠ ${nConf} sesión${nConf === 1 ? '' : 'es'} coincide${nConf === 1 ? '' : 'n'} con otra. Las dejo sin marcar; márcalas si quieres crearlas igualmente.</div>` : '');
    actualizarBoton();
  }
  const pedir = () => { clearTimeout(temporizador); temporizador = setTimeout(() => recalcular().catch(e => errorEnModal(m.el, e.message)), 200); };
  form.elements.cantidad.addEventListener('input', pedir);
  form.elements.desde.addEventListener('input', pedir);
  bindDias(m.el, pedir);
  preview.addEventListener('change', actualizarBoton);
  recalcular().catch(e => errorEnModal(m.el, e.message));

  alEnviar(m, form, async () => {
    const elegidas = marcadas();
    if (!elegidas.length) throw new Error('No hay sesiones marcadas');
    const dias = leerDias(m.el);
    await S.api.crearSesiones(elegidas.map(f => ({
      cliente_id: c.id, bono_id: ultimo?.id || null, fecha: f.fecha, hora: f.hora,
      duracion_min: DURACION_SESION_MIN, estado: 'reservada',
    })));
    if (JSON.stringify(dias) !== JSON.stringify(c.dias_fijos || [])) await S.api.guardarCliente({ id: c.id, dias_fijos: dias });
    m.cerrar();
    await bus.recargar();
    toast(elegidas.length === 1 ? '1 sesión creada' : `${elegidas.length} sesiones creadas`);
  });
}
