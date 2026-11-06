# Arquitectura

Cómo funciona el mod Más agentes dentro de Herdr App. Para instalar y usar, mira
el [README](../README.es.md).

## Dónde se ejecuta

El mod es JavaScript normal que carga el runtime de mods de Herdr. Usa
`gpui-kit` y `gpui-base` para el diálogo y `herdr` para la API del anfitrión, y
no tiene compilación ni dependencias.

Herdr fusiona dos tablas de programas: su `defaults/programs.json` y el
`~/.config/herdr-app/programs.json` personal, que recarga en vivo. El mod no
puede registrar lanzadores con una API de mods, así que edita ese archivo
personal. `mod.json` no coloca nada en el shell y abre `main.js` como un
diálogo de 640×640.

## Mapa de archivos (`mods/more-agents/`)

| Archivo | Papel |
| --- | --- |
| `main.js` | El diálogo: carga, detección, añadir/eliminar, flujo de instalación, vigilante, teclado y pintado. |
| `catalog.js` | Solo datos de agentes. Tras los comentarios de cabecera es JSON estricto; `scripts/validate-catalog.mjs` lo analiza sin ejecutarlo. |
| `copy.js` | Cadenas y constructores de mensajes en inglés y español; `EN` es el valor por defecto y `copyFor()` vuelve a él. |
| `mod.json` | `place: none` más el overlay del diálogo (`width`/`height` 640). |
| `repair.js` | Propuestas puras de solo lectura para entradas que ya no coinciden con el catálogo. |
| `path-probe.js` | Pregunta al shell de inicio de sesión qué binarios existen; también comprueba las herramientas de instalación. |
| `path-scan.js` | Busca un comando que se escapó en las carpetas habituales de instalación por usuario. |
| `install-assist.js` | La única regla de comandos de instalación, los planes de instalación, las herramientas necesarias y la detección de "instalado pero no está en el menú +". |
| `bridge-install.js` | Planes y validación de los únicos comandos que el diálogo puede ejecutar para un bridge de estado. |

Una copia instalada lleva además `bridges/` dentro de la carpeta del mod; el
instalador lo copia ahí para que un bridge siga funcionando si se borra el
clon.

## Escribir `programs.json`

La ruta sale de `appHome()` + `/programs.json`. `load()` lee el texto una vez y
lo guarda; cada escritura se compara con esa instantánea.

### Reglas de fusión

`addEntries()` nunca pisa una entrada personal que ya tenga `run`: esa clave se
omite y se avisa de que ya estaba. Si la clave existe sin `run` (por ejemplo,
solo un icono), los campos del catálogo se fusionan en ella y se añade `run`.
Una entrada del catálogo aporta `name`, `icon`, `match` cuando el catálogo lo
tiene, y los valores por defecto de tinte/teja/color. La variante continue es
una clave aparte, `<id>-continue`, con su propia entrada, así que base y
variante se pueden añadir y quitar por separado.

### Compare-and-swap

`writeTextFile(path, text, before)` recibe el texto exacto que se leyó. Si el
archivo cambió entre medias, la escritura falla por obsoleto. `edit()` vuelve a
leer la nueva instantánea, reconstruye el cambio y reintenta **una vez**; un segundo
conflicto no escribe nada y lo dice. Los errores de permisos, espacio u otras
E/S no se reintentan. El mapa de propiedad se establece antes de la escritura y
se revierte si esta falla, así que un guardado fallido no deja propiedad atrás.

Un archivo mal formado nunca se reescribe: `load()` rechaza JSON no válido, una
raíz que no sea objeto, un valor `programs` que no sea objeto y entradas que no
sean objetos, nombra el fallo (lectura, JSON, estructura) y ofrece **Recargar**
en vez de una ruta de escritura.

### Copias de seguridad

Tras una escritura correcta se intentan dos copias de mejor esfuerzo:

