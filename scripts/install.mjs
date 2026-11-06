#!/usr/bin/env node
// Installs (or updates) this mod into Herdr's app home:
//   ~/.config/herdr-app/mods/more-agents
// The copy is prepared in a staging folder and swapped in with a rename, so an
// interrupted update never leaves a half-written mod or a nested
// mods/more-agents/more-agents. The previous folder is kept as
// mods/more-agents.bak (one backup: the next update replaces it).
// programs.json is never touched. keys.json is only touched by --with-key and
// --uninstall, and the file is never deleted.
//
// Usage: node scripts/install.mjs [--home <app home>] [--dry-run] [--uninstall] [--with-key]
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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
  --uninstall    Remove mods/more-agents and, when it is exactly this mod's
                 (mod.open:more-agents), the alt-shift-a binding from keys.json;
                 the keys.json file itself is never deleted
  --with-key     Also merge alt-shift-a -> mod.open:more-agents into keys.json:
                 other bindings are kept, a binding someone else has for that
                 chord is left alone, and keys.json is backed up once to
                 keys.json.more-agents.bak before the first change
  --help         Show this help`);

if (flag("--help") || flag("-h")) { usage(); process.exit(0); }

const dryRun = flag("--dry-run");
const uninstall = flag("--uninstall");
const withKey = flag("--with-key");
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
const keysFile = join(appHome, "keys.json");
const keysBackup = join(appHome, "keys.json.more-agents.bak");
// The chord and command this mod owns. Only this exact value is ever removed.
const KEY_CHORD = "alt-shift-a";
const KEY_COMMAND = "mod.open:more-agents";
// The first Herdr App that lists programs.json entries in the + menu.
const MIN_HERDR = [0, 1, 8];

const fail = (msg) => { console.error(`install: ${msg}`); process.exit(1); };

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const serialize = (v) => `${JSON.stringify(v, null, 2)}\n`;
const show = (v) => (typeof v === "string" ? v : JSON.stringify(v));

// Same folder + rename, so a crash never leaves a half-written keys.json.
function writeAtomic(file, text) {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${basename(file)}.more-agents-${process.pid}-${Date.now().toString(36)}`);
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

// One backup: the content before this mod's first change. Never overwritten.
function backupKeysOnce(previous) {
  if (existsSync(keysBackup)) return false;
  try {
    writeFileSync(keysBackup, previous, { flag: "wx" });
    return true;
  } catch (e) {
    if (e?.code === "EEXIST") return false;
    throw e;
  }
}

// Reads keys.json and decides what --with-key would do, without writing.
function planKeyMerge() {
  if (!existsSync(keysFile)) {
    return { kind: "create", data: { global: { [KEY_CHORD]: KEY_COMMAND } }, previous: null };
  }
  let previous;
  try { previous = readFileSync(keysFile, "utf8"); }
  catch (e) { fail(`cannot read ${keysFile}: ${e?.message ?? e}. Nothing was changed.`); }
  let data;
  try { data = JSON.parse(previous); }
  catch (e) { fail(`${keysFile} is not valid JSON (${e?.message ?? e}); nothing was changed. Fix it, or run again without --with-key.`); }
  if (!isObject(data)) fail(`${keysFile} is not a JSON object; nothing was changed. Fix it, or run again without --with-key.`);
  if (data.global !== undefined && !isObject(data.global)) {
    fail(`${keysFile} has a "global" that is not an object; nothing was changed. Fix it, or run again without --with-key.`);
  }
  const owner = data.global?.[KEY_CHORD];
  if (owner === KEY_COMMAND) return { kind: "same", previous };
  if (owner !== undefined) return { kind: "owned", previous, owner };
  // Spreading keeps every other key in place; a missing global goes last.
  const global = { ...(data.global ?? {}), [KEY_CHORD]: KEY_COMMAND };
  return { kind: data.global === undefined ? "create-global" : "add", data: { ...data, global }, previous };
}

function printKeyMerge(plan) {
  if (plan.kind === "same") console.log("Would leave keys.json alone: alt-shift-a already opens more-agents.");
  else if (plan.kind === "owned") console.log(`Would leave keys.json alone: alt-shift-a is bound to ${show(plan.owner)}, not this mod.`);
  else if (plan.kind === "create") console.log(`Would create ${keysFile} with alt-shift-a -> ${KEY_COMMAND}`);
  else console.log(`Would add alt-shift-a -> ${KEY_COMMAND} to ${keysFile}${existsSync(keysBackup) ? "" : ` (after backing it up to ${keysBackup})`}`);
}

function applyKeyMerge(plan) {
  if (plan.kind === "same") {
    console.log(`alt-shift-a already opens more-agents in ${keysFile}; nothing to change.`);
    return;
  }
  if (plan.kind === "owned") {
    console.log(`keys.json already binds alt-shift-a to ${show(plan.owner)} (not this mod); left it alone.`);
    return;
  }
  if (plan.previous !== null && backupKeysOnce(plan.previous)) console.log(`Backed up keys.json to ${keysBackup}`);
  writeAtomic(keysFile, serialize(plan.data));
  console.log(plan.kind === "create"
    ? `Created ${keysFile} with alt-shift-a -> ${KEY_COMMAND}`
    : `Added alt-shift-a -> ${KEY_COMMAND} to ${keysFile}`);
}

