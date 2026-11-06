// Lane C: search focus, Tab order, catalog sections, custom-form disclosure.
import fs from "node:fs";
import assert from "node:assert";
import { HOME, setShared } from "./stubs.mjs";

const M = (await import("./main.js")).default;
const { copyFor } = await import("./copy.js");
const CATALOG = (await import("./catalog.js")).default;

fs.mkdirSync(HOME, { recursive: true });
const P = HOME + "/programs.json";
const OWN = "more-agents.keys";

async function boot({ programs, own, onPath, timer } = {}) {
  delete process.env.MA_EXEC_FAIL;
  process.env.MA_ONPATH = onPath ?? "omp";
  process.env.MA_KNOWN_AGENTS = "";
  setShared(OWN, own);
  fs.rmSync(P, { force: true });
  fs.writeFileSync(P, JSON.stringify({ programs: programs ?? {} }, null, 2));
  const spawned = [];
  const cx = {
    spawn: (f) => { spawned.push(f(cx)); },
    notify() {},
    focus_handle: () => ({ focused: false, focus() { this.focused = true; } }),
    timer,
  };
  const m = new M();
  m.init({}, cx);
  await Promise.all(spawned.splice(0));
  return { m, cx };
}

const shown = (m) => { m.render(); return m.shown; };
function bucket(lines, name) {
  let current = null;
  for (const line of lines) {
    if (line.startsWith("Ready to add (")) current = "ready";
    else if (line.startsWith("Needs install (")) current = "install";
    else if (line.startsWith("Already in your + menu (")) current = "added";
    else if (line.startsWith("Ships with Herdr (")) current = "ships";
    else if (line.startsWith(name + " ::")) return current;
  }
  return null;
}

// 1. Initial focus is the search box, including the 600 ms retry.
{
  let late = null;
  const { m } = await boot({
    timer: { after(ms, fn) { late = { ms, fn }; } },
  });
  assert.equal(m.focusedField, "search", "initial focus on search");
  assert.equal(m.inputs.search.focused, true);
  assert.equal(m.inputs.key.focused, false, "key is not focused on open");
  assert.equal(late.ms, 600);
  m.focusedField = "continue";
  m.inputs.search.focused = false;
  late.fn();
  assert.equal(m.inputs.search.focused, true, "the retry focuses search");
  assert.equal(m.focusedField, "search");
}
console.log("ok 1: focus starts on search");

// 2. Sections: one ready, one missing, one already added, plus a custom agent.
//    Ships with Herdr is collapsed. Search forces a section open.
{
  const { m, cx } = await boot({
    programs: {
      aider: { name: "Aider", run: ["aider"] },
      "my-agent": { name: "My Agent", run: ["my-bin"] },
    },
    own: { "my-agent": null },
    onPath: "omp",
  });
  const kcx = { stop_propagation() {}, notify() {} };
  let lines = shown(m);
  assert.equal(bucket(lines, "Oh My Pi (omp)"), "ready");
  assert.equal(bucket(lines, "Kilo Code CLI"), "install");
  assert.equal(bucket(lines, "Aider"), "added");
  assert.equal(bucket(lines, "My Agent"), "added");
  assert.equal(bucket(lines, "Gemini CLI"), null, "a builtin row is not painted while collapsed");
  const installN = CATALOG.filter((a) => a.status === "verified" && a.id !== "omp" && a.id !== "aider").length;
  const shipsN = CATALOG.filter((a) => a.status === "builtin" || a.status === "unverified").length;
  assert.ok(lines.includes("section:ready:1:open"));
  assert.ok(lines.includes("Ready to add (1)"));
  assert.ok(lines.includes(`section:install:${installN}:open`));
  assert.ok(lines.includes(`Needs install (${installN})`));
  assert.ok(lines.includes("section:added:2:open"));
  assert.ok(lines.includes("Already in your + menu (2)"));
  assert.ok(lines.includes(`section:ships:${shipsN}:closed`));
  const aiderAt = lines.findIndex((s) => s.startsWith("Aider ::"));
  const mineAt = lines.findIndex((s) => s.startsWith("My Agent ::"));
  assert.ok(aiderAt >= 0 && mineAt > aiderAt, "alphabetical inside the added section");
  assert.equal(m.sectionOf({ id: "x", status: "unverified", name: "X", run: ["x"] }), "ships");

  // Collapsed ready rows are not arrow stops. Search paints them again.
  m.toggleSection("ready", cx);
  lines = shown(m);
  assert.ok(lines.includes("section:ready:1:closed"));
  assert.equal(bucket(lines, "Oh My Pi (omp)"), null);
  assert.ok(!m.offeredIds().includes("omp"));
  m.moveFocus("search", kcx);
  m.keyDown({ key: "down", modifiers: {} }, kcx);
  assert.notEqual(m.focusedField, "row-omp");
  assert.equal(m.focusedField, "row-" + m.offeredIds()[0]);
  m.inputs.search._set("omp");
  lines = shown(m);
  assert.ok(lines.some((s) => s.startsWith("section:ready:") && s.endsWith(":open")), "search expands the section");
  assert.deepEqual(m.offeredIds(), ["omp"]);
  m.moveFocus("search", kcx);
  m.keyDown({ key: "down", modifiers: {} }, kcx);
  assert.equal(m.focusedField, "row-omp");
  m.inputs.search._set("");
  m.render();
  assert.ok(!m.offeredIds().includes("omp"), "clearing the search restores the collapse");

  m.toggleSection("ready", cx);
  m.inputs.search._set("gemini");
  lines = shown(m);
  assert.ok(lines.some((s) => s.startsWith("section:ships:") && s.endsWith(":open")));
  assert.ok(lines.some((s) => s.startsWith("Gemini CLI ::")));
  assert.ok(!m.offeredIds().includes("gemini"), "a builtin row is still not an arrow stop");
  m.inputs.search._set("");
  lines = shown(m);
  assert.ok(lines.includes(`section:ships:${shipsN}:closed`));
  assert.ok(!lines.some((s) => s.startsWith("Gemini CLI ::")));

  // Spanish headers use the keys added next to searchNoMatch.
  const es = copyFor("es");
  assert.equal(es.sectionReady, "Listos para añadir");
  assert.equal(es.addOwn, "Añadir tu propio agente...");
  assert.notEqual(es.sectionInstall, copyFor("en").sectionInstall);
  m.lang = "es";
  m.copy = es;
  lines = shown(m);
  assert.ok(lines.includes("Listos para añadir (1)"));
  assert.ok(lines.includes("Vienen con Herdr (" + shipsN + ")"));
}
console.log("ok 2: sections, search expand, collapsed rows are not arrow stops");

