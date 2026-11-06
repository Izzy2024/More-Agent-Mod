// Bridge install plans: only bridges/<one-segment>/install.mjs, dry-run by
// default, and nothing runs without an explicit confirm. No real installer is
// started and no real home is touched: exec is a fake and the fixture is temp.
import fs from "node:fs";
import os from "node:os";
import assert from "node:assert";
import { join } from "node:path";
import { HOME } from "./stubs.mjs";
import { planBridge, runBridgePlan, repoRootFrom } from "./bridge-install.js";

const repo = fs.mkdtempSync(join(os.tmpdir(), "ma-bridge-plan-"));
fs.mkdirSync(join(repo, "bridges", "good"), { recursive: true });
const script = join(repo, "bridges", "good", "install.mjs");
fs.writeFileSync(script, "// fixture installer\n");

const good = { id: "good", name: "Good Agent", bridge: "bridges/good" };

// 1. No bridge, a path that climbs out, an absolute path and a bridge with no
//    installer are all refused before anything can run.
for (const agent of [
  { id: "plain", name: "Plain" },
  { id: "up", bridge: "bridges/../../x" },
  { id: "dotdot", bridge: "bridges/.." },
  { id: "mid", bridge: "bridges/good/../evil" },
  { id: "abs", bridge: "/tmp/install.mjs" },
  { id: "mod", bridge: "scripts/install.mjs" },
  { id: "missing", bridge: "bridges/nope" },
]) {
  const plan = await planBridge(agent, { repoRoot: repo, dryRun: true });
  assert.equal(plan.ok, false, `${agent.id} is refused`);
  assert.ok(plan.error, `${agent.id} says why`);
}

// 2. The good case: absolute script under the checkout, dry-run by default,
//    nothing under the user's home.
const plan = await planBridge(good, { repoRoot: repo });
assert.equal(plan.ok, true, plan.error);
assert.deepEqual(plan.argv, ["node", script, "--dry-run"]);
assert.equal(plan.argv.at(-1), "--dry-run");
assert.equal(plan.script, script);
assert.equal(plan.cwd, repo);
assert.equal(plan.writesHome, false);
assert.equal(plan.summary.includes("\n"), false, "summary is one line");
assert.match(plan.summary, /writes nothing/);
assert.doesNotMatch(plan.script, /scripts[\\/]install\.mjs$/, "never the mod installer");

// 3. Confirming executes exactly that argv, from the checkout root.
const calls = [];
const okExec = async (command, args, options) => {
  calls.push({ command, args, options });
  return { code: 0, stdout: "", stderr: "" };
};
const ran = await runBridgePlan(plan, { exec: okExec });
assert.equal(ran.ok, true, ran.error);
assert.equal(calls.length, 1);
assert.equal(calls[0].command, "node");
assert.deepEqual(calls[0].args, [script, "--dry-run"]);
assert.equal(calls[0].options.cwd, repo);
assert.equal(ran.installed, false, "a dry run is not an install");
assert.match(ran.text, /nothing was written/);

// 4. A tampered plan is refused and never reaches exec.
const seen = [];
const spy = async (...call) => { seen.push(call); return { code: 0, stdout: "", stderr: "" }; };
for (const bad of [
  { ...plan, argv: ["node", "/tmp/install.mjs", "--dry-run"] },
  { ...plan, script: join(os.tmpdir(), "install.mjs") },
  { ...plan, cwd: "/tmp" },
  { ...plan, bridge: "bridges/../../x" },
]) {
  const refused = await runBridgePlan(bad, { exec: spy });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /not valid/);
}
assert.equal(seen.length, 0, "a bad plan never runs");

// 5. A failing or unreachable installer is an error, not an install.
const failed = await runBridgePlan(plan, { exec: async () => ({ code: 1, stdout: "", stderr: "usage: no --dry-run here" }) });
assert.equal(failed.ok, false);
assert.match(failed.error, /exited with code 1/);
assert.match(failed.error, /Nothing was installed/);
const thrown = await runBridgePlan(plan, { exec: async () => { throw new Error("spawn failed"); } });
assert.equal(thrown.ok, false);
assert.match(thrown.error, /spawn failed/);
assert.match(thrown.error, /Nothing was installed/);

// 6. Repo root is only inferred from a checkout layout.
assert.equal(repoRootFrom("file:///repo/mods/more-agents/main.js"), "/repo");
assert.equal(repoRootFrom("file:///tmp/x/main.js"), null);

// 7. The dialog paints a Bridge button only for a `bridge` field, and the
//    button is not a Tab stop. Without a checkout it refuses safely.
{
  const M = (await import("./main.js")).default;
  fs.mkdirSync(HOME, { recursive: true });
  const spawned = [];
  const cx = { spawn: (f) => { spawned.push(f(cx)); }, notify() {} };
  const m = new M();
  m.init({}, cx);
  await Promise.all(spawned.splice(0));
  m.render();
  assert.ok(m.shown.includes("button:bridge-command-code"), "Command Code row has Bridge");
  assert.ok(!m.shown.includes("button:bridge-omp"), "rows without a bridge do not");
  assert.ok(!m.actionIds().includes("bridge-command-code"), "not a row action");
  assert.ok(!m.tabOrder().includes("bridge-command-code"), "not a Tab stop");
  m.previewBridge(m.agentOf("command-code"), cx);
  await Promise.all(spawned.splice(0));
  assert.equal(m.confirm, null, "no plan outside a checkout");
  assert.equal(m.msgLevel, "error");
  assert.match(m.msg, /not loaded from a checkout/);
}

fs.rmSync(repo, { recursive: true, force: true });
console.log("bridge-install.test: plans, confirm and refusal OK");
