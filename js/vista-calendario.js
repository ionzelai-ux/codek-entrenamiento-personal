// Calendario: vista de semana (columnas por día con horas) o de mes (cuadrícula).
import { S, bus, esAdmin, entrenadorDe, nombreCompleto, entrenadorFiltroId } from './store.js';
import { esc, nombreMes, mesCorto, dialogo, toast, fmtFechaDia } from './util.js';
import {
  hoyISO, addDias, lunesDe, primerDiaMes, ultimoDiaMes, parseISO, horaAMin, minAHora,
  estadoEfectivo, repartirCarriles, buscarConflictos,
} from './logica.js';
import { HORA_INICIO_CALENDARIO, HORA_FIN_CALENDARIO, DURACION_SESION_MIN } from './config.js';
import { modalSesion } from './modales.js';

const HPX = 52;                       // píxeles por hora en la vista semanal
const DIAS = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB', 'DOM'];
const ETIQUETA = { reservada: 'Reservada', hecha: 'Hecha', no_vino: 'No vino', auto: 'Auto (sin confirmar)' };

function rango() {
  const { modo, fecha } = S.cal;
  if (modo === 'semana') { const d1 = lunesDe(fecha); return { d1, d2: addDias(d1, 6) }; }
  const primero = primerDiaMes(fecha);
  return { d1: lunesDe(primero), d2: addDias(lunesDe(ultimoDiaMes(fecha)), 6) };
}

let token = 0;
export async function cargarCalendario() {
  const { d1, d2 } = rango();
  const mi = ++token;
  bus.repintar();
  const sesiones = await S.api.sesionesEntre(d1, d2, entrenadorFiltroId());
  if (mi !== token) return;
  S.cal.sesiones = sesiones;
  bus.repintar();
}

function titulo() {
  if (S.cal.modo === 'mes') return nombreMes(S.cal.fecha).toUpperCase();
  const { d1, d2 } = rango();
  const a = parseISO(d1), b = parseISO(d2);
  const mismoMes = a.getMonth() === b.getMonth();
  return `${a.getDate()}${mismoMes ? '' : ' ' + mesCorto(d1).toUpperCase()} – ${b.getDate()} ${mesCorto(d2).toUpperCase()} ${b.getFullYear()}`;
}

const colorEntr = s => entrenadorDe(s.clientes?.entrenador_id)?.color || '#888';
const mostrarEntr = () => esAdmin() && !entrenadorFiltroId();
const pastilla = s => (mostrarEntr() ? `<i class="tc" style="background:${colorEntr(s)}"></i>` : '');
const tip = s => `${s.hora} · ${nombreCompleto(s.clientes)}${mostrarEntr() ? ' · ' + (entrenadorDe(s.clientes.entrenador_id)?.nombre || '') : ''} · ${ETIQUETA[estadoEfectivo(s)]}${s.nota ? ' · ' + s.nota : ''}`;

function semanaHTML() {
  const { d1, d2 } = rango();
  const hoy = hoyISO();
  const ses = S.cal.sesiones.filter(s => s.fecha >= d1 && s.fecha <= d2);
  let h0 = HORA_INICIO_CALENDARIO, h1 = HORA_FIN_CALENDARIO;
  for (const s of ses) {
    h0 = Math.min(h0, Math.floor(horaAMin(s.hora) / 60));
    h1 = Math.max(h1, Math.ceil((horaAMin(s.hora) + (s.duracion_min || DURACION_SESION_MIN)) / 60));
  }
  const horas = Array.from({ length: h1 - h0 }, (_, i) => h0 + i);
  const cols = Array.from({ length: 7 }, (_, i) => addDias(d1, i));

  const cabecera = cols.map((f, i) => `<div class="wk-dh ${f === hoy ? 'hoy' : ''}">${DIAS[i]} <b>${parseISO(f).getDate()}</b></div>`).join('');
  const columnas = cols.map(f => {
    const items = ses.filter(s => s.fecha === f).map(s => {
      const ini = horaAMin(s.hora);
      return { s, ini, fin: ini + (s.duracion_min || DURACION_SESION_MIN) };
    });
    const bloques = repartirCarriles(items).map(({ s, ini, fin, lane, lanes }) => {
      const top = (ini - h0 * 60) / 60 * HPX, alto = Math.max(20, (fin - ini) / 60 * HPX - 2);
      const w = 100 / lanes;
      return `<div class="blk ${estadoEfectivo(s)}" data-acc="ses-abrir" data-id="${s.id}" title="${esc(tip(s))}"
          style="top:${top}px;height:${alto}px;left:calc(${lane * w}% + 1px);width:calc(${w}% - 2px)">
        <div class="blk-h">${pastilla(s)}${minAHora(ini)}–${minAHora(fin)}</div>
        <div class="blk-n">${esc(nombreCompleto(s.clientes))}</div></div>`;
    }).join('');
    return `<div class="wk-col ${f === hoy ? 'hoy' : ''}" data-acc="col-nuevo" data-fecha="${f}" data-h0="${h0}">${bloques}</div>`;
  }).join('');

  return `<div class="wk" style="--hpx:${HPX}px" data-h0="${h0}" data-h1="${h1}">
    <div class="wk-inner">
      <div class="wk-head"><div class="wk-corner"></div>${cabecera}</div>
      <div class="wk-body">
        <div class="wk-horas">${horas.map(h => `<div>${String(h).padStart(2, '0')}:00</div>`).join('')}</div>
        ${columnas}
      </div>
    </div></div>`;
}

