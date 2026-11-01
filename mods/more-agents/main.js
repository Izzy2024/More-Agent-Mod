// More agents: adds agents that don't ship ready-made to Herdr's + menu.
// Herdr only knows the agents in its programs table, and a mod can't register
// them through an API, so this mod edits ~/.config/herdr-app/programs.json
// (the personal layer Herdr merges over defaults/programs.json and reloads
// live). The list comes from catalog.js (data only), so adding an agent is a
// PR to that file. It opens as a dialog: `mod.open more-agents`.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { appHome, home, exec, readTextFile, writeTextFile, knownAgents, theme, props, closeOverlay, notify, shared, setShared } from "herdr";
import CATALOG from "./catalog.js";

const OWN = "more-agents.keys"; // key -> fingerprint of the entry this mod wrote
const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
// The table's own keys (herdr.d.ts Program: "claude", "nvim", "shell",
// "program" (anything unlisted), "agent"). They are not ours to redefine.
const RESERVED = new Set(["shell", "program", "agent"]);
const WINDOWS = /^[A-Za-z]:[\\/]/.test(home()) || home().includes("\\");
const TILE = { tint: true, tile: "#1c1d21", color: "#ffffff" };

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
function entries(a, withContinue) {
  const out = [[a.id, { name: a.name, icon: a.icon, ...TILE, ...(a.match ? { match: a.match } : {}), run: a.run }]];
  if (withContinue && a.continue) out.push([`${a.id}-continue`, { name: `${a.name} · continue`, icon: a.icon, ...TILE, run: a.continue }]);
  return out;
}

