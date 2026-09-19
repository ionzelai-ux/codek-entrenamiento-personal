// Arranque: login, navegación entre vistas y despacho de acciones (data-acc).
import { SUPABASE_ANON_KEY } from './config.js';
import { S, bus, esAdmin, clienteDe } from './store.js';
import { esc, toast } from './util.js';
import { renderCalendario, cargarCalendario, accionesCalendario } from './vista-calendario.js';
import { renderClientes, alBuscar, accionesClientes } from './vista-clientes.js';
import { renderResumen, accionesResumen } from './vista-resumen.js';

const DEMO = new URLSearchParams(location.search).has('demo');
const $ = id => document.getElementById(id);
const vistaEl = $('vista');

const VISTAS = { calendario: renderCalendario, clientes: renderClientes, resumen: renderResumen };
const pintar = () => VISTAS[S.vista](vistaEl);

bus.repintar = pintar;
bus.recargar = async () => {
  S.clientes = await S.api.listarClientes();
  if (S.vista === 'calendario') await cargarCalendario(); else pintar();
};

// ── Cabecera ──────────────────────────────────────────────────────────────
function pintarCabecera() {
  const admin = esAdmin();
  const tabs = [['calendario', 'Calendario'], ['clientes', 'Clientes'], ...(admin ? [['resumen', 'Resumen']] : [])];
  $('nav').innerHTML = tabs.map(([v, l]) =>
    `<button class="nav-tab ${S.vista === v ? 'active' : ''}" data-acc="vista" data-v="${v}">${l}</button>`).join('');
  const selector = admin && S.vista !== 'resumen'
    ? `<select id="selEntr" class="form-input sel-entr" aria-label="Entrenador">
         <option value="todos">Todos los entrenadores</option>
         ${S.entrenadores.map(e => `<option value="${e.id}" ${S.filtroEntr === e.id ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}
       </select>` : '';
  $('cabecera-der').innerHTML = `${selector}
    <span class="user-chip"><i class="tc" style="background:${esc(S.perfil.color)}"></i>${esc(S.perfil.nombre)}${admin ? ' · ADMIN' : ''}</span>
    <button class="btn btn-secondary btn-sm" data-acc="salir">Salir</button>`;
}

const GLOBALES = {
  vista: t => {
    if (t.dataset.v === 'resumen' && !esAdmin()) return;
    S.vista = t.dataset.v;
    pintarCabecera();
    return S.vista === 'calendario' ? cargarCalendario() : pintar();
  },
  salir: async () => {
    await S.api.cerrarSesion();
    Object.assign(S, { perfil: null, clientes: [], entrenadores: [], cliSel: null, filtroEntr: 'todos' });
    vistaEl.innerHTML = '';
    mostrarLogin();
  },
};
const ACCIONES = { ...GLOBALES, ...accionesCalendario, ...accionesClientes, ...accionesResumen };

document.addEventListener('click', async e => {
  const t = e.target.closest('[data-acc]');
  if (!t || t.tagName === 'SELECT') return;
  const fn = ACCIONES[t.dataset.acc];
  if (!fn) return;
  try { await fn(t, e); } catch (err) { toast(err.message || 'Error inesperado', true); }
});
document.addEventListener('input', e => { if (e.target.matches('[data-filtro-texto]')) alBuscar(e.target.value); });
document.addEventListener('change', async e => {
  if (e.target.id !== 'selEntr') return;
  S.filtroEntr = e.target.value;
  if (S.cliSel && S.filtroEntr !== 'todos' && clienteDe(S.cliSel)?.entrenador_id !== S.filtroEntr) S.cliSel = null;
  try { await (S.vista === 'calendario' ? cargarCalendario() : pintar()); } catch (err) { toast(err.message, true); }
});
window.addEventListener('unhandledrejection', e => { toast(e.reason?.message || 'Error inesperado', true); });

// ── Login ─────────────────────────────────────────────────────────────────
function mostrarLogin(msg = '') {
  $('app').hidden = true;
  $('login').hidden = false;
  $('login-error').textContent = msg;
  $('login-error').hidden = !msg;
}
async function entrar() {
  $('login').hidden = true;
  $('app').hidden = false;
  S.entrenadores = await S.api.listarEntrenadores();
  S.clientes = await S.api.listarClientes();
  Object.assign(S, { vista: 'calendario', filtroEntr: 'todos', cliSel: null });
  pintarCabecera();
  await cargarCalendario();
}

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  btn.disabled = true;
  mostrarLogin('');
  try {
    S.perfil = await S.api.iniciarSesion(e.target.usuario.value, e.target.clave.value);
    e.target.clave.value = '';
    await entrar();
  } catch (err) {
    mostrarLogin(err.message);
  } finally {
    btn.disabled = false;
  }
});

async function arrancar() {
  $('demo-banner').hidden = !DEMO;
  $('login-demo').hidden = !DEMO;
  if (!DEMO && (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.startsWith('PEGA'))) {
    mostrarLogin('Falta configurar la anon key de Supabase en js/config.js');
    $('login-form').querySelectorAll('input,button').forEach(x => { x.disabled = true; });
    return;
  }
  try {
    S.api = await import(DEMO ? './api-mock.js' : './api.js');
    S.perfil = await S.api.perfilActual();
  } catch (err) {
    mostrarLogin(err.message);
    return;
  }
  if (!S.perfil) return mostrarLogin();
  try { await entrar(); } catch (err) { mostrarLogin(err.message); }
}
arrancar();