function mesHTML() {
  const { d1, d2 } = rango();
  const hoy = hoyISO(), mesActual = S.cal.fecha.slice(0, 7);
  const porDia = new Map();
  for (const s of S.cal.sesiones) {
    if (!porDia.has(s.fecha)) porDia.set(s.fecha, []);
    porDia.get(s.fecha).push(s);
  }
  let celdas = '';
  for (let f = d1; f <= d2; f = addDias(f, 1)) {
    const lista = (porDia.get(f) || []).sort((a, b) => a.hora.localeCompare(b.hora));
    const pills = lista.slice(0, 3).map(s => `<div class="cell-sess ${estadoEfectivo(s)}" data-acc="ses-abrir" data-id="${s.id}" title="${esc(tip(s))}">${pastilla(s)}${s.hora}<span class="pn"> ${esc(s.clientes.nombre)}</span></div>`).join('');
    const mas = lista.length > 3 ? `<div class="cell-mas" data-acc="dia-semana" data-fecha="${f}">+${lista.length - 3} más</div>` : '';
    celdas += `<div class="cal-cell ${f.slice(0, 7) !== mesActual ? 'fuera' : ''} ${f === hoy ? 'today' : ''}" data-acc="dia-nuevo" data-fecha="${f}">
      <div class="cell-num">${parseISO(f).getDate()}</div>${pills}${mas}</div>`;
  }
  return `<div class="cal-grid">${DIAS.map(d => `<div class="cal-dname">${d}</div>`).join('')}${celdas}</div>`;
}

function leyenda() {
  const items = [['reservada', 'var(--yellow)'], ['hecha', 'var(--green-light)'], ['auto', 'var(--blue-light)'], ['no_vino', '#cc4444']];
  let html = items.map(([k, c]) => `<div class="leg-item"><div class="leg-dot" style="background:${c}"></div>${ETIQUETA[k]}</div>`).join('');
  if (mostrarEntr()) {
    html += S.entrenadores.map(e => `<div class="leg-item"><i class="tc" style="background:${e.color}"></i>${esc(e.nombre)}</div>`).join('');
  }
  if (S.cal.modo === 'semana') html += '<div class="leg-item leg-ayuda">↕ Arrastra un bloque para cambiar su hora (tramos de 30 min)</div>';
  return `<div class="legend">${html}</div>`;
}

export function renderCalendario(el) {
  const scrollPrevio = el.querySelector('.wk')?.scrollTop || 0;   // no perder la posición al repintar
  el.innerHTML = `
    <div class="cal-bar">
      <div class="cal-nav">
        <button class="cal-btn" data-acc="cal-prev" aria-label="Anterior">◀</button>
        <div class="cal-month-lbl">${titulo()}</div>
        <button class="cal-btn" data-acc="cal-next" aria-label="Siguiente">▶</button>
        <button class="btn btn-secondary btn-sm" data-acc="cal-hoy">Hoy</button>
      </div>
      <div class="cal-bar-der">
        <div class="seg seg-sm">
          <button class="${S.cal.modo === 'semana' ? 'on' : ''}" data-acc="cal-modo" data-v="semana">Semana</button>
          <button class="${S.cal.modo === 'mes' ? 'on' : ''}" data-acc="cal-modo" data-v="mes">Mes</button>
        </div>
        <button class="btn btn-primary btn-sm" data-acc="ses-nueva">+ Sesión</button>
      </div>
    </div>
    ${leyenda()}
    ${S.cal.modo === 'semana' ? semanaHTML() : mesHTML()}`;
  const wk = el.querySelector('.wk');
  if (wk) wk.scrollTop = scrollPrevio;
}

