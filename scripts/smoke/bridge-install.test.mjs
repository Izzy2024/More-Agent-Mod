// Bridge install plans: only bridges/<one-segment>/install.mjs, dry-run by
// default, and nothing runs without an explicit confirm. No real installer is
// started and no real home is touched: exec is a fake and the fixture is temp.
import fs from "node:fs";
import os from "node:os";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
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

// 6b. Installed copy: bridges/ sits next to main.js, so the bridge root is the
//     mod folder even though repoRootFrom can only infer the app home.
{
  const appHome = fs.mkdtempSync(join(os.tmpdir(), "ma-bridge-installed-"));
  const mod = join(appHome, "mods", "more-agents");
  fs.mkdirSync(join(mod, "bridges", "good"), { recursive: true });
  const installedScript = join(mod, "bridges", "good", "install.mjs");
  fs.writeFileSync(installedScript, "// fixture installer\n");
  assert.equal(repoRootFrom("file://" + join(mod, "main.js")), appHome, "the app home is all it can infer");
  const installedPlan = await planBridge(good, { repoRoot: appHome });
  assert.equal(installedPlan.ok, true, installedPlan.error);
  assert.equal(installedPlan.script, installedScript);
  assert.equal(installedPlan.cwd, mod, "runs from the installed mod folder");
  const ranInstalled = await runBridgePlan(installedPlan, { exec: okExec });
  assert.equal(ranInstalled.ok, true, ranInstalled.error);
  assert.equal(calls.at(-1).options.cwd, mod);
  fs.rmSync(appHome, { recursive: true, force: true });
}
console.log("ok 6b: installed copy uses its own bridges/");

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
  // Cursor is builtin, so its row sits in the "Ships with Herdr" section, which
  // starts collapsed: the Bridge button is one click away, not on screen.
  assert.ok(!m.shown.includes("button:bridge-cursor"), "collapsed builtin section hides the cursor row");
  m.toggleSection("ships", cx);
  m.render();
  assert.ok(m.shown.includes("button:bridge-cursor"), "the builtin cursor row reaches its bridge once the section is open");
  assert.ok(!m.shown.includes("button:bridge-omp"), "rows without a bridge do not");
  assert.ok(!m.actionIds().includes("bridge-command-code"), "not a row action");
  assert.ok(!m.tabOrder().includes("bridge-command-code"), "not a Tab stop");
  m.previewBridge(m.agentOf("command-code"), cx);
  await Promise.all(spawned.splice(0));
  assert.equal(m.confirm, null, "no plan outside a checkout");
  assert.equal(m.msgLevel, "error");
  assert.match(m.msg, /not loaded from a checkout/);
}

// 8. One argv per action; status parses exactly one JSON line and refuses the rest.
{
  const statusPlan = await planBridge(good, { repoRoot: repo, action: "status" });
  assert.equal(statusPlan.action, "status");
  assert.deepEqual(statusPlan.argv, ["node", script, "--status"]);
  assert.equal(statusPlan.writesHome, false);
  const installPlan = await planBridge(good, { repoRoot: repo, action: "install" });
  assert.deepEqual(installPlan.argv, ["node", script]);
  assert.equal(installPlan.writesHome, true);
  const removePlan = await planBridge(good, { repoRoot: repo, action: "uninstall" });
  assert.deepEqual(removePlan.argv, ["node", script, "--uninstall"]);
  assert.equal(removePlan.writesHome, true);
  // The old dryRun option keeps its meaning: false is an install, anything else
  // (and the default) is the preview.
  assert.deepEqual((await planBridge(good, { repoRoot: repo, dryRun: false })).argv, ["node", script]);
  assert.deepEqual((await planBridge(good, { repoRoot: repo })).argv, ["node", script, "--dry-run"]);

  const runStatus = (stdout, code = 0) => runBridgePlan(statusPlan, { exec: async () => ({ code, stdout, stderr: "" }) });
  const okStatus = JSON.stringify({ app: "good", installed: true, file: "/tmp/good-hooks.json" });
  let parsed = await runStatus(`${okStatus}\n`);
  assert.equal(parsed.ok, true, parsed.error);
  assert.equal(parsed.installed, true);
  assert.deepEqual(parsed.status, JSON.parse(okStatus));
  for (const badOut of ["", "not json\n", "{}\n", '{"app":"good"}\n', `${okStatus}\n${okStatus}\n`]) {
    parsed = await runStatus(badOut);
    assert.equal(parsed.ok, false, `refuses ${JSON.stringify(badOut)}`);
    assert.notEqual(parsed.installed, true);
  }
  const failedStatus = await runBridgePlan(statusPlan, { exec: async () => ({ code: 1, stdout: "", stderr: "no status" }) });
  assert.equal(failedStatus.ok, false);
  assert.match(failedStatus.error, /no status/);
  assert.match(failedStatus.error, /Nothing was read/);

  const tampered = await runBridgePlan({ ...statusPlan, argv: ["node", script, "--uninstall"] }, { exec: spy });
  assert.equal(tampered.ok, false);
  assert.match(tampered.error, /not valid/);
}
console.log("ok 8: one argv per action and strict status parsing");

