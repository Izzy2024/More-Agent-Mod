# Architecture

How the More agents mod works inside Herdr App. For install and use, see the
[README](../README.md).

## Where it runs

The mod is plain JavaScript loaded by Herdr's mod runtime. It uses `gpui-kit`
and `gpui-base` for the dialog and `herdr` for the host API, and it has no
build step and no dependencies.

Herdr merges two program tables: its own `defaults/programs.json` and the
personal `~/.config/herdr-app/programs.json`, which it reloads live. The mod
cannot register launchers through a mod API, so it edits that personal file.
`mod.json` places nothing in the shell and opens `main.js` as a 640×640 dialog.

## File map (`mods/more-agents/`)

| File | Role |
| --- | --- |
| `main.js` | The dialog: load, detection, add/remove, install flow, watcher, keyboard, paint. |
| `catalog.js` | Agent data only. After the header comments it is strict JSON; `scripts/validate-catalog.mjs` parses it without running it. |
| `copy.js` | English and Spanish strings and message builders; `EN` is the default and `copyFor()` falls back to it. |
| `mod.json` | `place: none` plus the dialog overlay (`width`/`height` 640). |
| `repair.js` | Pure read-only proposals for entries that no longer match the catalog. |
| `path-probe.js` | Asks the login shell which binaries exist; also probes the install tools. |
| `path-scan.js` | Looks for a missed command in the usual per-user install folders. |
| `install-assist.js` | The one install-command rule, install plans, prerequisite tools and "installed but not in the + menu" detection. |
| `bridge-install.js` | Plans and validates the only commands the dialog may run for a status bridge. |

An installed copy also carries `bridges/` inside the mod folder; the installer
copies it there so a bridge keeps working if the checkout is deleted.

## Writing `programs.json`

The path comes from `appHome()` + `/programs.json`. `load()` reads the raw text
once and keeps it; every write is checked against that snapshot.

### Merge rules

`addEntries()` never overwrites a personal entry that already has `run`: that
key is skipped and reported as already present. If the key exists without
`run` (for example only an icon), the catalog fields are merged into it and
`run` is added. A catalog entry contributes `name`, `icon`, `match` when the
catalog has one, and the tint/tile/color defaults. The continue variant is a
separate key, `<id>-continue`, with its own entry, so base and variant can be
added and removed independently.

### Compare-and-swap

`writeTextFile(path, text, before)` receives the exact text that was read. If
the file changed in between, the write fails as stale. `edit()` then re-reads
the new snapshot, rebuilds the change and retries **once**; a second conflict
writes nothing and says so. Permission, space and other I/O errors are not
retried. The ownership map is set before the write and rolled back if the
write fails, so a failed save leaves no ownership behind.

A malformed file is never rewritten: `load()` rejects invalid JSON, a
non-object root, a non-object `programs` value and non-object entries, names
the failure (read, JSON, shape) and offers **Reload** instead of a write path.

### Backups

After a successful write, two best-effort copies are attempted:

- `programs.json.more-agents.bak`: the previous version, replaced on every
  successful write.
- `programs.json.more-agents.orig.bak`: the file as it was before the mod first
  touched it, written only if it does not exist yet and never replaced.

A backup failure is reported as a warning and does not undo or block the save.

### Ownership and Remove

The mod records what it wrote in Herdr's mod storage under `more-agents.keys`
as `key -> fingerprint`. The fingerprint is FNV-1a over a stable JSON
serialization of the whole entry, so any later hand edit changes it. The older
array format is migrated to keys with an unknown (`null`) fingerprint.

`remove()` only considers keys that are both owned and present. Unless the
confirmation is forced, an owned entry whose fingerprint no longer matches is
not deleted: the dialog asks first and offers **Remove anyway**. The mod never
deletes an entry it did not write.

### Repairs

`repair.js` scans the table without mutating it and returns proposals:

- a verified catalog entry whose `run` differs and that this mod owns gets an
  **update** proposal (apply the catalog command and match, after a confirm);
- `command-code` using the Windows shell token `cmd` gets an update proposal
  even when unowned, because the catalog documents the real command;
- a `run` that starts with a shell (`cmd`, `bash`, `zsh`, ...) is a warning and
  is left alone;
- an unowned entry that merely differs from the catalog is a warning and is
  left alone;
- a custom key one edit away from a lowercase neighbour, where the command is
  also one edit away, is a typo: an owned typo can be removed, an unowned one
  is only a warning;
- a builtin entry whose `match` contains the exact token `agent` is a warning
  about Herdr routing generic agent launches to it.

Each proposal is applied one at a time through the same `edit()` path, so
compare-and-swap, backups and ownership are unchanged.

## Detection

### The login shell

Herdr starts a program through the user's login interactive shell
(`/bin/zsh -lic '"$@"' zsh <argv>`). The app's own process, and therefore the
mod's `exec()`, has a shorter PATH: `~/.cargo/bin`, `~/.opencode/bin` and
similar folders can be missing. Probing with the app's PATH would call an
agent "not installed" even though the + menu would start it.

`path-probe.js` therefore asks `$SHELL`:

