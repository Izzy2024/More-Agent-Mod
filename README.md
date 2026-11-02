[Español: README.es.md](README.es.md)

# More agents: a Herdr App mod

Adds, to the Herdr App + menu, agents that do not come ready to use. You pick them from a **data catalog** (`mods/more-agents/catalog.js`) or add one of your own with the form. It writes to `~/.config/herdr-app/programs.json`:
- it merges with what you already have;
- after a successful write it saves the previous version to `programs.json.more-agents.bak`; the backup is best-effort, so a failure is reported without blocking the write;
- it never overwrites an entry of yours that already has `run`;
- if the file changed in the meantime it re-reads it and retries once; a second conflict writes nothing;
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
package.json                 npm run validate | test | check | install
.github/workflows/ci.yml     validate + smoke on Linux and macOS, node 22
```

## Why doesn't something I added show in the + menu?

Herdr's + menu (the `new-menu` mod) shows every **installed** agent, meaning one whose `run[0]` is on the PATH. Of the agents that are not installed, it shows only the first two in its internal order, which are always Claude Code and Codex. No field in `programs.json` changes this.

That is why each row carries a three-state badge — `installed`, `not found on this PATH`, or `could not check` when the probe itself failed — and the install hint when the command is missing. As soon as the command exists, the agent appears; Herdr's cache takes up to 60 s. The toast only says how many were added and how many still need an install; the per-agent hints stay in the dialog.

Messages carry a level (error, warning, success, info) and are painted accordingly, a save in progress shows "Saving…" and disables the save buttons, and if `programs.json` cannot be read or parsed the banner says why and offers **Reload** (`load()` + `detect()`), instead of asking you to reopen the dialog.

Keyboard: focus starts in the custom key field. Tab and Shift+Tab go key → name → command → continue → Add → Add custom → the Remove/Remove continue buttons of the added agents → Reload (only while the file is broken) → Close, and they do not wrap. In the catalog, ↑/↓ move between agents and Space/Enter tick them; Space/Enter also toggle continue and the buttons. Commands are split like a program, not like a shell: single and double quotes group and only `\"` and `\\` escape, so quoted paths survive; an unclosed quote is an error. The custom form never writes `match` (Herdr derives it from `run[0]`), and the keys `shell`, `program`, `agent` and anything ending in `-continue` are refused.

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
