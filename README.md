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
js/vista-*.js         calendario · clientes · resumen (admin)
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