1. It reads `$SHELL` and accepts only an absolute path whose basename is
   `zsh`, `bash`, `fish`, `sh`, `dash` or `ksh`.
2. It runs one `-lic` script that prints a begin marker, one `command -v` per
   binary and an end marker. Only `FOUND <name>` lines between the markers
   count, so an rc-file banner cannot confuse the answer.
3. Without a usable shell, or if that call fails or prints no markers, it
   falls back to one `sh -c` loop over the names.
4. On Windows there is no login shell: it runs `where` per name.

`probeBinaries()` returns `{ ok, found }`. `ok: false` means "could not check"
and is shown as such, never as "not installed". The dialog also merges
`knownAgents()`: what Herdr already knows wins over a probe that could not
answer. The same probe request includes the install tools (`npm`, `python`,
`python3`, `pip`, `brew`, `uv`, `curl`).

`detect()` probes the catalog commands, the commands of entries this mod wrote
and the install tools, all in one shell call. Row state is three-valued:
`true` installed, `false` not installed, `undefined`/unknown could not check.

### Folders Herdr does not see

`scanFound()` runs `path-scan.js` only for binaries the login shell reported as
missing. On POSIX it checks the usual folders an official installer uses
(`~/.local/bin`, `~/.cargo/bin`, `~/.bun/bin`, `~/.deno/bin`, `~/go/bin`,
`~/.npm-global/bin`, `~/.opencode/bin`, `~/.volta/bin`, `~/.yarn/bin`,
`~/.local/share/pnpm`, `/opt/homebrew/bin`, `/usr/local/bin`, and Python's
versioned user folder). It skips nvm-style folders because their names change
on every upgrade.

When a command is found there, the row says `installed, but Herdr can't see it`
and offers **Use full path**. Confirming adds the entry (or repoints one this
mod wrote) with an absolute `run[0]`; Herdr treats an absolute path as
installed. This is read-only until the confirm. Windows gets no scan.

## The dialog

`init()` loads the file, then detects binaries, scans the extra folders and
reads the bridges' status. `reload()` (the **Re-check** button and the
**Reload** button in an error banner) repeats that sequence and also stops any
install watcher.

### Sections and search

The list has four sections, in paint order: **Ready to add**, **Needs
install**, **Already in your + menu** and **Ships with Herdr**. The last one
starts collapsed, and section headers collapse on click. A verified agent goes
to "ready" when its command was found and to "needs install" otherwise; an
entry that already has `run` goes to "added"; builtin and unverified rows go
to "ships". The "added" section also lists custom entries this mod wrote.

The search box matches the name, the key and the command. It hides rows from
the list and from the arrow-key path; a checked agent that the search hides is
not added. A banner above the list offers **Add all** for installed catalog
agents that are missing from `programs.json`.

### Keyboard contract

Focus starts in the search box. Tab and Shift+Tab follow `tabOrder()`:

`search → continue → Add → Add your own agent... → (only while that form is
open) key → name → command → Add custom → Remove / Remove continue / Add
continue for the entries this mod wrote → Reload (only while the file is
broken) → Close`.

A pending question inserts its two buttons (`Overwrite`/`Keep`, `Remove
anyway`/`Keep`, `Install and add`/`Cancel`, and so on) before Close. Tab does
not wrap: at either end the key leaves the dialog. Catalog rows are not Tab
stops.

Arrow Down from the search box moves to the first addable row that is painted;
arrows move between those rows and Space/Enter ticks one. Space/Enter also
toggles the continue checkbox, the disclosure and the buttons; Space and Enter
inside a text field type normally. Enter in the command field submits the
custom form.

The section headers, the language switch (EN / ES), **Re-check**, **Add all**,
and the per-row **Install**, **Bridge** and **Use full path** buttons are
pointer-only; **Remove**, **Remove continue** and **Add continue** are Tab
stops. Commands are tokenized like a program, not a shell: single and double
quotes group, only
`\"` and `\\` escape, and an unclosed quote is an error. The custom form never
writes `match` (Herdr derives it from `run[0]`), refuses the keys `shell`,
`program`, `agent` and anything ending in `-continue`, and asks before saving a
command that cannot be found.

Messages carry an explicit level (error, warning, success, info). A save in
progress paints **Saving…** and disables the save buttons. The toast only
reports counts; the per-agent hints stay in the dialog.

## The install flow

### The Install button

A row offers **Install** only when it is verified, its command was not found,
and its catalog `install` string passes `isRunnableInstall()`. That rule is
shared with the catalog validator and allows only simple commands joined by
` && `: `npm i|install -g [--ignore-scripts] <pkg>`, `uv tool install <pkg>`,
`pip install <pkg>` / `python -m pip install <pkg>`, `brew install <pkg>`, and
`curl -fsSL|-LsSf https://... | sh|bash`, plus a trailing `<name>-install` after
the first command.

Before showing the confirm, `missingTools()` checks whether the command's
first words (`npm`, `python`, `pip`, `brew`, `uv`, `curl`) exist. If one is
missing, the button says **Needs X**, explains where to get it and runs
nothing; a missing `python` with `python3` present gets its own explanation.

