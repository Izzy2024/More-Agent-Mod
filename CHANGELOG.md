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
- Every status bridge gains `--status` (one JSON line, writes nothing). The dialog shows whether a bridge is installed and can install or remove it after you confirm the hook file and the exact command; the mod still never installs one on its own. Hidden on Windows.
- The EN/ES switch now translates every dialog message (add / save / remove, errors, confirms, row badges, repairs, toast, accessibility labels), not just the chrome, and the choice is remembered. Messages carry an explicit level instead of one guessed from English text. Catalog data (`note`, `install` hints) and the bridge installers' own output stay English.
- Catalog adds Codebuff, Forge, Kiro CLI, Nanocoder and Pi, each checked against its docs on 2026-11-06 (Forge and Codebuff have no continue variant; Kiro's curl installer is documented for macOS). Verified entries need a `tier` (`official` or `community`); a community row shows a badge. OpenHands CLI was left out: upstream says it is no longer actively maintained.
- Catalog `install` strings may also use `npm install -g --ignore-scripts <pkg>` and `uv tool install <pkg>`.
- `node scripts/check-links.mjs` requests every `docs` and `source` URL (a builtin's `source` is skipped: it has no public page) and flags a verified entry whose `checked` date is over 90 days old; `--offline` checks freshness only. A weekly workflow runs it.
- The dialog now checks which agents are installed with your login shell, the same way the + menu starts a program, so an agent installed with a version manager or into `~/.cargo/bin` is no longer reported as missing (the Herdr app itself runs with a shorter PATH than your shell). Row badges say `installed` / `not installed` / `could not check`, with no mention of a PATH; the custom form says "can't be found on this computer".
- When a command exists in a usual folder (`~/.local/bin`, `~/.cargo/bin`, `~/.bun/bin`, Homebrew, pip's user folder, ...) but your shell cannot see it, the row says `installed, but Herdr can't see it` and offers **Use full path**: it adds the entry (or repoints one this mod wrote) to the real file after you confirm. Herdr's own menu treats an absolute `run` path as installed (checked on 0.1.13).
- The install button first checks the tools the installer needs: a missing Node.js, Python, Homebrew, uv or curl turns it into "Needs Node.js" (etc.) with the page to get it, and `python` missing while `python3` exists is explained. Confirming now says **Install and add**: the dialog waits (every 5 s, up to 3 minutes) for the command to appear and adds it to the + menu by itself. Re-check or closing the dialog ends the wait.
- The install tab now says "press Enter for a shell": after the command the tab keeps a login shell open.

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
