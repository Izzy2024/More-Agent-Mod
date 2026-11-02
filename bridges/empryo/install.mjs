#!/usr/bin/env node
// Empryo adapter for Herdr's Agents panel.
// Maps Empryo hook events to bridges/lib/herdr-osc.sh with app=empryo.
// Does not write OSC 7501 itself. The More agents mod never runs this file.
//
// Usage: node bridges/empryo/install.mjs [--uninstall]
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = "empryo";
const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, "..", "lib", "herdr-osc.sh");
const hooksPath = join(homedir(), ".empryo", "hooks.json");
const backupPath = `${hooksPath}.bak-herdr-empryo-osc`;

// Empryo event -> OSC state. The shared emitter receives (app, state).
const EVENTS = [
  ["SessionStart", "idle"],
  ["UserPromptSubmit", "working"],
  ["PreToolUse", "working"],
  ["PostToolUse", "working"],
  ["Notification", "blocked"],
  ["Stop", "idle"],
  ["SessionEnd", "idle"],
];

const args = process.argv.slice(2);
const fail = (msg) => {
  console.error(`empryo-bridge: ${msg}`);
  process.exit(1);
};

const usage = () => console.log(`Usage: node bridges/empryo/install.mjs [--uninstall]

Merge Herdr OSC 7501 command hooks into ~/.empryo/hooks.json,
or remove only this adapter's hooks: herdr-osc.sh with app ${APP}, and the
earlier ~/.local/share/herdr-empryo-osc command. Other hooks stay.
The More agents mod never runs this.`);

if (args.includes("--help") || args.includes("-h")) {
  usage();
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
  if (hook.type !== "command" || typeof hook.command !== "string") return false;
  const command = hook.command;
  // Current contract: sh <lib>/herdr-osc.sh empryo <state>
  if (new RegExp(`herdr-osc\\.sh['"]?\\s+${APP}(?:\\s|$)`).test(command)) return true;
  // Hand-installed Empryo bridge (~/.local/share/herdr-empryo-osc), which took
  // only a state. It is this adapter's previous command, so a merge replaces it
  // instead of leaving a second reporter beside the shared emitter.
  return /herdr-empryo-osc[/\\]herdr-osc\.sh['"]?\s+(?:idle|working|blocked)\b/.test(command);
}

function rule(state) {
  return { type: "command", command: commandFor(state), timeout: 5, async: true };
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
  const flat = EVENTS.some(([event]) => Object.prototype.hasOwnProperty.call(doc, event));
  if (flat) return doc;
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
  stripOurs(map);
  for (const [event, state] of EVENTS) {
    const kept = map[event] ?? [];
    const next = rule(state);
    const asGroup = kept.length === 0 || grouped(kept);
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
    installInto(map);
  }
}
if (JSON.stringify(doc) === before) {
  console.log(uninstall ? "No Empryo OSC hooks to remove." : "Empryo OSC hooks already match this checkout.");
  process.exit(0);
}
save(doc);
console.log(uninstall ? `Removed Empryo OSC hooks from ${hooksPath}` : `Merged Empryo OSC hooks into ${hooksPath}`);
if (existsSync(backupPath)) console.log(`Backup: ${backupPath}`);