// Reads keys.json for --uninstall and decides what to remove, without writing.
// Unreadable keys.json is reported and left alone: the mod removal still wins.
function planKeyRemoval() {
  if (!existsSync(keysFile)) return { kind: "absent" };
  let previous;
  try { previous = readFileSync(keysFile, "utf8"); }
  catch (e) { return { kind: "invalid", reason: e?.message ?? String(e) }; }
  let data;
  try { data = JSON.parse(previous); }
  catch (e) { return { kind: "invalid", reason: e?.message ?? String(e) }; }
  if (!isObject(data)) return { kind: "invalid", reason: "not a JSON object" };
  if (data.global === undefined) return { kind: "nochord" };
  if (!isObject(data.global)) return { kind: "invalid", reason: '"global" is not an object' };
  const owner = data.global[KEY_CHORD];
  if (owner === undefined) return { kind: "nochord" };
  if (owner !== KEY_COMMAND) return { kind: "owned", owner };
  const global = { ...data.global };
  delete global[KEY_CHORD];
  const next = { ...data };
  if (Object.keys(global).length === 0) delete next.global;
  else next.global = global;
  return { kind: "remove", data: next, previous };
}

function printKeyRemoval(plan) {
  if (plan.kind === "remove") console.log(`Would remove alt-shift-a from ${keysFile}`);
  else if (plan.kind === "owned") console.log(`Would leave keys.json alone: alt-shift-a is bound to ${show(plan.owner)}, not this mod.`);
  else if (plan.kind === "invalid") console.log(`Would leave keys.json alone: it could not be parsed (${plan.reason}).`);
}

function applyKeyRemoval(plan) {
  if (plan.kind === "invalid") {
    console.warn(`Warning: keys.json could not be parsed (${plan.reason}); left it alone.`);
    return;
  }
  if (plan.kind === "owned") {
    console.log(`keys.json binds alt-shift-a to ${show(plan.owner)} (not this mod); left it alone.`);
    return;
  }
  if (plan.kind !== "remove") return;
  if (backupKeysOnce(plan.previous)) console.log(`Backed up keys.json to ${keysBackup}`);
  writeAtomic(keysFile, serialize(plan.data));
  console.log(`Removed alt-shift-a from ${keysFile}`);
}

// A missing herdr-app, a failing command or unparsable output is never an
// error: this is a warning only, and only on install/update.
function checkHerdrVersion() {
  let r;
  try {
    r = spawnSync("herdr-app", ["--version"], { encoding: "utf8", timeout: 5000 });
  } catch { return; }
  if (!r || r.error || r.status !== 0) return;
  const m = `${r.stdout ?? ""}${r.stderr ?? ""}`.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  if (!m) return;
  const found = [Number(m[1]), Number(m[2]), Number(m[3])];
  let older = false;
  for (let i = 0; i < 3; i++) {
    if (found[i] === MIN_HERDR[i]) continue;
    older = found[i] < MIN_HERDR[i];
    break;
  }
  if (older) {
    console.warn(`Warning: herdr-app ${m[1]}.${m[2]}.${m[3]} is older than 0.1.8; the + menu lists programs.json entries only from 0.1.8. Installing anyway.`);
  }
}

if (uninstall) {
  let removed = false;
  if (existsSync(target)) {
    if (dryRun) console.log(`Would remove ${target}`);
    else { rmSync(target, { recursive: true, force: true }); removed = true; console.log(`Removed ${target}`); }
  } else {
    console.log(`Not installed: ${target}`);
  }
  const keysPlan = planKeyRemoval();
  if (dryRun) printKeyRemoval(keysPlan);
  else applyKeyRemoval(keysPlan);
  if (removed) console.log("A status bridge must be removed first with node <checkout>/bridges/<id>/install.mjs --uninstall, or its hooks point at a deleted file.");
  console.log("programs.json was not touched.");
  process.exit(0);
}

if (!existsSync(join(source, "mod.json"))) fail(`mod folder not found at ${source}`);

// Plan the key merge before installing anything: a broken keys.json refuses
// the whole run instead of leaving a half-done install behind.
const keyPlan = withKey ? planKeyMerge() : null;

checkHerdrVersion();

if (dryRun) {
  console.log(`Would copy ${source}`);
  console.log(`           to ${target}`);
  if (existsSync(target)) console.log(`Would keep the previous folder as ${backup}`);
  if (keyPlan) printKeyMerge(keyPlan);
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
} catch (e) {
  rmSync(staging, { recursive: true, force: true });
  // Put the old folder back if the swap failed after moving it aside.
  if (movedPrevious && !existsSync(target)) {
    try { renameSync(backup, target); } catch {}
  }
  fail(e?.message ?? String(e));
}

if (keyPlan) {
  try { applyKeyMerge(keyPlan); }
  catch (e) { fail(`the mod was installed, but keys.json could not be written: ${e?.message ?? e}`); }
}
console.log(withKey ? "programs.json was not touched." : "programs.json and keys.json were not touched.");
