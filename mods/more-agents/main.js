// More agents: añade al menú + de Herdr agentes que no vienen listos.
// Herdr solo conoce los agentes de su tabla de programas, y un mod no puede
// registrarlos por API, así que este mod edita ~/.config/herdr-app/programs.json
// (la capa personal que Herdr fusiona sobre defaults/programs.json y recarga
// en vivo). La lista sale de catalog.js (solo datos), así que añadir un agente
// es un PR a ese archivo. Se abre como diálogo: `mod.open more-agents`.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { appHome, home, exec, readTextFile, writeTextFile, knownAgents, theme, props, closeOverlay, notify, shared, setShared } from "herdr";
import CATALOG from "./catalog.js";

const OWN = "more-agents.keys"; // claves que escribió este mod (solo esas se pueden quitar)
const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const WINDOWS = /^[A-Za-z]:[\\/]/.test(home()) || home().includes("\\");
const TILE = { tint: true, tile: "#1c1d21", color: "#ffffff" };

// La entrada de programs.json para un agente del catálogo (y su variante continuar).
function entries(a, withContinue) {
  const out = [[a.id, { name: a.name, icon: a.icon, ...TILE, ...(a.match ? { match: a.match } : {}), run: a.run }]];
  if (withContinue && a.continue) out.push([`${a.id}-continue`, { name: `${a.name} · continuar`, icon: a.icon, ...TILE, run: a.continue }]);
  return out;
}

export default class MoreAgents extends View {
  init(_props, cx) {
    this.path = `${appHome()}/programs.json`;
    this.backup = `${appHome()}/programs.json.more-agents.bak`;
    this.raw = null;            // texto actual (null: no existe)
    this.table = null;          // JSON parseado
    this.error = null;          // archivo inválido: no se escribe nada
    this.onPath = {};           // binario -> está en el PATH
    this.selected = new Set();  // ids marcados
    this.withContinue = false;
    this.busy = false;
    this.msg = "";
    this.inputs = {
      key: InputState.new({ placeholder: "clave, p. ej. my-agent" }),
      name: InputState.new({ placeholder: "nombre visible" }),
      run: InputState.new({ placeholder: "comando, p. ej. my-agent --flag" }),
    };
    // Herdr no mueve el foco con Tab dentro de un diálogo de mod (su ventana no
    // registra la acción Tab de gpui-shell), así que el formulario lo hace él
    // con la API pública: on_key_down + InputState.focus().
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
    try {
      this.raw = await readTextFile(this.path);
      const t = this.raw == null ? { programs: {} } : JSON.parse(this.raw);
      if (typeof t !== "object" || t === null || Array.isArray(t)) throw new Error("programs.json no es un objeto");
      t.programs ??= {};
      this.table = t;
      this.error = null;
    } catch (e) {
      this.error = `No toco programs.json: ${e.message ?? e}. Corrígelo (mira programs.error en herdr-app status) y vuelve a abrir.`;
    }
  }

  // ¿Qué binarios del catálogo están instalados? Un solo `sh -c` (o `where` en Windows),
  // con el PATH real del usuario. knownAgents() solo sabe de entradas que ya tienen run.
  async detect() {
    // Catálogo + agentes personalizados que añadió este mod.
    const custom = this.ours().map((k) => this.table?.programs?.[k]?.run?.[0]).filter((b) => typeof b === "string" && b);
    const bins = [...new Set([...CATALOG.filter((a) => a.status !== "unverified").map((a) => a.run[0]), ...custom])];
    try {
      if (WINDOWS) {
        for (const b of bins) this.onPath[b] = (await exec("where", [b]).catch(() => ({ code: 1 }))).code === 0;
      } else {
        const r = await exec("sh", ["-c", 'for b in "$@"; do command -v "$b" >/dev/null 2>&1 && echo "$b"; done', "sh", ...bins]);
        const found = new Set(r.stdout.split("\n").map((s) => s.trim()).filter(Boolean));
        for (const b of bins) this.onPath[b] = found.has(b);
      }
    } catch { /* sin detección: se muestra "?" */ }
    // El shell interactivo puede tener un PATH distinto (mise, nvm…): lo que Herdr ya sabe gana.
    try { for (const a of await knownAgents()) if (a.installed) this.onPath[a.run[0]] = true; } catch {}
  }

  ours() { return shared(OWN) ?? []; }

  // El agente del catálogo de una clave (también de su variante -continue).
  agentOf(key) {
    const base = key.endsWith("-continue") ? key.slice(0, -"-continue".length) : key;
    return CATALOG.find((a) => a.id === base) ?? null;
  }

  // Solo cuentan los marcados que aún se pueden añadir.
  selectable() {
    return [...this.selected].filter((id) => {
      const a = CATALOG.find((x) => x.id === id);
      return Boolean(a) && a.status === "verified" && !this.table?.programs?.[id]?.run?.length;
    });
  }