function mover(n) {
  const { modo, fecha } = S.cal;
  S.cal.fecha = modo === 'semana' ? addDias(fecha, 7 * n) : primerDiaMes(fecha, n);
  return cargarCalendario();
}

// ── Arrastrar bloques en la vista semanal ─────────────────────────────────
// Se puede mover a otra hora (tramos de 30 min) y también a otro día de la misma semana.
// Solo con ratón/lápiz: en pantalla táctil sigue valiendo abrir la sesión y cambiar la hora.
const PASO_MIN = 30;
let arrastre = null;
let ignorarClic = false;      // tras arrastrar, el navegador lanza un "clic" que no debe abrir nada

function destinoArrastre(e) {
  const a = arrastre;
  const cols = [...a.wk.querySelectorAll('.wk-col')];
  const col = cols.find(c => { const r = c.getBoundingClientRect(); return e.clientX >= r.left && e.clientX < r.right; })
    || cols.reduce((mejor, c) => {
      const r = c.getBoundingClientRect();
      const d = Math.min(Math.abs(e.clientX - r.left), Math.abs(e.clientX - r.right));
      return !mejor || d < mejor.d ? { c, d } : mejor;
    }, null).c;
  const y = e.clientY - col.getBoundingClientRect().top - a.agarreY;
  const crudo = a.h0 * 60 + (y / HPX) * 60;
  const min = Math.min(Math.max(Math.round(crudo / PASO_MIN) * PASO_MIN, a.h0 * 60), a.h1 * 60 - a.duracion);
  return { col, fecha: col.dataset.fecha, min };
}

function pintarFantasma(e) {
  const a = arrastre;
  const d = destinoArrastre(e);
  a.destino = d;
  a.fantasma.style.top = `${(d.min - a.h0 * 60) / 60 * HPX}px`;
  a.fantasma.querySelector('.blk-h').textContent = `${minAHora(d.min)}–${minAHora(d.min + a.duracion)}`;
  if (a.fantasma.parentElement !== d.col) d.col.appendChild(a.fantasma);
}

function cancelarArrastre() {
  if (!arrastre) return;
  arrastre.fantasma?.remove();
  arrastre.bloque.classList.remove('arrastrando');
  document.body.classList.remove('arrastrando-sesion');
  arrastre = null;
}

async function moverSesion(s, fecha, hora) {
  const existentes = await S.api.sesionesEntre(fecha, fecha, s.clientes.entrenador_id);
  const conflictos = buscarConflictos({ fecha, hora, duracion_min: s.duracion_min }, existentes, s.id);
  if (conflictos.length) {
    const lista = conflictos.map(x => `<li><b>${esc(x.hora)}</b> · ${esc(nombreCompleto(x.clientes))}</li>`).join('');
    const ok = await dialogo({
      titulo: '⚠ Solape de horario',
      mensaje: `<p>${esc(entrenadorDe(s.clientes.entrenador_id)?.nombre || 'El entrenador')} ya tiene sesión a esa hora:</p><ul class="dlg-lista">${lista}</ul><p>¿Mover igualmente?</p>`,
      ok: 'Mover igualmente',
    });
    if (!ok) return;
  }
  const cambios = { fecha, hora };
  if (s.nota === 'Hora no registrada') cambios.nota = null;   // ya se conoce la hora
  const previo = { fecha: s.fecha, hora: s.hora, nota: s.nota };
  Object.assign(s, cambios);              // se ve al instante; si falla, se deshace
  bus.repintar();
  try {
    await S.api.actualizarSesion(s.id, cambios);
  } catch (err) {
    Object.assign(s, previo);
    bus.repintar();
    throw err;
  }
  await bus.recargar();
  toast(`${nombreCompleto(s.clientes)} → ${fmtFechaDia(fecha)} · ${hora}`);
}

