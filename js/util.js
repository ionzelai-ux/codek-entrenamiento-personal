import { parseISO } from './logica.js';

export const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS_CORTO = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
export const nombreMes = (iso) => { const d = parseISO(iso.length === 7 ? iso + '-01' : iso); return `${MESES[d.getMonth()]} ${d.getFullYear()}`; };
export const mesCorto = iso => MESES[parseISO(iso).getMonth()].slice(0, 3);
export const fmtFecha = iso => (iso ? iso.split('-').reverse().join('/') : '');
export const fmtFechaDia = iso => { const d = parseISO(iso); return `${DIAS_CORTO[d.getDay()]} ${fmtFecha(iso).slice(0, 5)}`; };
export const DIAS_SEM = [[1, 'L', 'Lunes'], [2, 'M', 'Martes'], [3, 'X', 'Miércoles'], [4, 'J', 'Jueves'], [5, 'V', 'Viernes'], [6, 'S', 'Sábado'], [7, 'D', 'Domingo']];
export const textoDias = dias => (dias || []).slice().sort((a, b) => a.dia - b.dia || a.hora.localeCompare(b.hora))
  .map(d => `${DIAS_SEM.find(x => x[0] === d.dia)?.[1] || '?'} ${d.hora}`).join(' · ');
export const METODOS_PAGO = [['efectivo', '💶 Efectivo'], ['tarjeta', '💳 Tarjeta'], ['transferencia', '🏦 Transferencia']];
export const etiquetaMetodo = m => METODOS_PAGO.find(x => x[0] === m)?.[1] || '';
export const fmtEUR = n => Number(n || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });

export function toast(msg, error = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (error ? ' error' : '');
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), error ? 6000 : 3000);
}

// ── Modales ───────────────────────────────────────────────────────────────
export function abrirModal(html, clase = '') {
  const ov = document.createElement('div');
  ov.className = 'modal-overlay open';
  ov.innerHTML = `<div class="modal ${clase}" role="dialog" aria-modal="true">${html}</div>`;
  let cerrado = false;
  const m = {
    el: ov.firstElementChild,
    onCerrar: null,
    cerrar() { if (cerrado) return; cerrado = true; ov.remove(); m.onCerrar?.(); },
  };
  ov.addEventListener('mousedown', e => { if (e.target === ov) m.cerrar(); });
  ov._cerrar = m.cerrar;
  document.getElementById('modales').appendChild(ov);
  return m;
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  [...document.querySelectorAll('#modales .modal-overlay')].pop()?._cerrar?.();
});

// Diálogo de confirmación. `mensaje` es HTML: escapa lo que venga de datos con esc().
export function dialogo({ titulo, mensaje, ok = 'Aceptar', cancelar = 'Cancelar', peligro = false }) {
  return new Promise(resolver => {
    const m = abrirModal(`
      <div class="modal-title">${esc(titulo)}</div>
      <div class="dlg-msg">${mensaje}</div>
      <div class="modal-actions">
        <button class="btn btn-secondary" data-r="0">${esc(cancelar)}</button>
        <button class="btn ${peligro ? 'btn-danger-solid' : 'btn-primary'}" data-r="1">${esc(ok)}</button>
      </div>`, 'modal-sm');
    let hecho = false;
    const fin = v => { if (!hecho) { hecho = true; resolver(v); } };
    m.onCerrar = () => fin(false);
    m.el.querySelectorAll('[data-r]').forEach(b => b.addEventListener('click', () => { fin(b.dataset.r === '1'); m.cerrar(); }));
  });
}

export function errorEnModal(root, msg) {
  const el = root.querySelector('.form-error');
  if (el) { el.textContent = msg; el.hidden = !msg; el.scrollIntoView({ block: 'nearest' }); }
}
