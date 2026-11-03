import fs from "node:fs";
import assert from "node:assert";
import { HOME, notes } from "./stubs.mjs";
const main = await import("./main.js");
const M = main.default;
const { tokenize } = main;
fs.mkdirSync(HOME, { recursive: true });
const P = HOME + "/programs.json";
fs.writeFileSync(P, JSON.stringify({ programs: { aider: { run: ["my-aider"] } }, shells: ["zsh"] }, null, 2));

const spawned = [];
const handles = [];
const cx = {
  spawn: (f) => spawned.push(f(cx)),
  notify: () => {},
  focus_handle: () => {
    const h = { focused: false, focus() { this.focused = true; }, is_focused() { return this.focused; } };
    handles.push(h);
    return h;
  },
};
const m = new M();
m.init({}, cx);
await Promise.all(spawned.splice(0));

let stopped = 0;
const kcx = { stop_propagation: () => { stopped++; }, notify: () => {} };
const tab = (shift = false) => m.formKey({ key: "tab", modifiers: { shift } }, kcx);

// 1. Focus starts in the key field, so the dialog is usable without a mouse.
assert.equal(m.focusedField, "key", "initial focus on key");

// Full, non-wrapping Tab order: key → name → run → continue → Add → Add custom → Close.
const forward = [];
for (let i = 0; i < 6; i++) { tab(); forward.push(m.focusedField); }
assert.deepEqual(forward, ["name", "run", "continue", "add-selected", "add-custom", "close"]);
let before = stopped;
tab();
assert.equal(m.focusedField, "close", "Tab at the end does not wrap");
assert.equal(stopped, before, "Tab at the end leaves the form (no stop_propagation)");

// Shift+Tab is the exact inverse, and also does not wrap at the start.
const backward = [];
for (let i = 0; i < 6; i++) { tab(true); backward.push(m.focusedField); }
assert.deepEqual(backward, ["add-custom", "add-selected", "continue", "run", "name", "key"]);
before = stopped;
tab(true);
assert.equal(m.focusedField, "key", "Shift+Tab at the start does not wrap");
assert.equal(stopped, before, "Shift+Tab at the start leaves the form");

// Keys that are not Tab pass through untouched.
before = stopped;
m.formKey({ key: "a", modifiers: {} }, kcx);
assert.equal(stopped, before, "non-Tab keys pass through");

// 2. Catalog rows toggle with Space/Enter from the keyboard (no mouse).
m.moveFocus("row-omp", kcx);
m.keyDown({ key: " ", modifiers: {} }, kcx);
assert.ok(m.selected.has("omp"), "Space selects a row");
m.keyDown({ key: "enter", modifiers: {} }, kcx);
assert.ok(!m.selected.has("omp"), "Enter toggles it back");

// Rows are not Tab stops: Tab from a row continues after the command field.
m.moveFocus("row-omp", kcx);
tab();
assert.equal(m.focusedField, "continue");

// Arrow keys reach the rows from Add and move between them. The runtime names
// them "down"/"up" (see the menu, picker and worktree mods), not "arrowdown".
m.moveFocus("add-selected", kcx);
m.keyDown({ key: "down", modifiers: {} }, kcx);
assert.equal(m.focusedField, "row-" + m.offeredIds()[0]);
m.keyDown({ key: "down", modifiers: {} }, kcx);
assert.equal(m.focusedField, "row-" + m.offeredIds()[1]);
m.keyDown({ key: "up", modifiers: {} }, kcx);
assert.equal(m.focusedField, "row-" + m.offeredIds()[0]);
m.keyDown({ key: "arrowdown", modifiers: {} }, kcx);
assert.equal(m.focusedField, "row-" + m.offeredIds()[0], "the old spelling is not a key");

// The "continue" checkbox toggles with Space/Enter too.
m.moveFocus("continue", kcx);
m.keyDown({ key: " ", modifiers: {} }, kcx);
assert.equal(m.withContinue, true);
m.keyDown({ key: "enter", modifiers: {} }, kcx);
assert.equal(m.withContinue, false);

