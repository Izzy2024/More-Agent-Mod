import fs from "node:fs";
import assert from "node:assert";
import { HOME, setShared, shared } from "./stubs.mjs";
const M = (await import("./main.js")).default;

fs.mkdirSync(HOME, { recursive: true });
const P = HOME + "/programs.json";
const BAK = P + ".more-agents.bak";
const OWN = "more-agents.keys";

// A fresh dialog over a known programs.json. `failWrite` sets MA_FAIL_WRITE for
// the whole scenario; `file` wins over `programs` when both are given.
async function boot({ file, programs, failWrite, own } = {}) {
  delete process.env.MA_FAIL_WRITE;
  delete process.env.MA_EXEC_FAIL;
  process.env.MA_ONPATH = "omp aider";
  process.env.MA_KNOWN_AGENTS = "claude";
  if (failWrite !== undefined) process.env.MA_FAIL_WRITE = failWrite;
  fs.rmSync(P, { force: true });
  fs.rmSync(BAK, { force: true });
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
  const cx = { spawn: (f) => { spawned.push(f(cx)); }, notify: () => {} };
  const m = new M();
  m.init({}, cx);
  await Promise.all(spawned.splice(0));
  return { m, cx, raw, drain: () => Promise.all(spawned.splice(0)) };
}

const agentEntry = {
  name: "Oh My Pi (omp)",
  icon: "icons/pi.svg",
  tint: true,
  tile: "#1c1d21",
  color: "#ffffff",
  match: ["omp"],
  run: ["omp"],
};

// 1. programs itself must be an object; a broken shape is never written.
for (const programs of [[], "x"]) {
  const { m, cx, raw, drain } = await boot({ programs });
  assert.notEqual(m.error, null, "load reports the shape error");
  assert.equal(m.table, null, "no stale table");
  m.selected.add("omp");
  m.addSelected(cx);
  await drain();
  assert.equal(fs.readFileSync(P, "utf8"), raw, "file untouched");
  assert.match(m.error, /programs/i, "the banner carries the error");
  assert.match(m.error, /object/i);
  assert.equal(m.msg, "", "the banner is not repeated in the status line");
  assert.equal(m.busy, false, "busy reset after the failed add");
  assert.doesNotThrow(() => m.render());
}
console.log("ok 1: invalid programs shape");

// 2. Every programs entry must be an object too.
for (const bad of ["x", [], null]) {
  const file = JSON.stringify({ programs: { omp: bad } }, null, 2);
  const { m, cx, drain } = await boot({ file });
  assert.notEqual(m.error, null, "load reports the entry error");
  assert.equal(m.table, null);
  m.selected.add("omp");
  m.addSelected(cx);
  await drain();
  assert.equal(fs.readFileSync(P, "utf8"), file, "file untouched");
  assert.match(m.error, /object/i);
  assert.equal(m.busy, false);
}
console.log("ok 2: invalid entry shape");

// 3. A run that is not a non-empty array must not win over the catalog's run.
for (const badRun of [[], null, "foo"]) {
  const file = JSON.stringify({ programs: { omp: { name: "Mine", run: badRun } } }, null, 2);
  const { m, cx, drain } = await boot({ file });
  m.selected.add("omp");
  m.addSelected(cx);
  await drain();
  const t = JSON.parse(fs.readFileSync(P, "utf8"));
  assert.deepEqual(t.programs.omp.run, ["omp"], `fixes run ${JSON.stringify(badRun)}`);
  assert.equal(t.programs.omp.name, "Mine", "keeps the user's fields");
  assert.equal(m.busy, false);
}
console.log("ok 3: invalid run is replaced");

// 4. A failed backup is best-effort: the write goes through and the message says
//    so. The main file is replaced atomically and only if it has not changed, so
//    a missing safety copy must not block the operation; the failure is surfaced.
{
  const { m, cx, drain } = await boot({ programs: {}, failWrite: "more-agents.bak" });
  m.selected.add("omp");
  m.addSelected(cx);
  await drain();
  delete process.env.MA_FAIL_WRITE;
  const t = JSON.parse(fs.readFileSync(P, "utf8"));
  assert.deepEqual(t.programs.omp.run, ["omp"], "main file written");
  assert.equal(fs.existsSync(BAK), false, "no backup was written");
  assert.match(m.msg, /backup/i);
  assert.doesNotMatch(m.msg, /changed since it was read/i);
  assert.equal(m.busy, false);
  assert.equal(m.selected.size, 0, "selection cleared after a successful write");
}
console.log("ok 4: failing backup does not block the write");

