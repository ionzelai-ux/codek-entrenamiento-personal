// Modo demo (abre la app con ?demo): mismos métodos que api.js pero en memoria,
// con datos ficticios y sin tocar Supabase. Usuarios: admin / eduardo / jesus · clave: demo
import { hoyISO, addDias, lunesDe, nombreUsuario } from './logica.js';

let seq = 1;
const nuevoId = () => 'demo-' + seq++;
const clonar = x => JSON.parse(JSON.stringify(x));

const perfiles = [
  { id: 'p-admin', usuario: 'admin', nombre: 'Jon', rol: 'admin', color: '#8B2020' },
  { id: 'p-edu', usuario: 'eduardo', nombre: 'Eduardo', rol: 'entrenador', color: '#4a9fd4' },
  { id: 'p-jes', usuario: 'jesus', nombre: 'Jesús', rol: 'entrenador', color: '#d4903a' },
];
const clientes = [], bonos = [], sesiones = [];
let actual = null;

function cliente(datos) {
  const c = { id: nuevoId(), apellidos: '', telefono: '', email: '', fecha_nacimiento: null, notas: '', activo: true,
    pot_sesiones_bono: null, pot_veces_semana: null, pot_precio: null, dias_fijos: [], ...datos };
  clientes.push(c);
  return c;
}
function bono(c, sesionesN, precio, pago, inicio, metodo_pago = 'tarjeta') {
  bonos.push({ id: nuevoId(), cliente_id: c.id, sesiones: sesionesN, precio, fecha_pago: pago, fecha_inicio: inicio, metodo_pago });
}
function sesion(c, fecha, hora, estado = 'reservada') {
  sesiones.push({ id: nuevoId(), cliente_id: c.id, bono_id: null, fecha, hora, duracion_min: 60, estado, nota: '' });
}

(function sembrar() {
  const hoy = hoyISO(), lun = lunesDe(hoy);
  const ana = cliente({ entrenador_id: 'p-edu', nombre: 'Ana', apellidos: 'Demo Ruiz', estado: 'efectivo', origen: 'codek',
    fecha_nacimiento: '1988-04-12', telefono: '600 000 001', dias_fijos: [{ dia: 1, hora: '10:00' }, { dia: 3, hora: '10:00' }] });
  bono(ana, 8, 336, addDias(lun, -10), addDias(lun, -10));
  [-7, -5].forEach(n => sesion(ana, addDias(lun, n), '10:00', 'hecha'));
  [0, 2, 7].forEach(n => sesion(ana, addDias(lun, n), '10:00'));
  const luis = cliente({ entrenador_id: 'p-edu', nombre: 'Luis', apellidos: 'Ejemplo Gil', estado: 'efectivo', origen: 'externo', telefono: '600 000 002' });
  bono(luis, 12, 480, addDias(hoy, 12), addDias(hoy, 12), 'transferencia');
  sesion(luis, addDias(lun, 0), '18:00');
  sesion(luis, addDias(lun, 3), '17:30');
  cliente({ entrenador_id: 'p-edu', nombre: 'Marta', apellidos: 'Prueba', estado: 'potencial', origen: 'codek', pot_sesiones_bono: 8, pot_veces_semana: 2, pot_precio: 336, email: 'marta@ejemplo.com' });
  const pablo = cliente({ entrenador_id: 'p-jes', nombre: 'Pablo', apellidos: 'Demo Sanz', estado: 'efectivo', origen: 'externo', dias_fijos: [{ dia: 1, hora: '10:00' }, { dia: 4, hora: '19:00' }] });
  bono(pablo, 16, 608, addDias(lun, -3), addDias(lun, -3), 'efectivo');
  sesion(pablo, addDias(lun, 0), '10:00');
  sesion(pablo, addDias(lun, 3), '19:00');
  cliente({ entrenador_id: 'p-jes', nombre: 'Lucía', apellidos: 'Ejemplo', estado: 'potencial', origen: 'externo', pot_sesiones_bono: 12, pot_veces_semana: 3, pot_precio: 480 });
})();

const visibles = () => (actual.rol === 'admin' ? clientes : clientes.filter(c => c.entrenador_id === actual.id));
const idsVisibles = () => new Set(visibles().map(c => c.id));

export async function iniciarSesion(usuario, clave) {
  const p = perfiles.find(x => x.usuario === nombreUsuario(usuario));
  if (!p || clave !== 'demo') throw new Error('Usuario o contraseña incorrectos (demo: admin / eduardo / jesus · clave demo)');
  actual = p;
  sessionStorage.setItem('demo_user', p.id);
  return clonar(p);
}
export async function perfilActual() {
  const id = sessionStorage.getItem('demo_user');
  actual = perfiles.find(p => p.id === id) || null;
  return actual ? clonar(actual) : null;
}
export async function cerrarSesion() { actual = null; sessionStorage.removeItem('demo_user'); }

