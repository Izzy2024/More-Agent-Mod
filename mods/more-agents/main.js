// More agents: adds agents that don't ship ready-made to Herdr's + menu.
// Herdr only knows the agents in its programs table, and a mod can't register
// them through an API, so this mod edits ~/.config/herdr-app/programs.json
// (the personal layer Herdr merges over defaults/programs.json and reloads
// live). The list comes from catalog.js (data only), so adding an agent is a
// PR to that file. It opens as a dialog: `mod.open more-agents`.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { appHome, home, exec, readTextFile, writeTextFile, knownAgents, theme, props, closeOverlay, notify, shared, setShared, run } from "herdr";
import CATALOG from "./catalog.js";
import { scan } from "./repair.js"; // lane-repair
// lane-catalog: dialog copy. English is the default; see copy.js.
import { LANGS, DEFAULT_LANG, copyFor } from "./copy.js";
import { planBridge, runBridgePlan, repoRootFrom } from "./bridge-install.js"; // lane-bridge
// lane-install: detected agents, the Install button's plan and the one install rule.
import { detectedAgents, formatDetected, isRunnableInstall, planInstall } from "./install-assist.js";

const OWN = "more-agents.keys"; // key -> fingerprint of the entry this mod wrote
const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
// The table's own keys (herdr.d.ts Program: "claude", "nvim", "shell",
// "program" (anything unlisted), "agent"). They are not ours to redefine.
const RESERVED = new Set(["shell", "program", "agent"]);
const WINDOWS = /^[A-Za-z]:[\\/]/.test(home()) || home().includes("\\");
const TILE = { tint: true, tile: "#1c1d21", color: "#ffffff" };
const BRIDGES_DOCS = "https://github.com/Izzy2024/More-Agent-Mod/tree/main/bridges";
// Paint order. Empty sections are skipped. "ships" starts collapsed.
const SECTIONS = [
  { id: "ready", copyKey: "sectionReady" },
  { id: "install", copyKey: "sectionInstall" },
  { id: "added", copyKey: "sectionAdded" },
  { id: "ships", copyKey: "sectionBuiltin" },
];

// Splits a command the way a program does, not the way a shell does: single and
// double quotes group, and only \" and \\ escape; any other backslash is
// literal, so Windows paths survive. An unclosed quote is an error.
export function tokenize(text) {
  const argv = [];
  let cur = "";
  let quoted = false; // the current token started, even if empty
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else cur += ch;
      quoted = true;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === "\\" && (text[i + 1] === '"' || text[i + 1] === "\\")) cur += text[++i];
      else cur += ch;
      quoted = true;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      quoted = true;
    } else if (ch === "\\" && (text[i + 1] === '"' || text[i + 1] === "\\")) {
      cur += text[++i];
      quoted = true;
    } else if (/\s/.test(ch)) {
      if (quoted) { argv.push(cur); cur = ""; quoted = false; }
    } else {
      cur += ch;
      quoted = true;
    }
  }
  if (quote) throw new Error(`Unclosed ${quote === '"' ? "double" : "single"} quote in the command.`);
  if (quoted) argv.push(cur);
  return argv;
}

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
// A run counts only as a non-empty array: [] , null or a stray string are not a command.
const runOf = (entry) => (Array.isArray(entry?.run) && entry.run.length ? entry.run : null);
const errText = (e) => String(e?.message ?? e);
// Levels for strings assigned by the write path. `msg` itself stays a string so
// the other smoke files can keep matching it; `say()` sets the level explicitly.
function inferLevel(text) {
  if (!text) return "info";
  if (/could not |nothing was written|not valid json|must be a json|must be an object|non-object entry|invalid key|unclosed |the command is missing|reserved program key|reserved for catalog/i.test(text))
    return "error";
  if (/backup was not written|already in your programs\.json|nothing was removed|changed since it was added|unknown ownership|check at least one|overwrite it or keep|is on your PATH|is not on your PATH|will not show in the \+ menu|need install/i.test(text))
    return "warning";
  if (/now shows? in the \+ menu|saved .+ in your programs\.json|removed from your programs\.json/i.test(text))
    return "success";
  return "info";
}

// A stale CAS is retried once; permission, space and other I/O errors are not.
function writeErrorKind(e) {
  const code = String(e?.code ?? "");
  if (code === "ESTALE" || code === "EEXIST") return "stale";
  if (["EACCES", "EPERM", "ENOSPC", "EROFS", "EDQUOT", "EMFILE", "ENFILE"].includes(code)) return "io";
  const text = errText(e);
  if (/permission denied|read-only|no space|quota|EACCES|EPERM|ENOSPC|EROFS/i.test(text)) return "io";
  if (/\bstale\b|changed since it was read|changed in the meantime|snapshot/i.test(text)) return "stale";
  return "io";
}
// Key-order-independent JSON, for comparing an entry with its merged result.
function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (isObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "undefined";
}

// FNV-1a of the whole entry, so any later edit by hand changes the fingerprint.
function fingerprint(entry) {
  const s = stableJson(entry);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `fnv1a:${h.toString(16).padStart(8, "0")}`;
}

// The programs.json entry for a catalog agent (and its continue variant).
function continueEntry(a) {
  return [`${a.id}-continue`, { name: `${a.name} · continue`, icon: a.icon, ...TILE, run: a.continue }];
}

function entries(a, withContinue) {
  const out = [[a.id, { name: a.name, icon: a.icon, ...TILE, ...(a.match ? { match: a.match } : {}), run: a.run }]];
  if (withContinue && a.continue) out.push(continueEntry(a));
  return out;
}

export const RESOLVE_MARK = "more-agents-resolve-argv0";
// Exact `command -v` only: one lookup, no per-file forks on PATH.
const RESOLVE_SH = [
  RESOLVE_MARK,
  `if command -v "$1" >/dev/null 2>&1; then
  printf 'EXACT\\n'
else
  printf 'MISSING\\n'
fi`,
].join("\n");

function parseResolveOutput(stdout) {
  const out = String(stdout ?? "").trim();
  if (out === "EXACT") return { status: "exact" };
  return { status: "missing" };
}

async function resolveArgv0Windows(binary, execFn) {
  const r = await execFn("where", [binary]).catch(() => ({ code: 1, stdout: "" }));
  if (r.code !== 0 || !String(r.stdout ?? "").trim()) return { status: "missing" };
  // `where empryo` finds empryo.exe: compare the name without its extension, and
  // Windows filenames are case-insensitive, so `Empryo` is the same command.
  const stem = (name) => name.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "").toLowerCase();
  const bases = new Set(String(r.stdout).trim().split(/\r?\n/).map(stem).filter(Boolean));
  return bases.has(stem(binary)) ? { status: "exact" } : { status: "missing" };
}

export async function resolveArgv0OnPath(binary, { exec: execFn, windows }) {
  if (!binary) return { status: "missing" };
  try {
    if (windows) return await resolveArgv0Windows(binary, execFn);
    const r = await execFn("sh", ["-c", RESOLVE_SH, "sh", binary]);
    return parseResolveOutput(r.stdout);
  } catch {
    return { status: "missing" };
  }
}

export default class MoreAgents extends View {
  // Text stays a string. The level is beside it: error, warning, success, info.
  get msg() { return this._msg ?? ""; }
  set msg(value) {
    if (value && typeof value === "object") {
      this._msg = String(value.text ?? "");
      this._level = value.level || inferLevel(this._msg);
      this._hold = false;
      return;
    }
    this._msg = value == null ? "" : String(value);
    if (!this._hold) this._level = inferLevel(this._msg);
    this._hold = false;
  }
  get msgLevel() { return this._level || "info"; }
  say(level, text) {
    this._hold = true;
    this._level = level;
    this.msg = text;
  }
  // What render painted, so smoke tests can read the dialog without a real window.
  note(text) {
    if (this.shown && text != null && text !== "") this.shown.push(String(text));
    return text;
  }
  // error → blocked, warning/info → muted, success → theme "success" or foreground.
  // herdr.d.ts theme() has no "success" key (blocked, muted, foreground, done, unknown).
  msgTone(t) {
    if (this.msgLevel === "error") return t.blocked;
    if (this.msgLevel === "success") return t.success || t.foreground;
    return t.muted;
  }

