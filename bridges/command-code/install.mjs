#!/usr/bin/env node
// Command Code adapter for Herdr's Agents panel.
// Maps Command Code hook events to bridges/lib/herdr-osc.sh with app=command-code.
// Does not write OSC 7501 itself. The More agents mod never runs this file.
//
// PreToolUse is not a fixed state: the hook command reads tool_name and then
// execs the shared emitter with working, or blocked for a user question.
// That dispatcher is not a second emitter.
//
// Usage: node bridges/command-code/install.mjs [--uninstall | --dry-run]
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = "command-code";
const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, "..", "lib", "herdr-osc.sh");
const configDir = join(homedir(), ".commandcode");
const settingsPath = join(configDir, "settings.json");
const trustPath = join(configDir, "trusted-hooks.json");
const backupSuffix = ".bak-herdr-command-code-osc";

// Command Code event -> OSC state. "pretool" reads tool_name at hook time.
const EVENTS = [
  ["SessionStart", "idle"],
  ["PreToolUse", "pretool"],
  ["PostToolUse", "working"],
  ["Stop", "idle"],
];

const BLOCKED_TOOLS = ["AskUserQuestion", "Question", "ask_user_question"];

const args = process.argv.slice(2);
const fail = (msg) => {
  console.error(`command-code-bridge: ${msg}`);
  process.exit(1);
};

const usage = () => console.log(`Usage: node bridges/command-code/install.mjs [--status | --uninstall | --dry-run]

Merge Herdr OSC 7501 command hooks into ~/.commandcode/settings.json,
trust those commands in ~/.commandcode/trusted-hooks.json,
or remove only this adapter's hooks and fingerprints.
The earlier ~/.local/share/herdr-cmd-osc command is included.
Other hooks stay. --status prints one JSON line and writes nothing.
The More agents mod never runs this.`);

if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}
// Prints the files a real run would touch and writes nothing.
if (args.length === 1 && args[0] === "--dry-run") {
  console.log(`command-code-bridge: dry run. Would edit ${settingsPath} and ${trustPath}. Writes nothing.`);
  process.exit(0);
}
if (args.length > 1 || (args.length === 1 && !["--uninstall", "--status"].includes(args[0]))) {
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

// Reads the hook payload and execs the shared emitter. Hook PATH is often
// stripped, so the dispatcher puts /usr/bin and /bin first, same as the emitter.
function preToolCommand() {
  const lib = shellQuote(scriptPath);
  const blocked = BLOCKED_TOOLS.join("|");
  const script = [
    'PATH="/usr/bin:/bin${PATH:+:$PATH}"',
    "export PATH",
    "d=$(cat | tr '\\n' ' ')",
    `t=$(printf '%s' "$d" | awk 'match($0, /"tool_name"[[:space:]]*:[[:space:]]*"/) { s = substr($0, RSTART + RLENGTH); sub(/".*/, "", s); print s; exit }')`,
    `case "$t" in ${blocked}) s=blocked ;; *) s=working ;; esac`,
    `exec sh ${lib} ${APP} "$s"`,
  ].join("; ");
  return `sh -c ${shellQuote(script)}`;
}

const staticCommands = {
  idle: commandFor("idle"),
  working: commandFor("working"),
  pretool: preToolCommand(),
};

function desiredCommands() {
  return [staticCommands.idle, staticCommands.pretool, staticCommands.working];
}

// The status rule is exactly what installInto would write. A hook the user
// edited (another timeout, say) is not the rule this adapter installs.
function sameRule(hook, expected) {
  if (!hook || typeof hook !== "object" || Array.isArray(hook)) return false;
  return hook.type === expected.type && hook.command === expected.command
    && hook.timeout === expected.timeout && hook.async === expected.async;
}

function hasRule(entries, expected) {
  for (const entry of Array.isArray(entries) ? entries : []) {
    const hooks = entry && typeof entry === "object" && Array.isArray(entry.hooks) ? entry.hooks : [entry];
    for (const hook of hooks) if (sameRule(hook, expected)) return true;
  }
  return false;
}

function expectedRule(state) {
  return rule(state === "pretool" ? staticCommands.pretool : commandFor(state));
}

// Read-only. Never calls fail(): a broken file is a status, not an error exit.
// Trust fingerprints are not hook rules; install and --uninstall keep them in step.
function printStatus() {
  const report = { app: APP, installed: false, file: settingsPath };
  if (existsSync(settingsPath)) {
    let text;
    try {
      text = readFileSync(settingsPath, "utf8");
    } catch {
      report.error = "unreadable";
      console.log(JSON.stringify(report));
      return;
    }
    if (text.trim() !== "") {
      let doc;
      try {
        doc = JSON.parse(text);
      } catch {
        report.error = "invalid-json";
        console.log(JSON.stringify(report));
        return;
      }
      if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
        report.error = "invalid-json";
        console.log(JSON.stringify(report));
        return;
      }
      const map = doc.hooks && typeof doc.hooks === "object" && !Array.isArray(doc.hooks) ? doc.hooks : {};
      let present = 0;
      for (const [event, state] of EVENTS) if (hasRule(map[event], expectedRule(state))) present++;
      report.installed = present === EVENTS.length;
      if (present > 0 && !report.installed) report.partial = true;
    }
  }
  console.log(JSON.stringify(report));
}

if (args.length === 1 && args[0] === "--status") {
  printStatus();
  process.exit(0);
}

