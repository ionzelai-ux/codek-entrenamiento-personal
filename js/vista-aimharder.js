// Panel de AimHarder (solo administrador). Fase 1: SOLO LECTURA.
// Comprueba la conexión y lista las clases de un día para localizar el «Rack libre».
import { S, bus } from './store.js';
import { esc, fmtFechaDia } from './util.js';

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
      <td class="num">${esc(c.hora)}</td><td>${esc(c.nombre)}${c.es_rack ? ' <span class="chip amarillo">RACK</span>' : ''}</td>
      <td class="num">${esc(c.duracion)}</td><td class="num">${esc(c.aforo)}</td><td>${esc(c.sala || '')}</td><td class="num">${esc(c.schedule_id)}</td>
    </tr>`).join('');
  return `
    <div class="section-title" style="margin-top:22px">${esc(fmtFechaDia(d.fecha))} · ${d.resumen.total} clases · ${d.resumen.rack} de Rack libre</div>
    <div class="tabla-wrap"><table class="tabla">
      <thead><tr><th class="num">Hora</th><th>Clase</th><th class="num">Duración</th><th class="num">Aforo</th><th>Sala</th><th class="num">ID horario</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="6" class="vacio">Sin clases ese día</td></tr>'}</tbody>
    </table></div>`;
}

export function renderAimHarder(el) {
  const a = S.ah;
  el.innerHTML = `
    <div class="ah-panel">
      <div class="section-title">Conexión con AimHarder</div>
      <p class="hint" style="margin-bottom:14px">Fase 1: <b>solo lectura</b>. Nada de lo que hagas aquí crea ni cancela reservas.
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
    </div>`;
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
};
