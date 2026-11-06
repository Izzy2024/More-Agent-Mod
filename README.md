[Español: README.es.md](README.es.md)

# More agents: a Herdr App mod

Adds, to the Herdr App + menu, agents that do not come ready to use. You pick them from a **data catalog** (`mods/more-agents/catalog.js`) or add one of your own with the form. It writes to `~/.config/herdr-app/programs.json`:
- it merges with what you already have;
- after a successful write it saves the previous version to `programs.json.more-agents.bak`; the backup is best-effort, so a failure is reported without blocking the write;
- it never overwrites an entry of yours that already has `run`;
- if the file changed in the meantime it re-reads it and retries once; a second conflict writes nothing;
- if an entry's command drifted from the catalog (`cmd` instead of `command-code`) or an owned key is a one-edit typo, the dialog proposes a repair and writes only after you confirm;
- the first write also saves the file as it was before the mod touched it to `programs.json.more-agents.orig.bak` (never replaced).

## Install

On Linux and macOS, Herdr App keeps its config in `~/.config/herdr-app`:

```sh
git clone https://github.com/Izzy2024/More-Agent-Mod.git
cd More-Agent-Mod
node scripts/install.mjs            # copies the mod into ~/.config/herdr-app/mods/more-agents
```

The installer stages the copy and swaps it in with a rename, so an update never leaves a half-written or nested `mods/more-agents/more-agents` folder, and keeps the previous one as `more-agents.bak`. `--dry-run` shows what it would do and `--uninstall` removes the mod (neither touches `programs.json` nor `keys.json`). Updating is just `git pull && node scripts/install.mjs`.

Open it with `herdr-app do mod.open --name more-agents`, or optionally bind a key by merging the entry from `keys.json` (Alt+Shift+A) into `~/.config/herdr-app/keys.json`.

Built to work on Linux, macOS and Windows (the mod asks Herdr for its config folder and uses `sh` on Linux/macOS and `where` on Windows to detect installed agents), but only tested on Linux so far.

This is a Herdr App mod (installed with the script above) and not a `herdr plugin install` plugin, which is a different extension system for the Herdr CLI.

```
RECIPE.md                    card for herdr.dev/mods
CONTRIBUTING.md              how to add an agent by pull request
preview.png                  real screenshot (herdr-app shot, Herdr 0.1.10, Linux)
keys.json                    optional: alt-shift-a -> mod.open:more-agents
programs.snippet.json        alternative without the mod (omp + Command Code by hand)
mods/more-agents/
  main.js                    dialog
  catalog.js                 catalog (data only)
  mod.json                   place none + overlay dialog
scripts/
  validate-catalog.mjs       validates the catalog schema
  install.mjs                copies/updates/uninstalls the mod in the app home
  smoke-test.mjs             tests main.js logic with stubs (no UI)
  smoke/                     stubs and *.test.mjs (one sandbox per file)
package.json                 npm run validate | test | check | install:mod
.github/workflows/ci.yml     validate + smoke on Linux and macOS, node 22
```

## Why doesn't something I added show in the + menu?

Herdr's + menu (the `new-menu` mod) shows every **installed** agent, meaning one whose `run[0]` is on the PATH. Of the agents that are not installed, it shows only the first two in its internal order, which are always Claude Code and Codex. No field in `programs.json` changes this.

That is why each row carries a badge — `installed`, `not installed`, `could not check` when the check itself failed, or `installed, but Herdr can't see it` — plus the install hint when the command is missing. The dialog checks installed agents with your login shell, the same way the + menu starts a program. As soon as the command exists, the agent appears; Herdr's cache takes up to 60 s. The toast only says how many were added and how many still need an install; the per-agent hints stay in the dialog.

Messages carry a level (error, warning, success, info) and are painted accordingly, a save in progress shows "Saving…" and disables the save buttons, and if `programs.json` cannot be read or parsed the banner says why and offers **Reload** (`load()` + `detect()`), instead of asking you to reopen the dialog.

The **Agents** panel is a different list: it only shows terminals that report OSC 7501. Native reporters (omp, OpenCode, Claude Code, Codex) need nothing; for the rest, `bridges/` in this repo has opt-in adapters (Cursor, Command Code, Empryo) that merge into that agent's hooks with a backup and `--uninstall`. A catalog row that needs one carries `bridge`; the dialog shows whether that bridge is installed and only installs or removes it after you confirm, and the same adapters still run by hand with `--uninstall`.

Keyboard: focus starts in the search box. Tab and Shift+Tab go search → continue → Add → "Add your own agent" → (only while that form is open) key → name → command → Add custom → the Remove/Remove continue and Add continue buttons of the added agents → Reload (only while the file is broken) → Close, and they do not wrap. Arrow Down from the search box moves to the first catalog row you can add; ↑/↓ move between those rows and Space/Enter tick them. Space/Enter also toggle continue, "Add your own agent", and the buttons. Section headers collapse with a click and are not Tab stops. Commands are split like a program, not like a shell: single and double quotes group and only `\"` and `\\` escape, so quoted paths survive; an unclosed quote is an error. The custom form never writes `match` (Herdr derives it from `run[0]`), and the keys `shell`, `program`, `agent` and anything ending in `-continue` are refused. If the command can't be found on this computer, the dialog asks before saving it: the entry stays out of the + menu until it is installed, so a typo cannot disappear silently.

## Try it locally

1. `node scripts/install.mjs` (or copy `mods/more-agents/` to `~/.config/herdr-app/mods/more-agents/` yourself).
2. Validate with `herdr-app check ~/.config/herdr-app/mods/more-agents`.
3. Open it from the command palette: `mod.open` → `more-agents`. You can also merge `keys.json` into yours.
4. Check for errors with `herdr-app status`, and take the screenshot for `preview.png` with `herdr-app shot`.

## Checks without Herdr

```sh
node scripts/validate-catalog.mjs [--icons <herdr-app>/defaults/icons --builtin <herdr-app>/defaults/programs.json]
node scripts/smoke-test.mjs
```

Status: `herdr-app check` passes and the dialog was tested end to end (add, remove, + menu, custom agent form) in Herdr App 0.1.10 on Linux.
