// Lane install: detected agents, the one install-command rule, the Install/Add
// all buttons and the confirm-before-run path. No installer is started: `run`
// is the stub and records the Herdr command instead.
import fs from "node:fs";
import assert from "node:assert";
import { HOME, ran, setShared, shared } from "./stubs.mjs";

const M = (await import("./main.js")).default;
const CATALOG = (await import("./catalog.js")).default;
const { detectedAgents, formatDetected, isRunnableInstall, planInstall } = await import("./install-assist.js");

fs.mkdirSync(HOME, { recursive: true });
const P = HOME + "/programs.json";
const OWN = "more-agents.keys";

async function boot({ programs, own, onPath = "omp aider", known = "claude" } = {}) {
  delete process.env.MA_FAIL_WRITE;
  delete process.env.MA_EXEC_FAIL;
  process.env.MA_ONPATH = onPath;
  process.env.MA_KNOWN_AGENTS = known;
  ran.length = 0;
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

// 1. detectedAgents: installed, not installed, already in programs, unknown PATH.
{
  const catalog = [
    { id: "a", status: "verified", run: ["a"] },
    { id: "b", status: "verified", run: ["b"] },
    { id: "c", status: "verified", run: ["c"] },
    { id: "d", status: "unverified", run: ["d"] },
  ];
  const programs = { b: { run: ["b"] }, e: { run: [] } };
  const onPath = { a: true, b: true, d: true };
  assert.deepEqual(detectedAgents(catalog, programs, onPath).map((x) => x.id), ["a"]);
  assert.deepEqual(detectedAgents(catalog, {}, {}), [], "an unknown PATH detects nothing");
  assert.deepEqual(detectedAgents(catalog, {}, { c: false }).map((x) => x.id), [], "false is not installed");
  // An entry with no run is not "already in the + menu".
  assert.deepEqual(detectedAgents([catalog[0]], { a: { name: "A", run: [] } }, { a: true }).map((x) => x.id), ["a"]);
}
console.log("ok 1: detectedAgents");

// 2. The banner list is truncated, not wrapped.
{
  const agents = ["aider", "goose", "kilo", "cline", "junie"].map((id) => ({ id }));
  assert.equal(formatDetected(agents.slice(0, 2)), "aider, goose");
  assert.equal(formatDetected(agents), "aider, goose, +3");
  assert.equal(formatDetected([]), "");
}
console.log("ok 2: formatDetected truncates");

// 3. The one rule: every shipped install string passes; shell tricks do not.
{
  const shipped = CATALOG.filter((a) => a.install !== undefined).map((a) => a.install);
  assert.equal(shipped.length, 13, "the verified catalog entries with an install");
  for (const command of shipped) assert.ok(isRunnableInstall(command), `shipped: ${command}`);

  for (const command of [
    "npm i -g x",
    "npm install -g @scope/x@latest",
    "npm install -g @deepseek-ai/dsh @deepseek-harness-tui/dsh-tui",
    "pip install aider-chat",
    "python -m pip install aider-install && aider-install",
    "brew install goose",
    "curl -fsSL https://example.com/install.sh | sh",
    "curl -LsSf https://example.com/x.sh | bash",
  ]) assert.ok(isRunnableInstall(command), `accepts ${command}`);

  for (const command of [
    "",
    "   ",
    "npm i -g x ",
    "sudo npm i -g x",
    "npm i -g x; rm -rf /",
    "npm i -g x && sudo rm -rf /",
    "curl http://example.com/x.sh | sh",
    "curl -fsSL https://example.com/x.sh | sh > /dev/null",
    "curl -fsSL https://example.com/x.sh | sh && rm -rf /",
    "npm i -g $(whoami)",
    "npm i -g `id`",
    "brew install x | sh",
    "npm i -g x && rm -rf /",
    "python -m pip install x && aider-install && rm",
    "pip install x && rm",
    "pip install x && sh",
    "npm i -g x\ntouch pwned",
    null,
  ]) assert.equal(isRunnableInstall(command), false, `rejects ${JSON.stringify(command)}`);
}
console.log("ok 3: install-command rule");

// 4. planInstall: the exact command, sh -c, and the tab stays readable.
{
  const aider = CATALOG.find((a) => a.id === "aider");
  const plan = planInstall(aider);
  assert.equal(plan.ok, true);
  assert.equal(plan.command, aider.install);
  assert.equal(plan.name, "Install Aider");
  assert.deepEqual(plan.argv.slice(0, 2), ["sh", "-c"]);
  assert.ok(plan.argv[2].startsWith(`${aider.install}; printf '`), "runs the exact command");
  assert.match(plan.argv[2], /\[finished - press Enter to close\]/);
  assert.match(plan.argv[2], /; read _$/);

  for (const agent of [
    {},
    { id: "x" },
    { id: "x", name: "X", install: "sudo npm i -g x" },
    { id: "x", name: "X", install: "npm i -g x; rm -rf /" },
    CATALOG.find((a) => a.id === "trae-agent"),
  ]) {
    const refused = planInstall(agent);
    assert.equal(refused.ok, false, `refuses ${JSON.stringify(agent?.install)}`);
    assert.ok(refused.error);
  }
}
console.log("ok 4: planInstall");

// 5. The banner: only detected agents, hidden while busy or broken.
{
  const { m } = await boot({ programs: {} });
  m.render();
  assert.ok(m.shown.includes("button:add-detected"), "Add all is painted");
  assert.ok(m.shown.includes("button:recheck"), "Re-check is painted");
  assert.ok(m.shown.includes("2 installed agents are not in your + menu: omp, aider"), "one compact line");
  assert.ok(!m.tabOrder().includes("add-detected"), "pointer-only, not a Tab stop");
  assert.ok(!m.tabOrder().includes("recheck"), "pointer-only, not a Tab stop");

  const partial = await boot({ programs: { aider: { name: "Aider", run: ["aider"] } } });
  partial.m.render();
  assert.ok(partial.m.shown.includes("1 installed agent is not in your + menu: omp"), "singular");
  assert.ok(partial.m.shown.includes("button:add-detected"));

  const none = await boot({ programs: { omp: { run: ["omp"] }, aider: { run: ["aider"] } } });
  none.m.render();
  assert.ok(!none.m.shown.includes("button:add-detected"), "no detected agent, no Add all");
  assert.ok(!none.m.shown.some((s) => /not in your \+ menu/.test(s)), "and no banner line");
  assert.ok(none.m.shown.includes("button:recheck"), "Re-check stays beside the search box");

  none.m.busy = true;
  none.m.render();
  assert.ok(!none.m.shown.includes("button:recheck"), "hidden while busy");
  none.m.busy = false;

  const broken = await boot({ programs: {} });
  broken.m.error = "programs.json is not valid JSON: x. Nothing was written.";
  broken.m.render();
  assert.ok(!broken.m.shown.includes("button:recheck"), "hidden when the file is broken");
}
console.log("ok 5: detected banner and Re-check");

// 6. Add all goes through edit(): entries, ownership, no bypass.
{
  const { m, cx, drain } = await boot({ programs: {} });
  m.render();
  m.addDetected(cx);
  assert.equal(m.busy, true, "the save is in flight");
  await drain();
  const table = read();
  const omp = CATALOG.find((a) => a.id === "omp");
  const aider = CATALOG.find((a) => a.id === "aider");
  assert.deepEqual(table.programs.omp.run, omp.run);
  assert.deepEqual(table.programs.aider.run, aider.run);
  assert.equal(table.programs.omp.name, omp.name);
  assert.ok(shared(OWN).omp && shared(OWN).aider, "ownership recorded");
  assert.equal(m.busy, false);
  assert.equal(ran.length, 0, "adding entries never runs an install");
  m.render();
  assert.ok(!m.shown.includes("button:add-detected"), "nothing left to add");
}
console.log("ok 6: Add all writes through edit()");

// 7. Install: confirm first, one tab.new after; never for a docs-only row.
{
  const { m, cx, drain } = await boot({ programs: {}, onPath: "omp" });
  m.render();
  assert.ok(m.shown.includes("button:install-aider"), "a runnable install has a button");
  assert.ok(!m.shown.includes("button:install-trea-agent"), "a docs-only entry has none");
  assert.ok(!m.shown.includes("button:install-omp"), "an installed agent has none");
  assert.ok(!m.actionIds().includes("install-aider"), "not a row action");
  assert.ok(!m.tabOrder().includes("install-aider"), "not a Tab stop");

  const aider = m.agentOf("aider");
  assert.equal(m.previewInstall(aider, cx), true);
  assert.equal(m.confirm?.kind, "install");
  assert.match(m.msg, /python -m pip install aider-install && aider-install/, "the exact command is shown");
  await drain();
  assert.equal(ran.length, 0, "nothing runs before the confirm");

  m.resolveConfirm(false, cx);
  await drain();
  assert.equal(ran.length, 0, "cancel runs nothing");
  assert.match(m.msg, /Cancelled/);

  m.previewInstall(aider, cx);
  m.resolveConfirm(true, cx);
  await drain();
  assert.equal(ran.length, 1, "exactly one call after the confirm");
  assert.equal(ran[0].name, "tab.new");
  assert.equal(ran[0].args.name, "Install Aider");
  assert.deepEqual(ran[0].args.argv.slice(0, 2), ["sh", "-c"]);
  assert.ok(ran[0].args.argv[2].startsWith("python -m pip install aider-install && aider-install;"));
  assert.match(m.msg, /new tab/);
  assert.match(m.msg, /Re-check/);
}
console.log("ok 7: confirm before run");

// 8. The command is validated again right before running.
{
  const { m, cx } = await boot({ programs: {}, onPath: "omp" });
  m.confirm = { kind: "install", agentId: "trae-agent" };
  m.resolveConfirm(true, cx);
  assert.equal(ran.length, 0, "a row without a runnable install cannot run");
  assert.equal(m.msgLevel, "error");
  assert.match(m.msg, /No install command/);
}
console.log("ok 8: revalidated before running");

// 9. Windows never offers Install (no `sh`).
{
  const prev = process.env.MA_SYS_HOME;
  process.env.MA_SYS_HOME = "C:\\Users\\test";
  const WinM = (await import("./main.js?windows")).default;
  process.env.MA_SYS_HOME = prev;
  process.env.MA_ONPATH = "omp";
  process.env.MA_KNOWN_AGENTS = "claude";
  ran.length = 0;
  setShared(OWN, {});
  fs.writeFileSync(P, JSON.stringify({ programs: {} }, null, 2));
  const spawned = [];
  const cx = { spawn: (f) => { spawned.push(f(cx)); }, notify() {} };
  const m = new WinM();
  m.init({}, cx);
  await Promise.all(spawned.splice(0));
  m.render();
  assert.ok(!m.shown.some((s) => String(s).startsWith("button:install-")), "no Install button on Windows");
  assert.equal(m.previewInstall(m.agentOf("aider"), cx), false);
}
console.log("ok 9: no Install on Windows");

console.log("install-assist.test: LANE-INSTALL OK");