  init(_props, cx) {
    this.path = `${appHome()}/programs.json`;
    this.backup = `${appHome()}/programs.json.more-agents.bak`;
    this.orig = `${appHome()}/programs.json.more-agents.orig.bak`;
    this.raw = null;            // current text (null: does not exist)
    this.table = null;          // parsed JSON
    this.error = null;          // invalid file: nothing gets written
    this.loadGen = 0;           // ignores an older load that finishes late
    this.onPath = {};           // binary -> is on the PATH
    this.selected = new Set();  // checked ids
    this.withContinue = false;
    this.busy = false;
    this.msg = "";
    this.inputs = {
      key: InputState.new({ placeholder: "key, e.g. my-agent" }),
      name: InputState.new({ placeholder: "display name" }),
      run: InputState.new({ placeholder: "command, e.g. my-agent --flag" }),
      // LANE-CATALOG-INIT: the list's filter box. Its placeholder is set once,
      // in the language the dialog starts in.
      search: InputState.new({ placeholder: copyFor(DEFAULT_LANG).search }),
    };
    // Herdr doesn't move focus with Tab inside a mod dialog (its window doesn't
    // register gpui-shell's Tab action), so the dialog does it itself with the
    // public API: on_key_down + focus handles. It doesn't wrap: at either end
    // Tab leaves the dialog. The custom fields join this list only while the
    // disclosure is open (see tabOrder).
    this.order = ["search", "continue", "add-selected", "add-own", "close"];
    this.focusedField = "search";
    this.invalidField = null;
    this.customOpen = false;
    this.customOpenedByUser = false;
    this.sectionCollapsed = new Set(["ships"]);
    // cx.focus_handle() belongs in init, never in render.
    const handle = () => (typeof cx.focus_handle === "function" ? cx.focus_handle() : null);
    this.handleFactory = handle;
    this.handles = {
      continue: handle(), "add-selected": handle(), "add-own": handle(), "add-custom": handle(), close: handle(),
      "confirm-yes": handle(), "confirm-keep": handle(), reload: handle(),
    };
    this.actionHandles = {};    // rm-<id>, rm-continue-<id>, add-continue-<id>
    this.confirm = null;        // pending question: { kind: "overwrite" | "remove", ... }
    // LANE-BRIDGE: the last read-only --status per agent id, plus the runner and
    // the root the dialog uses (tests pin them). Unknown stays absent, so the row
    // keeps the plain dry-run button.
    this.bridgeStatus = {};
    this.bridgeExec = exec;
    this.bridgeRoot = null;
    this.rootHandle = handle();
    this.rowHandles = {};
    if (typeof cx.focus_handle === "function") {
      for (const a of CATALOG) {
        if (a.status === "verified") this.rowHandles[a.id] = cx.focus_handle();
        this.actionHandles[`rm-${a.id}`] = cx.focus_handle();
        this.actionHandles[`rm-continue-${a.id}`] = cx.focus_handle();
        this.actionHandles[`add-continue-${a.id}`] = cx.focus_handle();
      }
    }
    for (const k of ["key", "name", "run"]) {
      this.inputs[k].on("focus", () => { this.focusedField = k; });
      this.inputs[k].on("blur", () => { if (this.focusedField === k) this.focusedField = null; });
      this.inputs[k].on("change", () => { if (this.invalidField === k) this.invalidField = null; });
    }
    // LANE-CATALOG-INIT: English by default (the strings the smoke tests pin);
    // the header switch only changes the copy, nothing is persisted. The search
    // box notifies so the list repaints as you type. It is the first Tab stop,
    // and the dialog opens there.
    this.lang = DEFAULT_LANG;
    this.copy = copyFor(this.lang);
    this.inputs.search.on("focus", () => { this.focusedField = "search"; });
    this.inputs.search.on("blur", () => { if (this.focusedField === "search") this.focusedField = null; });
    this.inputs.search.on("change", (_e, cx) => cx?.notify?.());
    this.inputs.search.focus();
    // Focus is asked once on mount and once after the window settles: the other
    // shipped mods that take keyboard input do the same, because the first call
    // can land before the dialog exists.
    if (typeof cx.timer?.after === "function") cx.timer.after(600, () => this.inputs.search.focus());
    this.inputs.run.on("submit", (_e, cx) => this.addCustom(cx));
    cx.spawn(async (cx) => { await this.load(); cx.notify(); await this.detect(); cx.notify(); await this.checkBridges(); cx.notify(); });
  }

  async load() {
    const gen = ++this.loadGen;
    let raw;
    try {
      raw = await readTextFile(this.path);
    } catch (e) {
      if (gen !== this.loadGen) return;
      this.raw = null;
      this.table = null;
      this.error = `Could not read ${this.path}: ${errText(e)}. Nothing was written.`;
      return;
    }
    if (gen !== this.loadGen) return; // a newer load already decided
    this.raw = raw;
    if (raw == null) {
      this.table = { programs: {} };
      this.error = null;
      this.reconcileOwn(this.table.programs);
      this.ensureActionHandles(this.actionIds());
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      this.table = null;
      this.error = `programs.json is not valid JSON: ${errText(e)}. Nothing was written; fix it and try again.`;
      return;
    }
    if (!isObject(parsed)) {
      this.table = null;
      this.error = "programs.json must be a JSON object. Nothing was written.";
      return;
    }
    const programs = parsed.programs ?? {};
    if (!isObject(programs)) {
      this.table = null;
      this.error = 'programs.json "programs" must be an object keyed by program name. Nothing was written.';
      return;
    }
    for (const [key, value] of Object.entries(programs)) {
      if (!isObject(value)) {
        this.table = null;
        this.error = `programs.json has a non-object entry for "${key}". Nothing was written.`;
        return;
      }
    }
    parsed.programs = programs;
    this.table = parsed;
    this.error = null;
    this.reconcileOwn(programs);
    this.ensureActionHandles(this.actionIds());
  }

  // Which catalog binaries are installed? A single `sh -c` (or `where` on Windows),
  // with the user's real PATH. knownAgents() only knows about entries that already have run.
  async detect() {
    // Catalog + custom agents this mod added.
    const custom = this.ours().map((k) => runOf(this.table?.programs?.[k])?.[0]).filter((b) => typeof b === "string" && b);
    const bins = [...new Set([...CATALOG.filter((a) => a.status !== "unverified").map((a) => a.run[0]), ...custom])];
    try {
      if (WINDOWS) {
        for (const b of bins) this.onPath[b] = (await exec("where", [b]).catch(() => ({ code: 1 }))).code === 0;
      } else {
        const r = await exec("sh", ["-c", 'for b in "$@"; do command -v "$b" >/dev/null 2>&1 && echo "$b"; done', "sh", ...bins]);
        const found = new Set(r.stdout.split("\n").map((s) => s.trim()).filter(Boolean));
        for (const b of bins) this.onPath[b] = found.has(b);
      }
    } catch { this.onPath = {}; /* shown as unknown, not as the previous answer */ }
    // The interactive shell may have a different PATH (mise, nvm…): what Herdr already knows wins.
    try { for (const a of await knownAgents()) if (a.installed) this.onPath[a.run[0]] = true; } catch {}
  }

  // The banner names the failure. The sentence under it is load()'s own text,
  // which already includes the parser's line and column when it has them.
  errorHeading() {
    const e = this.error || "";
    if (e.startsWith("Could not read ")) return "Cannot read programs.json";
    if (e.includes("not valid JSON")) return "Invalid JSON";
    if (/must be|non-object entry/.test(e)) return "Unexpected shape";
    return "programs.json";
  }

  // Re-read, re-detect and re-check the bridges. Closing and reopening the
  // dialog does not do this.
  reload(cx) {
    if (this.busy) return false;
    const task = async (cx) => {
      await this.load();
      await this.detect();
      await this.checkBridges();
      cx?.notify?.();
    };
    if (typeof cx?.spawn === "function") {
      cx.spawn(task);
      return true;
    }
    return task(cx);
  }

  // Ownership: key -> fingerprint. The old format (an array of keys) means the
  // entry was written by an older version, so its fingerprint is unknown (null).
  own() {
    const value = shared(OWN);
    if (Array.isArray(value)) {
      const map = {};
      for (const key of value) if (typeof key === "string") map[key] = null;
      return map;
    }
    if (!isObject(value)) return {};
    const map = {};
    for (const [key, fp] of Object.entries(value)) map[key] = typeof fp === "string" ? fp : null;
    return map;
  }

  ours() { return Object.keys(this.own()); }

  setOwn(map) { setShared(OWN, map); }

  // Drop keys that are no longer in programs.json and migrate the old array.
  reconcileOwn(programs) {
    const raw = shared(OWN);
    const own = this.own();
    const kept = {};
    for (const [key, fp] of Object.entries(own)) {
      if (Object.prototype.hasOwnProperty.call(programs, key)) kept[key] = fp;
    }
    if (raw === undefined && !Object.keys(kept).length) return;
    if (Array.isArray(raw) || stableJson(raw) !== stableJson(kept)) {
      try { this.setOwn(kept); } catch {}
    }
  }