// Simulación de la función de AimHarder (modo demo): un día tipo con clases y racks de 4 plazas.
const pruebasDemo = [];
let seqPrueba = 9000;
export async function consultarAimHarder(cuerpo) {
  if (cuerpo.accion === 'prueba_listar') return { ok: true, pruebas: pruebasDemo.map(p => ({ ...p })) };
  if (cuerpo.accion === 'prueba_reservar') {
    if (pruebasDemo.filter(p => !p.cancelada).length >= 4) {   // simula el aforo (4) del Rack libre
      return { ok: false, http: 422, error: 'The class is full (demo).', aforo: 4 };
    }
    const p = { booking_id: ++seqPrueba, fecha: cuerpo.fecha, hora: cuerpo.hora, schedule_id: 600, cancelada: null };
    pruebasDemo.push(p);
    return { ok: true, booking_id: p.booking_id, mensaje: `Reserva de prueba creada (nº ${p.booking_id}) en «Rack libre» ${cuerpo.hora} del ${cuerpo.fecha} (demo).` };
  }
  if (cuerpo.accion === 'prueba_cancelar') {
    const activas = pruebasDemo.filter(p => !p.cancelada);
    activas.forEach(p => { p.cancelada = 'hoy'; });
    return { ok: true, canceladas: activas.length, resultados: [], mensaje: `${activas.length} reserva(s) de prueba cancelada(s) (demo).` };
  }
  if (cuerpo.accion === 'estado') {
    return { ok: true, http: 200, mensaje: 'Conexión correcta con AimHarder (demo)', caducidad: { access: '2026-12-31 10:00:00', refresh: '2027-03-31 10:00:00' } };
  }
  const horas = ['08:00', '09:00', '10:00', '11:00', '12:00', '17:00', '18:00', '19:00'];
  const clases = [
    { schedule_id: 501, hora: '10:00', nombre: 'Entrenamiento Funcional + Calistenia', duracion: '01:00', aforo: 12, sala: 'Sala principal', aforo_sala: 12, class_id: 1, cancelada: 0, es_rack: false },
    ...horas.map((h, i) => ({ schedule_id: 600 + i, hora: h, nombre: 'Rack libre', duracion: '01:00', aforo: 4, sala: 'Racks', aforo_sala: 4, class_id: 2, cancelada: 0, es_rack: true })),
  ].sort((a, b) => a.hora.localeCompare(b.hora));
  return { ok: true, fecha: cuerpo.fecha, clases, resumen: { total: clases.length, rack: horas.length } };
}

export async function listarEntrenadores() {
  const todos = perfiles.filter(p => p.rol === 'entrenador');
  return clonar(actual.rol === 'admin' ? todos : todos.filter(p => p.id === actual.id));
}
export async function listarClientes() {
  return clonar(visibles().map(c => ({
    ...c,
    bonos: bonos.filter(b => b.cliente_id === c.id),
    sesiones: sesiones.filter(s => s.cliente_id === c.id),
  })));
}
export async function guardarCliente(c) {
  const { id, bonos: _b, sesiones: _s, ...campos } = c;
  if (id) {
    const ex = clientes.find(x => x.id === id);
    if (!ex || !idsVisibles().has(id)) throw new Error('Cliente no encontrado');
    Object.assign(ex, campos);
    return clonar(ex);
  }
  if (actual.rol !== 'admin' && campos.entrenador_id !== actual.id) throw new Error('No puedes crear clientes para otro entrenador');
  return clonar(cliente(campos));
}
export async function eliminarCliente(id) {
  if (actual.rol !== 'admin') throw new Error('Solo el administrador puede eliminar');
  for (const arr of [bonos, sesiones]) for (let i = arr.length - 1; i >= 0; i--) if (arr[i].cliente_id === id) arr.splice(i, 1);
  clientes.splice(clientes.findIndex(c => c.id === id), 1);
}
export async function crearBono(b) { const n = { id: nuevoId(), ...b }; bonos.push(n); return clonar(n); }
export async function actualizarBono(id, cambios) {
  const b = bonos.find(x => x.id === id);
  if (!b || !idsVisibles().has(b.cliente_id)) throw new Error('Bono no encontrado');
  Object.assign(b, cambios);
  return clonar(b);
}
export async function eliminarBono(id) { bonos.splice(bonos.findIndex(b => b.id === id), 1); }

export async function sesionesEntre(desde, hasta, entrenadorId = null) {
  const ids = idsVisibles();
  return clonar(sesiones
    .filter(s => ids.has(s.cliente_id) && s.fecha >= desde && s.fecha <= hasta)
    .map(s => ({ s, c: clientes.find(c => c.id === s.cliente_id) }))
    .filter(({ c }) => !entrenadorId || c.entrenador_id === entrenadorId)
    .map(({ s, c }) => ({ ...s, clientes: { id: c.id, nombre: c.nombre, apellidos: c.apellidos, entrenador_id: c.entrenador_id } }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.hora.localeCompare(b.hora)));
}
export async function crearSesiones(filas) {
  const ids = idsVisibles();
  return clonar(filas.map(f => {
    if (!ids.has(f.cliente_id)) throw new Error('Cliente no accesible');
    const n = { id: nuevoId(), bono_id: null, nota: '', duracion_min: 60, estado: 'reservada', ...f };
    sesiones.push(n);
    return n;
  }));
}
export async function actualizarSesion(id, cambios) {
  const s = sesiones.find(x => x.id === id);
  Object.assign(s, cambios);
  return clonar(s);
}
export async function eliminarSesion(id) { sesiones.splice(sesiones.findIndex(s => s.id === id), 1); }
