# Changelog

## Unreleased

- The dialog lists repairs for a catalog command that drifted (`command-code` still launching `cmd`) and for an owned one-edit typo (`empryro-agent` next to `empryo-agent`). Nothing is written until you confirm. A builtin entry whose `match` contains the token `agent` is only warned about.
- `programs.snippet.json` no longer matches `cmd`.
- Catalog adds `dsh-tui` (OSC 7501 itself, so no bridge note). The list has a search box. "Add continue" is a Tab stop. The header can switch the chrome to Spanish; English stays the default. A checked agent hidden by the search is not added.
- A catalog row with a `bridge` can run that bridge's installer as `--dry-run` after a confirm. The three installers print the file they would edit and write nothing.
- The dialog opens on the search box, which is now the first Tab stop. Catalog rows are grouped into Ready to add, Needs install, Already in your + menu and Ships with Herdr (collapsed). The custom agent form sits behind "Add your own agent...".
- A line lists installed catalog agents that are not in the + menu yet, with **Add all**. Missing agents get an **Install** button that runs the catalog command in a new tab only after you confirm the exact command. **Re-check** (beside the search box) refreshes detection. Catalog `install` strings are validated against an allowlist of command shapes (`npm`, `pip`, `brew`, `curl ... | sh`).
- `npm install` no longer overwrites the installed mod: the manual installer is `npm run install:mod`. `package.json` is now `"type": "module"`.
- The generated `gpui-kit.d.ts` is untracked and no longer installed (nor `jsconfig.json`). The installer also copies `bridges/` into the mod folder, so the Bridge button works from an installed copy and bridge hooks written from it survive deleting the clone. `install --uninstall` reminds you to remove a status bridge first.
- A one-edit typo entry the mod did not write is a warning, not a "Remove typo" button that would refuse. The Cursor catalog row carries its `bridge`.

## 0.1.0

First released version of the mod.

### Catalog

- 19 agents: 13 verified and 6 builtin. Every verified entry records the date
  its `source` was reviewed in `checked`.
- Continue variants use the documented flags, including `cn --resume` (Continue
  CLI), `junie --resume`, `omp --continue`, `kilo --continue`, `qwen --continue`,
  `aider --restore-chat-history`, `droid --resume`, `auggie --continue` and
  `vibe --continue`.
- Cline keeps no continue variant (`--id` needs a session id) and Goose keeps
  none (the docs do not say `--resume` picks the latest session); both say so in
  the entry's `note`.
- Command Code no longer matches `cmd`, which is Windows' own shell; the
  documented short alias on Windows is `cmdc`.

### Writing `programs.json`

- Merge with existing entries, never overwriting one that already has `run`.
- Compare-and-swap writes: if the file changed since it was read, nothing is
  written and the dialog says so.
- The previous file goes to `programs.json.more-agents.bak` after a successful
  write; a failed backup is reported without blocking the write.
- Ownership fingerprints let Remove refuse an entry that was edited after the
  mod wrote it, with an explicit "Remove anyway".
- `programs` and every entry are validated before writing; a broken file is
  never rewritten.

### Dialog

- Full keyboard navigation: Tab/Shift+Tab through fields and buttons, arrow keys
  plus Space/Enter for agents and the continue checkbox, and visible focus.
- Commands are tokenized like a program (quotes and escapes) with an error for
  an unclosed quote, and a preview of the resulting argv.
- The custom form refuses reserved keys (`shell`, `program`, `agent`) and keys
  ending in `-continue`, and never invents `match`.

### Tooling

- `scripts/validate-catalog.mjs` checks the catalog, requires `checked` for
  verified entries, accepts Herdr icons or the mod's own icons, and can compare
  against Herdr's icons and builtin programs.
- `scripts/smoke-test.mjs` runs the logic tests and the catalog installer tests.
- `scripts/install.mjs` installs or updates the mod with staging and an atomic
  swap, keeps one backup, supports `--uninstall` and `--dry-run`, and never
  touches `programs.json` or `keys.json`.
- `package.json` scripts (`validate`, `test`, `check`, `install`) and a GitHub
  Actions workflow on Node 22 for Ubuntu and macOS.