function sha16(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function isOurCommand(command) {
  if (typeof command !== "string") return false;
  // Hand-installed bridge. It took no app id and decided the state itself.
  if (/herdr-cmd-osc[/\\]herdr-osc\.sh\b/.test(command)) return true;
  // sh <lib>/herdr-osc.sh command-code <state>
  if (new RegExp(`herdr-osc\\.sh['"]?\\s+${APP}(?:\\s|$)`).test(command)) return true;
  // PreToolUse dispatcher: it names the lib, the app id, and the question tools.
  return command.includes("herdr-osc.sh") && command.includes(APP) && command.includes("AskUserQuestion");
}

function isOurs(hook) {
  if (!hook || typeof hook !== "object" || Array.isArray(hook)) return false;
  if (hook.type != null && hook.type !== "command") return false;
  return isOurCommand(hook.command);
}

function rule(command) {
  return { type: "command", command, timeout: 10 };
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

function assertEventArrays(map) {
  for (const [event] of EVENTS) {
    if (map[event] != null && !Array.isArray(map[event])) fail(`${settingsPath}: "${event}" must be an array`);
  }
}

function collectCommands(doc) {
  const out = [];
  const map = doc.hooks;
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  for (const entries of Object.values(map)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && typeof entry === "object" && Array.isArray(entry.hooks)) {
        for (const hook of entry.hooks) {
          if (hook && typeof hook.command === "string") out.push(hook.command);
        }
      } else if (entry && typeof entry.command === "string") out.push(entry.command);
    }
  }
  return out;
}

function installInto(map) {
  assertEventArrays(map);
  for (const [event, state] of EVENTS) {
    const kept = withoutOurs(Array.isArray(map[event]) ? map[event] : []);
    const next = rule(staticCommands[state]);
    const asGroup = kept.length === 0 || grouped(kept);
    map[event] = asGroup ? [...kept, { hooks: [next] }] : [...kept, next];
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

function load(path) {
  if (!existsSync(path)) return { doc: {}, existed: false };
  const text = readFileSync(path, "utf8");
  if (text.trim() === "") return { doc: {}, existed: true };
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(`${path}: invalid JSON (${message})`);
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) fail(`${path}: expected a JSON object`);
  return { doc, existed: true };
}

function save(path, doc) {
  const backup = `${path}${backupSuffix}`;
  mkdirSync(dirname(path), { recursive: true });
  let wroteBackup = false;
  if (existsSync(path)) {
    copyFileSync(path, backup);
    wroteBackup = true;
  }
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  try {
    renameSync(tmp, path);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    fail(message);
  }
  return wroteBackup ? backup : null;
}

// "" is the global scope. Every root already listed gets the same fingerprints,
// so an existing project does not prompt again. trustedAt is left alone when
// the fingerprint is already there.
function applyTrust(trust, { remove, ensure }) {
  const roots = new Set(Object.keys(trust));
  if (ensure.size > 0) roots.add("");
  for (const root of roots) {
    if (!Object.prototype.hasOwnProperty.call(trust, root)) trust[root] = [];
    const list = trust[root];
    if (!Array.isArray(list)) fail(`${trustPath}: ${root === "" ? '""' : root} must be an array`);
    const next = [];
    const seen = new Set();
    for (const entry of list) {
      const fp = entry && typeof entry === "object" ? entry.fingerprint : undefined;
      if (typeof fp === "string" && (remove.has(fp) || ensure.has(fp))) {
        if (remove.has(fp) && !ensure.has(fp)) continue;
        if (seen.has(fp)) continue;
        seen.add(fp);
        next.push(entry);
        continue;
      }
      next.push(entry);
    }
    for (const fp of ensure) {
      if (seen.has(fp)) continue;
      seen.add(fp);
      next.push({ fingerprint: fp, trustedAt: new Date().toISOString() });
    }
    if (next.length === 0) delete trust[root];
    else trust[root] = next;
  }
}

if (!uninstall && !existsSync(scriptPath)) fail(`shared emitter not found at ${scriptPath}`);

const settingsLoaded = load(settingsPath);
const trustLoaded = load(trustPath);
const settings = settingsLoaded.doc;
const trust = trustLoaded.doc;
const beforeSettings = JSON.stringify(settings);
const beforeTrust = JSON.stringify(trust);

const desired = new Set(desiredCommands());
const ensure = uninstall ? new Set() : new Set([...desired].map(sha16));
const remove = new Set();
for (const command of collectCommands(settings)) {
  if (!isOurCommand(command)) continue;
  const fp = sha16(command);
  if (!desired.has(command)) remove.add(fp);
}
if (uninstall) {
  for (const command of desired) remove.add(sha16(command));
  for (const command of collectCommands(settings)) {
    if (isOurCommand(command)) remove.add(sha16(command));
  }
}

applyTrust(trust, { remove, ensure });

if (settings.hooks == null) {
  if (!uninstall) settings.hooks = {};
} else if (typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) {
  fail(`${settingsPath}: "hooks" must be an object`);
}
if (settings.hooks) {
  if (uninstall) {
    stripOurs(settings.hooks);
    if (Object.keys(settings.hooks).length === 0) delete settings.hooks;
  } else {
    installInto(settings.hooks);
  }
}

const settingsChanged = JSON.stringify(settings) !== beforeSettings;
const trustChanged = JSON.stringify(trust) !== beforeTrust;
if (!settingsChanged && !trustChanged) {
  console.log(uninstall ? "No Command Code OSC hooks to remove." : "Command Code OSC hooks already match this checkout.");
  process.exit(0);
}

const backups = [];
if (settingsChanged) backups.push(save(settingsPath, settings));
if (trustChanged) backups.push(save(trustPath, trust));
console.log(
  uninstall
    ? `Removed Command Code OSC hooks from ${settingsPath}`
    : `Merged Command Code OSC hooks into ${settingsPath}`,
);
for (const backup of backups) {
  if (backup) console.log(`Backup: ${backup}`);
}
