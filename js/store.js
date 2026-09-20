// Estado compartido de la app y "bus" para que las vistas pidan repintar/recargar
// sin importarse unas a otras (evita dependencias circulares).
import { hoyISO } from './logica.js';

export const S = {
  api: null,
  perfil: null,
  entrenadores: [],
  clientes: [],
  vista: 'calendario',          // calendario | clientes | resumen
  filtroEntr: 'todos',          // 'todos' o id de entrenador (solo admin lo cambia)
  cliSel: null,                 // id del cliente abierto en la ficha
  cal: { modo: 'semana', fecha: hoyISO(), sesiones: [] },
  cli: { estado: 'todos', origen: 'todos', texto: '', archivados: false, pendientes: false },
  resumenMes: hoyISO().slice(0, 7),
  ah: {                          // panel de AimHarder (solo admin)
    fecha: hoyISO(), estado: null, dia: null, error: '', cargando: false,
    pfecha: '2026-09-21', phora: '11:00', pruebas: null, pruebasCargadas: false, prueba: null, diag: null,
  },
};

export const bus = {
  repintar: () => {},           // vuelve a dibujar la vista actual con lo que hay en memoria
  recargar: async () => {},     // vuelve a pedir datos y repinta
};

export const esAdmin = () => S.perfil?.rol === 'admin';
export const entrenadorDe = id => S.entrenadores.find(e => e.id === id) || (S.perfil?.id === id ? S.perfil : null);
export const nombreCompleto = c => `${c.nombre} ${c.apellidos || ''}`.trim();
export const clienteDe = id => S.clientes.find(c => c.id === id);

// Entrenador cuyo calendario/clientes se está viendo (null = todos los que puedo ver).
export function entrenadorFiltroId() {
  if (!esAdmin()) return S.perfil.id;
  return S.filtroEntr === 'todos' ? null : S.filtroEntr;
}