- `programs.json.more-agents.bak`: la versión anterior, reemplazada en cada
  escritura correcta.
- `programs.json.more-agents.orig.bak`: el archivo tal como estaba antes de que
  el mod lo tocara por primera vez; se escribe solo si aún no existe y nunca se
  reemplaza.

Un fallo de copia se avisa como advertencia y no deshace ni bloquea el guardado.

### Propiedad y Eliminar

El mod apunta lo que escribió en el almacenamiento de mods de Herdr bajo
`more-agents.keys` como `clave -> huella`. La huella es FNV-1a sobre una
serialización JSON estable de toda la entrada, así que cualquier edición manual
posterior la cambia. El formato antiguo de array se migra a claves con huella
desconocida (`null`).

`remove()` solo considera claves que sean a la vez propias y estén presentes.
Salvo que se fuerce la confirmación, una entrada propia cuya huella ya no
coincide no se borra: el diálogo pregunta antes y ofrece **Eliminar igualmente**.
El mod nunca borra una entrada que no escribió.

### Reparaciones

`repair.js` recorre la tabla sin mutarla y devuelve propuestas:

- una entrada verificada del catálogo cuyo `run` difiere y que este mod escribió
  recibe una propuesta de **actualización** (aplicar el comando y el match del
  catálogo, tras confirmar);
- `command-code` usando el token `cmd` del shell de Windows recibe una propuesta
  de actualización aunque no sea propia, porque el catálogo documenta el
  comando real;
- un `run` que empieza por un shell (`cmd`, `bash`, `zsh`, ...) es una
  advertencia y se deja como está;
- una entrada no propia que solo difiere del catálogo es una advertencia y se
  deja como está;
- una clave a una edición de otra clave vecina en minúsculas, cuyo comando
  también está a una edición, es una errata: la propia se puede eliminar; la no
  propia solo se avisa;
- una entrada integrada cuyo `match` contiene el token exacto `agent` es una
  advertencia sobre Herdr enviándole los lanzamientos genéricos de agente.

Cada propuesta se aplica de una en una por la misma ruta `edit()`, así que
compare-and-swap, copias y propiedad no cambian.

## Detección

### El shell de inicio de sesión

Herdr arranca un programa con el shell interactivo de inicio de sesión del
usuario (`/bin/zsh -lic '"$@"' zsh <argv>`). El proceso de la app, y por tanto
el `exec()` del mod, tiene un PATH más corto: pueden faltar `~/.cargo/bin`,
`~/.opencode/bin` y carpetas parecidas. Sondear con el PATH de la app diría que
un agente "no está instalado" aunque el menú + sí lo arrancaría.

Por eso `path-probe.js` pregunta a `$SHELL`:

1. Lee `$SHELL` y acepta solo una ruta absoluta cuyo nombre base sea `zsh`,
   `bash`, `fish`, `sh`, `dash` o `ksh`.
2. Ejecuta un único script `-lic` que imprime una marca de inicio, un
   `command -v` por binario y una marca de fin. Solo cuentan las líneas
   `FOUND <nombre>` entre las marcas, así que un banner del rc no confunde la
   respuesta.
3. Sin un shell usable, o si esa llamada falla o no imprime marcas, cae a un
   bucle `sh -c` sobre los nombres.
4. En Windows no hay shell de inicio de sesión: ejecuta `where` por nombre.

`probeBinaries()` devuelve `{ ok, found }`. `ok: false` significa "no se pudo
comprobar" y se muestra así, nunca como "no instalado". El diálogo también
fusiona `knownAgents()`: lo que Herdr ya sabe gana sobre un sondeo que no pudo
responder. La misma petición incluye las herramientas de instalación (`npm`,
`python`, `python3`, `pip`, `brew`, `uv`, `curl`).

