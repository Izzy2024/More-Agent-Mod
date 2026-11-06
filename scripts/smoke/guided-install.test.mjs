// lane-guided: the tools an install needs, the "Needs Node.js" hint, and the
// watcher that adds the agent once its command exists. A fake timer queue makes
// every 5 s tick manual; `run` is the stub, so no installer ever starts.
import fs from "node:fs";
import assert from "node:assert";
import { HOME, ran, setShared, shared } from "./stubs.mjs";

const M = (await import("./main.js")).default;
const CATALOG = (await import("./catalog.js")).default;
const { copyFor } = await import("./copy.js");
const { requiredTools, missingTools, TOOL_HELP } = await import("./install-assist.js");

fs.mkdirSync(HOME, { recursive: true });
const P = HOME + "/programs.json";
const OWN = "more-agents.keys";

// One queue for the whole view: `after` never fires by itself and a tick is
// taken out of the queue by hand, exactly like an async host timer would.
function makeTimer() {
  const queue = [];
  return {
    queue,
    after(ms, fn) { queue.push({ ms, fn }); },
    ticks() { return queue.filter((t) => t.ms === 5000).length; },
    tick() {
      const i = queue.findIndex((t) => t.ms === 5000);
      assert.ok(i >= 0, "an install tick is scheduled");
      const [{ fn }] = queue.splice(i, 1);
      return fn();
    },
  };
}

async function boot({ programs, onPath = "omp", known = "claude", timer = makeTimer(), mod = M } = {}) {
  process.env.MA_ONPATH = onPath;
  process.env.MA_KNOWN_AGENTS = known;
  ran.length = 0;
  setShared(OWN, {});
  fs.rmSync(P, { force: true });
  fs.rmSync(P + ".more-agents.bak", { force: true });
  fs.writeFileSync(P, JSON.stringify({ programs: programs ?? {} }, null, 2));
  const spawned = [];
  const cx = {
    spawn: (f) => { spawned.push(f(cx)); },
    notify() {},
    focus_handle: () => ({ focused: false, focus() { this.focused = true; } }),
    timer,
  };
  const m = new mod();
  m.init({}, cx);
  await Promise.all(spawned.splice(0));
  return { m, cx, timer, drain: () => Promise.all(spawned.splice(0)) };
}

const read = () => JSON.parse(fs.readFileSync(P, "utf8"));

// 1. The tools each catalog install command needs, from the first word of every
//    ` && ` part. `python -m pip` is Python; a trailing `<x>-install` adds nothing.
{
  const shipped = Object.fromEntries(CATALOG.filter((a) => a.install).map((a) => [a.id, requiredTools(a.install)]));
  assert.deepEqual(shipped, {
    omp: ["curl"],
    "command-code": ["npm"],
    "dsh-tui": ["npm"],
    kilo: ["npm"],
    "qwen-code": ["npm"],
    goose: ["curl"],
    aider: ["python"],
    cline: ["npm"],
    droid: ["curl"],
    auggie: ["npm"],
    junie: ["curl"],
    "mistral-vibe": ["curl"],
    "continue-cli": ["npm"],
    codebuff: ["npm"],
    forge: ["curl"],
    "kiro-cli": ["curl"],
    nanocoder: ["npm"],
    pi: ["curl"],
  }, "every shipped install string");

  assert.deepEqual(requiredTools("python -m pip install aider-install && aider-install"), ["python"]);
  assert.deepEqual(requiredTools("pip install aider-chat"), ["pip"]);
  assert.deepEqual(requiredTools("npm i -g x && npm i -g y"), ["npm"], "unique, in order");
  assert.deepEqual(requiredTools("curl -fsSL https://example.com/x.sh | sh"), ["curl"]);
  assert.deepEqual(requiredTools("aider-install"), []);
  assert.deepEqual(requiredTools(null), []);
}
console.log("ok 1: requiredTools");