// 5. A real race after load: the single retry re-applies the add on the new
//    file, so the concurrent entry and the requested one both survive.
{
  const { m, cx, drain } = await boot({ programs: {} });
  m.selected.add("omp");
  m.addSelected(cx);
  const other = JSON.stringify({ programs: { other: { run: ["other"] } } }, null, 2);
  fs.writeFileSync(P, other); // after edit() has read its snapshot
  await drain();
  const t = JSON.parse(fs.readFileSync(P, "utf8"));
  assert.deepEqual(t.programs.other.run, ["other"], "concurrent entry kept");
  assert.deepEqual(t.programs.omp.run, ["omp"], "add re-applied on the new state");
  assert.equal(m.busy, false);
  assert.equal(m.selected.size, 0, "successful retry clears the selection");
  assert.ok(m.ours().includes("omp"), "ownership matches the written entry");
}
console.log("ok 5: stale add is retried once");

// 6. An unexpected throw in the save path still clears busy and keeps the selection.
{
  const { m, cx, drain } = await boot({ programs: {} });
  m.selected.add("omp");
  m.edit = async () => { throw new Error("boom"); };
  m.addSelected(cx);
  await drain();
  assert.equal(m.busy, false);
  assert.equal(m.selected.has("omp"), true);
  assert.match(m.msg, /boom/i);
}
console.log("ok 6: spawn resets busy after a throw");

// 7. Nothing changed: no write, no backup.
{
  const { m, cx, drain } = await boot({ programs: { omp: { run: ["custom"] } } });
  const before = fs.readFileSync(P, "utf8");
  m.addEntries([["omp", agentEntry]], cx);
  await drain();
  assert.equal(fs.readFileSync(P, "utf8"), before, "no write");
  assert.equal(fs.existsSync(BAK), false, "no backup");
  assert.match(m.msg, /Already in your programs\.json/);
  assert.equal(m.busy, false);
}
console.log("ok 7: no-op add writes nothing");

console.log("data.test: A1 OK");

// A2 ------------------------------------------------------------------------
// Ownership is a map key -> fingerprint of the whole entry the mod wrote.
const owns = (k) => {
  const own = shared(OWN);
  return !!own && typeof own === "object" && !Array.isArray(own) && Object.prototype.hasOwnProperty.call(own, k);
};

// 8. A user-edited owned entry is not deleted until the dialog confirms.
{
  const { m, cx, drain } = await boot({ programs: {} });
  m.selected.add("omp");
  m.withContinue = true;
  m.addSelected(cx);
  await drain();
  const own = shared(OWN);
  assert.ok(own && typeof own === "object" && !Array.isArray(own), "new ownership format");
  assert.match(own.omp, /^fnv1a:/);
  assert.match(own["omp-continue"], /^fnv1a:/);
  const edited = JSON.parse(fs.readFileSync(P, "utf8"));
  edited.programs.omp.name = "Edited";
  fs.writeFileSync(P, JSON.stringify(edited, null, 2));
  m.remove(["omp"], cx);
  await drain();
  const kept = JSON.parse(fs.readFileSync(P, "utf8"));
  assert.ok(kept.programs.omp, "edited entry survives");
  assert.ok(m.confirm, "confirmation pending");
  assert.deepEqual(m.confirm.keys, ["omp"]);
  assert.match(m.msg, /changed since it was added/i);
  assert.match(m.msg, /nothing was removed/i);
  assert.equal(m.busy, false);
  assert.doesNotThrow(() => m.render());
  m.remove(m.confirm.keys, cx, true); // "Remove anyway"
  await drain();
  const after = JSON.parse(fs.readFileSync(P, "utf8"));
  assert.ok(!after.programs.omp, "confirmed entry removed");
  assert.ok(after.programs["omp-continue"], "the variant was not requested");
  assert.equal(m.confirm, null);
  assert.ok(!owns("omp"));
  assert.ok(owns("omp-continue"));
}
console.log("ok 8: edited entry needs confirmation");

