#!/usr/bin/env node
// Cursor CLI adapter for Herdr's Agents panel.
// Maps Cursor hook events to bridges/lib/herdr-osc.sh with app=cursor.
// Does not write OSC 7501 itself. The More agents mod never runs this file.
//
// Usage: node bridges/cursor/install.mjs [--uninstall | --dry-run]
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = "cursor";
const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, "..", "lib", "herdr-osc.sh");
const hooksPath = join(homedir(), ".cursor", "hooks.json");
const backupPath = `${hooksPath}.bak-herdr-cursor-osc`;

// Cursor version-1 event -> OSC state. The shared emitter receives (app, state).
const EVENTS = [
  ["sessionStart", "idle"],
  ["beforeSubmitPrompt", "working"],
  ["preToolUse", "working"],
  ["postToolUse", "working"],
  ["stop", "idle"],
];

const args = process.argv.slice(2);
const fail = (msg) => {
  console.error(`cursor-bridge: ${msg}`);
  process.exit(1);
};

const usage = () => console.log(`Usage: node bridges/cursor/install.mjs [--uninstall | --dry-run]

Merge Herdr OSC 7501 command hooks into ~/.cursor/hooks.json,
or remove only this adapter's hooks: herdr-osc.sh with app ${APP}, and the
earlier ~/.local/share/herdr-cursor-osc command. Other hooks (Orca included) stay.
The More agents mod never runs this.`);

if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}
// Prints the file a real run would touch and writes nothing.
if (args.length === 1 && args[0] === "--dry-run") {
  console.log(`cursor-bridge: dry run. Would edit ${hooksPath}. Writes nothing.`);
  process.exit(0);
}
if (args.length > 1 || (args.length === 1 && args[0] !== "--uninstall")) {
  usage();
  process.exit(1);
}
const uninstall = args[0] === "--uninstall";

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function commandFor(state) {
  return `sh ${shellQuote(scriptPath)} ${APP} ${state}`;
}

function isOurs(hook) {
  if (!hook || typeof hook !== "object" || Array.isArray(hook)) return false;
  if (typeof hook.command !== "string") return false;
  if (hook.type != null && hook.type !== "command") return false;
  const command = hook.command;
  // Current contract: sh <lib>/herdr-osc.sh cursor <state>
  if (new RegExp(`herdr-osc\\.sh['"]?\\s+${APP}(?:\\s|$)`).test(command)) return true;
  // Hand-installed Cursor bridge (~/.local/share/herdr-cursor-osc), which took
  // only a state. A merge replaces it instead of leaving a second reporter.
  return /herdr-cursor-osc[/\\]herdr-osc\.sh['"]?\s+(?:idle|working|blocked)\b/.test(command);
}

function rule(state) {
  // Cursor hooks.json version 1 stores flat { command, timeout } entries.
  return { command: commandFor(state), timeout: 10 };
}

function withoutOurs(entries) {
  if (!Array.isArray(entries)) return [];
  const out = [];
  for (const entry of entries) {
    if (entry && typeof entry === "object" && !Array.isArray(entry) && Array.isArray(entry.hooks)) {
      const hooks = entry.hooks.filter((hook) => !isOurs(hook));
      if (hooks.length === 0) continue;
      out.push(hooks.length === entry.hooks.length ? entry : { ...entry, hooks });
      continue;
    }
    if (isOurs(entry)) continue;
    out.push(entry);
  }
  return out;
}

function grouped(entries) {
  return entries.some((entry) => entry && typeof entry === "object" && !Array.isArray(entry) && Array.isArray(entry.hooks));
}

function hooksRoot(doc, create) {
  if (Object.prototype.hasOwnProperty.call(doc, "hooks")) {
    if (doc.hooks == null || typeof doc.hooks !== "object" || Array.isArray(doc.hooks)) {
      fail(`${hooksPath}: "hooks" must be an object`);
    }
    return doc.hooks;
  }
  if (!create) return null;
  doc.hooks = {};
  return doc.hooks;
}

function assertEventArrays(map) {
  for (const [event] of EVENTS) {
    if (map[event] != null && !Array.isArray(map[event])) fail(`${hooksPath}: "${event}" must be an array`);
  }
}

function stripOurs(map) {
  for (const event of Object.keys(map)) {
    if (!Array.isArray(map[event])) continue;
    const kept = withoutOurs(map[event]);
    if (kept.length === 0) delete map[event];
    else map[event] = kept;
  }
}

function installInto(map) {
  assertEventArrays(map);
  for (const [event, state] of EVENTS) {
    const kept = withoutOurs(Array.isArray(map[event]) ? map[event] : []);
    const next = rule(state);
    // An empty event is a flat list. That is the version-1 shape. A file that
    // already groups hooks keeps that shape so the two are not mixed.
    // Assigning an existing key keeps its place, so a second run does not reorder.
    const asGroup = kept.length > 0 && grouped(kept);
    map[event] = asGroup ? [...kept, { hooks: [next] }] : [...kept, next];
  }
}

function load() {
  if (!existsSync(hooksPath)) return {};
  const text = readFileSync(hooksPath, "utf8");
  if (text.trim() === "") return {};
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(`${hooksPath}: invalid JSON (${message})`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) fail(`${hooksPath}: expected a JSON object`);
  return doc;
}

function save(doc) {
  mkdirSync(dirname(hooksPath), { recursive: true });
  if (existsSync(hooksPath)) copyFileSync(hooksPath, backupPath);
  const tmp = `${hooksPath}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  try {
    renameSync(tmp, hooksPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(message);
  }
}

if (!uninstall && !existsSync(scriptPath)) fail(`shared emitter not found at ${scriptPath}`);

const doc = load();
const before = JSON.stringify(doc);
const map = hooksRoot(doc, !uninstall);
if (map) {
  if (uninstall) {
    stripOurs(map);
    if (doc.hooks && doc.hooks === map && Object.keys(map).length === 0) delete doc.hooks;
  } else {
    if (doc.version == null) doc.version = 1;
    installInto(map);
  }
}
if (JSON.stringify(doc) === before) {
  console.log(uninstall ? "No Cursor OSC hooks to remove." : "Cursor OSC hooks already match this checkout.");
  process.exit(0);
}
save(doc);
console.log(uninstall ? `Removed Cursor OSC hooks from ${hooksPath}` : `Merged Cursor OSC hooks into ${hooksPath}`);
if (existsSync(backupPath)) console.log(`Backup: ${backupPath}`);