// 2. Only a `false` answer is missing; `undefined` is unknown, never an alarm.
//    A missing `python` with `python3` present keeps the hint specific.
{
  assert.deepEqual(missingTools("npm i -g x", { npm: false }), [{ tool: "npm", python3Only: false }]);
  assert.deepEqual(missingTools("npm i -g x", {}), [], "unknown is not missing");
  assert.deepEqual(missingTools("npm i -g x", { npm: true }), []);
  assert.deepEqual(missingTools("python -m pip install x", { python: false, python3: true }),
    [{ tool: "python", python3Only: true }]);
  assert.deepEqual(missingTools("python -m pip install x", { python: false }),
    [{ tool: "python", python3Only: false }]);
  assert.deepEqual(missingTools("brew install goose", { brew: false, npm: false }).map((m) => m.tool), ["brew"]);
  assert.deepEqual(missingTools("pip install x", { pip: false, python: false }).map((m) => m.tool), ["pip"]);
  assert.deepEqual(missingTools("curl -fsSL https://x.sh | sh", { curl: false }).map((m) => m.tool), ["curl"]);
  assert.equal(TOOL_HELP.npm.url, "https://nodejs.org");
  assert.equal(TOOL_HELP.python.url, "https://www.python.org/downloads/");
  assert.equal(TOOL_HELP.brew.url, "https://brew.sh");
  assert.equal(TOOL_HELP.uv.url, "https://docs.astral.sh/uv/");
  assert.equal(TOOL_HELP.curl.url, null, "curl ships with the system");
}
console.log("ok 2: missingTools");

// 3. Missing Node: no Install button, a "Needs Node.js" one, a plain-words
//    warning with the page, and nothing runs.
{
  const { m, cx } = await boot({ programs: {}, onPath: "omp" });
  m.onPath.npm = false;
  const a = m.agentOf("command-code");
  m.render();
  assert.ok(m.shown.includes("button:needs-command-code"), "the needs button replaces Install");
  assert.ok(!m.shown.includes("button:install-command-code"), "no Install button");
  assert.equal(copyFor("en").needsTool(copyFor("en").toolLabel("node")), "Needs Node.js");

  assert.equal(m.previewInstall(a, cx), true, "even a direct preview only explains");
  assert.equal(m.confirm, null);
  assert.equal(m.msgLevel, "warning");
  assert.match(m.msg, /^To install Command Code you first need Node\.js\./);
  assert.match(m.msg, /https:\/\/nodejs\.org/, "where to get it");
  assert.match(m.msg, /come back and press Re-check\.$/);
  assert.equal(ran.length, 0, "nothing runs");
}
console.log("ok 3: missing Node is explained, not installed");

