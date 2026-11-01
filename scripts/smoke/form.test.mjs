import fs from "node:fs";
import assert from "node:assert";
import { HOME, notes } from "./stubs.mjs";
const M = (await import("./main.js")).default;
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

// The dialog's key handler does not swallow text typed into an input.
before = stopped;
m.keyDown({ key: " ", modifiers: {} }, kcx);
assert.equal(stopped, before, "space in a text field is typed, not activated");

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

// Arrow keys reach the rows from Add and move between them.
m.moveFocus("add-selected", kcx);
m.keyDown({ key: "arrowdown", modifiers: {} }, kcx);
assert.equal(m.focusedField, "row-" + m.offeredIds()[0]);
m.keyDown({ key: "arrowdown", modifiers: {} }, kcx);
assert.equal(m.focusedField, "row-" + m.offeredIds()[1]);
m.keyDown({ key: "arrowup", modifiers: {} }, kcx);
assert.equal(m.focusedField, "row-" + m.offeredIds()[0]);

// The "continue" checkbox toggles with Space/Enter too.
m.moveFocus("continue", kcx);
m.keyDown({ key: " ", modifiers: {} }, kcx);
assert.equal(m.withContinue, true);
m.keyDown({ key: "enter", modifiers: {} }, kcx);
assert.equal(m.withContinue, false);

// Rendering the dialog with focus rings and labels must not throw.
m.render();

console.log("form.test: keyboard/focus OK; notifications:", notes.length);
