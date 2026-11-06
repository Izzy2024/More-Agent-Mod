// Dialog feedback: honest PATH badges, message levels, the saving state,
// and recovery of a broken programs.json (Reload).
import fs from "node:fs";
import assert from "node:assert";
import { HOME, notes, setShared } from "./stubs.mjs";

const M = (await import("./main.js")).default;
fs.mkdirSync(HOME, { recursive: true });
const P = HOME + "/programs.json";
const OWN = "more-agents.keys";

async function boot({ file, programs, own, onPath, shOnPath, mode } = {}) {
  delete process.env.MA_FAIL_WRITE;
  delete process.env.MA_EXEC_FAIL;
  delete process.env.MA_SH_ONPATH;
  delete process.env.MA_LOGIN_FAIL;
  process.env.MA_ONPATH = onPath ?? "omp aider";
  if (shOnPath !== undefined) process.env.MA_SH_ONPATH = shOnPath;
  process.env.MA_KNOWN_AGENTS = "claude";
  notes.length = 0;
  setShared(OWN, own);
  fs.rmSync(P, { force: true });
  fs.rmSync(P + ".more-agents.bak", { force: true });
  if (file !== undefined) fs.writeFileSync(P, file);
  else if (programs !== undefined) fs.writeFileSync(P, JSON.stringify({ programs }, null, 2));
  if (mode != null) fs.chmodSync(P, mode);
  const spawned = [];
  const cx = { spawn: (f) => { spawned.push(f(cx)); }, notify() {} };
  const m = new M();
  m.init({}, cx);
  await Promise.all(spawned.splice(0));
  return { m, cx, drain: () => Promise.all(spawned.splice(0)) };
}

const rowOf = (m, name) => {
  m.render();
  const line = m.shown.find((s) => typeof s === "string" && s.startsWith(name + " ::"));
  assert.ok(line, `row painted for ${name}`);
  return line;
};