The confirm shows the exact command. Confirming (button **Install and add**)
builds `planInstall()`:

```sh
sh -c '<install command>; printf "\n[finished - press Enter for a shell]\n"; read _'
```

and runs it with `run("tab.new", { name, argv })`. The command does not run
before the confirm, and the flow is disabled on Windows because it needs `sh`.

### The watcher

After the tab opens, `startInstallWatch()` waits for the command to appear:
every 5 s, for at most 3 minutes. Each tick re-runs detection; when the binary
is found it adds the catalog entry (and the continue variant when the checkbox
is on) through the normal add path. **Re-check** or closing the dialog stops
the wait. At the deadline the dialog says the agent is still missing. The
watcher never runs the install itself; the tab does.

## Status bridges

The **Agents** panel is separate from the + menu: it only lists terminals that
report their state with the OSC 7501 sequence:

```text
ESC ] 7501 ; state=<idle|working|blocked> : app=<app> ST
```

Native reporters (Claude Code, Codex, OpenCode, omp) need nothing. For other
agents, `bridges/` has opt-in adapters (Cursor, Command Code, Empryo) that call
the shared emitter `bridges/lib/herdr-osc.sh`, merge their commands into the
agent's hook file with a backup, and support `--uninstall`.

Every adapter also supports `--status`: it prints exactly one JSON line (for
example `{"app":"cursor","installed":true,"file":"..."}`) and writes nothing.
The dialog reads it for each catalog row with a `bridge` when it opens and
after every change; a failed or unknown read leaves the row on the plain
**Bridge** button.

`bridge-install.js` builds a plan for one of four actions (`status`, `preview`,
`install`, `uninstall`) and only accepts `bridges/<one-segment>/install.mjs`
under the resolved root. Before running, `runBridgePlan()` rebuilds the allowed
argv and refuses a tampered plan. The click runs a dry run; installing or
removing needs the confirm, which shows the hook file and the exact command.
Nothing is ever installed on its own, and the whole bridge UI is hidden on
Windows. Catalog entries that report OSC 7501 themselves use `nativeOsc: true`
and must not also carry `bridge` (the validator enforces this).

## Tests and checks

`scripts/smoke-test.mjs` copies `mods/more-agents/` into a fresh temp folder,
writes a `package.json` with `"type": "module"`, and rewrites the
`gpui-kit`/`gpui-base`/`herdr` imports in `main.js` to `scripts/smoke/stubs.mjs`.
It then runs every `scripts/smoke/*.test.mjs` in its own sandbox with
`MA_HOME` pointing at a temp home, and ends with `ALL OK (<n> test files)`.
The stubs replace the host, the filesystem read/write, the shell probe and
`notify`, so the logic is testable without a window.

Test knobs (environment variables read by `stubs.mjs`):

| Knob | Effect |
| --- | --- |
| `MA_HOME` | Sandbox app home (`appHome()`). |
| `MA_SYS_HOME` | Fake OS home; drives Windows detection and `path-scan`. |
| `MA_ONPATH` | Binaries the login shell (or `where`) finds, space separated. |
| `MA_SH_ONPATH` | Binaries only the `sh -c` fallback finds; defaults to `MA_ONPATH`. |
| `MA_SHELL` | What `$SHELL` reports; empty forces the fallback. |
| `MA_LOGIN_FAIL=1` | The login-shell call throws. |
| `MA_LOGIN_SILENT=1` | It prints no markers. |
| `MA_KNOWN_AGENTS` | Names `knownAgents()` reports as installed. |
| `MA_EXEC_FAIL=1` | Detection throws. |
| `MA_FAIL_WRITE` | Comma-separated path fragments whose write throws. |
| `MA_TOOLS_MISSING=1` | Removes the install tools from the probe. |

`scripts/validate-catalog.mjs` parses `catalog.js` as strict JSON and checks
fields, ids, dates, icons, install shapes, `tier`, bridges and `nativeOsc`. With
`--icons` and `--builtin` it also compares against a Herdr checkout.

`scripts/check-links.mjs` requests every `docs` and `source` URL (a builtin's
`source` is skipped because it has no public page), flags verified entries
whose `checked` date is over 90 days old, and supports `--offline` for the
freshness check only. A weekly GitHub workflow runs it.

CI runs validate and the smoke tests on Ubuntu and macOS with Node 22, checks
the validator against a generated fixture (missing icon, missing builtin), and
runs `herdr-app check mods/more-agents` when the app is installed.

## Repository map

```text
mods/more-agents/            the mod (see the table above)
bridges/                     optional OSC 7501 adapters and the shared emitter
scripts/install.mjs          installs/updates/uninstalls the mod in the app home
scripts/validate-catalog.mjs catalog checks
scripts/smoke-test.mjs       runs scripts/smoke/*.test.mjs against the stubs
scripts/smoke/               one sandbox per test file, plus stubs.mjs
scripts/check-links.mjs      docs/source URL and freshness check
keys.json                    optional Alt+Shift+A binding for mod.open
programs.snippet.json        alternative without the mod (omp + Command Code)
.github/workflows/           CI and the weekly catalog-health job
```
