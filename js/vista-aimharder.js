// Panel de AimHarder (solo administrador).
// Fase 1: solo lectura (comprobar conexión, ver las clases de un día).
// Fase 2: prueba controlada de reservas (crea/cancela plazas de invitado «PRUEBA PT»).
import { S, bus } from './store.js';
import { esc, fmtFechaDia, fmtFecha, dialogo } from './util.js';

function estadoHTML() {
  const e = S.ah.estado;
  if (!e) return '';
  const cad = e.caducidad
    ? `<div class="hint">Caducidad guardada · acceso: ${esc(e.caducidad.access || '—')} · renovación: ${esc(e.caducidad.refresh || '—')}</div>`
    : '<div class="hint">Usando los tokens de los secretos de Supabase (aún no se ha renovado ninguno).</div>';
  return e.ok
    ? `<div class="alert alert-ok">✔ ${esc(e.mensaje)}</div>${cad}`
    : `<div class="alert alert-danger">✖ ${esc(e.mensaje || e.error || 'No se pudo conectar')}</div>`;
}

function diaHTML() {
  const d = S.ah.dia;
  if (!d) return '';
  if (!d.ok) {
    return `<div class="alert alert-danger">✖ ${esc(d.error || 'Error')}${d.forma ? `<br><small>Campos recibidos: ${esc(d.forma.join(', '))}</small>` : ''}</div>
      ${d.crudo ? `<div class="hint" style="margin:10px 0 4px">Respuesta recibida de AimHarder (sin tokens), para diagnóstico:</div><pre class="ah-crudo">${esc(d.crudo)}</pre>` : ''}`;
  }
  const filas = d.clases.map(c => `
    <tr class="${c.es_rack ? 'fila-rack' : ''}">
      <td class="num">${esc(c.hora)}</td><td>${esc(c.nombre)}${c.es_rack ? ' <span class="chip amarillo">RACK</span>' : ''}${c.es_personal ? ' <span class="chip">PERSONAL</span>' : ''}${c.cancelada ? ' <span class="chip granate">CANCELADA</span>' : ''}</td>
      <td class="num">${esc(c.duracion)}</td><td class="num">${esc(c.aforo)}</td><td>${esc(c.sala || '')}</td><td class="num">${esc(c.schedule_id)}</td>
    </tr>`).join('');
  return `
    <div class="section-title" style="margin-top:22px">${esc(fmtFechaDia(d.fecha))} · ${d.resumen.total} clases · ${d.resumen.rack} de Rack libre</div>
    <div class="tabla-wrap"><table class="tabla">
      <thead><tr><th class="num">Hora</th><th>Clase</th><th class="num">Duración</th><th class="num">Aforo máx.</th><th>Sala</th><th class="num">ID horario</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="6" class="vacio">Sin clases ese día</td></tr>'}</tbody>
    </table></div>
    <p class="hint" style="margin-top:10px">«Aforo máx.» es la capacidad de la clase. El calendario de la API de AimHarder <b>no informa de las plazas ocupadas</b>:
      para saber cuántas quedan libres hay que mirar en AimHarder.</p>`;
}

function pruebasHTML() {
  const p = S.ah.prueba;
  const msg = p ? (p.ok
    ? `<div class="alert alert-ok">✔ ${esc(p.mensaje || 'Hecho')}</div>`
    : `<div class="alert alert-danger">✖ ${esc(p.error || p.mensaje || 'Error')}${p.http ? `<br><small>Respuesta de AimHarder: HTTP ${esc(p.http)}</small>` : ''}${
      (p.resultados || []).filter(r => !r.ok).map(r => `<br><small>Reserva ${esc(r.booking_id)}: ${esc(r.error)}</small>`).join('')}</div>`) : '';
  const filas = (S.ah.pruebas || []).map(x => `
    <tr><td class="num">${esc(x.booking_id)}</td><td>${esc(fmtFecha(x.fecha))} ${esc(x.hora)}</td>
      <td>${x.cancelada ? '<span class="chip gris">CANCELADA</span>' : '<span class="chip amarillo">ACTIVA</span>'}</td></tr>`).join('');
  const activas = (S.ah.pruebas || []).filter(x => !x.cancelada).length;
  return `
    <div class="section-title" style="margin-top:34px">Fase 2 · Prueba de reservas</div>
    <p class="hint" style="margin-bottom:12px"><b>Esto sí escribe en AimHarder.</b> Crea plazas de invitado llamadas «PRUEBA PT» en el «Rack libre» y solo puede
      cancelar las que ha creado él mismo. Máximo 6 activas y al menos 3 horas antes de la clase. Antes de empezar, anota cuántas plazas
      ocupadas tiene ese Rack libre en AimHarder.</p>
    <div class="ah-fila">
      <input class="form-input" type="date" id="ah-pfecha" value="${esc(S.ah.pfecha)}" style="max-width:190px">
      <input class="form-input" type="time" id="ah-phora" value="${esc(S.ah.phora)}" style="max-width:130px">
      <button class="btn btn-primary btn-sm" data-acc="ah-reservar" ${S.ah.cargando ? 'disabled' : ''}>Reservar 1 plaza de prueba</button>
      <button class="btn btn-danger btn-sm" data-acc="ah-cancelar" ${S.ah.cargando || !activas ? 'disabled' : ''}>Cancelar todas las pruebas${activas ? ` (${activas})` : ''}</button>
    </div>
    ${msg}
    ${filas ? `<div class="tabla-wrap" style="margin-top:14px"><table class="tabla"><thead><tr><th class="num">Nº reserva</th><th>Clase</th><th>Estado</th></tr></thead><tbody>${filas}</tbody></table></div>` : ''}`;
}