// 4. A missed check is not success. installed / not installed / could not check.
{
  const { m } = await boot({ programs: {} });
  assert.match(rowOf(m, "Oh My Pi (omp)"), /:: installed$/);
  assert.match(rowOf(m, "Command Code"), /not installed/);
  assert.doesNotMatch(rowOf(m, "Command Code"), /in the \+ menu/);
  delete m.onPath.kilo;
  const kilo = rowOf(m, "Kilo Code CLI");
  assert.match(kilo, /could not check/);
  assert.doesNotMatch(kilo, /in the \+ menu/);
  // The lie was specific to an agent we already added: undefined used to read
  // as "in the + menu" because only `false` was treated as missing.
  const added = await boot({
    programs: { kilo: { name: "Kilo Code CLI", icon: "icons/agent.svg", tint: true, tile: "#1c1d21", color: "#ffffff", run: ["kilo"] } },
    own: { kilo: null },
  });
  delete added.m.onPath.kilo;
  const owned = rowOf(added.m, "Kilo Code CLI");
  assert.match(owned, /could not check/);
  assert.doesNotMatch(owned, /in the \+ menu/);
}
// lane-path: the login shell decides, the way Herdr's + menu does. `kilo` is
// only in the login shell's answer here, so a probe through `sh` would miss it.
{
  const { m } = await boot({ programs: {}, onPath: "omp kilo", shOnPath: "omp" });
  assert.match(rowOf(m, "Kilo Code CLI"), /:: installed$/, "the login shell sees kilo");
}
// A login shell that fails still falls back to the app's own PATH.
{
  const { m } = await boot({ programs: {}, onPath: "omp kilo", shOnPath: "omp kilo" });
  process.env.MA_LOGIN_FAIL = "1";
  await m.detect();
  delete process.env.MA_LOGIN_FAIL;
  assert.match(rowOf(m, "Kilo Code CLI"), /:: installed$/, "a failed login probe falls back");
}
// lane H fills foundAt; this lane only paints it: installed, but out of reach.
{
  const { m } = await boot({ programs: {} });
  m.foundAt = { "command-code": "/Users/x/.npm-global/bin/command-code" };
  const cc = rowOf(m, "Command Code");
  assert.match(cc, /installed, but Herdr can't see it/);
  assert.match(cc, /\/Users\/x\/\.npm-global\/bin\/command-code/);
  assert.doesNotMatch(cc, /not installed/);
  assert.doesNotMatch(cc, /:: installed$/);
}
// A later probe that fails is not allowed to keep the previous verdict.
{
  const { m } = await boot({ programs: {} });
  assert.match(rowOf(m, "Oh My Pi (omp)"), /:: installed$/);
  process.env.MA_EXEC_FAIL = "1";
  process.env.MA_KNOWN_AGENTS = "";
  await m.detect();
  delete process.env.MA_EXEC_FAIL;
  assert.match(rowOf(m, "Oh My Pi (omp)"), /could not check/);
  assert.doesNotMatch(rowOf(m, "Oh My Pi (omp)"), /installed/);
}
console.log("ok 4: badge is installed / not installed / could not check, by the login shell");

// 5. A failed save is an error, the buttons show Saving…, and the selection stays.
{
  const { m, cx, drain } = await boot({
    programs: { kilo: { name: "Kilo Code CLI", icon: "icons/agent.svg", tint: true, tile: "#1c1d21", color: "#ffffff", run: ["kilo"] } },
    own: { kilo: null },
  });
  m.selected.add("omp");
  m.selected.add("command-code");
  process.env.MA_FAIL_WRITE = "programs.json";
  m.addSelected(cx);
  assert.equal(m.busy, true, "save still in flight");
  m.customOpen = true;
  m.render();
  assert.ok(m.shown.includes("Saving…"), "saving indicator");
  assert.ok(m.shown.includes("disabled:add-selected"));
  assert.ok(m.shown.includes("disabled:add-custom"));
  assert.ok(m.shown.includes("disabled:rm-kilo"));
  assert.ok(m.shown.includes("button:close"), "Close stays usable");
  await drain();
  delete process.env.MA_FAIL_WRITE;
  assert.equal(m.busy, false);
  assert.equal(m.msgLevel, "error");
  assert.match(m.msg, /nothing was written|could not write/i);
  assert.equal(m.selected.has("omp"), true, "selection survives");
  assert.equal(m.selected.has("command-code"), true, "selection survives");
  assert.equal(fs.readFileSync(P, "utf8").includes('"omp"'), false);
}
console.log("ok 5: failed save keeps the selection and says error");

// 6. Several agents: the toast is a count, the install hints stay in the dialog.
{
  const { m, cx, drain } = await boot({ programs: {} });
  for (const id of ["omp", "kilo", "command-code"]) m.selected.add(id);
  m.addSelected(cx);
  await drain();
  const body = notes.at(-1).body;
  assert.match(body, /^Added 3; 2 need install$/);
  assert.doesNotMatch(body, /npm |curl |https?:|on your PATH/);
  assert.match(m.msg, /on your PATH/);
  assert.match(m.msg, /npm install -g @kilocode\/cli/);
  assert.match(m.msg, /npm i -g command-code@latest/);
  assert.equal(m.msgLevel === "error", false, "a partial add is not an error");
}
console.log("ok 6: toast summarizes, dialog keeps the install hints");

console.log("ui.test: C1 OK");

// 1. A read error (permissions) leaves no table, explains itself, and offers Reload.
{
  const secret = "SECRET-not-json";
  const { m } = await boot({ file: secret, mode: 0 });
  try {
    assert.equal(m.table, null);
    assert.match(m.error, /Could not read/);
    assert.match(m.error, /EACCES|permission denied/i);
    assert.doesNotMatch(m.error, /reopen/i);
    assert.doesNotThrow(() => m.render());
    assert.ok(m.shown.includes("Cannot read programs.json"), "read banner");
    assert.ok(m.shown.includes("button:reload"), "Reload is painted");
  } finally {
    fs.chmodSync(P, 0o644);
  }
  assert.equal(fs.readFileSync(P, "utf8"), secret, "a read failure writes nothing");
}
console.log("ok 1: read error banner and Reload");

// 2. Invalid JSON keeps the cause (line/column when the parser reports it) and the bytes.
{
  const raw = "{";
  const { m } = await boot({ file: raw });
  assert.equal(m.table, null);
  assert.match(m.error, /not valid JSON/);
  assert.match(m.error, /line 1 column 2/i);
  assert.doesNotMatch(m.error, /reopen/i);
  assert.equal(fs.readFileSync(P, "utf8"), raw, "raw is not rewritten");
  m.render();
  assert.ok(m.shown.includes("Invalid JSON"));
  assert.ok(m.shown.includes("button:reload"));
  const shape = await boot({ file: "[]\n" });
  assert.equal(shape.m.table, null);
  assert.match(shape.m.error, /must be a JSON object/);
  assert.doesNotMatch(shape.m.error, /not valid JSON/);
  assert.equal(fs.readFileSync(P, "utf8"), "[]\n");
  shape.m.render();
  assert.ok(shape.m.shown.includes("Unexpected shape"));
}
console.log("ok 2: invalid JSON and a bad shape stay unwritten");

// 3. After the file is fixed outside the dialog, Reload restores the table.
{
  const { m, cx, drain } = await boot({ file: "{" });
  assert.equal(m.table, null);
  const fixed = JSON.stringify({ programs: { kilo: { name: "Kilo", run: ["kilo"] } } }, null, 2);
  fs.writeFileSync(P, fixed);
  m.reload(cx);
  await drain();
  assert.equal(m.error, null);
  assert.equal(m.table.programs.kilo.run[0], "kilo");
  m.render();
  assert.ok(!m.shown.includes("button:reload"), "the banner is gone");
  assert.ok(m.offeredIds().includes("omp"), "rows accept a selection again");
  m.selected.add("omp");
  assert.deepEqual(m.selectable(), ["omp"]);
  assert.match(rowOf(m, "Kilo Code CLI"), /already in your programs\.json/);
}
console.log("ok 3: Reload recovers a repaired programs.json");

console.log("ui.test: C1+C2 OK");
