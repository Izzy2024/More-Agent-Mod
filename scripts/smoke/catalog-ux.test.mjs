// Lane catalog (fix/catalog-ux): the list filter, "Add continue" as a Tab stop,
// the silent bridge note for agents that already report OSC 7501, and copy.js
// defaulting to English.
//
// The suite has no coverage of "the run in programs.json does not match the
// catalog" or of programs.snippet.json; this file covers what this lane
// changed, and the other lanes add their own.
import fs from "node:fs";
import assert from "node:assert";
import { HOME, setShared } from "./stubs.mjs";

const M = (await import("./main.js")).default;
const { copyFor, DEFAULT_LANG, LANGS } = await import("./copy.js");
const CATALOG = (await import("./catalog.js")).default;

fs.mkdirSync(HOME, { recursive: true });
const P = HOME + "/programs.json";
const OWN = "more-agents.keys";
const kcx = { stop_propagation: () => {}, notify: () => {} };

async function boot({ programs, own } = {}) {
  process.env.MA_ONPATH = "omp dsh-tui aide";
  setShared(OWN, own);
  fs.rmSync(P, { force: true });
  fs.rmSync(P + ".more-agents.bak", { force: true });
  fs.writeFileSync(P, JSON.stringify({ programs: programs ?? {} }, null, 2));
  const spawned = [];
  const cx = { spawn: (f) => { spawned.push(f(cx)); }, notify() {} };
  const m = new M();
  m.init({}, cx);
  await Promise.all(spawned.splice(0));
  return { m, cx, drain: () => Promise.all(spawned.splice(0)) };
}
const read = () => JSON.parse(fs.readFileSync(P, "utf8"));
const shown = (m) => { m.render(); return m.shown.join("\n"); };

// 1. copy.js: English by default, Spanish on request, English for anything else.
{
  assert.equal(DEFAULT_LANG, "en");
  assert.deepEqual(LANGS, ["en", "es"], "the dialog offers two languages");
  const en = copyFor();
  assert.equal(en.title, "More agents for the + menu", "the default is the English the tests pin");
  assert.equal(copyFor("en"), en);
  assert.equal(copyFor("fr"), en, "an unknown language falls back to English");
  assert.match(en.bridgeCustom("https://docs"), /^Agents panel: if it does not report OSC 7501, it needs a status bridge — see https:\/\/docs\.$/);
  const es = copyFor("es");
  assert.notEqual(es.title, en.title);
  assert.notEqual(es.bridgeCustom("https://docs"), en.bridgeCustom("https://docs"));
  const { m } = await boot({ programs: {} });
  assert.equal(m.lang, DEFAULT_LANG, "the dialog opens in English");
  assert.equal(m.copy.title, en.title);
}
console.log("ok 1: copy.js is English by default, Spanish on request");

// 2. The search box narrows the list by name, key or command.
{
  const { m } = await boot({ programs: {} });
  assert.ok(m.inputs.search, "there is a search input state");
  m.inputs.search._set("omp");
  let text = shown(m);
  assert.match(text, /Oh My Pi \(omp\) ::/, "the match is painted");
  assert.doesNotMatch(text, /Kilo Code CLI ::/, "a non-matching agent is filtered out");
  // Case-insensitive, and the command counts too.
  m.inputs.search._set("TRAE-CLI");
  text = shown(m);
  assert.match(text, /Trae Agent ::/, "the command matches");
  assert.doesNotMatch(text, /Oh My Pi/, "the previous match is gone");
  m.inputs.search._set("dsh-tui");
  text = shown(m);
  assert.match(text, /dsh-TUI ::/, "the new catalog entry is searchable");
  assert.doesNotMatch(text, /Goose ::/);
  // No match at all: the list is empty and says so.
  m.inputs.search._set("zzz-not-an-agent");
  text = shown(m);
  assert.doesNotMatch(text, / :: /, "no catalog row is painted");
  assert.ok(m.shown.includes("No agent matches that search."), "the empty state is painted");
  // The arrow keys follow the filter, so they cannot land on a hidden row.
  m.inputs.search._set("kilo");
  m.render();
  assert.deepEqual(m.offeredIds(), ["kilo"], "only the visible agent is an arrow target");
  m.selected.add("omp");
  m.selected.add("kilo");
  assert.deepEqual(m.selectable(), ["kilo"], "a checked agent hidden by the filter is not added");
  m.moveFocus("add-selected", kcx);
  m.keyDown({ key: "down", modifiers: {} }, kcx);
  assert.equal(m.focusedField, "row-kilo");
  m.inputs.search._set("");
  m.render();
  assert.ok(m.offeredIds().length > 5, "clearing the filter brings the list back");
}
console.log("ok 2: the search filters name, key and command");

