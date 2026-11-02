import fs from "node:fs";
import assert from "node:assert";
import { HOME, setShared, shared } from "./stubs.mjs";
const M = (await import("./main.js")).default;

fs.mkdirSync(HOME, { recursive: true });
const P = HOME + "/programs.json";
const BAK = P + ".more-agents.bak";
const ORIG = P + ".more-agents.orig.bak";
const OWN = "more-agents.keys";

// A fresh dialog over a known programs.json. `failWrite` sets MA_FAIL_WRITE for
// the scenario; `own` seeds the ownership map (or the legacy array).
async function boot({ file, programs, failWrite, own } = {}) {
  delete process.env.MA_FAIL_WRITE;
  delete process.env.MA_EXEC_FAIL;
  process.env.MA_ONPATH = "omp aider";
  process.env.MA_KNOWN_AGENTS = "claude";
  if (failWrite !== undefined) process.env.MA_FAIL_WRITE = failWrite;
  for (const p of [P, BAK, ORIG]) fs.rmSync(p, { force: true });
  setShared(OWN, own);
  let raw = null;
  if (file !== undefined) {
    raw = file;
    fs.writeFileSync(P, raw);
  } else if (programs !== undefined) {
    raw = JSON.stringify({ programs }, null, 2);
    fs.writeFileSync(P, raw);
  }
  const spawned = [];
  const handles = [];
  const cx = {
    spawn: (f) => { spawned.push(f(cx)); },
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
  return { m, cx, raw, handles, drain: () => Promise.all(spawned.splice(0)) };
}

const read = () => JSON.parse(fs.readFileSync(P, "utf8"));
const owns = (k) => {
  const own = shared(OWN);
  return !!own && typeof own === "object" && !Array.isArray(own) && Object.prototype.hasOwnProperty.call(own, k);
};
const merge = (...files) => JSON.stringify({ programs: Object.assign({}, ...files.map((f) => f.programs ?? f)) }, null, 2);

// 1. CAS conflict: one retry re-applies `change` on the new state and writes.
{
  const initial = { programs: { aider: { run: ["aider"] } } };
  const { m, cx, drain } = await boot({ file: JSON.stringify(initial, null, 2) });
  m.selected.add("omp");
  m.addSelected(cx);
  // After edit() read its snapshot but before its write: another process adds `other`.
  fs.writeFileSync(P, merge(initial, { programs: { other: { run: ["other"] } } }));
  await drain();
  const t = read();
  assert.deepEqual(t.programs.aider.run, ["aider"], "kept the concurrent entry");
  assert.deepEqual(t.programs.other.run, ["other"]);
  assert.deepEqual(t.programs.omp.run, ["omp"], "retry wrote the requested entry");
  assert.equal(m.busy, false);
  assert.equal(m.selected.size, 0, "successful retry clears the selection");
  assert.ok(owns("omp"));
  assert.doesNotMatch(m.msg, /changed since it was read/i);
}
console.log("ok D1.1: stale write retried once");

// 2. Stale twice: no write, honest message, busy reset, selection kept.
{
  const state2 = merge({ programs: { second: { run: ["second"] } } });
  const state3 = merge({ programs: { third: { run: ["third"] } } });
  const { m, cx, drain } = await boot({ programs: {} });
  let loads = 0;
  const originalLoad = m.load.bind(m);
  m.load = async () => {
    const r = await originalLoad();
    loads++;
    if (loads === 1) fs.writeFileSync(P, state2); // first write goes stale
    if (loads === 2) fs.writeFileSync(P, state3); // retry write goes stale too
    return r;
  };
  m.selected.add("omp");
  m.addSelected(cx);
  await drain();
  assert.equal(loads, 3, "initial read + retry + final reload");
  assert.equal(fs.readFileSync(P, "utf8"), state3, "nothing written");
  assert.match(m.msg, /changed since it was read/i);
  assert.match(m.msg, /nothing was written/i);
  assert.equal(m.busy, false);
  assert.equal(m.selected.has("omp"), true, "selection kept on failure");
  assert.ok(!owns("omp"));
}
console.log("ok D1.2: second stale refuses");

// 3. orig.bak: created once with the content before the first successful write,
//    never overwritten, and its failure is a warning that does not block.
{
  const initial = JSON.stringify({ programs: { aider: { run: ["aider"] } } }, null, 2);
  const { m, cx, drain } = await boot({ file: initial, failWrite: ".orig.bak" });
  m.selected.add("omp");
  m.addSelected(cx);
  await drain();
  delete process.env.MA_FAIL_WRITE;
  assert.deepEqual(read().programs.omp.run, ["omp"], "main write still goes through");
  assert.equal(fs.existsSync(ORIG), false, "failed orig is not created");
  assert.match(m.msg, /original backup/i);
  assert.ok(fs.existsSync(BAK), "the normal backup still happens");
  assert.equal(m.busy, false);
}
{
  const initial = JSON.stringify({ programs: { aider: { run: ["aider"] } } }, null, 2);
  const { m, cx, drain } = await boot({ file: initial });
  m.selected.add("omp");
  m.addSelected(cx);
  await drain();
  assert.equal(fs.readFileSync(ORIG, "utf8"), initial, "orig is the pre-mod file");
  m.inputs.key._set("second");
  m.inputs.name._set("Second");
  m.inputs.run._set("second-bin");
  m.addCustom(cx);
  await drain();
  assert.equal(fs.readFileSync(ORIG, "utf8"), initial, "orig is never overwritten");
  assert.deepEqual(read().programs.second.run, ["second-bin"]);
}
{
  const { m, cx, drain } = await boot({ file: undefined, programs: undefined });
  fs.rmSync(P, { force: true });
  m.selected.add("omp");
  m.addSelected(cx);
  await drain();
  assert.deepEqual(read().programs.omp.run, ["omp"]);
  assert.equal(fs.existsSync(ORIG), false, "no orig when programs.json did not exist");
  assert.equal(fs.existsSync(BAK), false, "no backup when there was no previous file");
}
console.log("ok D1.3: orig.bak lifecycle");

// 4. A permission error is not a stale conflict: no retry, and the message says so.
{
  const initial = JSON.stringify({ programs: {} }, null, 2);
  const { m, cx, drain } = await boot({ file: initial, failWrite: "programs.json" });
  m.selected.add("omp");
  m.addSelected(cx);
  await drain();
  delete process.env.MA_FAIL_WRITE;
  assert.equal(fs.readFileSync(P, "utf8"), initial, "nothing written");
  assert.match(m.msg, /EACCES|permission/i);
  assert.doesNotMatch(m.msg, /changed since it was read|did the file change/i);
  assert.equal(m.busy, false);
}
console.log("ok D1.4: I/O errors are not reported as races");

console.log("continue.test: D1 OK");

// D2 ------------------------------------------------------------------------
// 5. With the base already present, add only the documented continue variant.
{
  const base = { run: ["omp"], name: "Mine" };
  const { m, cx, drain } = await boot({ programs: { omp: base } });
  const a = m.agentOf("omp");
  assert.equal(m.canAddContinue(a), true, "offered when the base is present");
  assert.equal(m.activate("add-continue-omp", cx), true);
  await drain();
  const t = read();
  assert.deepEqual(t.programs.omp, base, "base untouched and still the user's");
  assert.deepEqual(t.programs["omp-continue"].run, ["omp", "--continue"]);
  assert.ok(!owns("omp"), "the base was not ours");
  assert.ok(owns("omp-continue"));
  assert.equal(m.canAddContinue(a), false, "not offered twice");
  assert.ok(m.actionIds().includes("rm-continue-omp"));
  assert.ok(!m.actionIds().includes("add-continue-omp"));
  assert.equal(t.programs["omp-continue"].match, undefined);
}
// No continue in the catalog: no action, ever. Nor for custom keys.
{
  const { m } = await boot({ programs: { cline: { run: ["cline"] } } });
  const cline = m.agentOf("cline");
  assert.equal(cline.continue, undefined);
  assert.equal(m.canAddContinue(cline), false);
  assert.ok(!m.actionIds().includes("add-continue-cline"));
  assert.equal(m.canAddContinue({ id: "mine", status: "custom", run: ["mine"] }), false);
  assert.equal(m.agentOf("mine-continue"), null, "no invented variants for custom keys");
}
console.log("ok D2.5: add continue only when documented and missing");

// 6. Remove the base and the variant independently, each with its own print.
{
  const { m, cx, drain } = await boot({ programs: {} });
  m.selected.add("omp");
  m.withContinue = true;
  m.addSelected(cx);
  await drain();
  assert.deepEqual(m.actionIds().filter((id) => id.includes("omp")), ["rm-omp", "rm-continue-omp"]);
  const contFp = shared(OWN)["omp-continue"];
  assert.equal(m.activate("rm-omp", cx), true);
  await drain();
  let t = read();
  assert.ok(!t.programs.omp, "base removed");
  assert.ok(t.programs["omp-continue"], "variant stayed");
  assert.equal(shared(OWN)["omp-continue"], contFp, "variant fingerprint intact");
  assert.equal(m.activate("rm-continue-omp", cx), true);
  await drain();
  t = read();
  assert.ok(!t.programs["omp-continue"]);
  assert.deepEqual(shared(OWN), {});
}
{
  const { m, cx, drain } = await boot({ programs: {} });
  m.selected.add("omp");
  m.withContinue = true;
  m.addSelected(cx);
  await drain();
  const baseFp = shared(OWN).omp;
  assert.equal(m.activate("rm-continue-omp", cx), true);
  await drain();
  const t = read();
  assert.ok(t.programs.omp, "base stayed");
  assert.ok(!t.programs["omp-continue"], "variant removed");
  assert.equal(shared(OWN).omp, baseFp, "base fingerprint intact");
}
// A changed variant still goes through Remove anyway / Keep, and only removes
// that key when confirmed.
{
  const { m, cx, drain } = await boot({ programs: {} });
  m.selected.add("omp");
  m.withContinue = true;
  m.addSelected(cx);
  await drain();
  const edited = read();
  edited.programs["omp-continue"].name = "Edited continue";
  fs.writeFileSync(P, JSON.stringify(edited, null, 2));
  m.remove(["omp-continue"], cx);
  await drain();
  let t = read();
  assert.ok(t.programs.omp, "base untouched");
  assert.ok(t.programs["omp-continue"], "changed variant kept until confirmed");
  assert.equal(m.confirm?.kind, "remove");
  assert.deepEqual(m.confirm.keys, ["omp-continue"]);
  assert.match(m.msg, /changed since it was added|unknown ownership/i);
  m.remove(m.confirm.keys, cx, true);
  await drain();
  t = read();
  assert.ok(t.programs.omp, "base still there");
  assert.ok(!t.programs["omp-continue"], "confirmed variant removed");
  assert.ok(owns("omp") && !owns("omp-continue"));
}
console.log("ok D2.6: base and continue remove independently");

console.log("continue.test: D1+D2 OK");

// D3 ------------------------------------------------------------------------
// 7. Remove is a real Tab stop after Add custom, activates with Enter/Space,
//    and focus lands on a live control after the button disappears.
{
  const { m, cx, drain } = await boot({ programs: {} });
  m.selected.add("omp");
  m.addSelected(cx);
  await drain();
  assert.ok(m.actionHandles["rm-omp"], "catalog remove has a focus handle");
  m.moveFocus("add-custom", cx);
  let stopped = 0;
  const kcx = { stop_propagation: () => { stopped++; }, notify: () => {} };
  m.formKey({ key: "tab", modifiers: {} }, kcx);
  assert.equal(m.focusedField, "rm-omp", "Remove follows Add custom");
  assert.equal(stopped, 1, "Tab is consumed");
  assert.ok(m.tabOrder().includes("rm-omp"));
  // While a confirm is open, both answers follow the row actions.
  m.confirm = { kind: "remove", keys: ["omp"], changed: ["omp"] };
  const order = m.tabOrder();
  assert.ok(order.indexOf("confirm-yes") > order.indexOf("rm-omp"));
  assert.ok(order.indexOf("confirm-keep") > order.indexOf("confirm-yes"));
  m.confirm = null;
  assert.equal(m.activate(m.focusedField, cx), true);
  await drain();
  assert.ok(!read().programs.omp, "activated Remove deleted the base");
  assert.equal(m.focusedField, "add-selected", "focus moved to a live control");
  assert.equal(m.busy, false);
}
// The same for a key created by the custom form.
{
  const { m, cx, drain } = await boot({ programs: {} });
  m.inputs.key._set("my-agent");
  m.inputs.name._set("My Agent");
  m.inputs.run._set("my-bin");
  m.addCustom(cx);
  await drain();
  assert.ok(m.actionHandles["rm-my-agent"], "custom remove has a focus handle");
  m.moveFocus("add-custom", cx);
  m.formKey({ key: "tab", modifiers: {} }, { stop_propagation: () => {}, notify: () => {} });
  assert.equal(m.focusedField, "rm-my-agent");
  assert.equal(m.activate("rm-my-agent", cx), true);
  await drain();
  assert.ok(!("my-agent" in read().programs));
  assert.equal(m.focusedField, "add-selected");
}
console.log("ok D3.7: Remove is keyboard reachable");

console.log("continue.test: D1+D2+D3 OK");