// After a remove confirmation the focused button disappears: the keyboard has
// to land on a real stop, or Tab and Space stop working.
m.confirm = { kind: "remove", keys: ["omp"], changed: ["omp"] };
m.focusedField = "confirm-keep";
m.resolveConfirm(false, kcx);
assert.equal(m.confirm, null);
assert.equal(m.focusedField, "add-selected", "focus returns to a live control");
tab();
assert.equal(m.focusedField, "add-custom", "Tab works after the confirm");

// A blur can leave no focus at all; keys must not crash or eat Tab.
m.focusedField = null;
assert.doesNotThrow(() => m.formKey({ key: "tab", modifiers: {} }, kcx));
assert.doesNotThrow(() => m.keyDown({ key: "down", modifiers: {} }, kcx));
assert.doesNotThrow(() => m.keyDown({ key: "enter", modifiers: {} }, kcx));
assert.equal(m.activate(null, kcx), false);

// Rendering the dialog with focus rings and labels must not throw.
m.render();

const settle = () => Promise.all(spawned.splice(0));
const read = () => JSON.parse(fs.readFileSync(P, "utf8"));

// 3. argv tokenizer: quotes, escapes, spaces in paths; an unclosed quote is an error.
assert.deepEqual(tokenize(`"C:\\Program Files\\x.exe" --flag="a b"`), ["C:\\Program Files\\x.exe", "--flag=a b"]);
assert.deepEqual(tokenize(`one 'two three' four`), ["one", "two three", "four"]);
assert.deepEqual(tokenize(`a\\"b c\\\\d`), ['a"b', "c\\d"]);
assert.deepEqual(tokenize("  spaced   out  "), ["spaced", "out"]);
assert.throws(() => tokenize(`ok "unclosed`), /quote/i);
assert.deepEqual(tokenize(`""`), [""], "an empty quoted token is still a token");

// An empty quoted command is not a command: no run:[""] entry.
m.inputs.key._set("empty");
m.inputs.run._set(`""`);
m.addCustom(cx);
await settle();
assert.equal(m.invalidField, "run");
assert.match(m.msg, /missing/i);
assert.ok(!("empty" in read().programs));

// An unclosed quote: explicit error, focus on the command, nothing written.
m.inputs.key._set("quoted");
m.inputs.run._set(`foo "bar`);
m.addCustom(cx);
await settle();
assert.equal(m.invalidField, "run");
assert.equal(m.focusedField, "run");
assert.match(m.msg, /quote/i);
assert.ok(!("quoted" in read().programs));

// 4. Reserved program keys (herdr.d.ts: shell, program, agent) and -continue.
for (const key of ["shell", "program", "agent"]) {
  m.inputs.key._set(key);
  m.inputs.run._set("whatever");
  m.addCustom(cx);
  await settle();
  assert.equal(m.invalidField, "key", `${key} is rejected`);
  assert.match(m.msg, /reserved/i);
  assert.ok(!(key in read().programs));
}
m.inputs.key._set("foo-continue");
m.inputs.run._set("foo");
m.addCustom(cx);
await settle();
assert.equal(m.invalidField, "key");
assert.ok(!("foo-continue" in read().programs));

// A key already in programs.json is not overwritten silently.
m.inputs.key._set("aider");
m.inputs.name._set("Aider again");
m.inputs.run._set("aider --x");
m.addCustom(cx);
await settle();
assert.ok(m.confirm, "asks before overwriting a key in programs.json");
assert.deepEqual(read().programs.aider.run, ["my-aider"], "kept untouched until confirmed");
m.resolveConfirm(false, cx);
await settle();
assert.deepEqual(read().programs.aider.run, ["my-aider"], "keep as is");
assert.equal(m.confirm, null);

// Confirmed overwrite replaces the entry, leaving the rest of the file alone.
m.inputs.key._set("aider");
m.inputs.run._set("aider --x");
m.addCustom(cx);
await settle();
m.resolveConfirm(true, cx);
await settle();
assert.equal(m.focusedField, "key", "the confirm buttons are gone; focus is on a live control");
assert.deepEqual(read().programs.aider.run, ["aider", "--x"]);
assert.deepEqual(read().shells, ["zsh"], "top-level keys preserved");