  // El menú + de Herdr (mods/new-menu) enseña TODOS los agentes instalados y, de los
  // no instalados, solo los 2 primeros del orden interno (Claude Code y Codex). Un
  // agente añadido cuyo comando no está en el PATH no sale hasta que se instala.
  addedMessage(keys) {
    const binOf = (k) => this.table?.programs?.[k]?.run?.[0] ?? k;
    const ready = keys.filter((k) => this.onPath[binOf(k)] === true);
    const later = keys.filter((k) => this.onPath[binOf(k)] !== true);
    const parts = [];
    if (ready.length) parts.push(`${ready.join(", ")}: ya ${ready.length === 1 ? "sale" : "salen"} en el menú +.`);
    const bases = later.filter((k) => !(k.endsWith("-continue") && later.includes(k.slice(0, -"-continue".length))));
    for (const k of bases) {
      const a = this.agentOf(k);
      const hint = a?.install || a?.docs || "";
      parts.push(`Añadido ${k}; aparecerá en el menú + cuando instales \`${binOf(k)}\`${hint ? ` (${hint})` : ""}.`);
    }
    return { text: parts.join(" "), allReady: later.length === 0 };
  }

  // Leer → copia de seguridad → cambiar → escribir solo si nadie lo tocó entre medias.
  async edit(change) {
    await this.load();
    if (this.error) { this.msg = this.error; return null; }
    const before = this.raw;
    const result = change(this.table.programs);
    if (!result.changed.length) return result;
    const text = JSON.stringify(this.table, null, 2) + "\n";
    try {
      if (before != null) {
        const old = await readTextFile(this.backup);
        await writeTextFile(this.backup, before, old);
      }
      await writeTextFile(this.path, text, before);
      this.raw = text;
      return result;
    } catch (e) {
      this.msg = `No se pudo guardar (¿cambió el archivo mientras tanto?): ${e.message ?? e}`;
      return null;
    }
  }