`detect()` sondea los comandos del catálogo, los de las entradas que escribió
este mod y las herramientas de instalación, todo en una llamada al shell. El
estado de una fila tiene tres valores: `true` instalado, `false` no instalado,
`undefined`/desconocido no se pudo comprobar.

### Carpetas que Herdr no ve

`scanFound()` ejecuta `path-scan.js` solo para los binarios que el shell de
inicio de sesión dijo que faltaban. En POSIX mira las carpetas habituales que
usa un instalador oficial (`~/.local/bin`, `~/.cargo/bin`, `~/.bun/bin`,
`~/.deno/bin`, `~/go/bin`, `~/.npm-global/bin`, `~/.opencode/bin`,
`~/.volta/bin`, `~/.yarn/bin`, `~/.local/share/pnpm`, `/opt/homebrew/bin`,
`/usr/local/bin` y la carpeta versionada de Python del usuario). Se salta las
carpetas tipo nvm porque su nombre cambia en cada actualización.

Cuando un comando aparece ahí, la fila dice `instalado, pero Herdr no lo ve` y
ofrece **Usar ruta completa**. Al confirmar, añade la entrada (o repunta una que
escribió este mod) con un `run[0]` absoluto; Herdr trata una ruta absoluta como
instalada. Hasta la confirmación todo es de solo lectura. Windows no tiene
escaneo.

## El diálogo

`init()` carga el archivo, luego detecta binarios, escanea las carpetas extra y
lee el estado de los bridges. `reload()` (el botón **Volver a comprobar** y el
botón **Recargar** del banner de error) repite esa secuencia y además detiene
cualquier vigilante de instalación.

### Secciones y búsqueda

La lista tiene cuatro secciones, en orden de pintado: **Listos para añadir**,
**Hay que instalarlos**, **Ya están en tu menú +** y **Vienen con Herdr**. La
última empieza plegada, y las cabeceras se pliegan con un clic. Un agente
verificado va a "listos" cuando su comando apareció y a "hay que instalarlos"
si no; una entrada que ya tiene `run` va a "ya están"; las filas integradas y
sin verificar van a "vienen". La sección "ya están" también lista las entradas
propias que escribió este mod.

La caja de búsqueda coincide con el nombre, la clave y el comando. Oculta filas
de la lista y del recorrido con flechas; un agente marcado que la búsqueda
esconde no se añade. Un banner sobre la lista ofrece **Añadir todos** para los
agentes del catálogo que están instalados y faltan en `programs.json`.

### Contrato de teclado

El foco empieza en la caja de búsqueda. Tab y Mayús+Tab siguen `tabOrder()`:

`búsqueda → continue → Añadir → Añadir tu propio agente... → (solo con ese
formulario abierto) clave → nombre → comando → Añadir → Eliminar / Eliminar
continue / Añadir continue de las entradas que escribió este mod → Recargar
(solo si el archivo está roto) → Cerrar`.