// 9. Removing only the base leaves the continue entry, and the other way round.
{
  const { m, cx, drain } = await boot({ programs: {} });
  m.selected.add("omp");
  m.withContinue = true;
  m.addSelected(cx);
  await drain();
  m.remove(["omp"], cx);
  await drain();
  let t = JSON.parse(fs.readFileSync(P, "utf8"));
  assert.ok(!t.programs.omp && t.programs["omp-continue"]);
  assert.ok(!owns("omp") && owns("omp-continue"));
  m.remove(["omp-continue"], cx);
  await drain();
  t = JSON.parse(fs.readFileSync(P, "utf8"));
  assert.ok(!t.programs["omp-continue"]);
  assert.deepEqual(shared(OWN), {});
}
{
  const { m, cx, drain } = await boot({ programs: {} });
  m.selected.add("omp");
  m.withContinue = true;
  m.addSelected(cx);
  await drain();
  m.remove(["omp-continue"], cx);
  await drain();
  const t = JSON.parse(fs.readFileSync(P, "utf8"));
  assert.ok(t.programs.omp, "base stays");
  assert.ok(!t.programs["omp-continue"]);
  assert.ok(owns("omp") && !owns("omp-continue"));
}
console.log("ok 9: keys are removed one at a time");

// 10. Legacy array ownership and orphan keys are migrated/reconciled on load.
{
  const file = JSON.stringify({ programs: { omp: { run: ["omp"] } } }, null, 2);
  const { m, cx, drain } = await boot({ file, own: ["ghost", "omp"] });
  const own = shared(OWN);
  assert.ok(own && typeof own === "object" && !Array.isArray(own), "legacy array migrated");
  assert.ok(!("ghost" in own), "orphan dropped");
  assert.equal(own.omp, null, "old ownership is unknown, not a match");
  m.remove(["omp"], cx);
  await drain();
  assert.ok(JSON.parse(fs.readFileSync(P, "utf8")).programs.omp, "unknown ownership keeps the entry");
  assert.ok(m.confirm);
  assert.match(m.msg, /unknown ownership|changed since it was added/i);
  m.remove(m.confirm.keys, cx, true);
  await drain();
  assert.ok(!JSON.parse(fs.readFileSync(P, "utf8")).programs.omp);
  assert.deepEqual(shared(OWN), {});
}
{
  const { m } = await boot({ file: JSON.stringify({ programs: {} }, null, 2), own: { ghost: "fnv1a:deadbeef" } });
  assert.deepEqual(shared(OWN), {}, "orphan map entries are dropped");
  assert.equal(m.error, null);
}
console.log("ok 10: ownership migration and reconciliation");

// 11. A stale remove reloads on the retry; the entry is already gone, so it
//     reports nothing to remove and drops the ownership.
{
  const { m, cx, drain } = await boot({ programs: {} });
  m.selected.add("omp");
  m.addSelected(cx);
  await drain();
  assert.ok(owns("omp"));
  m.remove(["omp"], cx);
  const other = JSON.stringify({ programs: { other: { run: ["other"] } } }, null, 2);
  fs.writeFileSync(P, other);
  await drain();
  assert.equal(fs.readFileSync(P, "utf8"), other, "the concurrent file is kept");
  assert.match(m.msg, /Nothing to remove/);
  assert.equal(m.busy, false);
  const own = shared(OWN);
  assert.ok(own && typeof own === "object" && !Array.isArray(own));
  assert.ok(!("omp" in own), "no ownership for an entry that is not there");
}
console.log("ok 11: stale remove reconciles ownership");

// 12. "Remove anyway" still cannot delete an entry this mod never recorded.
{
  const file = JSON.stringify({ programs: { mine: { run: ["mine"] } } }, null, 2);
  const { m, cx, drain } = await boot({ file });
  m.remove(["mine"], cx, true);
  await drain();
  assert.ok(JSON.parse(fs.readFileSync(P, "utf8")).programs.mine, "user entry protected");
  assert.match(m.msg, /Nothing to remove/);
}
console.log("ok 12: force never deletes unowned entries");

console.log("data.test: A1+A2 OK");
