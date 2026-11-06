[English: README.md](README.md)

# More agents: mod de Herdr App

Añade al menú + de Herdr App agentes que no vienen listos. Los eliges de un **catálogo de datos** (`mods/more-agents/catalog.js`) o añades uno propio con el formulario. Escribe en `~/.config/herdr-app/programs.json`:
- fusiona con lo que ya tienes;
- tras un guardado correcto guarda la versión anterior en `programs.json.more-agents.bak`; el backup es best-effort, así que un fallo se avisa sin bloquear la escritura;
- nunca pisa una entrada tuya que ya tenga `run`;
- si el archivo cambió entre medias lo relee y reintenta una vez; un segundo conflicto no escribe nada;
- si el comando de una entrada se desvió del catálogo (`cmd` en vez de `command-code`) o una clave propia es un typo a una edición, el diálogo propone la reparación y solo escribe si confirmas;
- la primera escritura guarda además el archivo tal como estaba antes de que el mod lo tocara en `programs.json.more-agents.orig.bak` (no se reemplaza nunca).

## Instalar

En Linux y macOS, Herdr App guarda su configuración en `~/.config/herdr-app`:

```sh
git clone https://github.com/Izzy2024/More-Agent-Mod.git
cd More-Agent-Mod
node scripts/install.mjs            # copia el mod a ~/.config/herdr-app/mods/more-agents
```

El instalador prepara la copia y la intercambia con un rename, así que una actualización nunca deja una carpeta a medias ni anidada (`mods/more-agents/more-agents`), y guarda la anterior como `more-agents.bak`. `--dry-run` enseña lo que haría y `--uninstall` quita el mod (ninguno toca `programs.json` ni `keys.json`). Actualizar es `git pull && node scripts/install.mjs`.

Ábrelo con `herdr-app do mod.open --name more-agents`, o, si quieres, asigna una tecla fusionando la entrada de `keys.json` (Alt+Shift+A) en `~/.config/herdr-app/keys.json`.

Hecho para funcionar en Linux, macOS y Windows (el mod le pide a Herdr su carpeta de configuración y usa `sh` en Linux/macOS y `where` en Windows para detectar los agentes instalados), pero de momento solo se ha probado en Linux.

Es un mod de Herdr App (se instala con el script de arriba) y no un plugin de `herdr plugin install`, que es otro sistema de extensiones para la CLI de Herdr.

```
RECIPE.md                    ficha para herdr.dev/mods
CONTRIBUTING.md              cómo añadir un agente por PR
preview.png                  captura real (herdr-app shot, Herdr 0.1.10, Linux)
keys.json                    opcional: alt-shift-a -> mod.open:more-agents
programs.snippet.json        alternativa sin mod (omp + Command Code a mano)
mods/more-agents/
  main.js                    diálogo
  catalog.js                 catálogo (solo datos)
  mod.json                   place none + overlay dialog
scripts/
  validate-catalog.mjs       valida el esquema del catálogo
  install.mjs                copia/actualiza/desinstala el mod en la carpeta de la app
  smoke-test.mjs             prueba la lógica de main.js con stubs (sin UI)
  smoke/                     stubs y *.test.mjs (un sandbox por archivo)
package.json                 npm run validate | test | check | install
.github/workflows/ci.yml     valida + smoke en Linux y macOS, node 22
```

## ¿Por qué no sale en el menú + algo que añadí?

El menú + de Herdr (mod `new-menu`) enseña todos los agentes **instalados**, es decir, cuyo `run[0]` está en el PATH. De los no instalados solo enseña los dos primeros del orden interno, que siempre son Claude Code y Codex. Ningún campo de `programs.json` cambia esto.

Por eso cada fila lleva un badge de tres estados — `installed`, `not found on this PATH` o `could not check` cuando la propia detección falló — y la pista de instalación si falta el comando. En cuanto el comando existe, el agente aparece; la caché de Herdr tarda hasta 60 s. El toast solo dice cuántos se añadieron y cuántos necesitan instalación; las pistas por agente se quedan en el diálogo.

Los mensajes llevan nivel (error, warning, success, info) y se pintan según él, un guardado en curso muestra "Saving…" y deshabilita los botones de guardar, y si `programs.json` no se puede leer o parsear el banner dice por qué y ofrece **Reload** (`load()` + `detect()`), en lugar de pedirte que reabras el diálogo.

El panel **Agents** es otra lista: solo muestra terminales que reportan OSC 7501. Los que reportan nativo (omp, OpenCode, Claude Code, Codex) no necesitan nada; para el resto, `bridges/` en este repo trae adaptadores opt-in (Cursor, Command Code, Empryo) que se fusionan en los hooks de ese agente con backup y `--uninstall`. Una fila del catálogo que lo necesita lleva `bridge` y el diálogo lo dice al añadirla. El mod nunca instala un puente por su cuenta.

Teclado: el foco empieza en el campo de clave del formulario propio. Tab y Shift+Tab van clave → nombre → comando → continue → Add → Add custom → los botones Remove/Remove continue de los agentes añadidos → Reload (solo si el archivo está roto) → Close, y no dan la vuelta. En el catálogo, ↑/↓ mueven entre agentes y Espacio/Enter los marcan; Espacio/Enter también conmutan continue y los botones. Los comandos se parten como un programa, no como un shell: comillas simples y dobles agrupan y solo `\"` y `\\` escapan, así que las rutas entre comillas sobreviven; una comilla sin cerrar es un error. El formulario propio no escribe `match` (Herdr lo deriva de `run[0]`), y se rechazan las claves `shell`, `program`, `agent` y cualquiera que acabe en `-continue`. Si el comando no está en el PATH, el diálogo pregunta antes de guardarlo: la entrada no sale en el menú + hasta que ese comando exista, así una errata no desaparece en silencio.

## Probar en local

1. `node scripts/install.mjs` (o copia `mods/more-agents/` a `~/.config/herdr-app/mods/more-agents/` a mano).
2. Valida con `herdr-app check ~/.config/herdr-app/mods/more-agents`.
3. Ábrelo desde la paleta de comandos: `mod.open` → `more-agents`. También puedes fusionar `keys.json` en el tuyo.
4. Revisa errores con `herdr-app status` y haz la captura para `preview.png` con `herdr-app shot`.

## Comprobaciones sin Herdr

```sh
node scripts/validate-catalog.mjs [--icons <herdr-app>/defaults/icons --builtin <herdr-app>/defaults/programs.json]
node scripts/smoke-test.mjs
```

Estado: `herdr-app check` pasa y el diálogo se probó de punta a punta (añadir, quitar, menú +, formulario personalizado) en Herdr App 0.1.10 en Linux.
