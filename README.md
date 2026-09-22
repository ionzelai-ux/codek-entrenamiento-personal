# CODEK · Entrenamiento Personal

Aplicación web para gestionar el entrenamiento personal del gimnasio: fichas de clientes (potenciales y efectivos),
bonos, calendario semanal/mensual y resumen de facturación. Cada entrenador entra con su usuario y solo ve sus clientes;
el administrador lo ve todo.

Sin build: HTML + JS (módulos ES) + Supabase. Se publica tal cual en GitHub Pages.

## Estructura

```
index.html            estructura
css/styles.css        estilos
js/config.js          URL/anon key de Supabase, tarifas estándar, horarios
js/logica.js          lógica pura (créditos, tarifas, solapes, días fijos…) — con tests
js/api.js             acceso a Supabase (login, clientes, bonos, sesiones)
js/api-mock.js        modo demo en memoria (?demo)
js/app.js             arranque, login, navegación
js/vista-*.js         calendario · clientes · resumen · comisiones (admin)
js/modales.js         formularios: sesión, ficha, bono, convertir, generar sesiones
sql/                  scripts para Supabase (ejecutar en orden)
tests/                node --test tests/*.test.js
```

## Puesta en marcha

### 1. Supabase (proyecto «PROGRESO CODEK»)
1. **Table Editor**: comprueba que no hay nada que quieras conservar.
2. **SQL Editor** → pega y ejecuta `sql/00_limpiar_proyecto.sql` (⚠ borra todo el esquema `public`; solo si el proyecto es reutilizable).
3. Ejecuta `sql/01_esquema.sql` (tablas + seguridad RLS).
4. **Authentication → Users → Add user → Create new user** (marca *Auto Confirm User*), con la contraseña que elijas:
   `admin@codek-ep.app` · `eduardo@codek-ep.app` · `jesus@codek-ep.app`
   Si había usuarios antiguos, elimínalos.
5. Ejecuta `sql/02_usuarios.sql` (debe devolver 3 filas).
   (`sql/03_metodo_pago.sql` solo hace falta si ejecutaste el 01 antes de que existiera el método de pago.)
6. **Authentication → Sign In / Providers**: desactiva *Allow new users to sign up* (nadie más debe poder registrarse).
7. **Project Settings → API**: copia la **anon / publishable key** en `js/config.js` (`SUPABASE_ANON_KEY`). Nunca pegues la `service_role`.

### 2. Publicar en GitHub Pages
Repo → Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`. La URL queda como
`https://<usuario>.github.io/<repo>/`.

### 3. Entrar
Usuario a secas (`admin`, `eduardo`, `jesus`) y la contraseña elegida. Para añadir otro entrenador: crear su usuario
en Authentication (`<usuario>@codek-ep.app`) y añadir su bloque `insert` en un script como `02_usuarios.sql`.

## Integración con AimHarder (racks del entrenamiento personal)
Objetivo: cada sesión de entrenamiento personal ocupa un hueco del «Rack libre» en AimHarder (reserva como *invitado*,
p. ej. «PT Eduardo»). API oficial: https://aimharder.com/api_doc/aimharder/index.html

**Fase 1 (solo lectura)** — pestaña «AimHarder» (solo administrador): comprueba la conexión y lista las clases de un día.
1. Secretos en Supabase (Edge Functions → Secrets): `AIMHARDER_ACCESS_TOKEN` y `AIMHARDER_REFRESH_TOKEN`.
2. `sql/04_aimharder_tokens.sql` (tabla privada donde la función guarda los tokens renovados).
3. Desplegar `supabase/functions/aimharder-probe/index.ts` con el nombre `aimharder-probe` (Verify JWT activado).

**Fase 2 (prueba de escritura)** — misma pestaña, sección «Prueba de reservas»: crea plazas de invitado «PRUEBA PT» en el
«Rack libre» de un día/hora y las cancela, para comprobar si AimHarder las cuenta como ocupadas y si respeta el aforo.
Necesita `sql/05_aimharder_pruebas.sql` (apunta cada reserva creada: la función solo puede cancelar esas, máx. 6 activas,
mínimo 3 h de margen antes de la clase).

**Ocupación del rack (solo lectura)**: la API no informa de las plazas ocupadas y los invitados pueden superar el aforo
(comprobado: 5/4, todas `confirmed`; y se pueden reservar invitados a 15+ días vista). Por eso la ocupación se **calcula**:
reservas confirmadas de todos los socios en esa clase/día/hora (`clients` + `clients/:id/booking-history?id_from=…`, acotado
por número de reserva) + invitados (los propios y, si la lista lo permite, los de otros). Solo devuelve recuentos y números
de reserva (nunca nombres/emails/teléfonos). Sirve para avisar cuando una sesión de última hora no tiene rack libre.

**Límite de uso de AimHarder y freno de seguridad** (`sql/06_aimharder_uso.sql`): la API responde 429 «Too many requests» si se
supera su cupo (en la primera prueba real aceptó ≈100 peticiones y rechazó el resto, y seguía rechazando una hora después).
La función apunta cuántas peticiones hace (tope propio: 90 por hora) y, tras un 429 serio, **no vuelve a llamar** durante un
rato (insistir alarga el bloqueo); el administrador puede quitar el freno desde la pantalla. El ritmo es de 1 petición por
segundo. Hay que preguntar a AimHarder el límite exacto y ajustar `LIMITE_HORA`.