export function renderAimHarder(el) {
  const a = S.ah;
  el.innerHTML = `
    <div class="ah-panel">
      <div class="section-title">Conexión con AimHarder</div>
      <p class="hint" style="margin-bottom:14px">Fase 1: <b>solo lectura</b>. Nada de lo que hagas en esta parte crea ni cancela reservas.
        Los tokens viven en Supabase y nunca llegan a esta pantalla.</p>
      <div class="ah-fila">
        <button class="btn btn-secondary btn-sm" data-acc="ah-estado" ${a.cargando ? 'disabled' : ''}>Comprobar conexión</button>
      </div>
      ${estadoHTML()}
      <div class="ah-fila" style="margin-top:20px">
        <input class="form-input" type="date" id="ah-fecha" value="${esc(a.fecha)}" style="max-width:190px">
        <button class="btn btn-primary btn-sm" data-acc="ah-calendario" ${a.cargando ? 'disabled' : ''}>Ver clases del día</button>
        ${a.cargando ? '<span class="hint">Consultando…</span>' : ''}
      </div>
      ${a.error ? `<div class="alert alert-danger" style="margin-top:14px">✖ ${esc(a.error)}</div>` : ''}
      ${diaHTML()}
      ${pruebasHTML()}
    </div>`;
  if (a.pruebas === null && !a.pruebasCargadas) { a.pruebasCargadas = true; accionesAimHarder['ah-listar'](); }
}

async function consultar(cuerpo) {
  S.ah.cargando = true; S.ah.error = '';
  bus.repintar();
  try { return await S.api.consultarAimHarder(cuerpo); }
  catch (err) { S.ah.error = err.message; return null; }
  finally { S.ah.cargando = false; }
}

export const accionesAimHarder = {
  'ah-estado': async () => {
    const r = await consultar({ accion: 'estado' });
    if (r) S.ah.estado = r;
    bus.repintar();
  },
  'ah-calendario': async () => {
    const fecha = document.getElementById('ah-fecha')?.value;
    if (!fecha) { S.ah.error = 'Elige una fecha.'; bus.repintar(); return; }
    S.ah.fecha = fecha;
    const r = await consultar({ accion: 'calendario', fecha });
    if (r) S.ah.dia = r;
    bus.repintar();
  },
  'ah-listar': async () => {
    try {
      const r = await S.api.consultarAimHarder({ accion: 'prueba_listar' });
      S.ah.pruebas = r?.pruebas || [];
    } catch (err) { S.ah.pruebas = []; S.ah.prueba = { ok: false, error: err.message }; }
    bus.repintar();
  },
  'ah-reservar': async () => {
    const fecha = document.getElementById('ah-pfecha')?.value, hora = document.getElementById('ah-phora')?.value;
    S.ah.pfecha = fecha || S.ah.pfecha; S.ah.phora = hora || S.ah.phora;
    if (!fecha || !hora) { S.ah.prueba = { ok: false, error: 'Indica el día y la hora de la clase.' }; bus.repintar(); return; }
    const ok = await dialogo({
      titulo: 'Reservar plaza de prueba',
      mensaje: `<p>Se creará <b>1 reserva de invitado «PRUEBA PT»</b> en el <b>Rack libre</b> del <b>${esc(fmtFecha(fecha))} a las ${esc(hora)}</b>, en AimHarder de verdad.</p><p>Después podrás cancelarla desde aquí.</p>`,
      ok: 'Reservar',
    });
    if (!ok) return;
    S.ah.prueba = null;
    const r = await consultar({ accion: 'prueba_reservar', fecha, hora });
    if (r) S.ah.prueba = r;
    await accionesAimHarder['ah-listar']();
  },
  'ah-cancelar': async () => {
    const ok = await dialogo({
      titulo: 'Cancelar las pruebas',
      mensaje: '<p>Se cancelarán en AimHarder <b>solo las reservas de prueba creadas desde aquí</b>. No se toca ninguna otra.</p>',
      ok: 'Cancelar pruebas', peligro: true,
    });
    if (!ok) return;
    S.ah.prueba = null;
    const r = await consultar({ accion: 'prueba_cancelar' });
    if (r) S.ah.prueba = r;
    await accionesAimHarder['ah-listar']();
  },
};
