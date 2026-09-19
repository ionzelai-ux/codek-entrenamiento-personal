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
6. **Authentication → Sign In / Providers**: desactiva *Allow new users to sign up* (nadie más debe poder registrarse).
7. **Project Settings → API**: copia la **anon / publishable key** en `js/config.js` (`SUPABASE_ANON_KEY`). Nunca pegues la `service_role`.

### 2. Publicar en GitHub Pages
Repo → Settings → Pages → *Deploy from a branch* → `main` / `/ (root)`. La URL queda como
`https://<usuario>.github.io/<repo>/`.

### 3. Entrar
Usuario a secas (`admin`, `eduardo`, `jesus`) y la contraseña elegida. Para añadir otro entrenador: crear su usuario
en Authentication (`<usuario>@codek-ep.app`) y añadir su bloque `insert` en un script como `02_usuarios.sql`.

## Modo demo
Abre `index.html?demo` desde un servidor estático (`python -m http.server`): datos ficticios en memoria, usuarios
`admin` / `eduardo` / `jesus`, contraseña `demo`. No toca Supabase.

## Reglas de negocio
- **Créditos** = sesiones de todos los bonos − sesiones hechas. Una reserva cuya hora ya pasó sin confirmar cuenta como
  hecha (*auto*). «No vino» no consume.
- **Tarifas estándar** (solo sugerencia, siempre editables): 4 → 45 €/ses · 8 → 42 · 12 → 40 · 16 → 38 · 40 → 37.
- **Pago**: cada bono tiene fecha de pago; si es futura figura como «pago programado» hasta que llega el día.
- **Solapes**: al crear una sesión o generar las de los días fijos se avisa si ese entrenador ya tiene a alguien a esa hora.
- **Origen**: *Codek* = captado por la empresa · *Externo* = lo trae el entrenador.