Notas de la API: el calendario (`GET calendar/AAAA-MM-DD`) devuelve `{ data: [...] }` con `schedule_id`, hora, nombre y aforo,
pero **no las plazas ocupadas**. Reservar: `POST classes/booking/guest` (`schedule_id` + `booking_date`) → devuelve el id de
reserva; cancelar: `POST classes/booking/cancel` (`booking_id`; no admite cancelar con menos de 1 h).

Seguridad: los tokens nunca van en el código ni llegan al navegador; la función solo responde al administrador con
sesión iniciada (la anon key pública recibe 403). AimHarder entrega una pareja nueva de tokens en cada renovación y la
anterior deja de valer; si se pulsa «Refrescar tokens» en AimHarder hay que actualizar los secretos y vaciar la tabla.

## Modo demo
Abre `index.html?demo` desde un servidor estático (`python -m http.server`): datos ficticios en memoria, usuarios
`admin` / `eduardo` / `jesus`, contraseña `demo`. No toca Supabase.

## Reglas de negocio
- **Créditos** = sesiones de todos los bonos − sesiones hechas. Una reserva cuya hora ya pasó sin confirmar cuenta como
  hecha (*auto*). «No vino» no consume.
- **Tarifas estándar** (solo sugerencia, siempre editables): 4 → 45 €/ses · 8 → 42 · 12 → 40 · 16 → 38 · 40 → 37.
- **Pago**: cada bono tiene fecha de pago; si es futura figura como «pago programado» hasta que llega el día.
  También guarda el **método de pago** (efectivo, tarjeta o transferencia), obligatorio al crear un bono.
- **Mover sesiones**: en la vista semanal se arrastra un bloque a otra hora (tramos de 30 min) o a otro día de la semana.
  Avisa si hay solape, se cancela con Esc o soltando fuera del calendario, y al fijar la hora se quita la nota
  «Hora no registrada». Solo con ratón; en pantalla táctil se cambia desde el formulario de la sesión.
- **Solapes**: al crear una sesión o generar las de los días fijos se avisa si ese entrenador ya tiene a alguien a esa hora.
- **Campos obligatorios** (sin ellos no se guarda, y se avisa de todos los que faltan a la vez): nombre, teléfono, tipo
  (potencial/cliente) y origen; en un potencial, sesiones e importe; en un cliente nuevo, todo el bono (sesiones, importe,
  fecha de pago, fecha de inicio y método de pago).
- **Info pendiente**: apellidos, email, fecha de nacimiento, veces por semana (potenciales) y bono o método de pago
  (clientes) no bloquean, pero la ficha se marca «Info pendiente» en la lista y en la ficha. Hay un filtro para verlas.
- **Origen**: *Codek* = captado por la empresa · *Externo* = lo trae el entrenador.
- **Estado de pago de un bono**: *pagado* solo si el administrador lo confirmó con «✓ Marcar pagado» (se guarda la
  fecha); si no, *pendiente de pago* cuando su fecha de pago es hoy o ya pasó, y *pago programado* cuando es futura.
  Solo el administrador puede confirmar o deshacer un pago — lo impone también la base de datos (`sql/07_pagos.sql`),
  no solo la pantalla. Al llegar el estado de pago de la lista de clientes, se ve sin entrar en cada ficha, con un
  filtro «Pago» y un aviso arriba con el total pendiente de cobro.
- **Renovar**: si el último bono de un cliente está pagado y le quedan 2 sesiones o menos (o se agotó) sin que haya
  un bono nuevo, se marca «RENOVAR» con el importe del último bono como referencia.
- **Resumen → Facturación prevista**: la fecha de pago de cada bono decide en qué mes cuenta; muestra el total de
  este mes y del siguiente, desglosado en pagado / pendiente de cobro / programado, con el detalle de cada bono.
- **Comisiones** (pestaña solo del administrador; `sql/08_comisiones.sql`): liquidación mensual de lo que se le paga
  a cada entrenador, sobre los bonos que el administrador confirmó como pagados ese mes. Por cada bono:
  importe del bono → si se trata como *declarado* (por defecto, tarjeta/transferencia; se puede forzar a mano) se
  divide entre 1 + IVA/100 → si a el entrenador se le paga en *nómina* (elegible por bono) se divide otra vez, sobre
  lo anterior, entre 1 + Seguridad Social/100 → sobre esa base se aplica el % de comisión según el origen del cliente
  (Codek o traído por el propio entrenador). Los cuatro porcentajes son editables y recalculan al momento, como una
  hoja de cálculo; el trato de cada bono y los porcentajes se guardan para la próxima vez. Un entrenador puede
  quedar fuera del sistema de comisiones (`perfiles.aplica_comisiones`, `sql/09_comisiones_entrenadores.sql`) sin que
  le afecte al resto de la app: solo desaparece de esta pestaña.