Una pregunta pendiente inserta sus dos botones (**Sobrescribir**/**Conservar**,
**Eliminar igualmente**/**Conservar**, **Instalar y añadir**/**Cancelar**, etc.)
antes de Cerrar. Tab no da la vuelta: en cualquiera de los extremos la tecla
sale del diálogo. Las filas del catálogo no son paradas de Tab.

Flecha abajo desde la búsqueda va a la primera fila añadible que esté pintada;
las flechas se mueven entre esas filas y Espacio/Intro marca una. Espacio/Intro
también conmutan la casilla continue, el desplegable y los botones; Espacio e
Intro dentro de un campo de texto escriben con normalidad. Intro en el campo de comando
envía el formulario propio.

Las cabeceras de sección, el cambio de idioma (EN / ES), **Volver a comprobar**,
**Añadir todos** y los botones de fila **Instalar**, **Bridge** y **Usar ruta
completa** son solo de puntero; **Eliminar**, **Eliminar continue** y **Añadir
continue** son paradas de Tab. Los comandos se parten como un programa, no como
un shell: las comillas simples y dobles agrupan, solo `\"` y `\\` escapan, y una
comilla sin cerrar es un error. El formulario propio nunca escribe `match`
(Herdr lo deriva de `run[0]`), rechaza las claves `shell`, `program`, `agent` y
cualquiera que acabe en `-continue`, y pregunta antes de guardar un comando que
no se encuentra.

Los mensajes llevan un nivel explícito (error, warning, success, info). Un
guardado en curso pinta **Guardando…** y deshabilita los botones de guardar. El
toast solo informa de recuentos; las pistas por agente se quedan en el diálogo.

## El flujo de instalación

### El botón Instalar

Una fila ofrece **Instalar** solo cuando es verificada, su comando no apareció y
su cadena `install` del catálogo pasa `isRunnableInstall()`. Esa regla se
comparte con el validador del catálogo y solo permite comandos simples unidos
por ` && `: `npm i|install -g [--ignore-scripts] <pkg>`, `uv tool install <pkg>`,
`pip install <pkg>` / `python -m pip install <pkg>`, `brew install <pkg>` y
`curl -fsSL|-LsSf https://... | sh|bash`, más un `<nombre>-install` final tras
el primer comando.

Antes de enseñar la confirmación, `missingTools()` comprueba si existen las
primeras palabras del comando (`npm`, `python`, `pip`, `brew`, `uv`, `curl`). Si
falta una, el botón dice **Necesita X**, explica dónde conseguirla y no ejecuta
nada; un `python` que falta con `python3` presente tiene su propia explicación.

La confirmación enseña el comando exacto. Al confirmar (botón **Instalar y
añadir**) se construye `planInstall()`:

```sh
sh -c '<comando de instalación>; printf "\n[finished - press Enter for a shell]\n"; read _'
```

y se ejecuta con `run("tab.new", { name, argv })`. El comando no se ejecuta antes
de la confirmación, y el flujo está desactivado en Windows porque necesita `sh`.

### El vigilante

Tras abrir la pestaña, `startInstallWatch()` espera a que aparezca el comando:
cada 5 s, como máximo 3 minutos. Cada tick vuelve a detectar; cuando encuentra el
binario añade la entrada del catálogo (y la variante continue si la casilla está
marcada) por la ruta normal de añadir. **Volver a comprobar** o cerrar el
diálogo detiene la espera. Al vencer el plazo el diálogo dice que el agente
sigue sin instalarse. El vigilante nunca ejecuta la instalación; la ejecuta la
pestaña.

## Bridges de estado

El panel **Agentes** es distinto del menú +: solo lista terminales que informan
de su estado con la secuencia OSC 7501:

```text
ESC ] 7501 ; state=<idle|working|blocked> : app=<app> ST
```

Los que informan de forma nativa (Claude Code, Codex, OpenCode, omp) no necesitan nada.
Para los demás, `bridges/` trae adaptadores opt-in (Cursor, Command Code,
Empryo) que llaman al emisor compartido `bridges/lib/herdr-osc.sh`, fusionan sus
comandos en el archivo de hooks del agente con copia de seguridad y admiten
`--uninstall`.

Cada adaptador admite también `--status`: imprime exactamente una línea JSON
(por ejemplo `{"app":"cursor","installed":true,"file":"..."}`) y no escribe
nada. El diálogo lo lee para cada fila del catálogo con `bridge` al abrirse y
tras cada cambio; una lectura fallida o desconocida deja la fila en el botón
**Bridge** normal.

`bridge-install.js` construye un plan para una de cuatro acciones (`status`,
`preview`, `install`, `uninstall`) y solo acepta
`bridges/<un-segmento>/install.mjs` bajo la raíz resuelta. Antes de ejecutar,
`runBridgePlan()` reconstruye el argv permitido y rechaza un plan manipulado. El
clic ejecuta una prueba sin escribir; instalar o quitar necesita la
confirmación, que enseña el archivo de hooks y el comando exacto. Nunca se
instala nada solo, y toda la interfaz de bridges se oculta en Windows. Las
entradas del catálogo que informan OSC 7501 por sí mismas usan
`nativeOsc: true` y no pueden llevar además `bridge` (el validador lo exige).

## Pruebas y comprobaciones

`scripts/smoke-test.mjs` copia `mods/more-agents/` a una carpeta temporal nueva,
escribe un `package.json` con `"type": "module"` y cambia los imports de
`gpui-kit`/`gpui-base`/`herdr` en `main.js` por `scripts/smoke/stubs.mjs`. Luego
ejecuta cada `scripts/smoke/*.test.mjs` en su propio sandbox con `MA_HOME`
apuntando a un home temporal, y termina con `ALL OK (<n> test files)`. Los stubs
reemplazan el anfitrión, la lectura/escritura de archivos, el sondeo del shell y
`notify`, así que la lógica se puede probar sin ventana.

Ajustes de prueba (variables de entorno que lee `stubs.mjs`):

| Ajuste | Efecto |
| --- | --- |
| `MA_HOME` | Carpeta de configuración de la app en el sandbox (`appHome()`). |
| `MA_SYS_HOME` | Carpeta personal falsa del sistema; controla la detección de Windows y `path-scan`. |
| `MA_ONPATH` | Binarios que encuentra el shell de inicio de sesión (o `where`), separados por espacios. |
| `MA_SH_ONPATH` | Binarios que solo encuentra el respaldo `sh -c`; por defecto, `MA_ONPATH`. |
| `MA_SHELL` | Lo que informa `$SHELL`; vacío fuerza el respaldo. |
| `MA_LOGIN_FAIL=1` | La llamada al shell de inicio de sesión lanza un error. |
| `MA_LOGIN_SILENT=1` | No imprime marcas. |
| `MA_KNOWN_AGENTS` | Nombres que `knownAgents()` informa como instalados. |
| `MA_EXEC_FAIL=1` | La detección lanza un error. |
| `MA_FAIL_WRITE` | Fragmentos de ruta, separados por comas, cuya escritura falla. |
| `MA_TOOLS_MISSING=1` | Quita las herramientas de instalación del sondeo. |

`scripts/validate-catalog.mjs` analiza `catalog.js` como JSON estricto y
comprueba campos, ids, fechas, iconos, formas de instalación, `tier`, bridges y
`nativeOsc`. Con `--icons` y `--builtin` también compara con un clon de Herdr.

`scripts/check-links.mjs` pide cada URL de `docs` y `source` (la `source` de un
integrado se omite porque no tiene página pública), marca las entradas
verificadas cuya fecha `checked` tiene más de 90 días y admite `--offline` para
comprobar solo la frescura. Un workflow semanal de GitHub lo ejecuta.

CI ejecuta la validación y las pruebas de humo en Ubuntu y macOS con Node 22,
comprueba el validador contra un fixture generado (icono que falta, integrado
que falta) y ejecuta `herdr-app check mods/more-agents` cuando la app está
instalada.

## Mapa del repositorio

```text
mods/more-agents/            el mod (ver la tabla de arriba)
bridges/                     adaptadores OSC 7501 opcionales y el emisor compartido
scripts/install.mjs          instala/actualiza/desinstala el mod en el home de la app
scripts/validate-catalog.mjs comprobaciones del catálogo
scripts/smoke-test.mjs       ejecuta scripts/smoke/*.test.mjs contra los stubs
scripts/smoke/               un sandbox por archivo de prueba, más stubs.mjs
scripts/check-links.mjs      comprobación de URL de docs/source y frescura
keys.json                    atajo opcional Alt+Mayús+A para mod.open
programs.snippet.json        alternativa sin el mod (omp + Command Code)
.github/workflows/           CI y la tarea semanal de salud del catálogo
```
