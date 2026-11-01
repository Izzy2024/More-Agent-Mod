[Español: README.es.md](README.es.md)

# More agents: a Herdr App mod

Adds, to the Herdr App + menu, agents that do not come ready to use. You pick them from a **data catalog** (`mods/more-agents/catalog.js`) or add one of your own with the form. It writes to `~/.config/herdr-app/programs.json`:
- it merges with what you already have;
- before each write it copies the file to `programs.json.more-agents.bak`;
- it never overwrites an entry of yours that already has `run`;
- it does not write if the file changed in the meantime.

## Install

On Linux and macOS, Herdr App keeps its config in `~/.config/herdr-app`:

```sh
git clone https://github.com/Izzy2024/More-Agent-Mod.git && mkdir -p ~/.config/herdr-app/mods && cp -r More-Agent-Mod/mods/more-agents ~/.config/herdr-app/mods/
```

Open it with `herdr-app do mod.open --name more-agents`, or optionally bind a key by merging the entry from `keys.json` (Alt+Shift+A) into `~/.config/herdr-app/keys.json`.

Built to work on Linux, macOS and Windows (the mod asks Herdr for its config folder and uses `sh` on Linux/macOS and `where` on Windows to detect installed agents), but only tested on Linux so far.

This is a Herdr App mod (copy the folder, as above) and not a `herdr plugin install` plugin, which is a different extension system for the Herdr CLI.

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
  smoke-test.mjs             tests main.js logic with stubs (no UI)
  smoke/                     stubs and test
```

## Why doesn't something I added show in the + menu?

Herdr's + menu (the `new-menu` mod) shows every **installed** agent, meaning one whose `run[0]` is on the PATH. Of the agents that are not installed, it shows only the first two in its internal order, which are always Claude Code and Codex. No field in `programs.json` changes this.

That is why the dialog says: "Added X; it will show in the + menu once you install `cmd`", together with the install hint. As soon as the command exists, the agent appears; Herdr's cache takes up to 60 s.

In the custom form, Tab and Shift+Tab move between fields, and Enter on the command adds the agent.

## Try it locally

1. Copy `mods/more-agents/` to `~/.config/herdr-app/mods/more-agents/`.
2. Validate with `herdr-app check ~/.config/herdr-app/mods/more-agents`.
3. Open it from the command palette: `mod.open` → `more-agents`. You can also merge `keys.json` into yours.
4. Check for errors with `herdr-app status`, and take the screenshot for `preview.png` with `herdr-app shot`.

## Checks without Herdr

```sh
node scripts/validate-catalog.mjs [--icons <herdr-app>/defaults/icons --builtin <herdr-app>/defaults/programs.json]
node scripts/smoke-test.mjs
```

Status: `herdr-app check` passes and the dialog was tested end to end (add, remove, + menu, custom agent form) in Herdr App 0.1.10 on Linux.