// 3. "Add continue" is a Tab stop: Tab reaches it and Enter activates it.
{
  const { m, cx, drain } = await boot({ programs: { "command-code": { name: "Command Code", run: ["command-code"] } } });
  m.render();
  assert.ok(m.actionIds().includes("add-continue-command-code"), "the variant is offered");
  assert.ok(m.tabOrder().includes("add-continue-command-code"), "and it is a Tab stop");
  m.customOpen = true;
  m.moveFocus("add-custom", cx);
  m.formKey({ key: "tab", modifiers: {} }, kcx);
  assert.equal(m.focusedField, "add-continue-command-code", "Tab lands on it");
  // The key context in the real runtime is the view's Context, so it can spawn.
  m.keyDown({ key: "enter", modifiers: {} }, { spawn: cx.spawn, notify() {}, stop_propagation() {} });
  await drain();
  assert.deepEqual(read().programs["command-code-continue"].run, ["command-code", "--continue"]);
  assert.equal(m.focusedField, "add-selected", "focus moves to a live control");
  // Remove continue stays reachable as well.
  m.render();
  assert.ok(m.tabOrder().includes("rm-continue-command-code"));
  assert.equal(m.activate("rm-continue-command-code", cx), true);
  await drain();
  assert.ok(!read().programs["command-code-continue"]);
}
console.log("ok 3: Add continue is keyboard reachable");

// 4. An agent that reports OSC 7501 itself gets no bridge suggestion.
{
  const dsh = CATALOG.find((a) => a.id === "dsh-tui");
  assert.equal(dsh?.nativeOsc, true, "dsh-tui declares its own OSC 7501");
  assert.equal(dsh?.bridge, undefined);
  assert.equal(dsh?.run[0], "dsh-tui", "run is the command, not the dst alias");
  assert.equal(CATALOG.find((a) => a.id === "omp")?.nativeOsc, true);
  const { m, cx, drain } = await boot({ programs: {} });
  m.inputs.key._set("dsh-tui");
  m.inputs.name._set("dsh-TUI");
  m.inputs.run._set("dsh-tui");
  m.addCustom(cx);
  await drain();
  assert.equal(m.confirm?.kind, "overwrite", "it is a catalog key");
  m.resolveConfirm(true, cx);
  await drain();
  assert.deepEqual(read().programs["dsh-tui"].run, ["dsh-tui"]);
  assert.doesNotMatch(m.msg, /status bridge/, "no bridge note for an OSC 7501 agent");
  // A custom agent has no catalog entry to vouch for it, so it keeps the note.
  m.inputs.key._set("my-tool");
  m.inputs.run._set("my-tool");
  m.addCustom(cx);
  await drain();
  assert.equal(m.confirm?.kind, "path-missing", "my-tool is not on this PATH");
  m.resolveConfirm(true, cx);
  await drain();
  assert.match(m.msg, /Agents panel: if it does not report OSC 7501, it needs a status bridge/);
  // Adding dsh-tui from the list is just as quiet, and Command Code is not.
  const b = await boot({ programs: {} });
  b.m.selected.add("dsh-tui");
  b.m.render();
  b.m.addSelected(b.cx);
  await b.drain();
  assert.deepEqual(read().programs["dsh-tui"].run, ["dsh-tui"]);
  assert.doesNotMatch(b.m.msg, /status bridge/);
  const cc = await boot({ programs: {} });
  cc.m.selected.add("command-code");
  cc.m.render();
  cc.m.addSelected(cc.cx);
  await cc.drain();
  assert.match(cc.m.msg, /Agents panel: Command Code needs the status bridge bridges\/command-code/);
}
console.log("ok 4: no bridge note for an agent that already emits OSC 7501");

console.log("catalog-ux.test: OK");