  // The catalog agent for a key (also for its -continue variant).
  agentOf(key) {
    const base = key.endsWith("-continue") ? key.slice(0, -"-continue".length) : key;
    return CATALOG.find((a) => a.id === base) ?? null;
  }

  // Only checked agents that can still be added count.
  selectable() {
    return [...this.selected].filter((id) => {
      const a = CATALOG.find((x) => x.id === id);
      return Boolean(a) && a.status === "verified" && !runOf(this.table?.programs?.[id])
        && (this.visibleIds?.has(id) ?? true);
    });
  }

  // The continue variant is offered only when the catalog documents it, the
  // base is present, and the variant is missing. Custom keys never have one.
  canAddContinue(a) {
    return Boolean(a?.continue) && a.status === "verified" &&
      Boolean(runOf(this.table?.programs?.[a.id])) &&
      !runOf(this.table?.programs?.[`${a.id}-continue`]);
  }

  // Herdr's + menu (mods/new-menu) shows ALL installed agents and, of the ones not
  // installed, only the first 2 in its internal order (Claude Code and Codex). An
  // added agent whose command is not on the PATH doesn't show until it's installed.
  addedMessage(keys) {
    const binOf = (k) => runOf(this.table?.programs?.[k])?.[0] ?? k;
    const ready = keys.filter((k) => this.onPath[binOf(k)] === true);
    const later = keys.filter((k) => this.onPath[binOf(k)] !== true);
    const parts = [];
    if (ready.length) parts.push(`${ready.join(", ")}: now ${ready.length === 1 ? "shows" : "show"} in the + menu.`);
    const bases = later.filter((k) => !(k.endsWith("-continue") && later.includes(k.slice(0, -"-continue".length))));
    for (const k of bases) {
      const a = this.agentOf(k);
      const hint = a?.install || a?.docs || "";
      parts.push(`Added ${k}; it shows in the + menu once \`${binOf(k)}\` is on your PATH${hint ? ` (${hint})` : ""}.`);
    }
    // The dialog keeps every hint. The toast only gets the count.
    const need = bases.length;
    const toast = need ? `Added ${keys.length}; ${need} need${need === 1 ? "s" : ""} install` : `Added ${keys.length}`;
    return { text: parts.join(" "), allReady: later.length === 0, toast };
  }

  // One attempt: load is already done. It is re-runnable, so `change` must
  // rebuild its ownership map from scratch on every call.
  async prepareEdit(change) {
    const before = this.raw;
    const beforeOwn = this.own();
    let result;
    try {
      result = change(this.table.programs);
    } catch (e) {
      this.msg = `Could not prepare the change: ${errText(e)}. Nothing was written.`;
      await this.load();
      return null;
    }
    if (!result?.changed?.length) return { result, text: null, before, beforeOwn };
    let text;
    try {
      text = JSON.stringify(this.table, null, 2) + "\n";
    } catch (e) {
      this.msg = `Could not serialize programs.json: ${errText(e)}. Nothing was written.`;
      await this.load();
      return null;
    }
    return { result, text, before, beforeOwn };
  }

  // Best-effort copies after a successful write: the pre-mod file once
  // (.orig.bak, never replaced) and the previous version for every write.
  async writeBackups(before) {
    const warnings = [];
    if (before == null) return warnings;
    try {
      const old = await readTextFile(this.orig);
      if (old == null) await writeTextFile(this.orig, before, null);
    } catch (e) {
      let exists = null;
      try { exists = await readTextFile(this.orig); } catch {}
      if (exists == null) warnings.push(`The original backup was not written: ${errText(e)}.`);
    }
    try {
      const old = await readTextFile(this.backup);
      await writeTextFile(this.backup, before, old);
    } catch (e) {
      warnings.push(`The backup was not written: ${errText(e)}.`);
    }
    return warnings;
  }

