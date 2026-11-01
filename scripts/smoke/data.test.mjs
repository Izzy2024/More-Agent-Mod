import fs from "node:fs";
import assert from "node:assert";
import { HOME, setShared } from "./stubs.mjs";
const M = (await import("./main.js")).default;

fs.mkdirSync(HOME, { recursive: true });
const P = HOME + "/programs.json";
const BAK = P + ".more-agents.bak";
const OWN = "more-agents.keys";

// A fresh dialog over a known programs.json. `failWrite` sets MA_FAIL_WRITE for
// the whole scenario; `file` wins over `programs` when both are given.
async function boot({ file, programs, failWrite } = {}) {
  delete process.env.MA_FAIL_WRITE;
  delete process.env.MA_EXEC_FAIL;
  process.env.MA_ONPATH = "omp aider";
  process.env.MA_KNOWN_AGENTS = "claude";
  if (failWrite !== undefined) process.env.MA_FAIL_WRITE = failWrite;
  fs.rmSync(P, { force: true });
  fs.rmSync(BAK, { force: true });
  setShared(OWN, undefined);
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
  assert.match(m.msg, /programs/i);
  assert.match(m.msg, /object/i);
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
  assert.match(m.msg, /object/i);
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

// 4. A failed backup is best-effort: the write goes through and the message says so.
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
  assert.doesNotMatch(m.msg, /did the file change/i);
  assert.equal(m.busy, false);
  assert.equal(m.selected.size, 0, "selection cleared after a successful write");
}
console.log("ok 4: failing backup does not block the write");

// 5. A real race after load: nothing is written, the message is honest, the
//    selection survives, and no ownership is recorded for a missing entry.
{
  const { m, cx, drain } = await boot({ programs: {} });
  m.selected.add("omp");
  m.addSelected(cx);
  const other = JSON.stringify({ programs: { other: { run: ["other"] } } }, null, 2);
  fs.writeFileSync(P, other); // after edit() has read its snapshot
  await drain();
  assert.equal(fs.readFileSync(P, "utf8"), other, "stale write refused");
  assert.match(m.msg, /changed since it was read/i);
  assert.match(m.msg, /nothing was written/i);
  assert.equal(m.busy, false);
  assert.equal(m.selected.has("omp"), true, "selection kept on failure");
  assert.ok(!m.ours().includes("omp"), "no ownership for an entry that is not there");
}
console.log("ok 5: stale write is refused");

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