// 3. Tab order collapsed and expanded. Reload and confirm keep their places.
{
  const { m } = await boot({
    programs: {
      aider: { name: "Aider", run: ["aider"] },
      "my-agent": { name: "My Agent", run: ["my-bin"] },
    },
    own: { "my-agent": null },
  });
  const kcx = { stop_propagation() {}, notify() {} };
  const tab = (shift = false) => m.formKey({ key: "tab", modifiers: { shift } }, kcx);
  assert.equal(m.focusedField, "search");
  assert.ok(!m.tabOrder().includes("key"), "collapsed form hides the key stop");
  const collapsed = [];
  for (let i = 0; i < 6; i++) { tab(); collapsed.push(m.focusedField); }
  assert.deepEqual(collapsed, ["continue", "add-selected", "add-own", "add-continue-aider", "rm-my-agent", "close"]);
  m.customOpen = true;
  m.moveFocus("search", kcx);
  const expanded = [];
  for (let i = 0; i < 10; i++) { tab(); expanded.push(m.focusedField); }
  assert.deepEqual(expanded, [
    "continue", "add-selected", "add-own", "key", "name", "run", "add-custom",
    "add-continue-aider", "rm-my-agent", "close",
  ]);
  m.error = "programs.json is not valid JSON";
  m.moveFocus("rm-my-agent", kcx);
  tab();
  assert.equal(m.focusedField, "reload");
  tab();
  assert.equal(m.focusedField, "close");
  m.confirm = { kind: "remove", keys: ["my-agent"] };
  const order = m.tabOrder();
  assert.deepEqual(order.slice(-3), ["confirm-yes", "confirm-keep", "close"]);
  assert.ok(order.indexOf("reload") < order.indexOf("confirm-yes"));
  m.confirm = null;
  m.error = null;
  assert.ok(!m.tabOrder().includes("reload"));
}
console.log("ok 3: tab order collapsed, expanded, reload, confirm");

// 4. Disclosure: collapsed by default, first open focuses key, values survive,
//    fail() and a custom confirm force it open.
{
  const { m, cx } = await boot({ programs: {} });
  const kcx = { stop_propagation() {}, notify() {} };
  m.inputs.key._set("kept-key");
  m.inputs.run._set("foo --bar");
  let lines = shown(m);
  assert.ok(lines.includes("custom-form:closed"));
  assert.ok(lines.includes("Add your own agent..."));
  assert.ok(!lines.includes(m.copy.hint), "the hint is inside the expanded form");
  assert.ok(!lines.includes("run-preview"), "the command preview is hidden while collapsed");
  m.moveFocus("add-own", kcx);
  m.keyDown({ key: " ", modifiers: {} }, kcx);
  assert.equal(m.customOpen, true, "Space toggles the disclosure");
  assert.equal(m.focusedField, "key", "the first open focuses key");
  lines = shown(m);
  assert.ok(lines.includes("custom-form:open"));
  assert.ok(lines.includes(m.copy.hint));
  assert.ok(lines.includes("run-preview"));
  m.keyDown({ key: "enter", modifiers: {} }, kcx);
  assert.equal(m.customOpen, true, "Enter in the key field does not toggle the disclosure");
  m.moveFocus("add-own", kcx);
  m.keyDown({ key: "enter", modifiers: {} }, kcx);
  assert.equal(m.customOpen, false);
  assert.equal(m.inputs.key.value(), "kept-key", "collapsing keeps the key");
  assert.equal(m.inputs.run.value(), "foo --bar", "collapsing keeps the command");
  lines = shown(m);
  assert.ok(!lines.includes("run-preview"));
  m.moveFocus("continue", kcx);
  m.activate("add-own", cx);
  assert.equal(m.customOpen, true);
  assert.equal(m.focusedField, "continue", "a later open does not steal focus");

  m.customOpen = false;
  m.fail("run", "The command is missing.", cx);
  assert.equal(m.customOpen, true, "fail() opens the form");
  assert.equal(m.focusedField, "run");
  assert.equal(m.invalidField, "run");

  m.customOpen = false;
  m.confirm = { kind: "path-missing", key: "kept-key", entry: { run: ["foo"] } };
  lines = shown(m);
  assert.ok(lines.includes("custom-form:open"), "a custom confirm paints the form");
  assert.ok(m.tabOrder().includes("key"));
  m.activate("add-own", cx);
  assert.equal(m.formOpen(), true, "the form stays open while the question is up");
  m.confirm = null;
}
console.log("ok 4: custom form disclosure");

console.log("layout.test: OK");
