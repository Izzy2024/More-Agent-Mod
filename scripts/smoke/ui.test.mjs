// Dialog feedback: honest PATH badges, message levels, and the saving state.
// programs.json recovery (read / JSON / Reload) is appended in the C2 commit.
import fs from "node:fs";
import assert from "node:assert";
import { HOME, notes, setShared } from "./stubs.mjs";

const M = (await import("./main.js")).default;
fs.mkdirSync(HOME, { recursive: true });
const P = HOME + "/programs.json";
const OWN = "more-agents.keys";

async function boot({ file, programs, own, onPath } = {}) {
  delete process.env.MA_FAIL_WRITE;
  delete process.env.MA_EXEC_FAIL;
  process.env.MA_ONPATH = onPath ?? "omp aider";
  process.env.MA_KNOWN_AGENTS = "claude";
  notes.length = 0;
  setShared(OWN, own);
  fs.rmSync(P, { force: true });
  fs.rmSync(P + ".more-agents.bak", { force: true });
  if (file !== undefined) fs.writeFileSync(P, file);
  else if (programs !== undefined) fs.writeFileSync(P, JSON.stringify({ programs }, null, 2));
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

// 4. A missed PATH check is not success. installed / not found / could not check.
{
  const { m } = await boot({ programs: {} });
  assert.match(rowOf(m, "Oh My Pi (omp)"), /:: installed$/);
  assert.match(rowOf(m, "Command Code"), /not found on this PATH/);
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
console.log("ok 4: PATH badge is installed / not found / could not check");

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
