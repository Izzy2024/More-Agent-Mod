# More agents

Adds coding agents Herdr doesn't ship ready to start, such as Oh My Pi (`omp`), Command Code, Kilo Code, Qwen Code, Goose, Aider, Droid, Auggie, Junie and Mistral Vibe, to the + menu. You pick them from a catalog, or add any other command-line agent by name and command.

![More agents](preview.png)

## What you see

A dialog titled "More agents for the + menu". The catalog has one row per agent: name, the command it runs, and whether that command is on your PATH. When the command is missing, the row shows how to install it. Rows you can add have a checkbox. Rows for agents Herdr already ships say so and are greyed. Below the list:

- a "continue" checkbox;
- an Add button with the number of agents you picked;
- a form for your own agent: key, name, command.

## How it behaves

Open it with `mod.open more-agents` (command palette) or the key in keys.json.

**Adding.** Tick agents and press Add. Each one becomes an entry in `~/.config/herdr-app/programs.json`, and everything else in that file is kept.
- With "continue" ticked, a second entry starts the agent on its last session. This happens only where the agent documents a flag for it.
- An entry you already have with a command is never replaced.
- After a successful write, the previous version is saved to `programs.json.more-agents.bak`. The backup is best-effort: a failure is reported without blocking the write.
- The write only goes through if nobody changed the file since it was read.
- A broken programs.json is never written; the dialog says so.

Herdr reloads the table live, so new agents show in the + menu at once.

**Removing.** Remove deletes only the entries this mod added.

**Contributing.** The catalog is plain data in `mods/more-agents/catalog.js`, so new agents come in by pull request.

## Built from

- `mods/more-agents/main.js`
- `catalog.js` (data only)
- `mod.json` (place none, dialog overlay)

It uses `readTextFile`, `writeTextFile`, `exec` (`command -v`, or `where` on Windows), `knownAgents`, `shared` and `notify`.

## Watch out

- Status (working, blocked, done) only comes from agents that report OSC 7501. An agent that doesn't report it stays a plain terminal with its icon.
- Most catalog agents use Herdr's generic agent icon.
- Trae Agent lives in a uv virtualenv, so `trae-cli` has to be on your PATH.
- Needs Herdr App 0.1.8 or newer, the first version that shows programs.json entries in the + menu.

## Done when

- After Add, the + menu lists the agents you picked, and each one starts in a new tab.
- `herdr-app status` shows no programs.json error.
- Remove takes the agents out again.