// 4. python3 only: the hint names both commands.
{
  const { m, cx } = await boot({ programs: {}, onPath: "omp" });
  m.onPath.python = false;
  m.onPath.python3 = true;
  const a = m.agentOf("aider");
  m.render();
  assert.ok(m.shown.includes("button:needs-aider"));
  assert.ok(!m.shown.includes("button:install-aider"));
  m.explainMissing(a, missingTools(a.install, m.onPath), cx);
  assert.equal(m.msgLevel, "warning");
  assert.match(m.msg, /`python`/);
  assert.match(m.msg, /only has `python3`/);
  assert.match(m.msg, /https:\/\/www\.python\.org\/downloads\//);
  assert.equal(ran.length, 0);
}
console.log("ok 4: python3-only hint");

// 5. Confirm "Install and add": one tab.new, still no programs.json entry.
{
  const { m, cx, timer, drain } = await boot({ programs: {}, onPath: "omp" });
  m.onPath.npm = true; // Node is ready: the Install button, not the hint
  const a = m.agentOf("command-code");
  m.render();
  assert.ok(m.shown.includes("button:install-command-code"));

  assert.equal(m.previewInstall(a, cx), true);
  assert.equal(m.confirm?.kind, "install");
  assert.equal(m.msg, `Install Command Code and add it to your + menu when it finishes? This runs in a new tab: ${a.install}`);
  assert.equal(copyFor("es").installAdd, "Instalar y añadir");
  await drain();
  assert.equal(ran.length, 0, "nothing before the confirm");

  m.resolveConfirm(true, cx);
  await drain();
  assert.equal(ran.length, 1);
  assert.equal(ran[0].name, "tab.new");
  assert.equal(read().programs["command-code"], undefined, "no entry yet");
  assert.equal(m.watch.id, "command-code");
  assert.equal(m.watch.bin, "command-code");
  assert.ok(m.watch.deadline > Date.now(), "three minutes from now");
  assert.equal(m.msg, "Waiting for Command Code to finish installing...");
  assert.equal(m.msgLevel, "info");
  assert.equal(timer.ticks(), 1, "one tick scheduled");
}
console.log("ok 5: confirm opens one tab and starts the wait");

// 6. A tick before the command exists keeps waiting; busy ticks are skipped.
{
  const { m, cx, timer, drain } = await boot({ programs: {}, onPath: "omp" });
  m.onPath.npm = true;
  const a = m.agentOf("command-code");
  m.previewInstall(a, cx);
  m.resolveConfirm(true, cx);
  await drain();
  const watch = m.watch;

  m.busy = true;
  await timer.tick();
  assert.equal(m.watch, watch, "a busy dialog is not probed");
  assert.equal(read().programs["command-code"], undefined);
  m.busy = false;

  await timer.tick();
  assert.equal(m.watch, watch, "still the same wait");
  assert.equal(read().programs["command-code"], undefined, "nothing written");
  assert.equal(m.msg, "Waiting for Command Code to finish installing...");
  assert.equal(timer.ticks(), 1, "the next tick was re-scheduled");
}
console.log("ok 6: ticks before the install only wait");

// 7. Once the command exists the entry is added through addEntries(): ownership,
//    the success message, and no more ticks.
{
  const { m, cx, timer, drain } = await boot({ programs: {}, onPath: "omp" });
  m.onPath.npm = true;
  const a = m.agentOf("command-code");
  m.previewInstall(a, cx);
  m.resolveConfirm(true, cx);
  await drain();

  process.env.MA_ONPATH = "omp command-code";
  await timer.tick();
  await drain();
  const table = read();
  assert.deepEqual(table.programs["command-code"].run, a.run);
  assert.equal(table.programs["command-code"].name, a.name);
  assert.ok(shared(OWN)["command-code"], "ownership recorded");
  assert.equal(m.msg, "Command Code is installed and now shows in your + menu.");
  assert.equal(m.msgLevel, "success");
  assert.equal(m.watch, null, "the wait ended");
  assert.equal(timer.ticks(), 0, "no tick left");
  assert.equal(ran.length, 1, "only the tab.new from the confirm");
}
console.log("ok 7: the entry is added when the install finishes");

// 8. At the deadline: one info line, no write, no tick.
{
  const { m, cx, timer, drain } = await boot({ programs: {}, onPath: "omp" });
  const a = m.agentOf("aider");
  m.previewInstall(a, cx);
  m.resolveConfirm(true, cx);
  await drain();
  m.watch.deadline = Date.now() - 1;
  await timer.tick();
  await drain();
  assert.equal(m.msg, "Aider is still not installed. When the install tab finishes, press Re-check.");
  assert.equal(m.msgLevel, "info");
  assert.equal(m.watch, null);
  assert.equal(read().programs.aider, undefined);
  assert.equal(timer.ticks(), 0);
}
console.log("ok 8: the deadline gives up without writing");

// 9. Closing the dialog stops the wait, even if a tick is already queued.
{
  const { m, cx, timer, drain } = await boot({ programs: {}, onPath: "omp" });
  const a = m.agentOf("aider");
  m.previewInstall(a, cx);
  m.resolveConfirm(true, cx);
  await drain();
  await m.close(cx);
  assert.equal(m.alive, false);
  assert.equal(m.watch, null);
  await timer.tick(); // the stale handler
  await drain();
  assert.equal(read().programs.aider, undefined, "a closed dialog writes nothing");
}
console.log("ok 9: close stops the watcher");

// 10. A second watch replaces the first: the old tick does nothing.
{
  const { m, cx, timer, drain } = await boot({ programs: {}, onPath: "omp" });
  m.onPath.npm = true;
  const first = m.agentOf("command-code");
  m.previewInstall(first, cx);
  m.resolveConfirm(true, cx);
  await drain();
  const oldWatch = m.watch;

  const second = m.agentOf("kilo");
  m.previewInstall(second, cx);
  m.resolveConfirm(true, cx);
  await drain();
  assert.notEqual(m.watch, oldWatch);
  assert.equal(m.watch.id, "kilo");
  assert.equal(timer.ticks(), 2, "both waits had a tick queued");

  await timer.tick(); // the oldest one, from command-code
  await drain();
  assert.equal(m.watch.id, "kilo", "the replaced watch cannot stop the new one");
  assert.equal(read().programs["command-code"], undefined);

  process.env.MA_ONPATH = "omp kilo";
  await timer.tick();
  await drain();
  assert.deepEqual(read().programs.kilo.run, second.run);
  assert.equal(read().programs["command-code"], undefined);
  assert.equal(m.watch, null);
}
console.log("ok 10: one watch at a time");

// 11. An entry added by hand mid-watch ends the wait without writing.
{
  const { m, cx, timer, drain } = await boot({ programs: {}, onPath: "omp" });
  m.onPath.npm = true;
  const a = m.agentOf("command-code");
  m.previewInstall(a, cx);
  m.resolveConfirm(true, cx);
  await drain();
  m.table.programs["command-code"] = { name: a.name, run: a.run };
  await timer.tick();
  assert.equal(m.watch, null);
  assert.equal(read().programs["command-code"], undefined, "nothing was written by the watcher");
  assert.equal(timer.ticks(), 0);
}
console.log("ok 11: an entry added by hand stops the wait");

// 12. Re-check ends the wait and keeps working as before.
{
  const { m, cx, timer, drain } = await boot({ programs: {}, onPath: "omp" });
  const a = m.agentOf("aider");
  m.previewInstall(a, cx);
  m.resolveConfirm(true, cx);
  await drain();
  assert.ok(m.watch);
  m.reload(cx);
  assert.equal(m.watch, null, "Re-check stops the guide");
  await drain();
  assert.equal(timer.ticks(), 1, "the queued tick is still there but inert");
  await timer.tick();
  await drain();
  assert.equal(read().programs.aider, undefined);
}
console.log("ok 12: Re-check stops the watcher");

// 13. Windows: no Install button, no needs button, no tab, no watch.
{
  const prev = process.env.MA_SYS_HOME;
  process.env.MA_SYS_HOME = "C:\\Users\\test";
  const WinM = (await import("./main.js?windows")).default;
  if (prev === undefined) delete process.env.MA_SYS_HOME;
  else process.env.MA_SYS_HOME = prev;
  const { m, cx, timer } = await boot({ programs: {}, onPath: "omp", mod: WinM });
  m.onPath.npm = false;
  m.render();
  assert.ok(!m.shown.some((s) => String(s).startsWith("button:install-")), "no Install button");
  assert.ok(!m.shown.some((s) => String(s).startsWith("button:needs-")), "no needs button");
  assert.equal(m.previewInstall(m.agentOf("command-code"), cx), false);
  m.confirm = { kind: "install", agentId: "command-code" };
  m.resolveConfirm(true, cx);
  assert.equal(ran.length, 0, "no tab.new on Windows");
  assert.equal(m.watch, null);
  assert.equal(timer.ticks(), 0);
}
console.log("ok 13: no guided install on Windows");

console.log("guided-install.test: LANE-GUIDED OK");
