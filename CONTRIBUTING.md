# Contributing

## Add an agent to the catalog (by pull request, without touching code)

The catalog is `mods/more-agents/catalog.js`. It has `//` comments at the top, then `export default [ ... ];` with **strict JSON**: double quotes, no comments inside, and no trailing commas. Herdr's mod runtime only imports `.js`, which is why this is not a `.json` file.

1. Add an object to the list:

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

   | Field | Required | What it is |
   |---|---|---|
   | `id` | yes | Key in programs.json. Lowercase letters, digits, and `. _ -`, 32 characters at most. It cannot end in `-continue`. |
   | `name` | yes | Visible name. |
   | `run` | yes | argv to start it in interactive mode. `run[0]` is the binary. |
   | `match` | no | Other process names, or the `app=` value the agent reports over OSC 7501. |
   | `continue` | no | argv to resume the last session, using the same binary. **Only if that flag is documented.** |
   | `install` | no | Official install command. If there is none, `docs` is shown instead. The dialog's **Install** button runs it in a new tab after a confirm, so the validator only accepts `npm i\|install -g <pkg>`, `pip install <pkg>`, `brew install <pkg>` and `curl -fsSL\|-LsSf https://<host>/<path> \| sh\|bash`, joined by ` && `. No `sudo`, no `;`, no `http://`. |
   | `docs` | yes | https URL of the documentation. |
   | `icon` | yes | `icons/<nombre>.svg`, one of the icons Herdr ships (`defaults/icons/` in herdr-app), or `mods/more-agents/icons/<nombre>.svg` for an icon that belongs to this mod (compatible license). If the agent has no icon of its own, use `icons/agent.svg`. |
   | `status` | yes | `verified`: command taken from official docs. `unverified`: listed, but not offered. `builtin`: Herdr already ships it with `run`. |
   | `tier` | required for `verified` | `official` or `community`. `official` means the vendor's own organization or documentation site published it, and `community` means a third-party or personal repository such as dsh-tui. The validator rejects a verified entry without it, and rejects it on any other status. |
   | `source` | yes | URL where `run` (and `continue`) is checked. |
   | `checked` | required for `verified` | Date (`YYYY-MM-DD`) of the last review of `source`. The validator rejects a verified entry without a real calendar date. |
   | `bridge` | no | `bridges/<id>` when the agent does not report OSC 7501 and this repo ships an adapter for it. The validator checks that `bridges/<id>/install.mjs` exists. |
   | `note` | no | Short text. |

2. **Do not invent commands.** `run`, `continue`, and `install` have to come from the documentation or the official README you cite in `source`. If you cannot confirm them, use `"status": "unverified"` or leave `continue` out.
3. If Herdr already ships the agent with `run` in its `defaults/programs.json`, use `"status": "builtin"`.
4. Validate before opening the pull request:

   ```sh
   node scripts/validate-catalog.mjs
   # con un clon de herdr-app al lado, también comprueba iconos y builtin:
   node scripts/validate-catalog.mjs --icons ../herdr-app/defaults/icons --builtin ../herdr-app/defaults/programs.json
   node scripts/smoke-test.mjs
   node scripts/check-links.mjs --offline   # freshness only; omit --offline to request every docs and source URL
   # or: npm run check
   ```

   A `verified` entry without `checked`, an unknown field, an icon that does not
   exist, or a `builtin` that Herdr does not ship with `run` is an error.

5. In the pull request, link the source and say how you tested it: the agent shows in the + menu and starts. Bump `checked` whenever you re-verify an entry.

## Code changes

If you change `main.js`, also test it in Herdr App:
- `herdr-app check mods/more-agents`;
- open the dialog, add agents, and remove them;
- check `herdr-app status`.

Update `preview.png` with `herdr-app shot` if the look changes.
