#!/usr/bin/env node
// Installs (or updates) this mod into Herdr's app home:
//   ~/.config/herdr-app/mods/more-agents
// The copy is prepared in a staging folder and swapped in with a rename, so an
// interrupted update never leaves a half-written mod or a nested
// mods/more-agents/more-agents. The previous folder is kept as
// mods/more-agents.bak (one backup: the next update replaces it).
// programs.json and keys.json are never touched.
//
// Usage: node scripts/install.mjs [--home <app home>] [--dry-run] [--uninstall]
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};
const usage = () => console.log(`Usage: node scripts/install.mjs [options]

  --home <dir>   Herdr app home (default: $HERDR_APP_HOME or ~/.config/herdr-app)
  --dry-run      Print what would change; write nothing
  --uninstall    Remove mods/more-agents (leaves programs.json and keys.json alone)
  --help         Show this help`);

if (flag("--help") || flag("-h")) { usage(); process.exit(0); }

const dryRun = flag("--dry-run");
const uninstall = flag("--uninstall");
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const source = join(repo, "mods", "more-agents");
// Herdr regenerates gpui-kit.d.ts on every run and jsconfig.json is editor
// config: neither belongs in an installed copy.
const NOT_INSTALLED = new Set(["gpui-kit.d.ts", "jsconfig.json"]);
const bridges = join(repo, "bridges");
const appHome = resolve(value("--home") ?? process.env.HERDR_APP_HOME ?? join(homedir(), ".config", "herdr-app"));
const modsDir = join(appHome, "mods");
const target = join(modsDir, "more-agents");
const backup = join(modsDir, "more-agents.bak");
const staging = join(modsDir, `.more-agents.staging-${process.pid}-${Date.now().toString(36)}`);

const fail = (msg) => { console.error(`install: ${msg}`); process.exit(1); };

if (uninstall) {
  if (!existsSync(target)) { console.log(`Not installed: ${target}`); process.exit(0); }
  if (dryRun) { console.log(`Would remove ${target}`); process.exit(0); }
  rmSync(target, { recursive: true, force: true });
  console.log(`Removed ${target}`);
  console.log("A status bridge must be removed first with node <checkout>/bridges/<id>/install.mjs --uninstall, or its hooks point at a deleted file.");
  console.log("programs.json and keys.json were not touched.");
  process.exit(0);
}

if (!existsSync(join(source, "mod.json"))) fail(`mod folder not found at ${source}`);

if (dryRun) {
  console.log(`Would copy ${source}`);
  console.log(`           to ${target}`);
  if (existsSync(target)) console.log(`Would keep the previous folder as ${backup}`);
  console.log("Dry run: nothing was written.");
  process.exit(0);
}

let movedPrevious = false;
try {
  mkdirSync(modsDir, { recursive: true });
  rmSync(staging, { recursive: true, force: true });
  cpSync(source, staging, {
    recursive: true,
    errorOnExist: true,
    filter: (path) => !NOT_INSTALLED.has(basename(path)),
  });
  if (!existsSync(join(staging, "mod.json")) || existsSync(join(staging, "more-agents"))) {
    throw new Error("staged copy has an unexpected layout");
  }
  // The dialog finds a bridge next to main.js, so the installed copy needs the
  // whole folder. Nothing in it is run here.
  cpSync(bridges, join(staging, "bridges"), { recursive: true, errorOnExist: true });
  if (existsSync(target)) {
    rmSync(backup, { recursive: true, force: true });
    renameSync(target, backup);
    movedPrevious = true;
    console.log(`Backed up the previous folder to ${backup}`);
  }
  renameSync(staging, target);
  console.log(`${movedPrevious ? "Updated" : "Installed"} ${target}`);
  console.log("programs.json and keys.json were not touched.");
} catch (e) {
  rmSync(staging, { recursive: true, force: true });
  // Put the old folder back if the swap failed after moving it aside.
  if (movedPrevious && !existsSync(target)) {
    try { renameSync(backup, target); } catch {}
  }
  fail(e?.message ?? String(e));
}
