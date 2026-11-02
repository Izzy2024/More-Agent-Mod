# Bridges

Optional hooks that report an agent's state to Herdr. An agent that does not write [OSC 7501](#osc-7501) itself gets a small adapter. Every adapter calls the same emitter, `bridges/lib/herdr-osc.sh`.

The More agents mod does not run anything in this folder. `scripts/install.mjs` only copies the mod. Adding a row to `programs.json` does not register hooks. You install an adapter yourself, from a checkout, after reading it.

## The + menu and the Agents panel

Herdr keeps two lists, and they read different data.

The **+ menu** lists launchers stored in `programs.json`. More agents writes that file. A row shows up there when its command is on your `PATH`.

The **Agents panel** lists terminals that report a live state. Herdr reads that state from OSC 7501 written into the terminal. A terminal that has not written the sequence stays a normal terminal: the + menu can still start that agent, and Agents still has no row for it.

## OSC 7501

The sequence Herdr reads is:

```text
ESC ] 7501 ; state=<state> : app=<app> ST
```

`ESC` is the escape byte. `ST` is the string terminator, `ESC` followed by `\`. There are no spaces. `state` is `idle`, `working`, or `blocked`. `app` is a short token, the same kind of value a catalog `match` entry can name (`empryo`, `cursor`, `command-code`).

Herdr attaches the report to the terminal that received the bytes. A status such as `{app: empryo, state: idle}` is that sequence, parsed.

Hook processes have no controlling terminal. The emitter does not read `HC_TERMINAL_ID`: some agents, including Empryo, strip the hook environment. It walks parent process ids until it finds a process whose TTY is a writable device, then writes the sequence there. With no such ancestor, it writes nothing.

It always prints `{}` and exits 0, including when it writes nothing, so a hook runner does not treat the report as a failed hook.

## Shared emitter

`bridges/lib/herdr-osc.sh` is the only program that writes OSC 7501.

```text
sh bridges/lib/herdr-osc.sh <app> <state>
```

`<app>` is one token of letters, digits, `.`, `_`, and `-`. `<state>` is `idle`, `working`, or `blocked`. Any other argument produces no sequence. Adapters pass their own app id. The script has no built-in agent, and adapters do not carry a copy of it.

It needs POSIX `sh` and `ps` (macOS or Linux). On startup it puts `/usr/bin` and `/bin` on `PATH`, because hook runners often start with a stripped environment.

## Who already reports, and who needs an adapter

"Native" means the agent writes OSC 7501 itself. An adapter is required when it does not. A Herdr built-in launcher and a row in `mods/more-agents/catalog.js` are separate facts: some built-in launchers still need an adapter, and some native reporters are not rows this mod adds.

| Agent | `app` | Launcher | Agents panel |
| --- | --- | --- | --- |
| Claude Code | `claude` | Herdr built-in | native OSC 7501 |
| Codex | `codex` | Herdr built-in | native OSC 7501 |
| OpenCode | `opencode` | Herdr built-in | native OSC 7501 |
| Oh My Pi | `omp` | this catalog | native OSC 7501 |
| Empryo | `empryo` | none in this mod | adapter: `bridges/empryo` |
| Cursor CLI | `cursor` | Herdr built-in, also listed in the catalog | adapter not in this repo yet |
| Command Code | `command-code` | this catalog | adapter not in this repo yet |

Claude Code, Codex, and OpenCode are listed because they are the native reporters Herdr already understands. The other agents in `catalog.js` (Kilo, Qwen Code, Goose, Aider, and the rest) stay off this table until that agent's own output has been checked. A fork relationship is not that check.

Cursor and Command Code are the next adapters. This tree does not install them.

## Add an adapter

Three steps. The Empryo installer is the reference.

1. Create `bridges/<id>/install.mjs`. That directory holds the adapter only. Leave `bridges/lib/herdr-osc.sh` as the single emitter.
2. Call the shared emitter with that agent's app id: `sh <absolute-path-to>/bridges/lib/herdr-osc.sh <id> <state>`. `<id>` is the `app=` value Herdr should show.
3. Map that agent's own events onto `idle`, `working`, or `blocked`. Merge the rules into its hook file, leave every other hook in place, write a backup before a change, do nothing on a second run when the rules already match, and support `--uninstall`, which removes only commands that run `herdr-osc.sh` with this app id.

The mod stays out of this. An adapter runs when a person runs it.

## Security

A command hook is a command the agent runs as you. Read `bridges/lib/herdr-osc.sh` and the `command` string the installer writes before you install. The emitter writes the OSC 7501 sequence above to a TTY device of an ancestor process. It does not read the hook payload. An installer edits that agent's hook file and, when the file already exists and the run would change it, copies it to a sibling backup. It does not start the agent, and it does not change `programs.json`.

The hook file can name any command. Treat a later edit to `command` as a new script.

## Uninstall

From this checkout:

```sh
node bridges/<id>/install.mjs --uninstall
```

That removes hooks whose command runs `herdr-osc.sh` with that adapter's app id, on any event, and leaves the rest of the file. It does not remove the More agents mod. When the file changes, the installer refreshes that adapter's backup first.

Deleting the checkout, or moving it, stops reports: the hook command points at `bridges/lib/herdr-osc.sh` inside that checkout. Run the installer again from the new path.

## Empryo

Reference adapter. Hook file, events, and command-hook fields: <https://empryo.com/docs/tools/hooks>. Empryo reads Claude Code's hook format from `~/.empryo/hooks.json`.

| Empryo event | State |
| --- | --- |
| `SessionStart` | `idle` |
| `Stop` | `idle` |
| `SessionEnd` | `idle` |
| `UserPromptSubmit` | `working` |
| `PreToolUse` | `working` |
| `PostToolUse` | `working` |
| `Notification` | `blocked` |

Each rule is `{ "type": "command", "command": "sh <lib> empryo <state>", "timeout": 5, "async": true }`. The path is the absolute path of `bridges/lib/herdr-osc.sh`, shell-quoted. A new file is written as `{ "hooks": { "<event>": [ { "hooks": [ <rule> ] } ] } }`. When `hooks.json` already stores event arrays at the top level, those arrays are updated in place.

```sh
node bridges/empryo/install.mjs
node bridges/empryo/install.mjs --uninstall
```

A run that changes an existing file copies it to `~/.empryo/hooks.json.bak-herdr-empryo-osc`, replacing the previous backup. Invalid JSON is left untouched. A second install from the same checkout writes nothing.

A command left by the earlier hand-installed bridge (`~/.local/share/herdr-empryo-osc/herdr-osc.sh` plus a state, and no app argument) is the same reporter. Install replaces it with a call to the shared emitter. `--uninstall` removes that command too. Hooks that call `herdr-osc.sh` with any other app id stay.

Start Empryo from a Herdr terminal. Agents can show it after a hook has written OSC 7501 into that terminal. The + menu is a separate step: this adapter does not add a launcher.