export function iniciarArrastre() {
  document.addEventListener('pointerdown', e => {
    const bloque = e.target.closest?.('.wk .blk');
    if (!bloque || e.button !== 0 || e.pointerType === 'touch' || arrastre) return;
    const s = S.cal.sesiones.find(x => x.id === bloque.dataset.id);
    const wk = bloque.closest('.wk');
    if (!s || !wk) return;
    e.preventDefault();                    // evita seleccionar texto al arrastrar
    try { bloque.setPointerCapture(e.pointerId); } catch { /* sin captura también funciona */ }
    arrastre = {
      s, bloque, wk, pointerId: e.pointerId, activo: false, destino: null, fantasma: null,
      x0: e.clientX, y0: e.clientY,
      agarreY: e.clientY - bloque.getBoundingClientRect().top,
      h0: Number(wk.dataset.h0), h1: Number(wk.dataset.h1),
      duracion: s.duracion_min || DURACION_SESION_MIN,
    };
  });

  document.addEventListener('pointermove', e => {
    const a = arrastre;
    if (!a || e.pointerId !== a.pointerId) return;
    if (!document.body.contains(a.bloque)) { cancelarArrastre(); return; }   // se repintó la vista
    if (!a.activo) {
      if (Math.hypot(e.clientX - a.x0, e.clientY - a.y0) < 5) return;        // todavía es un clic
      a.activo = true;
      a.bloque.classList.add('arrastrando');
      document.body.classList.add('arrastrando-sesion');
      a.fantasma = a.bloque.cloneNode(true);
      a.fantasma.classList.remove('arrastrando');
      a.fantasma.classList.add('blk-ghost');
      a.fantasma.removeAttribute('data-acc'); a.fantasma.removeAttribute('title');
      a.fantasma.style.height = a.bloque.style.height;
    }
    // desplazamiento automático al acercarse a los bordes de la vista
    const r = a.wk.getBoundingClientRect();
    if (e.clientY > r.bottom - 36) a.wk.scrollTop += 14; else if (e.clientY < r.top + 70) a.wk.scrollTop -= 14;
    pintarFantasma(e);
  });

  document.addEventListener('pointerup', e => {
    const a = arrastre;
    if (!a || e.pointerId !== a.pointerId) return;
    const eraArrastre = a.activo;
    if (eraArrastre) pintarFantasma(e);
    const { s, destino } = a;
    const r = a.wk.getBoundingClientRect();
    const fuera = e.clientX < r.left - 10 || e.clientX > r.right + 10 || e.clientY < r.top - 10 || e.clientY > r.bottom + 10;
    cancelarArrastre();
    if (!eraArrastre) return;              // fue un clic normal: lo gestiona la acción 'ses-abrir'
    ignorarClic = true;
    setTimeout(() => { ignorarClic = false; }, 0);
    if (fuera) return;                     // soltado fuera del calendario: se cancela, no se mueve nada
    const hora = minAHora(destino.min);
    if (destino.fecha === s.fecha && hora === s.hora) return;               // volvió a su sitio
    moverSesion(s, destino.fecha, hora).catch(err => toast(err.message || 'No se pudo mover la sesión', true));
  });

  document.addEventListener('pointercancel', () => cancelarArrastre());
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && arrastre?.activo) cancelarArrastre(); });
}

export const accionesCalendario = {
  'cal-prev': () => mover(-1),
  'cal-next': () => mover(1),
  'cal-hoy': () => { S.cal.fecha = hoyISO(); return cargarCalendario(); },
  'cal-modo': t => { S.cal.modo = t.dataset.v; return cargarCalendario(); },
  'ses-nueva': () => modalSesion({ fecha: hoyISO() }),
  'ses-abrir': t => {
    if (ignorarClic) return;
    const s = S.cal.sesiones.find(x => x.id === t.dataset.id);
    if (s) modalSesion({ sesion: s });
  },
  'dia-nuevo': t => modalSesion({ fecha: t.dataset.fecha }),
  'dia-semana': t => { S.cal.fecha = t.dataset.fecha; S.cal.modo = 'semana'; return cargarCalendario(); },
  // Clic en un hueco de la columna de un día: hora según la posición (tramos de 30 min)
  'col-nuevo': (t, e) => {
    if (ignorarClic) return;
    const y = e.clientY - t.getBoundingClientRect().top;
    const min = Number(t.dataset.h0) * 60 + Math.floor(y / HPX * 2) * 30;
    modalSesion({ fecha: t.dataset.fecha, hora: minAHora(Math.max(0, min)) });
  },
};