  // Añade sin pisar: si tu programs.json ya tiene esa clave con run, se deja como está;
  // si la tiene sin run (p. ej. solo un icono), tus campos ganan y solo se añade lo que falta.
  addEntries(pairs, cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      const r = await this.edit((p) => {
        const changed = [], skipped = [];
        for (const [key, entry] of pairs) {
          const base = key.endsWith("-continue") ? key.slice(0, -"-continue".length) : null;
          if (p[key]?.run?.length || (base && skipped.includes(base))) { skipped.push(key); continue; }
          p[key] = { ...entry, ...(p[key] ?? {}) };
          changed.push(key);
        }
        return { changed, skipped };
      });
      if (r) {
        if (r.changed.length) setShared(OWN, [...new Set([...this.ours(), ...r.changed])]);
        await this.detect(); // el mensaje depende de si el comando está instalado
        const added = r.changed.length ? this.addedMessage(r.changed) : null;
        this.msg = [
          added?.text ?? "",
          r.skipped.length ? `Ya estaban en tu programs.json (no se tocan): ${r.skipped.join(", ")}.` : "",
        ].filter(Boolean).join(" ");
        if (added) notify({ title: "More agents", body: added.text, level: added.allReady ? "success" : "info" });
      }
      this.selected.clear();
      this.busy = false;
      cx.notify();
    });
  }

  remove(keys, cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      const mine = new Set(this.ours());
      const r = await this.edit((p) => {
        const changed = keys.filter((k) => mine.has(k) && k in p);
        for (const k of changed) delete p[k];
        return { changed, skipped: [] };
      });
      if (r) {
        setShared(OWN, this.ours().filter((k) => !r.changed.includes(k)));
        this.msg = r.changed.length ? `Quitados de tu programs.json: ${r.changed.join(", ")}.` : "Nada que quitar.";
      }
      this.selected.clear();
      this.busy = false;
      cx.notify();
    });
  }

  addSelected(cx) {
    const ids = new Set(this.selectable());
    const pairs = CATALOG.filter((a) => ids.has(a.id)).flatMap((a) => entries(a, this.withContinue));
    if (!pairs.length) { this.msg = "Marca al menos un agente."; cx.notify(); return; }
    this.addEntries(pairs, cx);
  }

  addCustom(cx) {
    const key = this.inputs.key.value().trim().toLowerCase();
    const name = this.inputs.name.value().trim();
    const argv = this.inputs.run.value().trim().split(/\s+/).filter(Boolean);
    if (!KEY_RE.test(key)) { this.msg = "Clave inválida: minúsculas, números, . _ - (máx. 32)."; cx.notify(); return; }
    if (!argv.length) { this.msg = "Falta el comando."; cx.notify(); return; }
    this.addEntries([[key, { name: name || key, icon: "icons/agent.svg", ...TILE, match: [argv[0]], run: argv }]], cx);
    for (const i of Object.values(this.inputs)) i.set_value("");
  }

  // Tab / Shift+Tab entre clave → nombre → comando.
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
      // stop_propagation: el clic no debe llegar también a la fila (los clics suben a los padres).
      .on_click((_e, cx) => { cx.stop_propagation(); if (!this.busy) onClick(cx); })
      .child(label);
  }

  check(on, t) {
    return div().w(16).h(16).flex_none().rounded(4).border_1().border_color(on ? t.solid : t.border).bg(on ? t.solid : t.background)
      .flex().items_center().justify_center().text_size(11).text_color(t.solid_foreground).child(on ? "✓" : "");
  }

  row(a, t) {
    const hasRun = Boolean(this.table?.programs?.[a.id]?.run?.length);
    const added = this.ours().includes(a.id) && hasRun;
    const yours = hasRun && !added; // ya lo tienes en tu programs.json (p. ej. configurado a mano)
    const builtin = a.status === "builtin";
    const offer = a.status === "verified" && !added && !yours;
    const inst = this.onPath[a.run[0]];
    const sel = this.selected.has(a.id);
    const state = builtin ? "ya viene en Herdr" : added ? (inst === false ? "añadido · falta instalarlo" : "en el menú +") : yours ? "ya en tu programs.json" : a.status === "unverified" ? "sin verificar" : "";
    const hint = a.install || a.docs || "";
    const where = inst === true ? "instalado"
      : inst === false ? (added ? `aparecerá en el menú + cuando instales \`${a.run[0]}\`${hint ? " · " + hint : ""}` : `no instalado${hint ? " · " + hint : ""}`)
      : "";
    return h_flex().id(`row-${a.id}`).px(8).py(5).gap(10).items_center().rounded(8)
      .when(offer, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => {
        // Estado actual, no el capturado al pintar.
        if (this.selected.has(a.id)) this.selected.delete(a.id); else this.selected.add(a.id);
        cx.notify();
      }))
      .child(offer ? this.check(sel, t) : div().w(16).flex_none())
      .child(v_flex().flex_1().min_w(0)
        .child(h_flex().gap(6).items_center()
          .child(div().text_size(13).text_color(builtin ? t.dim : t.foreground).truncate().child(a.name))
          .child(div().text_size(11).text_color(t.dim).flex_none().child(a.run.join(" ")))
          .when(Boolean(state), (el) => el.child(div().text_size(10.5).px(5).rounded(4).bg(t.raised).text_color(t.muted).flex_none().child(state))))
        // Sin truncate: la pista de instalación puede ser larga (Goose) y se parte en líneas.
        .when(Boolean(where) && !builtin, (el) => el.child(div().w_full().text_size(10.5).line_height("14px").text_color(inst ? t.dim : t.muted).child(where))))
      .when(added, (el) => el.child(this.button(`rm-${a.id}`, "Quitar", (cx) => this.remove([a.id, `${a.id}-continue`], cx), t)));
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
        .child(div().text_size(14).font_semibold().text_color(t.foreground).child("Más agentes para el menú +"))
        .child(this.button("close", "Cerrar", () => closeOverlay(props().overlay), t)))
      .child(div().text_size(11.5).text_color(t.muted).child(`Escribe en ${this.path} (copia previa en programs.json.more-agents.bak). Herdr lo recarga solo.`))
      .when(Boolean(this.error), (el) => el.child(div().p(8).rounded(6).bg(t.raised).text_color(t.blocked).text_size(12).child(this.error)))
      .child(v_flex().id("catalog").flex_1().min_h(0).overflow_y_scrollbar().pr(12).gap(1)
        .children(list.map((a) => this.row(a, t)))
        .children(custom.map((k) => {
          const e = this.table.programs[k];
          return this.row({ id: k, name: e.name ?? k, run: e.run ?? [k], status: "custom", docs: "" }, t);
        })))
      .child(h_flex().gap(8).items_center()
        .child(h_flex().id("continue").gap(6).items_center().cursor_pointer()
          .on_click((_e, cx) => { this.withContinue = !this.withContinue; cx.notify(); })
          .child(this.check(this.withContinue, t))
          .child(div().text_size(12).text_color(t.foreground).child("Añadir también la variante \"continuar\" (si existe)")))
        .child(div().flex_1())
        .child(this.button("add-selected", n ? `Añadir ${n}` : "Añadir", (cx) => this.addSelected(cx), t, n > 0)))
      .child(div().h(1).bg(t.border))
      .child(div().text_size(12).text_color(t.dim).child("Agente personalizado · Tab cambia de campo, Enter en el comando lo añade"))
      .child(v_flex().id("custom-form").gap(6).on_key_down((e, cx) => this.formKey(e, cx))
        .child(h_flex().gap(6).child(div().w(150).child(field("key"))).child(div().flex_1().child(field("name"))))
        .child(h_flex().gap(6).child(div().flex_1().child(field("run"))).child(this.button("add-custom", "Añadir", (cx) => this.addCustom(cx), t, true))))
      .when(Boolean(this.msg), (el) => el.child(div().text_size(11.5).text_color(t.muted).child(this.msg)));
  }
}