  // Read → change → write only if nobody touched it in between. One stale
  // conflict is retried from the new snapshot; a second one is reported.
  async edit(change) {
    await this.load();
    if (this.error) { this.msg = ""; return null; }
    let p = await this.prepareEdit(change);
    if (!p) return null;
    if (p.text == null) return p.result;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        if (p.result.own) this.setOwn(p.result.own); // intent first; rolled back if the write fails
      } catch (e) {
        try { this.setOwn(p.beforeOwn); } catch {}
        this.msg = `Could not record ownership: ${errText(e)}. Nothing was written.`;
        await this.load();
        return null;
      }
      try {
        await writeTextFile(this.path, p.text, p.before);
      } catch (e) {
        try { this.setOwn(p.beforeOwn); } catch {}
        const kind = writeErrorKind(e);
        if (kind === "stale" && attempt === 0) {
          await this.load(); // take the state the other writer left
          if (this.error) { this.msg = this.error; return null; }
          p = await this.prepareEdit(change);
          if (!p) return null;
          if (p.text == null) return p.result;
          continue;
        }
        const message = kind === "stale"
          ? "programs.json changed since it was read; nothing was written. Try again."
          : `Could not write ${this.path}${e?.code ? ` (${e.code})` : ""}: ${errText(e)}. Nothing was written.`;
        await this.load();
        this.msg = message;
        return null;
      }
      this.raw = p.text;
      const warnings = await this.writeBackups(p.before);
      return { ...p.result, warning: warnings.join(" ") };
    }
    return null;
  }

  // lane-repair: read-only proposals for entries that no longer match the catalog.
  // Nothing is written here; a broken file yields no proposals at all.
  scanRepairs() {
    if (this.error || !this.table?.programs) return [];
    try {
      return scan(this.table.programs, CATALOG, Object.keys(this.own()));
    } catch {
      return []; // a diagnostic must never break the dialog
    }
  }

  // lane-install: catalog agents already installed but absent from programs.json.
  detected() {
    return detectedAgents(CATALOG, this.table?.programs ?? {}, this.onPath);
  }

  // lane-repair: applies ONE proposal after the existing confirm. The write still
  // goes through edit() (via writeEntry/remove), so CAS and backups are unchanged.
  askRepair(proposal, cx) {
    if (!proposal || this.busy) return false;
    if (proposal.kind === "update") {
      this.confirm = { kind: "overwrite", key: proposal.key, entry: proposal.entry, where: "the catalog" };
      this.say("warning", `"${proposal.key}" does not match the catalog: overwrite it or keep it as is?`);
      this.moveFocus("confirm-keep", cx);
      cx?.notify?.();
      return true;
    }
    if (proposal.kind !== "remove") return false;
    // The rule stands: this mod does not delete an entry it did not write.
    if (!proposal.owned || !Object.prototype.hasOwnProperty.call(this.own(), proposal.key)) {
      this.say("warning", `Not removing ${proposal.key}: this mod did not write that entry. Remove it by hand if it is a typo.`);
      cx?.notify?.();
      return false;
    }
    this.confirm = { kind: "remove", keys: [proposal.key], changed: [proposal.key] };
    this.say("warning", `Remove the typo ${proposal.key} and keep ${proposal.neighbor}?`);
    this.moveFocus("confirm-keep", cx);
    cx?.notify?.();
    return true;
  }

  // Adds without overwriting: if your programs.json already has that key with run, it's left as is;
  // if it has it without run (e.g. just an icon), your fields win and only what's missing is added.
  addEntries(pairs, cx, done) {
    if (this.busy) return false;
    this.busy = true;
    this.confirm = null;
    cx.spawn(async (cx) => {
      let ok = false;
      try {
        const r = await this.edit((p) => {
          const changed = [], skipped = [];
          const own = this.own();
          for (const [key, entry] of pairs) {
            const base = key.endsWith("-continue") ? key.slice(0, -"-continue".length) : null;
            const prev = p[key];
            if (runOf(prev) || (base && skipped.includes(base))) { skipped.push(key); continue; }
            const merged = { ...entry, ...(isObject(prev) ? prev : {}) };
            if (!runOf(prev)) merged.run = entry.run;
            if (isObject(prev) && stableJson(prev) === stableJson(merged)) { skipped.push(key); continue; }
            p[key] = merged;
            changed.push(key);
          }
          if (changed.length) for (const key of changed) own[key] = fingerprint(p[key]);
          return { changed, skipped, own };
        });
        if (r) {
          ok = true;
          this.ensureActionHandles(this.actionIds());
          if (r.changed.length) {
            await this.detect(); // the message depends on whether the command is installed
            const added = this.addedMessage(r.changed);
            // A catalog row that needs an OSC 7501 bridge says so, with the repo
            // path. LANE-CATALOG: an agent that reports OSC 7501 itself
            // (nativeOsc) is not told to install a bridge.
            const bridged = [...new Set(r.changed.map((k) => this.agentOf(k)).filter((a) => a && a.bridge && !a.nativeOsc))];
            const copy = this.copy ?? copyFor(DEFAULT_LANG);
            const bridgeNotes = bridged.map((a) => copy.bridgeCatalog(a.name, a.bridge, BRIDGES_DOCS));
            this.msg = [
              added.text,
              ...bridgeNotes,
              r.warning,
              r.skipped.length ? `Already in your programs.json (left untouched): ${r.skipped.join(", ")}.` : "",
            ].filter(Boolean).join(" ");
            notify({ title: "More agents", body: [added.toast ?? added.text, r.warning].filter(Boolean).join(" "), level: added.allReady && !r.warning ? "success" : "info" });
          } else {
            this.msg = [
              r.skipped.length ? `Already in your programs.json (left untouched): ${r.skipped.join(", ")}.` : "Nothing to add.",
              r.warning,
            ].filter(Boolean).join(" ");
          }
          this.selected.clear();
        }
      } catch (e) {
        this.msg = `Could not add to programs.json: ${errText(e)}.`;
      } finally {
        this.busy = false;
        try { done?.(ok); } catch {}
        cx.notify();
      }
    });
    return true;
  }

  remove(keys, cx, force = false) {
    if (this.busy) return;
    this.busy = true;
    this.confirm = null;
    cx.spawn(async (cx) => {
      try {
        let needs = null;
        const r = await this.edit((p) => {
          const own = this.own();
          const present = [...new Set(keys)].filter((k) =>
            Object.prototype.hasOwnProperty.call(own, k) && Object.prototype.hasOwnProperty.call(p, k));
          if (!present.length) return { changed: [], skipped: [] };
          if (!force) {
            const bad = present.filter((k) => own[k] !== fingerprint(p[k]));
            if (bad.length) {
              needs = { kind: "remove", keys: present, changed: bad };
              return { changed: [], skipped: [] }; // nothing is written
            }
          }
          for (const k of present) delete p[k];
          const nextOwn = { ...own };
          for (const k of present) delete nextOwn[k];
          return { changed: present, skipped: [], own: nextOwn };
        });
        if (needs) {
          this.confirm = needs;
          this.msg = `Changed since it was added (or unknown ownership): ${needs.changed.join(", ")}. Nothing was removed.`;
          this.moveFocus("confirm-keep", cx);
        } else if (r) {
          this.msg = [
            r.changed.length ? `Removed from your programs.json: ${r.changed.join(", ")}.` : "Nothing to remove.",
            r.warning,
          ].filter(Boolean).join(" ");
          this.selected.clear();
          if (r.changed.length) this.moveFocus("add-selected", cx);
        }
      } catch (e) {
        this.msg = `Could not remove from programs.json: ${errText(e)}.`;
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  // LANE-BRIDGE: the root this dialog can trust (a checkout or an installed copy).
  bridgeRootNow() {
    return this.bridgeRoot ?? (props().repoRoot || repoRootFrom(import.meta.url));
  }

  // Same read the rest of the dialog uses; no new filesystem access.
  async bridgeFileExists(path) {
    try { return (await readTextFile(path)) != null; } catch { return false; }
  }

  // LANE-BRIDGE: read-only --status for every catalog row with a bridge. Any
  // failure leaves that row unknown: no status, so the button keeps the dry run.
  async checkBridges() {
    this.bridgeStatus = {};
    if (WINDOWS || this.error) return;
    const repoRoot = this.bridgeRootNow();
    for (const a of CATALOG) {
      if (typeof a.bridge !== "string") continue;
      try {
        const plan = await planBridge(a, { repoRoot, action: "status", fileExists: (path) => this.bridgeFileExists(path) });
        if (!plan.ok) continue;
        const r = await runBridgePlan(plan, { exec: this.bridgeExec });
        if (r.ok && r.status) this.bridgeStatus[a.id] = r.status;
      } catch {
        // Unknown stays unknown; a probe never breaks the dialog.
      }
    }
  }

  // LANE-BRIDGE: what the row's button says, from the last --status.
  bridgeLabel(a) {
    const c = this.copy ?? copyFor(DEFAULT_LANG);
    const st = this.bridgeStatus?.[a.id];
    return st ? (st.installed ? c.bridgeRemove : c.bridgeInstall) : c.bridge;
  }

  // LANE-BRIDGE-PREVIEW: a known status runs the read-only dry run on the click
  // and offers install or remove in the confirm; unknown keeps the plain dry run.
  previewBridge(a, cx) {
    if (this.busy || WINDOWS) return false;
    this.confirm = null;
    cx.spawn(async (cx) => {
      try {
        const repoRoot = this.bridgeRootNow();
        const fileExists = (path) => this.bridgeFileExists(path);
        const plan = await planBridge(a, { repoRoot, action: "preview", fileExists });
        if (!plan.ok) { this.say("error", plan.error); return; }
        const status = this.bridgeStatus[a.id] ?? null;
        const action = status ? (status.installed ? "uninstall" : "install") : null;
        let runPlan = null;
        let summary = plan.summary;
        if (action) {
          runPlan = await planBridge(a, { repoRoot, action, fileExists });
          if (!runPlan.ok) { this.say("error", runPlan.error); return; }
          // The click only runs --dry-run; the real action needs the confirm.
          const dry = await runBridgePlan(plan, { exec: this.bridgeExec });
          if (!dry.ok) { this.say("error", dry.error); return; }
          summary = dry.text;
        }
        const copy = this.copy ?? copyFor(DEFAULT_LANG);
        const file = status?.file ?? plan.script;
        const command = (runPlan ?? plan).argv.join(" ");
        this.confirm = { kind: "bridge", agentId: a.id, plan, runPlan, action };
        this.say("info", copy.bridgePrompt(action ?? "preview", a.name, file, command, summary));
        this.moveFocus("confirm-keep", cx);
      } catch (e) {
        this.say("error", `Could not prepare the bridge install: ${errText(e)}. Nothing was run.`);
      } finally {
        cx.notify();
      }
    });
    return true;
  }

  // LANE-INSTALL: show the exact command; nothing runs before the confirm.
  previewInstall(a, cx) {
    if (this.busy || WINDOWS) return false;
    const plan = planInstall(a);
    if (!plan.ok) { this.say("error", plan.error); cx?.notify?.(); return false; }
    const copy = this.copy ?? copyFor(DEFAULT_LANG);
    this.confirm = { kind: "install", agentId: a.id };
    this.say("info", copy.installConfirm(a.name, plan.command));
    this.moveFocus("confirm-keep", cx);
    cx?.notify?.();
    return true;
  }

  addSelected(cx) {
    const ids = new Set(this.selectable());
    const pairs = CATALOG.filter((a) => ids.has(a.id)).flatMap((a) => entries(a, this.withContinue));
    if (!pairs.length) { this.say("warning", "Check at least one agent."); cx.notify(); return; }
    this.addEntries(pairs, cx);
  }

  // lane-install: the banner's "Add all" reuses the same add path as the checkboxes.
  addDetected(cx) {
    const pairs = this.detected().flatMap((a) => entries(a, this.withContinue));
    if (!pairs.length) { this.say("warning", "Nothing to add."); cx.notify(); return; }
    this.addEntries(pairs, cx);
  }

  // Adds only the documented continue variant; the base stays as it is.
  addContinue(a, cx) {
    if (!this.canAddContinue(a)) return false;
    return this.addEntries([continueEntry(a)], cx, (ok) => {
      if (ok) this.moveFocus("add-selected", cx);
    });
  }

  // Marks the offending field, moves the keyboard there, and says why.
  fail(field, text, cx) {
    this.invalidField = field;
    this.customOpen = true;
    this.say("error", text);
    this.moveFocus(field, cx);
    cx?.notify?.();
  }

  // Resolves argv[0] on PATH with exact `command -v` / `where` (no case guessing).
  async applyPathResolution(argv) {
    const resolution = await resolveArgv0OnPath(argv[0], { exec, windows: WINDOWS });
    return { argv, missing: resolution.status !== "exact" };
  }

  // What the command field will produce: the argv, and whether its binary is
  // known to be missing from the PATH.
  runPreview() {
    const raw = this.inputs.run.value().trim();
    if (!raw) return { argv: [], error: null, missing: false };
    try {
      const argv = tokenize(raw);
      return { argv, error: null, missing: argv.length > 0 && this.onPath[argv[0]] === false };
    } catch (e) {
      return { argv: [], error: e.message ?? String(e), missing: false };
    }
  }

  addCustom(cx) {
    if (this.busy) return false;
    this.invalidField = null;
    this.confirm = null;
    const key = this.inputs.key.value().trim().toLowerCase();
    const name = this.inputs.name.value().trim();
    if (!KEY_RE.test(key)) return this.fail("key", "Invalid key: lowercase letters, digits, . _ - (max. 32).", cx);
    if (RESERVED.has(key)) return this.fail("key", `"${key}" is a reserved program key (${[...RESERVED].join(", ")}).`, cx);
    if (key.endsWith("-continue")) return this.fail("key", "Keys ending in -continue are reserved for catalog variants.", cx);
    let argv;
    try {
      argv = tokenize(this.inputs.run.value());
    } catch (e) {
      return this.fail("run", e.message ?? String(e), cx);
    }
    if (!argv.length || !argv[0]) return this.fail("run", "The command is missing.", cx);
    const inCatalog = CATALOG.some((a) => a.id === key);
    const inFile = Boolean(this.table?.programs && Object.prototype.hasOwnProperty.call(this.table.programs, key));
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const { argv: resolved, missing } = await this.applyPathResolution(argv);
        // No match: Herdr derives the program from run[0]. A wrapper (npx, uvx,
        // python…) would be mislabelled by a match of our own.
        const entry = { name: name || key, icon: "icons/agent.svg", ...TILE, run: resolved };
        const where = [inFile ? "your programs.json" : "", inCatalog ? "the catalog" : ""].filter(Boolean).join(" and ");
        if (missing) {
          this.customOpen = true;
          this.confirm = {
            kind: "path-missing",
            key,
            entry,
            pendingOverwrite: (inCatalog || inFile) ? { where } : null,
          };
          this.say("warning", `\`${argv[0]}\` is not on your PATH, so it will not show in the + menu until it exists. Add anyway?`);
          this.moveFocus("confirm-keep", cx);
          return;
        }
        if (inCatalog || inFile) {
          this.customOpen = true;
          this.confirm = { kind: "overwrite", key, entry, where };
          this.say("warning", `"${key}" is already in ${where}: overwrite it or keep it as is?`);
          this.moveFocus("confirm-keep", cx);
          return;
        }
        await this.saveCustomEntry(key, entry, cx);
      } catch (e) {
        this.say("error", `Could not check PATH for \`${argv[0]}\`: ${errText(e)}.`);
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
    return true;
  }

  async saveCustomEntry(key, entry, cx, note = null) {
    const r = await this.edit((p) => {
      const own = this.own();
      p[key] = entry;
      own[key] = fingerprint(entry);
      return { changed: [key], skipped: [], own };
    });
    if (r) {
      await this.detect();
      const copy = this.copy ?? copyFor(DEFAULT_LANG);
      // LANE-CATALOG: an agent whose catalog entry declares that it reports
      // OSC 7501 by itself needs no bridge, so the dialog stays quiet about it.
      const bridge = this.agentOf(key)?.nativeOsc ? null : copy.bridgeCustom(BRIDGES_DOCS);
      const saved = [
        `Saved ${key} in your programs.json.`,
        note,
        r.warning,
        bridge,
      ].filter(Boolean).join(" ");
      const level = (note || r.warning) ? "warning" : "success";
      this.say(level, saved);
      this.ensureActionHandles(this.actionIds());
      notify({ title: "More agents", body: `Saved ${key}.`, level: level === "warning" ? "info" : "success" });
      // The filter box is not part of the form, so a save must not clear it.
      for (const [id, input] of Object.entries(this.inputs)) if (id !== "search") input.set_value("");
      this.invalidField = null;
    }
  }

  // Writes exactly this entry: the confirmation covered replacing whatever was there.
  writeEntry(key, entry, cx, note = null) {
    if (this.busy) return false;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        await this.saveCustomEntry(key, entry, cx, note);
      } catch (e) {
        this.say("error", `Could not save ${key}: ${errText(e)}.`);
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
    return true;
  }

  // Overwrite/Keep for a custom key, or Remove anyway/Keep for an owned entry
  // that changed after the mod wrote it.
  resolveConfirm(overwrite, cx) {
    const c = this.confirm;
    this.confirm = null;
    if (!c) return;
    // LANE-INSTALL: only a confirmed install opens a tab; validate the command again.
    if (c.kind === "install") {
      this.moveFocus("add-selected", cx); // the confirm buttons are gone
      if (!overwrite) { this.say("info", "Cancelled."); cx.notify(); return; }
      const a = CATALOG.find((x) => x.id === c.agentId);
      const plan = planInstall(a);
      if (!plan.ok) { this.say("error", plan.error); cx.notify(); return; }
      try {
        run("tab.new", { name: plan.name, argv: plan.argv });
        this.say("info", (this.copy ?? copyFor(DEFAULT_LANG)).installStarted(a.name));
      } catch (e) {
        this.say("error", `Could not open the install tab: ${errText(e)}.`);
      }
      cx.notify();
      return;
    }
    // LANE-BRIDGE-CONFIRM: only this button runs the real action; then the row's
    // status is read again. An unknown status still only runs the dry run.
    if (c.kind === "bridge") {
      this.moveFocus("add-selected", cx); // the confirm buttons are gone
      if (!overwrite) { this.say("info", "Cancelled."); cx.notify(); return; }
      this.busy = true;
      cx.spawn(async (cx) => {
        try {
          const r = await runBridgePlan(c.runPlan ?? c.plan, { exec: this.bridgeExec });
          if (c.runPlan) await this.checkBridges();
          if (r.ok) this.say(c.runPlan ? "success" : "info", r.text);
          else this.say("error", r.error);
        } catch (e) {
          this.say("error", `Could not run the bridge installer: ${errText(e)}. Nothing was run.`);
        } finally {
          this.busy = false;
          cx.notify();
        }
      });
      return;
    }
    if (c.kind === "remove") {
      this.moveFocus("add-selected", cx); // the confirm buttons are gone
      if (overwrite) this.remove(c.keys, cx, true);
      else this.say("info", "Kept.");
      cx.notify();
      return;
    }
    if (c.kind === "path-missing") {
      this.customOpen = true;
      this.moveFocus("key", cx);
      if (!overwrite) {
        this.say("info", "Cancelled.");
        cx.notify();
        return;
      }
      const note = `\`${c.entry.run[0]}\` is not on your PATH, so it will not show in the + menu until it exists.`;
      if (c.pendingOverwrite) {
        this.confirm = { kind: "overwrite", key: c.key, entry: c.entry, where: c.pendingOverwrite.where, pathNote: note };
        this.say("warning", `"${c.key}" is already in ${c.pendingOverwrite.where}: overwrite it or keep it as is?`);
        this.moveFocus("confirm-keep", cx);
        cx.notify();
        return;
      }
      this.writeEntry(c.key, c.entry, cx, note);
      return;
    }
    if (!overwrite) {
      this.say("info", `Kept the existing "${c.key}".`);
      this.customOpen = true;
      this.moveFocus("key", cx);
      return;
    }
    this.invalidField = null;
    this.customOpen = true;
    this.moveFocus("key", cx); // the confirm buttons are gone
    this.writeEntry(c.key, c.entry, cx, c.pathNote ?? null);
  }

  // A custom-agent question (not remove, repair or bridge). The form stays open
  // while one of these is on screen.
  customConfirmPending() {
    const k = this.confirm?.kind;
    return k === "path-missing" || k === "overwrite";
  }

  formOpen() {
    return this.customOpen || this.customConfirmPending();
  }

  // User disclosure. The first open moves focus to key; later opens do not.
  // Collapsing does not clear the fields. A pending custom confirm cannot collapse.
  toggleCustom(cx) {
    if (this.customConfirmPending()) {
      this.customOpen = true;
      cx?.notify?.();
      return;
    }
    if (this.customOpen) {
      const inside = this.focusedField === "key" || this.focusedField === "name"
        || this.focusedField === "run" || this.focusedField === "add-custom";
      this.customOpen = false;
      if (inside) this.moveFocus("add-own", cx);
      cx?.notify?.();
      return;
    }
    this.customOpen = true;
    if (!this.customOpenedByUser) {
      this.customOpenedByUser = true;
      this.moveFocus("key", cx);
      return;
    }
    cx?.notify?.();
  }

  // ready: verified, on PATH, no run in the file.
  // install: verified, missing or PATH unknown, no run in the file.
  // added: a run is already in the file, including this mod's custom agents.
  // ships: builtin, plus any unverified row.
  sectionOf(a) {
    if (a.status === "custom") return "added";
    if (a.status === "builtin" || a.status === "unverified") return "ships";
    if (a.status !== "verified") return "ships";
    if (runOf(this.table?.programs?.[a.id])) return "added";
    return this.onPath[a.run?.[0]] === true ? "ready" : "install";
  }

  sectionOpen(id, q) {
    if (q) return true;
    return !this.sectionCollapsed.has(id);
  }

  toggleSection(id, cx) {
    if (this.sectionCollapsed.has(id)) this.sectionCollapsed.delete(id);
    else this.sectionCollapsed.add(id);
    cx?.notify?.();
  }

  // Catalog rows and this mod's custom entries, split into sections, alphabetical
  // by name. `q` is the trimmed search; empty sections are simply empty arrays.
  grouped() {
    const q = String(this.inputs?.search?.value?.() ?? "").trim().toLowerCase();
    const hit = (a) => !q || `${a.id} ${a.name} ${(runOf(a) ?? []).join(" ")}`.toLowerCase().includes(q);
    const sections = { ready: [], install: [], added: [], ships: [] };
    for (const a of [...CATALOG].sort((x, y) => x.name.localeCompare(y.name))) {
      if (!hit(a)) continue;
      sections[this.sectionOf(a)].push(a);
    }
    const known = new Set(CATALOG.map((a) => a.id));
    const custom = this.ours()
      .filter((k) => !known.has(k) && !k.endsWith("-continue") && this.table?.programs?.[k])
      .map((k) => {
        const e = this.table.programs[k] ?? {};
        return { id: k, name: e.name ?? k, run: runOf(e) ?? [k], status: "custom", docs: "" };
      });
    for (const a of custom) if (hit(a)) sections.added.push(a);
    sections.added.sort((x, y) => x.name.localeCompare(y.name));
    const noMatch = Boolean(q) && SECTIONS.every((s) => !sections[s.id].length);
    return { q, sections, noMatch };
  }

  // Verified agents that can still be added, in paint order.
  offeredIds() {
    // LANE-CATALOG-SEARCH: only the rows the filter left on screen are arrow
    // stops. Collapsed sections are not stops either. render() fills visibleIds;
    // before the first paint nothing is hidden.
    const addable = (a) => a.status === "verified" && !runOf(this.table?.programs?.[a.id]);
    if (!this.visibleIds) return CATALOG.filter(addable).map((a) => a.id);
    const { sections, q } = this.grouped();
    const ids = [];
    for (const spec of SECTIONS) {
      if (!this.sectionOpen(spec.id, q)) continue;
      for (const a of sections[spec.id]) if (addable(a) && this.visibleIds.has(a.id)) ids.push(a.id);
    }
    return ids;
  }

  // Row actions in render order. Remove buttons are Tab stops; Add continue
  // stays a pointer action so the keyboard order stays short.
  actionIds() {
    const p = this.table?.programs ?? {};
    const own = this.own();
    const ids = [];
    for (const a of CATALOG) {
      const cont = `${a.id}-continue`;
      if (own[a.id] !== undefined && runOf(p[a.id])) ids.push(`rm-${a.id}`);
      if (own[cont] !== undefined && runOf(p[cont])) ids.push(`rm-continue-${a.id}`);
      if (this.canAddContinue(a)) ids.push(`add-continue-${a.id}`);
    }
    const known = new Set(CATALOG.map((a) => a.id));
    for (const key of Object.keys(own).sort()) {
      if (known.has(key) || key.endsWith("-continue") || !runOf(p[key])) continue;
      ids.push(`rm-${key}`);
      if (own[`${key}-continue`] !== undefined && runOf(p[`${key}-continue`])) ids.push(`rm-continue-${key}`);
    }
    return [...new Set(ids)];
  }

  ensureActionHandles(ids) {
    if (!this.handleFactory) return;
    for (const id of ids) {
      if (this.actionHandles[id]) continue;
      const h = this.handleFactory();
      if (h) this.actionHandles[id] = h;
    }
  }

  // Moves the keyboard to an input or to a control that tracks a focus handle.
  moveFocus(id, cx) {
    this.focusedField = id;
    if (this.inputs[id]) this.inputs[id].focus();
    else if (this.handles[id]) this.handles[id].focus();
    else if (id.startsWith("row-")) this.rowHandles[id.slice(4)]?.focus();
    else {
      this.ensureActionHandles([id]);
      this.actionHandles[id]?.focus();
    }
    cx?.notify?.();
  }

  // search → continue → Add → disclosure → (when open: key → name → run →
  // Add custom) → the row actions → Reload only while the file is broken →
  // Close. A question adds two stops before Close. Tab does not wrap.
  tabOrder() {
    const actions = this.actionIds();
    this.ensureActionHandles(actions);
    const base = [...this.order.slice(0, -1)];
    if (this.formOpen()) base.push("key", "name", "run", "add-custom");
    base.push(...actions);
    if (this.error) base.push("reload");
    base.push("close");
    return this.confirm
      ? [...base.slice(0, -1), "confirm-yes", "confirm-keep", "close"]
      : base;
  }

  // Tab / Shift+Tab through tabOrder(). At either end it stops handling Tab,
  // so the key leaves the dialog. A catalog row is not a stop: Tab continues
  // at continue, Shift+Tab returns to search.
  formKey(e, cx) {
    if (e.key !== "tab") return;
    const order = this.tabOrder();
    const cur = this.focusedField ?? "";
    let i = order.indexOf(cur);
    if (i < 0 && cur.startsWith("row-")) {
      if (e.modifiers?.shift) {
        cx.stop_propagation();
        this.moveFocus("search", cx);
        return;
      }
      i = order.indexOf("search");
    }
    if (i < 0) return;
    const j = i + (e.modifiers?.shift ? -1 : 1);
    if (j < 0 || j >= order.length) return;
    cx.stop_propagation();
    this.moveFocus(order[j], cx);
  }

  // Space/Enter activate the focused control. Arrow Down from search (and
  // Up/Down from Add) reach the painted catalog rows. Text fields keep their keys.
  keyDown(e, cx) {
    if (e.key === "tab") { this.formKey(e, cx); return; }
    if (e.key === "down" || e.key === "up") {
      const ids = this.offeredIds();
      if (!ids.length) return;
      const down = e.key === "down";
      const here = this.focusedField ?? "";
      if (here === "search") {
        if (!down) return;
        this.moveFocus(`row-${ids[0]}`, cx);
      } else if (here === "add-selected") this.moveFocus(`row-${down ? ids[0] : ids[ids.length - 1]}`, cx);
      else if (here.startsWith("row-")) {
        const cur = ids.indexOf(here.slice(4));
        const next = cur < 0 ? 0 : Math.min(Math.max(cur + (down ? 1 : -1), 0), ids.length - 1);
        this.moveFocus(`row-${ids[next]}`, cx);
      } else return;
      cx.stop_propagation();
      return;
    }
    if (e.key !== " " && e.key !== "space" && e.key !== "enter") return;
    if (this.inputs[this.focusedField ?? ""]) return; // typing, not activating
    if (this.activate(this.focusedField, cx)) cx.stop_propagation();
  }

  activate(id, cx) {
    if (!id) return false;
    if (id === "continue") { this.withContinue = !this.withContinue; cx?.notify?.(); return true; }
    if (id === "add-selected") { this.addSelected(cx); return true; }
    if (id === "add-own") { this.toggleCustom(cx); return true; }
    if (id === "add-custom") { this.addCustom(cx); return true; }
    if (id === "close") { closeOverlay(props().overlay); return true; }
    if (id === "reload") { this.reload(cx); return true; }
    if (id === "confirm-yes") { this.resolveConfirm(true, cx); return true; }
    if (id === "confirm-keep") { this.resolveConfirm(false, cx); return true; }
    if (id.startsWith("rm-continue-")) { this.remove([`${id.slice("rm-continue-".length)}-continue`], cx); return true; }
    if (id.startsWith("rm-")) { this.remove([id.slice("rm-".length)], cx); return true; }
    if (id.startsWith("add-continue-")) {
      const a = CATALOG.find((x) => x.id === id.slice("add-continue-".length));
      if (a) this.addContinue(a, cx);
      return true;
    }
    if (!id.startsWith("row-")) return false;
    const a = CATALOG.find((x) => x.id === id.slice(4));
    if (!a || !this.offeredIds().includes(a.id)) return false;
    if (this.selected.has(a.id)) this.selected.delete(a.id); else this.selected.add(a.id);
    cx?.notify?.();
    return true;
  }

  button(id, label, onClick, t, primary = false) {
    const focused = this.focusedField === id;
    // Add, Add custom and Remove are the saves. disabled() blocks activation;
    // opacity is the visible disabled state (the host does not draw one).
    const saves = id === "add-selected" || id === "add-custom" || id.startsWith("rm-");
    const locked = this.busy && saves;
    this.note(locked ? `disabled:${id}` : `button:${id}`);
    const handle = this.handles[id] ?? this.actionHandles?.[id];
    let el = div().id(id).h(26).px(10).flex().flex_none().items_center().rounded(6).text_size(12)
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .border_1().border_color(focused ? t.accent : primary ? t.solid : t.raised)
      .role("button").accessibility_label(label)
      .when(handle, (node) => node.track_focus(handle));
    el = locked ? el.opacity(0.4).disabled(true).cursor_default() : el.cursor_pointer().hover((s) => s.opacity(0.88));
    return el
      // stop_propagation: the click must not also reach the row (clicks bubble up to parents).
      .on_click((_e, cx) => {
        cx.stop_propagation();
        if (this.inputs[id] || handle || id.startsWith("row-")) this.moveFocus(id, cx);
        if (locked || (this.busy && id !== "close")) return;
        onClick(cx);
      })
      .child(label);
  }

  check(on, t) {
    return div().w(16).h(16).flex_none().rounded(4).border_1().border_color(on ? t.solid : t.border).bg(on ? t.solid : t.background)
      .flex().items_center().justify_center().text_size(11).text_color(t.solid_foreground).child(on ? "✓" : "");
  }

  // PATH is three states. `undefined` is "could not check", never "in the + menu".
  rowFacts(a) {
    const hasRun = Boolean(runOf(this.table?.programs?.[a.id]));
    const added = this.ours().includes(a.id) && hasRun;
    const yours = hasRun && !added; // you already have it in your programs.json (e.g. set up by hand)
    const contKey = `${a.id}-continue`;
    const contAdded = this.ours().includes(contKey) && Boolean(runOf(this.table?.programs?.[contKey]));
    const canAddContinue = this.canAddContinue(a);
    const builtin = a.status === "builtin";
    const offer = a.status === "verified" && !added && !yours;
    const inst = this.onPath[a.run?.[0]];
    const pathBadge = inst === true ? "installed" : inst === false ? "not found on this PATH" : "could not check";
    const state = builtin ? "already ships with Herdr"
      : added ? (inst === true ? "in the + menu" : inst === false ? "added · not installed yet" : "could not check")
      : yours ? "already in your programs.json"
      : a.status === "unverified" ? "unverified" : "";
    const hint = a.install || a.docs || "";
    const where = !builtin && inst === false && hint ? `${pathBadge} · ${hint}` : pathBadge;
    return { added, yours, builtin, offer, inst, pathBadge, state, where, contKey, contAdded, canAddContinue };
  }

  row(a, t) {
    const { added, builtin, offer, inst, state, where, contKey, contAdded, canAddContinue } = this.rowFacts(a);
    const copy = this.copy ?? copyFor(DEFAULT_LANG);
    this.note(`${a.name} :: ${state} :: ${where}`);
    const sel = this.selected.has(a.id);
    const rowId = `row-${a.id}`;
    const focused = this.focusedField === rowId;
    const pathColor = inst === true ? t.done : inst === false ? t.muted : t.unknown;
    const actions = [];
    if (added) actions.push(this.button(`rm-${a.id}`, "Remove", (cx) => this.remove([a.id], cx), t));
    if (contAdded) actions.push(this.button(`rm-continue-${a.id}`, "Remove continue", (cx) => this.remove([contKey], cx), t));
    if (canAddContinue) actions.push(this.button(`add-continue-${a.id}`, "Add continue", (cx) => this.addContinue(a, cx), t));
    // LANE-BRIDGE-BUTTON: pointer-only, state-aware, and never on Windows (no
    // `sh`/`ps` there). A known status also paints its one-word label.
    if (!WINDOWS && typeof a.bridge === "string" && a.bridge.startsWith("bridges/")) {
      const st = this.bridgeStatus[a.id];
      if (st) {
        actions.push(div().flex_none().text_size(10.5).text_color(st.installed ? t.done : t.muted)
          .child(st.installed ? copy.bridgeInstalled : copy.bridgeNotInstalled));
      }
      actions.push(this.button(`bridge-${a.id}`, this.bridgeLabel(a), (cx) => this.previewBridge(a, cx), t));
    }
    // LANE-INSTALL: pointer-only too, and never on Windows (no `sh`).
    if (!WINDOWS && a.status === "verified" && inst === false && isRunnableInstall(a.install)) {
      actions.push(this.button(`install-${a.id}`, copy.install, (cx) => this.previewInstall(a, cx), t));
    }
    return h_flex().id(`row-${a.id}`).px(8).py(5).gap(10).items_center().rounded(8)
      .border_1().border_color(focused ? t.accent : t.popover)
      .role("list_box_option").aria_selected(sel)
      .accessibility_label(`${a.name} · ${a.run.join(" ")}${state ? ` · ${state}` : ""} · ${where}`)
      // Rows are reachable with the arrow keys and Space/Enter, but they are not
      // Tab stops: Tab continues at continue, Shift+Tab returns to search.
      .when(offer, (el) => el.cursor_pointer().tab_stop(false)
        .when(this.rowHandles[a.id], (e2) => e2.track_focus(this.rowHandles[a.id]))
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => {
          this.moveFocus(rowId, cx);
          // Current state, not the one captured at paint time.
          if (this.selected.has(a.id)) this.selected.delete(a.id); else this.selected.add(a.id);
          cx.notify();
        }))
      .child(offer ? this.check(sel, t) : div().w(16).flex_none())
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(h_flex().gap(6).items_center().min_w(0)
          .child(div().min_w(0).text_size(13).text_color(builtin ? t.dim : t.foreground).truncate().child(a.name))
          .when(Boolean(state), (el) => el.child(div().text_size(10.5).px(5).rounded(4).bg(t.raised).text_color(t.muted).flex_none().child(state))))
        // The command wraps on its own line so a long argv cannot push the row sideways.
        .child(div().w_full().min_w(0).text_size(11).text_color(t.dim).whitespace_normal().child(a.run.join(" ")))
        // No truncate: the install hint can be long (Goose) and wraps onto several lines.
        .when(!builtin, (el) => el.child(div().w_full().min_w(0).text_size(10.5).line_height("14px").text_color(pathColor).whitespace_normal().child(where))))
      .children(actions);
  }

  // Pointer-only. Not a Tab stop and not an arrow stop.
  sectionHeader(id, title, open, t) {
    return h_flex().id(`section-${id}`).px(8).py(4).gap(6).items_center().rounded(4).cursor_pointer()
      .tab_stop(false)
      .role("button")
      .accessibility_label(`${title}, ${open ? "expanded" : "collapsed"}`)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        this.toggleSection(id, cx);
      })
      .child(div().w(12).flex_none().text_size(11).text_color(t.muted).child(open ? "▾" : "▸"))
      .child(div().text_size(11.5).font_semibold().text_color(t.foreground).child(title));
  }

  render() {
    const t = theme();
    const c = this.copy ?? copyFor(DEFAULT_LANG);
    // LANE-CATALOG-SEARCH: one matcher for catalog rows and custom entries; it
    // looks at the name, the key and the command. Only the matches are painted,
    // and a collapsed section's rows are not.
    const { q, sections, noMatch } = this.grouped();
    const painted = [];
    for (const spec of SECTIONS) {
      const rows = sections[spec.id];
      if (rows.length && this.sectionOpen(spec.id, q)) painted.push(...rows);
    }
    // The arrow keys follow what is painted. This is the only place that
    // records which rows are on screen.
    this.visibleIds = new Set(painted.map((a) => a.id));
    const border = (k) => (this.invalidField === k ? t.blocked : this.focusedField === k ? t.accent : t.input);
    const field = (k) => Input.new(this.inputs[k]).h(30).px(8).rounded(6).border_1().border_color(border(k)).bg(t.background).text_size(12).text_color(t.foreground);
    const labeled = (k, label) => v_flex().gap(3).flex_1().min_w(0)
      .child(div().text_size(10.5).text_color(this.invalidField === k ? t.blocked : t.muted).child(label))
      .child(field(k));
    const contFocused = this.focusedField === "continue";
    const ownFocused = this.focusedField === "add-own";
    const pv = this.runPreview();
    const n = this.selectable().length;
    // LANE-INSTALL: the banner line shows only while an installed agent is missing
    // from the + menu. Re-check lives beside the search box, where the list is.
    const detected = this.detected();
    const showDetected = !this.error && !this.busy && detected.length > 0;
    const showRecheck = !this.error && !this.busy;
    const formOpen = this.formOpen();
    this.shown = [];
    this.note(formOpen ? "custom-form:open" : "custom-form:closed");
    if (formOpen && (pv.argv.length > 0 || pv.error)) this.note("run-preview");
    const catalog = [];
    for (const spec of SECTIONS) {
      const rows = sections[spec.id];
      if (!rows.length) continue;
      const open = this.sectionOpen(spec.id, q);
      const title = `${c[spec.copyKey]} (${rows.length})`;
      this.note(`section:${spec.id}:${rows.length}:${open ? "open" : "closed"}`);
      this.note(title);
      catalog.push(this.sectionHeader(spec.id, title, open, t));
      if (!open) continue;
      for (const a of rows) catalog.push(this.row(a, t));
    }
    const status = this.busy || Boolean(this.confirm) || Boolean(this.msg);
    return v_flex().size_full().bg(t.popover).p(14).gap(8).text_size(13)
      .id("more-agents").track_focus(this.rootHandle).role("dialog").accessibility_label(c.title)
      // Keys travel the focus path, so one handler here covers inputs and controls.
      .on_key_down((e, cx) => this.keyDown(e, cx))
      .child(h_flex().justify_between().items_center()
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child(c.title))
        .child(h_flex().gap(8).items_center()
          // LANE-CATALOG-SEARCH: language switch. Pointer-only on purpose: it is
          // not part of the dialog's Tab order.
          .children(LANGS.map((lang) => div().id(`lang-${lang}`).px(5).py(1).rounded(4).cursor_pointer()
            .text_size(10.5).text_color(lang === this.lang ? t.foreground : t.muted)
            .bg(lang === this.lang ? t.raised : t.popover)
            .role("button").accessibility_label(lang === "en" ? "English" : "Español")
            .on_click((_e, cx) => { this.lang = lang; this.copy = copyFor(lang); cx.notify(); })
            .child(lang.toUpperCase())))
          .child(this.button("close", c.close, () => closeOverlay(props().overlay), t))))
      .child(div().text_size(11.5).text_color(t.muted).child(c.writes(this.path)))
      .when(Boolean(this.error), (el) => el.child(h_flex().flex_none().max_h(72).overflow_y_scrollbar().gap(8).items_center().p(8).rounded(6).bg(t.raised)
        .child(v_flex().flex_1().min_w(0).gap(2)
          .child(div().text_size(12).font_semibold().text_color(t.blocked).child(this.note(this.errorHeading())))
          .child(div().text_size(12).text_color(t.blocked).whitespace_normal().child(this.note(this.error))))
        .child(this.button("reload", c.reload, (cx) => this.reload(cx), t))))
      // LANE-REPAIR-BANNER
      .when(this.scanRepairs().length > 0, (el) => {
        const repairs = this.scanRepairs();
        return el.child(v_flex().id("repairs").flex_none().max_h(96).overflow_y_scrollbar().gap(4).p(8).rounded(6).bg(t.raised)
          .child(div().text_size(11.5).font_semibold().text_color(t.muted).child(this.note("Repairs for programs.json (nothing is written until you confirm)")))
          .children(repairs.map((p) => h_flex().gap(8).items_center()
            .child(div().flex_1().min_w(0).text_size(11).text_color(p.kind === "warn" ? t.muted : p.kind === "remove" ? t.blocked : t.foreground).whitespace_normal().child(this.note(p.message)))
            .when(p.kind !== "warn", (row) => row.child(this.button(`repair-${p.key}`, p.kind === "remove" ? "Remove typo" : "Repair", (cx) => this.askRepair(p, cx), t, p.kind === "update"))))));
      })
      // LANE-INSTALL: installed agents that are not in the + menu yet, one compact
      // line. Add all is pointer-only: the dialog's Tab order stays short.
      .when(showDetected, (el) => el.child(h_flex().id("install-assist").flex_none().gap(8).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(this.note(c.detected(detected.length, formatDetected(detected)))))
        .child(this.button("add-detected", c.addAll, (cx) => this.addDetected(cx), t, true))))
      // LANE-CATALOG-SEARCH: the filter box sits above the list and narrows it
      // to the agents whose name, key or command matches. It is the first Tab stop.
      .child(h_flex().gap(6).items_center().flex_none()
        .child(div().flex_1().min_w(0).tab_stop(true).child(field("search")))
        // LANE-INSTALL: Re-check after an install finishes (pointer-only).
        .when(showRecheck, (row) => row.child(this.button("recheck", c.recheck, (cx) => this.reload(cx), t))))
      .child(v_flex().id("catalog").role("list_box").accessibility_label(c.agents).flex_1().min_h(0).overflow_y_scrollbar().pr(12).gap(1)
        .when(noMatch, (el) => el.child(div().p(8).text_size(12).text_color(t.muted).child(this.note(c.searchNoMatch))))
        .children(catalog))
      .child(h_flex().gap(8).items_center()
        .child(h_flex().id("continue").gap(6).items_center().cursor_pointer().px(4).py(2).rounded(4)
          .border_1().border_color(contFocused ? t.accent : t.popover)
          .role("check_box").checked(this.withContinue).accessibility_label(c.continueLabel)
          .when(this.handles.continue, (el) => el.track_focus(this.handles.continue))
          .on_click((_e, cx) => { this.moveFocus("continue", cx); this.withContinue = !this.withContinue; cx.notify(); })
          .child(this.check(this.withContinue, t))
          .child(div().text_size(12).text_color(t.foreground).child(c.continueLabel)))
        .child(div().flex_1())
        .child(this.button("add-selected", c.add(n), (cx) => this.addSelected(cx), t, n > 0)))
      .child(div().h(1).bg(t.border))
      .child(h_flex().id("add-own").gap(6).items_center().cursor_pointer().px(4).py(2).rounded(4)
        .border_1().border_color(ownFocused ? t.accent : t.popover)
        .role("button").tab_stop(true).accessibility_label(c.addOwn)
        .when(this.handles["add-own"], (el) => el.track_focus(this.handles["add-own"]))
        .on_click((_e, cx) => {
          cx.stop_propagation();
          this.moveFocus("add-own", cx);
          this.toggleCustom(cx);
        })
        .child(div().w(12).flex_none().text_size(12).text_color(t.muted).child(formOpen ? "▾" : "▸"))
        .child(div().text_size(12).text_color(t.foreground).child(this.note(c.addOwn))))
      .when(formOpen, (el) => el
        .child(div().text_size(12).text_color(t.dim).child(this.note(c.hint)))
        .child(v_flex().id("custom-form").role("form").gap(6)
          .child(h_flex().gap(6).items_end()
            .child(div().w(150).child(labeled("key", c.key)))
            .child(div().flex_1().min_w(0).child(labeled("name", c.name))))
          .child(h_flex().gap(6).items_end()
            .child(div().flex_1().min_w(0).child(labeled("run", c.command)))
            .child(this.button("add-custom", c.add(0), (cx) => this.addCustom(cx), t, true))))
        // What the command field produces, as a list of arguments. Only while open.
        .when(pv.argv.length > 0 || Boolean(pv.error), (e2) => e2.child(h_flex().gap(6).items_center().min_w(0)
          .child(div().flex_none().text_size(11).text_color(t.muted).child(c.run))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(pv.error ? t.blocked : t.dim).child(pv.error ?? JSON.stringify(pv.argv)))
          .when(pv.missing, (e3) => e3.child(div().flex_none().text_size(11).text_color(t.blocked).child(c.notOnPath(pv.argv[0])))))))
      // Capped and scrolled so a long error or install hint cannot push the list out of the 640×640 dialog.
      .when(status, (el) => el.child(v_flex().flex_none().max_h(72).overflow_y_scrollbar().gap(4)
        .when(this.busy, (e2) => e2.child(div().text_size(11.5).text_color(t.muted).child(this.note(c.saving))))
        .when(Boolean(this.confirm), (e2) => e2.child(h_flex().gap(8).items_center().p(8).rounded(6).bg(t.raised)
          .child(div().flex_1().min_w(0).text_size(11.5).text_color(this.msgTone(t)).whitespace_normal().child(this.msg))
          .child(this.button("confirm-yes",
            this.confirm.kind === "remove" ? c.removeAnyway
              : this.confirm.kind === "path-missing" ? c.addAnyway
                : this.confirm.kind === "bridge"
                  ? (this.confirm.action === "install" ? c.bridgeInstall
                    : this.confirm.action === "uninstall" ? c.bridgeRemove : c.dryRun)
                  : this.confirm.kind === "install" ? c.install
                    : c.overwrite, (cx) => this.resolveConfirm(true, cx), t, true))
          .child(this.button("confirm-keep",
            this.confirm.kind === "remove" ? c.keep
              : this.confirm.kind === "path-missing" || this.confirm.kind === "bridge" || this.confirm.kind === "install" ? c.cancel
                : c.keepAsIs, (cx) => this.resolveConfirm(false, cx), t))))
        .when(Boolean(this.msg) && !this.confirm, (e2) => e2.child(div().text_size(11.5).text_color(this.invalidField ? t.blocked : this.msgTone(t)).whitespace_normal().child(this.msg)))));
  }
}