export default class MoreAgents extends View {
  init(_props, cx) {
    this.path = `${appHome()}/programs.json`;
    this.backup = `${appHome()}/programs.json.more-agents.bak`;
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
    };
    // Herdr doesn't move focus with Tab inside a mod dialog (its window doesn't
    // register gpui-shell's Tab action), so the dialog does it itself with the
    // public API: on_key_down + focus handles. It doesn't wrap: at either end
    // Tab leaves the dialog.
    this.order = ["key", "name", "run", "continue", "add-selected", "add-custom", "close"];
    this.focusedField = "key";
    this.invalidField = null;
    // cx.focus_handle() belongs in init, never in render.
    const handle = () => (typeof cx.focus_handle === "function" ? cx.focus_handle() : null);
    this.handles = {
      continue: handle(), "add-selected": handle(), "add-custom": handle(), close: handle(),
      "confirm-yes": handle(), "confirm-keep": handle(),
    };
    this.confirm = null;        // pending question: { kind: "overwrite" | "remove", ... }
    this.rowHandles = {};
    if (typeof cx.focus_handle === "function") {
      for (const a of CATALOG) if (a.status === "verified") this.rowHandles[a.id] = cx.focus_handle();
    }
    for (const k of ["key", "name", "run"]) {
      this.inputs[k].on("focus", () => { this.focusedField = k; });
      this.inputs[k].on("blur", () => { if (this.focusedField === k) this.focusedField = null; });
      this.inputs[k].on("change", () => { if (this.invalidField === k) this.invalidField = null; });
    }
    this.inputs.key.focus();
    this.inputs.run.on("submit", (_e, cx) => this.addCustom(cx));
    cx.spawn(async (cx) => { await this.load(); cx.notify(); await this.detect(); cx.notify(); });
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
    } catch { /* no detection: shown as unknown */ }
    // The interactive shell may have a different PATH (mise, nvm…): what Herdr already knows wins.
    try { for (const a of await knownAgents()) if (a.installed) this.onPath[a.run[0]] = true; } catch {}
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
      return Boolean(a) && a.status === "verified" && !runOf(this.table?.programs?.[id]);
    });
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
      parts.push(`Added ${k}; it will show in the + menu once you install \`${binOf(k)}\`${hint ? ` (${hint})` : ""}.`);
    }
    return { text: parts.join(" "), allReady: later.length === 0 };
  }

  // Read → change → write only if nobody touched it in between. The backup is
  // best-effort and written after the CAS, so a failed write cannot destroy it.
  async edit(change) {
    await this.load();
    if (this.error) { this.msg = this.error; return null; }
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
    if (!result?.changed?.length) return result;
    let text;
    try {
      text = JSON.stringify(this.table, null, 2) + "\n";
    } catch (e) {
      this.msg = `Could not serialize programs.json: ${errText(e)}. Nothing was written.`;
      await this.load();
      return null;
    }
    try {
      if (result.own) this.setOwn(result.own); // intent first; rolled back if the write fails
    } catch (e) {
      try { this.setOwn(beforeOwn); } catch {}
      this.msg = `Could not record ownership: ${errText(e)}. Nothing was written.`;
      await this.load();
      return null;
    }
    try {
      await writeTextFile(this.path, text, before);
    } catch (e) {
      try { this.setOwn(beforeOwn); } catch {}
      const stale = /stale/i.test(errText(e));
      const message = stale
        ? "programs.json changed since it was read; nothing was written. Try again."
        : `Could not write ${this.path}: ${errText(e)}. Nothing was written.`;
      await this.load(); // show the file as it is now
      this.msg = message;
      return null;
    }
    this.raw = text;
    let warning = "";
    if (before != null) {
      try {
        const old = await readTextFile(this.backup);
        await writeTextFile(this.backup, before, old);
      } catch (e) {
        warning = `The backup was not written: ${errText(e)}.`;
      }
    }
    return { ...result, warning };
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
          if (r.changed.length) {
            await this.detect(); // the message depends on whether the command is installed
            const added = this.addedMessage(r.changed);
            this.msg = [
              added.text,
              r.warning,
              r.skipped.length ? `Already in your programs.json (left untouched): ${r.skipped.join(", ")}.` : "",
            ].filter(Boolean).join(" ");
            notify({ title: "More agents", body: [added.text, r.warning].filter(Boolean).join(" "), level: added.allReady && !r.warning ? "success" : "info" });
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
        } else if (r) {
          this.msg = [
            r.changed.length ? `Removed from your programs.json: ${r.changed.join(", ")}.` : "Nothing to remove.",
            r.warning,
          ].filter(Boolean).join(" ");
          this.selected.clear();
        }
      } catch (e) {
        this.msg = `Could not remove from programs.json: ${errText(e)}.`;
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  addSelected(cx) {
    const ids = new Set(this.selectable());
    const pairs = CATALOG.filter((a) => ids.has(a.id)).flatMap((a) => entries(a, this.withContinue));
    if (!pairs.length) { this.msg = "Check at least one agent."; cx.notify(); return; }
    this.addEntries(pairs, cx);
  }

  // Marks the offending field, moves the keyboard there, and says why.
  fail(field, text, cx) {
    this.invalidField = field;
    this.msg = text;
    this.moveFocus(field, cx);
    cx?.notify?.();
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
    if (!argv.length) return this.fail("run", "The command is missing.", cx);
    // No match: Herdr derives the program from run[0]. A wrapper (npx, uvx,
    // python…) would be mislabelled by a match of our own.
    const entry = { name: name || key, icon: "icons/agent.svg", ...TILE, run: argv };
    const inCatalog = CATALOG.some((a) => a.id === key);
    const inFile = Boolean(this.table?.programs && Object.prototype.hasOwnProperty.call(this.table.programs, key));
    if (inCatalog || inFile) {
      const where = [inFile ? "your programs.json" : "", inCatalog ? "the catalog" : ""].filter(Boolean).join(" and ");
      this.confirm = { kind: "overwrite", key, entry, where };
      this.msg = `"${key}" is already in ${where}: overwrite it or keep it as is?`;
      this.moveFocus("confirm-keep", cx);
      return;
    }
    this.writeEntry(key, entry, cx);
  }

  // Writes exactly this entry: the confirmation covered replacing whatever was there.
  writeEntry(key, entry, cx) {
    if (this.busy) return false;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const r = await this.edit((p) => {
          const own = this.own();
          p[key] = entry;
          own[key] = fingerprint(entry);
          return { changed: [key], skipped: [], own };
        });
        if (r) {
          await this.detect();
          this.msg = [`Saved ${key} in your programs.json.`, r.warning].filter(Boolean).join(" ");
          notify({ title: "More agents", body: `Saved ${key}.`, level: r.warning ? "info" : "success" });
          for (const i of Object.values(this.inputs)) i.set_value("");
          this.invalidField = null;
        }
      } catch (e) {
        this.msg = `Could not save ${key}: ${errText(e)}.`;
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
    if (c.kind === "remove") {
      if (overwrite) this.remove(c.keys, cx, true);
      else { this.msg = "Kept."; cx.notify(); }
      return;
    }
    if (!overwrite) {
      this.msg = `Kept the existing "${c.key}".`;
      this.moveFocus("key", cx);
      return;
    }
    this.invalidField = null;
    this.writeEntry(c.key, c.entry, cx);
  }

  // Verified agents that can still be added, in the list's order.
  offeredIds() {
    return CATALOG.filter((a) => a.status === "verified" && !runOf(this.table?.programs?.[a.id])).map((a) => a.id);
  }

  // Moves the keyboard to an input or to a control that tracks a focus handle.
  moveFocus(id, cx) {
    this.focusedField = id;
    if (this.inputs[id]) this.inputs[id].focus();
    else if (this.handles[id]) this.handles[id].focus();
    else if (id.startsWith("row-")) this.rowHandles[id.slice(4)]?.focus();
    cx?.notify?.();
  }

  // The overwrite question adds two stops before Close while it is open.
  tabOrder() {
    return this.confirm
      ? [...this.order.slice(0, -1), "confirm-yes", "confirm-keep", "close"]
      : this.order;
  }

  // Tab / Shift+Tab through key → name → run → continue → Add → Add custom →
  // Close. At either end it stops handling Tab, so the key leaves the dialog.
  formKey(e, cx) {
    if (e.key !== "tab") return;
    const order = this.tabOrder();
    let i = order.indexOf(this.focusedField);
    // Rows sit between the command and the continue checkbox, but are not Tab
    // stops themselves.
    if (i < 0 && this.focusedField.startsWith("row-")) i = order.indexOf("run");
    if (i < 0) return;
    const j = i + (e.modifiers?.shift ? -1 : 1);
    if (j < 0 || j >= order.length) return;
    cx.stop_propagation();
    this.moveFocus(order[j], cx);
  }

  // Space/Enter activate the focused control; arrows reach the catalog rows
  // from Add and move between them. Text fields keep their own keys.
  keyDown(e, cx) {
    if (e.key === "tab") { this.formKey(e, cx); return; }
    if (e.key === "arrowdown" || e.key === "arrowup") {
      const ids = this.offeredIds();
      if (!ids.length) return;
      const down = e.key === "arrowdown";
      if (this.focusedField === "add-selected") this.moveFocus(`row-${down ? ids[0] : ids[ids.length - 1]}`, cx);
      else if (this.focusedField.startsWith("row-")) {
        const cur = ids.indexOf(this.focusedField.slice(4));
        const next = cur < 0 ? 0 : Math.min(Math.max(cur + (down ? 1 : -1), 0), ids.length - 1);
        this.moveFocus(`row-${ids[next]}`, cx);
      } else return;
      cx.stop_propagation();
      return;
    }
    if (e.key !== " " && e.key !== "space" && e.key !== "enter") return;
    if (this.inputs[this.focusedField]) return; // typing, not activating
    if (this.activate(this.focusedField, cx)) cx.stop_propagation();
  }

  activate(id, cx) {
    if (id === "continue") { this.withContinue = !this.withContinue; cx?.notify?.(); return true; }
    if (id === "add-selected") { this.addSelected(cx); return true; }
    if (id === "add-custom") { this.addCustom(cx); return true; }
    if (id === "close") { closeOverlay(props().overlay); return true; }
    if (id === "confirm-yes") { this.resolveConfirm(true, cx); return true; }
    if (id === "confirm-keep") { this.resolveConfirm(false, cx); return true; }
    if (!id.startsWith("row-")) return false;
    const a = CATALOG.find((x) => x.id === id.slice(4));
    if (!a || !this.offeredIds().includes(a.id)) return false;
    if (this.selected.has(a.id)) this.selected.delete(a.id); else this.selected.add(a.id);
    cx?.notify?.();
    return true;
  }

  button(id, label, onClick, t, primary = false) {
    const focused = this.focusedField === id;
    return div().id(id).h(26).px(10).flex().flex_none().items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .border_1().border_color(focused ? t.accent : primary ? t.solid : t.raised)
      .role("button").accessibility_label(label)
      .when(this.handles[id], (el) => el.track_focus(this.handles[id]))
      .hover((s) => s.opacity(0.88))
      // stop_propagation: the click must not also reach the row (clicks bubble up to parents).
      .on_click((_e, cx) => { cx.stop_propagation(); this.moveFocus(id, cx); if (!this.busy) onClick(cx); })
      .child(label);
  }

  check(on, t) {
    return div().w(16).h(16).flex_none().rounded(4).border_1().border_color(on ? t.solid : t.border).bg(on ? t.solid : t.background)
      .flex().items_center().justify_center().text_size(11).text_color(t.solid_foreground).child(on ? "✓" : "");
  }

  row(a, t) {
    const hasRun = Boolean(runOf(this.table?.programs?.[a.id]));
    const added = this.ours().includes(a.id) && hasRun;
    const yours = hasRun && !added; // you already have it in your programs.json (e.g. set up by hand)
    const builtin = a.status === "builtin";
    const offer = a.status === "verified" && !added && !yours;
    const inst = this.onPath[a.run[0]];
    const sel = this.selected.has(a.id);
    const rowId = `row-${a.id}`;
    const focused = this.focusedField === rowId;
    const state = builtin ? "already ships with Herdr" : added ? (inst === false ? "added · not installed yet" : "in the + menu") : yours ? "already in your programs.json" : a.status === "unverified" ? "unverified" : "";
    const hint = a.install || a.docs || "";
    const where = inst === true ? "installed"
      : inst === false ? (added ? `will show in the + menu once you install \`${a.run[0]}\`${hint ? " · " + hint : ""}` : `not installed${hint ? " · " + hint : ""}`)
      : "";
    return h_flex().id(`row-${a.id}`).px(8).py(5).gap(10).items_center().rounded(8)
      .border_1().border_color(focused ? t.accent : t.popover)
      .role("list_box_option").aria_selected(sel)
      .accessibility_label(`${a.name} · ${a.run.join(" ")}${state ? ` · ${state}` : ""}`)
      // Rows are reachable with the arrow keys and Space/Enter, but they are not
      // Tab stops: Tab goes from the command to the continue checkbox.
      .when(offer, (el) => el.cursor_pointer().tab_stop(false)
        .when(this.rowHandles[a.id], (e2) => e2.track_focus(this.rowHandles[a.id]))
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => {
          this.moveFocus(rowId, cx);
          // Current state, not the one captured at paint time.
          if (this.selected.has(a.id)) this.selected.delete(a.id); else this.selected.add(a.id);
          cx.notify();
        }))
      .child(offer ? this.check(sel, t) : div().w(16).flex_none())
      .child(v_flex().flex_1().min_w(0)
        .child(h_flex().gap(6).items_center()
          .child(div().text_size(13).text_color(builtin ? t.dim : t.foreground).truncate().child(a.name))
          .child(div().text_size(11).text_color(t.dim).flex_none().child(a.run.join(" ")))
          .when(Boolean(state), (el) => el.child(div().text_size(10.5).px(5).rounded(4).bg(t.raised).text_color(t.muted).flex_none().child(state))))
        // No truncate: the install hint can be long (Goose) and wraps onto several lines.
        .when(Boolean(where) && !builtin, (el) => el.child(div().w_full().text_size(10.5).line_height("14px").text_color(inst ? t.dim : t.muted).child(where))))
      .when(added, (el) => el.child(this.button(`rm-${a.id}`, "Remove", (cx) => this.remove([a.id, `${a.id}-continue`], cx), t)));
  }

  render() {
    const t = theme();
    const known = new Set(CATALOG.map((a) => a.id));
    const custom = this.ours().filter((k) => !known.has(k) && !k.endsWith("-continue") && this.table?.programs?.[k]);
    const order = { verified: 0, unverified: 1, builtin: 2 };
    const list = [...CATALOG].sort((x, y) => order[x.status] - order[y.status] || x.name.localeCompare(y.name));
    const border = (k) => (this.invalidField === k ? t.blocked : this.focusedField === k ? t.accent : t.input);
    const field = (k) => Input.new(this.inputs[k]).h(30).px(8).rounded(6).border_1().border_color(border(k)).bg(t.background).text_size(12).text_color(t.foreground);
    const labeled = (k, label) => v_flex().gap(3).flex_1().min_w(0)
      .child(div().text_size(10.5).text_color(this.invalidField === k ? t.blocked : t.muted).child(label))
      .child(field(k));
    const contFocused = this.focusedField === "continue";
    const pv = this.runPreview();
    const n = this.selectable().length;
    return v_flex().size_full().bg(t.popover).p(14).gap(8).text_size(13)
      .id("more-agents").role("dialog").accessibility_label("More agents for the + menu")
      // Keys travel the focus path, so one handler here covers inputs and controls.
      .on_key_down((e, cx) => this.keyDown(e, cx))
      .child(h_flex().justify_between().items_center()
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child("More agents for the + menu"))
        .child(this.button("close", "Close", () => closeOverlay(props().overlay), t)))
      .child(div().text_size(11.5).text_color(t.muted).child(`Writes to ${this.path}; after a successful save the previous version goes to programs.json.more-agents.bak (best-effort: a backup failure is reported, not blocking the write). Herdr reloads it by itself.`))
      .when(Boolean(this.error), (el) => el.child(div().p(8).rounded(6).bg(t.raised).text_color(t.blocked).text_size(12).child(this.error)))
      .child(v_flex().id("catalog").role("list_box").accessibility_label("Agents").flex_1().min_h(0).overflow_y_scrollbar().pr(12).gap(1)
        .children(list.map((a) => this.row(a, t)))
        .children(custom.map((k) => {
          const e = this.table?.programs?.[k] ?? {};
          return this.row({ id: k, name: e.name ?? k, run: runOf(e) ?? [k], status: "custom", docs: "" }, t);
        })))
      .child(h_flex().gap(8).items_center()
        .child(h_flex().id("continue").gap(6).items_center().cursor_pointer().px(4).py(2).rounded(4)
          .border_1().border_color(contFocused ? t.accent : t.popover)
          .role("check_box").checked(this.withContinue).accessibility_label("Also add the \"continue\" variant (if it has one)")
          .when(this.handles.continue, (el) => el.track_focus(this.handles.continue))
          .on_click((_e, cx) => { this.moveFocus("continue", cx); this.withContinue = !this.withContinue; cx.notify(); })
          .child(this.check(this.withContinue, t))
          .child(div().text_size(12).text_color(t.foreground).child("Also add the \"continue\" variant (if it has one)")))
        .child(div().flex_1())
        .child(this.button("add-selected", n ? `Add ${n}` : "Add", (cx) => this.addSelected(cx), t, n > 0)))
      .child(div().h(1).bg(t.border))
      .child(div().text_size(12).text_color(t.dim).child("Custom agent · Tab: fields and buttons · ↑/↓ then Space/Enter: agents · Enter in the command adds it"))
      .child(v_flex().id("custom-form").role("form").gap(6)
        .child(h_flex().gap(6).items_end()
          .child(div().w(150).child(labeled("key", "Key")))
          .child(div().flex_1().min_w(0).child(labeled("name", "Display name"))))
        .child(h_flex().gap(6).items_end()
          .child(div().flex_1().min_w(0).child(labeled("run", "Command")))
          .child(this.button("add-custom", "Add", (cx) => this.addCustom(cx), t, true))))
      // What the command field produces, as a list of arguments.
      .when(pv.argv.length > 0 || Boolean(pv.error), (el) => el.child(h_flex().gap(6).items_center().min_w(0)
        .child(div().flex_none().text_size(11).text_color(t.muted).child("run:"))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(pv.error ? t.blocked : t.dim).child(pv.error ?? JSON.stringify(pv.argv)))
        .when(pv.missing, (e2) => e2.child(div().flex_none().text_size(11).text_color(t.blocked).child(`\`${pv.argv[0]}\` is not on your PATH`)))))
      .when(Boolean(this.confirm), (el) => el.child(h_flex().gap(8).items_center().p(8).rounded(6).bg(t.raised)
        .child(div().flex_1().text_size(11.5).text_color(t.blocked).child(this.msg))
        .child(this.button("confirm-yes", this.confirm.kind === "remove" ? "Remove anyway" : "Overwrite", (cx) => this.resolveConfirm(true, cx), t, true))
        .child(this.button("confirm-keep", this.confirm.kind === "remove" ? "Keep" : "Keep as is", (cx) => this.resolveConfirm(false, cx), t))))
      .when(Boolean(this.msg) && !this.confirm, (el) => el.child(div().text_size(11.5).text_color(this.invalidField ? t.blocked : t.muted).child(this.msg)));
  }
}