// 9. Dialog flow: --status shapes the button, the confirm is required, cancel
//    runs nothing, and a failed action never flips the status.
{
  const M = (await import("./main.js")).default;
  const dir = join(repo, "bridges", "command-code");
  fs.mkdirSync(dir, { recursive: true });
  const installer = join(dir, "install.mjs");
  fs.writeFileSync(installer, "// fixture installer\n");
  let installed = false;
  const calls = [];
  const fake = async (command, args, options) => {
    calls.push({ command, args, options });
    if (args.includes("--status")) {
      return { code: 0, stdout: `${JSON.stringify({ app: "command-code", installed, file: "/tmp/cc-hooks.json" })}\n`, stderr: "" };
    }
    if (args.includes("--dry-run")) return { code: 0, stdout: "dry\n", stderr: "" };
    if (args.includes("--uninstall")) { installed = false; return { code: 0, stdout: "removed\n", stderr: "" }; }
    installed = true;
    return { code: 0, stdout: "installed\n", stderr: "" };
  };
  fs.mkdirSync(HOME, { recursive: true });
  const spawned = [];
  const cx = { spawn: (f) => { spawned.push(f(cx)); }, notify() {} };
  const m = new M();
  m.init({}, cx);
  await Promise.all(spawned.splice(0));
  const agent = m.agentOf("command-code");
  m.bridgeRoot = repo;
  m.bridgeExec = fake;
  await m.checkBridges();
  assert.equal(m.bridgeStatus["command-code"]?.installed, false);
  assert.equal(m.bridgeLabel(agent), "Install bridge");
  m.render();
  assert.ok(m.shown.includes("button:bridge-command-code"), "the row paints the bridge button");

  const drain = () => Promise.all(spawned.splice(0));
  const realCalls = () => calls.filter((c) => !c.args.includes("--status") && !c.args.includes("--dry-run"));
  calls.length = 0;
  m.previewBridge(agent, cx);
  await drain();
  assert.equal(m.confirm?.kind, "bridge");
  assert.equal(m.confirm.action, "install");
  assert.deepEqual(m.confirm.plan.argv, ["node", installer, "--dry-run"]);
  assert.deepEqual(m.confirm.runPlan.argv, ["node", installer]);
  assert.match(m.msg, /Hook file: \/tmp\/cc-hooks\.json/);
  assert.match(m.msg, /Command: node .*install\.mjs/);
  assert.equal(calls.length, 0, "the preview only plans; nothing runs before the confirm");
  assert.equal(realCalls().length, 0, "no real action before the confirm");

  m.resolveConfirm(false, cx);
  await drain();
  assert.equal(m.confirm, null, "cancel clears the plan");
  assert.equal(realCalls().length, 0, "cancel runs nothing");

  calls.length = 0;
  m.previewBridge(agent, cx);
  await drain();
  m.resolveConfirm(true, cx);
  await drain();
  assert.deepEqual(realCalls().map((c) => c.args), [[installer]], "only the confirm runs the installer");
  assert.equal(installed, true);
  assert.equal(m.bridgeStatus["command-code"].installed, true);
  assert.equal(m.bridgeLabel(agent), "Remove bridge");
  assert.match(m.msg, /Bridge installer finished/);

  // A failing action is an error and the last status stays what it was.
  const failing = async (command, args, options) => {
    calls.push({ command, args, options });
    if (args.includes("--status")) {
      return { code: 0, stdout: `${JSON.stringify({ app: "command-code", installed: true, file: "/tmp/cc-hooks.json" })}\n`, stderr: "" };
    }
    if (args.includes("--dry-run")) return { code: 0, stdout: "", stderr: "" };
    return { code: 1, stdout: "", stderr: "permission denied\nsecond line" };
  };
  m.bridgeExec = failing;
  m.previewBridge(agent, cx);
  await drain();
  assert.equal(m.confirm.action, "uninstall");
  m.resolveConfirm(true, cx);
  await drain();
  assert.equal(m.msgLevel, "error");
  assert.match(m.msg, /exited with code 1: permission denied/);
  assert.equal(m.bridgeStatus["command-code"].installed, true, "a failure does not flip the status");

  // Unknown status: the button keeps the dry run and there is no real action.
  m.bridgeStatus = {};
  assert.equal(m.bridgeLabel(agent), "Bridge");
  calls.length = 0;
  m.previewBridge(agent, cx);
  await drain();
  assert.equal(m.confirm.runPlan, null);
  assert.equal(m.confirm.action, null);
  m.resolveConfirm(true, cx);
  await drain();
  assert.equal(realCalls().length, 0, "unknown status only runs the dry run");
  assert.equal(m.bridgeStatus["command-code"], undefined);
}
console.log("ok 9: dialog flow needs the confirm and re-reads the status");

// 10. Windows: bridges need sh/ps, so the row offers none and nothing is probed.
{
  const probe = spawnSync(process.execPath, ["--input-type=module", "-e", `
import { HOME } from "./stubs.mjs";
const M = (await import("./main.js")).default;
const spawned = [];
const cx = { spawn: (f) => { spawned.push(f(cx)); }, notify() {} };
const m = new M();
m.init({}, cx);
await Promise.all(spawned.splice(0));
m.render();
console.log(JSON.stringify({
  buttons: m.shown.filter((s) => s.startsWith("button:bridge-")),
  status: Object.keys(m.bridgeStatus).length,
}));
`], {
    cwd: process.cwd(),
    env: { ...process.env, MA_SYS_HOME: "C:\\Users\\x", MA_HOME: fs.mkdtempSync(join(os.tmpdir(), "ma-bridge-win-")) },
    encoding: "utf8",
  });
  assert.equal(probe.status, 0, probe.stderr);
  const out = JSON.parse(probe.stdout.trim());
  assert.deepEqual(out.buttons, [], "no Bridge button on Windows");
  assert.equal(out.status, 0, "no status probe on Windows");
}
console.log("ok 10: Windows hides the bridge button");

fs.rmSync(repo, { recursive: true, force: true });
console.log("bridge-install.test: plans, confirm and refusal OK");
