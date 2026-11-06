# Contribuir

## Añadir un agente al catálogo (por PR, sin tocar código)

El catálogo es `mods/more-agents/catalog.js`. Tiene comentarios `//` arriba y después `export default [ ... ];` con **JSON estricto**: comillas dobles, sin comentarios dentro y sin comas finales. El runtime de los mods de Herdr solo importa `.js`, por eso no es un `.json`.

1. Añade un objeto a la lista:

   ```json
   {
     "id": "mi-agente",
     "name": "Mi Agente",
     "run": ["mi-agente"],
     "match": ["mi-agente"],
     "continue": ["mi-agente", "--continue"],
     "install": "npm i -g mi-agente",
     "docs": "https://mi-agente.dev/docs",
     "icon": "icons/agent.svg",
     "status": "verified",
     "tier": "official",
     "source": "https://mi-agente.dev/docs/cli",
     "checked": "2026-11-01",
     "note": "Opcional: algo que el usuario deba saber."
   }
   ```

   | Campo | Obligatorio | Qué es |
   |---|---|---|
   | `id` | sí | Clave en programs.json. Minúsculas, números y `. _ -`, máximo 32 caracteres. No puede acabar en `-continue`. |
   | `name` | sí | Nombre visible. |
   | `run` | sí | argv para arrancarlo en modo interactivo. `run[0]` es el binario. |
   | `match` | no | Otros nombres de proceso, o el `app=` que el agente reporta por OSC 7501. |
   | `continue` | no | argv para retomar la última sesión, con el mismo binario. **Solo si está documentado.** |
   | `install` | no | Comando de instalación oficial. Si no hay uno, se muestra `docs`. El botón **Instalar** del diálogo lo ejecuta en una pestaña nueva tras confirmar, así que el validador solo acepta `npm i\|install -g [--ignore-scripts] <paquete>`, `uv tool install <paquete>`, `pip install <paquete>`, `brew install <paquete>` y `curl -fsSL\|-LsSf https://<host>/<ruta> \| sh\|bash`, unidos con ` && `. Sin `sudo`, sin `;`, sin `http://`. |
   | `docs` | sí | URL https de la documentación. |
   | `icon` | sí | `icons/<nombre>.svg`, de los iconos que trae Herdr (`defaults/icons/` en herdr-app), o `mods/more-agents/icons/<nombre>.svg` para un icono propio del mod (licencia compatible). Si no hay uno del agente, usa `icons/agent.svg`. |
   | `status` | sí | `verified`: comando sacado de docs oficiales. `unverified`: se lista pero no se ofrece. `builtin`: Herdr ya lo trae con `run`. |
   | `tier` | obligatorio en `verified` | `official` o `community`. `official` significa que lo publica la organización o la documentación del propio proveedor, y `community` significa un repositorio de terceros o personal, como dsh-tui. El validador rechaza un verified sin este campo y lo rechaza en cualquier otro status. |
   | `source` | sí | URL donde se comprueba `run` (y `continue`). |
   | `checked` | obligatorio en `verified` | Fecha (`YYYY-MM-DD`) de la última revisión de `source`. El validador rechaza un verified sin fecha real. |
   | `bridge` | no | `bridges/<id>` si el agente no reporta OSC 7501 y este repo trae adaptador. El validador comprueba que existe `bridges/<id>/install.mjs`. |
   | `note` | no | Texto corto. |

2. **No inventes comandos.** `run`, `continue` e `install` tienen que salir de la documentación o del README oficial que pones en `source`. Si no lo puedes confirmar, usa `"status": "unverified"` o deja fuera `continue`.
3. Si Herdr ya trae el agente con `run` en su `defaults/programs.json`, usa `"status": "builtin"`.
4. Valida antes de abrir el PR:

   ```sh
   node scripts/validate-catalog.mjs
   # con un clon de herdr-app al lado, también comprueba iconos y builtin:
   node scripts/validate-catalog.mjs --icons ../herdr-app/defaults/icons --builtin ../herdr-app/defaults/programs.json
   node scripts/smoke-test.mjs
   node scripts/check-links.mjs --offline   # solo frescura; quita --offline para pedir cada URL de docs y source
   # o: npm run check
   ```

   Un `verified` sin `checked`, un campo desconocido, un icono que no existe o
   un `builtin` que Herdr no trae con `run` son error.

5. En el PR, enlaza la fuente y di cómo lo probaste: el agente aparece en el menú + y arranca. Actualiza `checked` cada vez que revises una entrada.

## Cambios de código

Si cambias `main.js`, prueba también en Herdr App:
- `herdr-app check mods/more-agents`;
- abrir el diálogo, añadir y quitar agentes;
- revisar `herdr-app status`.

Actualiza `preview.png` con `herdr-app shot` si cambia el aspecto.
