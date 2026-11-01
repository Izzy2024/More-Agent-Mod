# More agents: mod de Herdr App (borrador)

Añade al menú + de Herdr App agentes que no vienen listos. Los eliges de un **catálogo de datos** (`mods/more-agents/catalog.js`) o añades uno propio con el formulario. Escribe en `~/.config/herdr-app/programs.json`:
- fusiona con lo que ya tienes;
- antes de cada escritura copia el archivo a `programs.json.more-agents.bak`;
- nunca pisa una entrada tuya que ya tenga `run`;
- no escribe si el archivo cambió entre medias.

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
  smoke-test.mjs             prueba la lógica de main.js con stubs (sin UI)
  smoke/                     stubs y test
```

## ¿Por qué no sale en el menú + algo que añadí?

El menú + de Herdr (mod `new-menu`) enseña todos los agentes **instalados**, es decir, cuyo `run[0]` está en el PATH. De los no instalados solo enseña los dos primeros del orden interno, que siempre son Claude Code y Codex. Ningún campo de `programs.json` cambia esto.

Por eso el diálogo avisa: "Añadido X; aparecerá en el menú + cuando instales `cmd`", junto con la pista de instalación. En cuanto el comando existe, el agente aparece; la caché de Herdr tarda hasta 60 s.

En el formulario personalizado, Tab y Shift+Tab cambian de campo y Enter en el comando añade el agente.

## Probar en local

1. Copia `mods/more-agents/` a `~/.config/herdr-app/mods/more-agents/`.
2. Valida con `herdr-app check ~/.config/herdr-app/mods/more-agents`.
3. Ábrelo desde la paleta de comandos: `mod.open` → `more-agents`. También puedes fusionar `keys.json` en el tuyo.
4. Revisa errores con `herdr-app status` y haz la captura para `preview.png` con `herdr-app shot`.

## Comprobaciones sin Herdr

```sh
node scripts/validate-catalog.mjs [--icons <herdr-app>/defaults/icons --builtin <herdr-app>/defaults/programs.json]
node scripts/smoke-test.mjs
```

## Publicar

1. Crea un repo público con esta carpeta.
2. Añade el topic `herdr-mod`.
3. Aparece en herdr.dev/mods → Community.

Estado: `herdr-app check` pasa y el diálogo abre y escribe programs.json en Herdr App 0.1.10 (Linux). Falta probar los clics a mano.