// A catalog key also asks before taking the name.
m.inputs.key._set("omp");
m.inputs.run._set("omp");
m.addCustom(cx);
await settle();
assert.ok(m.confirm, "asks before reusing a catalog key");
m.resolveConfirm(false, cx);
await settle();
assert.ok(!("omp" in read().programs));

// A new custom key is written with the parsed argv and no `match`.
m.inputs.key._set("my-agent");
m.inputs.name._set("My Agent");
m.inputs.run._set(`"C:\\Program Files\\x.exe" --flag="a b"`);
m.addCustom(cx);
await settle();
assert.ok(m.confirm && m.confirm.kind === "path-missing", "unknown binary asks first");
m.resolveConfirm(true, cx); // Add anyway
await settle();
const p = read().programs["my-agent"];
assert.deepEqual(p.run, ["C:\\Program Files\\x.exe", "--flag=a b"]);
assert.ok(!("match" in p), "Herdr derives the program from run[0]");
assert.equal(p.name, "My Agent");

// Preview: the argv list, and a warning when the binary is not on the PATH.
m.onPath.foo = false;
m.inputs.run._set(`foo --bar`);
let pv = m.runPreview();
assert.deepEqual(pv.argv, ["foo", "--bar"]);
assert.equal(pv.missing, true);
m.inputs.run._set(`--flag="a b"`);
pv = m.runPreview();
assert.deepEqual(pv.argv, ["--flag=a b"]);
m.inputs.run._set(`"x`);
assert.match(m.runPreview().error, /quote/i);

// 5. PATH resolution on addCustom: exact match; missing → confirm before save.
const pathSettle = () => Promise.all(spawned.splice(0));
const pathRead = () => JSON.parse(fs.readFileSync(P, "utf8"));
const pathEnv = (bins) => { process.env.MA_ONPATH = bins; };

// Exact match: no PATH warning, run[0] unchanged.
pathEnv("empryo omp aider");
m.onPath = {};
await m.detect();
m.inputs.key._set("empryo-agent");
m.inputs.run._set("empryo --help");
m.addCustom(cx);
await pathSettle();
let ep = pathRead().programs["empryo-agent"];
assert.deepEqual(ep.run, ["empryo", "--help"]);
assert.equal(m.msgLevel, "success");
assert.ok(!/not on your PATH/i.test(m.msg));

// Typo (Empryro vs empryo): missing — confirm before save, not a silent add.
pathEnv("empryo omp aider");
await m.detect();
m.inputs.key._set("typo-agent");
m.inputs.run._set("Empryro --help");
m.addCustom(cx);
await pathSettle();
assert.ok(m.confirm && m.confirm.kind === "path-missing");
assert.equal(m.focusedField, "confirm-keep");
assert.match(m.msg, /Empryro.*not on your PATH.*will not show in the \+ menu/i);
assert.ok(!("typo-agent" in pathRead().programs));

// Missing command: confirm; Cancel leaves disk clean; Add anyway saves.
pathEnv("omp aider");
await m.detect();
m.inputs.key._set("ghost-agent");
m.inputs.run._set("ghost-cmd");
m.addCustom(cx);
await pathSettle();
assert.ok(m.confirm && m.confirm.kind === "path-missing");
assert.equal(m.focusedField, "confirm-keep");
assert.ok(!("ghost-agent" in pathRead().programs));
m.resolveConfirm(false, cx);
await pathSettle();
assert.ok(!("ghost-agent" in pathRead().programs));
m.addCustom(cx);
await pathSettle();
m.resolveConfirm(true, cx);
await pathSettle();
ep = pathRead().programs["ghost-agent"];
assert.deepEqual(ep.run, ["ghost-cmd"]);
assert.equal(m.msgLevel, "warning", "add anyway keeps saying it is not on PATH");
assert.match(m.msg, /Saved ghost-agent/);
assert.match(m.msg, /not on your PATH/);
assert.match(m.msg, /Agents panel: if it does not report OSC 7501, it needs a status bridge/);

console.log("form.test: keyboard/focus + custom form + PATH resolution OK; notifications:", notes.length);
