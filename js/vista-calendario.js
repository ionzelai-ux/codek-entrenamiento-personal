// Calendario: vista de semana (columnas por día con horas) o de mes (cuadrícula).
import { S, bus, esAdmin, entrenadorDe, nombreCompleto, entrenadorFiltroId } from './store.js';
import { esc, nombreMes, mesCorto } from './util.js';
import {
  hoyISO, addDias, lunesDe, primerDiaMes, ultimoDiaMes, parseISO, horaAMin, minAHora,
  estadoEfectivo, repartirCarriles,
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

  return `<div class="wk" style="--hpx:${HPX}px">
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

export const accionesCalendario = {
  'cal-prev': () => mover(-1),
  'cal-next': () => mover(1),
  'cal-hoy': () => { S.cal.fecha = hoyISO(); return cargarCalendario(); },
  'cal-modo': t => { S.cal.modo = t.dataset.v; return cargarCalendario(); },
  'ses-nueva': () => modalSesion({ fecha: hoyISO() }),
  'ses-abrir': t => {
    const s = S.cal.sesiones.find(x => x.id === t.dataset.id);
    if (s) modalSesion({ sesion: s });
  },
  'dia-nuevo': t => modalSesion({ fecha: t.dataset.fecha }),
  'dia-semana': t => { S.cal.fecha = t.dataset.fecha; S.cal.modo = 'semana'; return cargarCalendario(); },
  // Clic en un hueco de la columna de un día: hora según la posición (tramos de 30 min)
  'col-nuevo': (t, e) => {
    const y = e.clientY - t.getBoundingClientRect().top;
    const min = Number(t.dataset.h0) * 60 + Math.floor(y / HPX * 2) * 30;
    modalSesion({ fecha: t.dataset.fecha, hora: minAHora(Math.max(0, min)) });
  },
};
