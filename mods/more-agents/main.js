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

const OWN = "more-agents.keys"; // keys this mod wrote (only those can be removed)
const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const WINDOWS = /^[A-Za-z]:[\\/]/.test(home()) || home().includes("\\");
const TILE = { tint: true, tile: "#1c1d21", color: "#ffffff" };

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
    // register gpui-shell's Tab action), so the form does it itself with the
    // public API: on_key_down + InputState.focus().
    this.order = ["key", "name", "run"];
    this.focusedField = null;
    for (const k of this.order) {
      this.inputs[k].on("focus", () => { this.focusedField = k; });
      this.inputs[k].on("blur", () => { if (this.focusedField === k) this.focusedField = null; });
    }
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

  ours() { return shared(OWN) ?? []; }

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
      await writeTextFile(this.path, text, before);
    } catch (e) {
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
    cx.spawn(async (cx) => {
      let ok = false;
      try {
        const r = await this.edit((p) => {
          const changed = [], skipped = [];
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
          return { changed, skipped };
        });
        if (r) {
          ok = true;
          if (r.changed.length) {
            try { setShared(OWN, [...new Set([...this.ours(), ...r.changed])]); } catch {}
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

  remove(keys, cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const mine = new Set(this.ours());
        const r = await this.edit((p) => {
          const changed = keys.filter((k) => mine.has(k) && k in p);
          for (const k of changed) delete p[k];
          return { changed, skipped: [] };
        });
        if (r) {
          if (r.changed.length) setShared(OWN, this.ours().filter((k) => !r.changed.includes(k)));
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

  addCustom(cx) {
    const key = this.inputs.key.value().trim().toLowerCase();
    const name = this.inputs.name.value().trim();
    const argv = this.inputs.run.value().trim().split(/\s+/).filter(Boolean);
    if (this.busy) { this.msg = "Still saving the last change."; cx.notify(); return; }
    if (!KEY_RE.test(key)) { this.msg = "Invalid key: lowercase letters, digits, . _ - (max. 32)."; cx.notify(); return; }
    if (!argv.length) { this.msg = "The command is missing."; cx.notify(); return; }
    this.addEntries([[key, { name: name || key, icon: "icons/agent.svg", ...TILE, match: [argv[0]], run: argv }]], cx, (ok) => {
      if (ok) for (const i of Object.values(this.inputs)) i.set_value("");
    });
  }

  // Tab / Shift+Tab between key → name → command.
  formKey(e, cx) {
    if (e.key !== "tab" || !this.focusedField) return;
    const i = this.order.indexOf(this.focusedField);
    const step = e.modifiers?.shift ? this.order.length - 1 : 1;
    cx.stop_propagation();
    this.inputs[this.order[(i + step) % this.order.length]].focus();
  }

  button(id, label, onClick, t, primary = false) {
    return div().id(id).h(26).px(10).flex().flex_none().items_center().rounded(6).text_size(12).cursor_pointer()
      .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
      .hover((s) => s.opacity(0.88))
      // stop_propagation: the click must not also reach the row (clicks bubble up to parents).
      .on_click((_e, cx) => { cx.stop_propagation(); if (!this.busy) onClick(cx); })
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
    const state = builtin ? "already ships with Herdr" : added ? (inst === false ? "added · not installed yet" : "in the + menu") : yours ? "already in your programs.json" : a.status === "unverified" ? "unverified" : "";
    const hint = a.install || a.docs || "";
    const where = inst === true ? "installed"
      : inst === false ? (added ? `will show in the + menu once you install \`${a.run[0]}\`${hint ? " · " + hint : ""}` : `not installed${hint ? " · " + hint : ""}`)
      : "";
    return h_flex().id(`row-${a.id}`).px(8).py(5).gap(10).items_center().rounded(8)
      .when(offer, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => {
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
    const field = (k) => Input.new(this.inputs[k]).h(30).px(8).rounded(6).border_1().border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground);
    const n = this.selectable().length;
    return v_flex().size_full().bg(t.popover).p(14).gap(8).text_size(13)
      .child(h_flex().justify_between().items_center()
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child("More agents for the + menu"))
        .child(this.button("close", "Close", () => closeOverlay(props().overlay), t)))
      .child(div().text_size(11.5).text_color(t.muted).child(`Writes to ${this.path} (backup first in programs.json.more-agents.bak). Herdr reloads it by itself.`))
      .when(Boolean(this.error), (el) => el.child(div().p(8).rounded(6).bg(t.raised).text_color(t.blocked).text_size(12).child(this.error)))
      .child(v_flex().id("catalog").flex_1().min_h(0).overflow_y_scrollbar().pr(12).gap(1)
        .children(list.map((a) => this.row(a, t)))
        .children(custom.map((k) => {
          const e = this.table.programs[k];
          return this.row({ id: k, name: e.name ?? k, run: runOf(e) ?? [k], status: "custom", docs: "" }, t);
        })))
      .child(h_flex().gap(8).items_center()
        .child(h_flex().id("continue").gap(6).items_center().cursor_pointer()
          .on_click((_e, cx) => { this.withContinue = !this.withContinue; cx.notify(); })
          .child(this.check(this.withContinue, t))
          .child(div().text_size(12).text_color(t.foreground).child("Also add the \"continue\" variant (if it has one)")))
        .child(div().flex_1())
        .child(this.button("add-selected", n ? `Add ${n}` : "Add", (cx) => this.addSelected(cx), t, n > 0)))
      .child(div().h(1).bg(t.border))
      .child(div().text_size(12).text_color(t.dim).child("Custom agent · Tab moves between fields, Enter in the command adds it"))
      .child(v_flex().id("custom-form").gap(6).on_key_down((e, cx) => this.formKey(e, cx))
        .child(h_flex().gap(6).child(div().w(150).child(field("key"))).child(div().flex_1().child(field("name"))))
        .child(h_flex().gap(6).child(div().flex_1().child(field("run"))).child(this.button("add-custom", "Add", (cx) => this.addCustom(cx), t, true))))
      .when(Boolean(this.msg), (el) => el.child(div().text_size(11.5).text_color(t.muted).child(this.msg)));
  }
}
