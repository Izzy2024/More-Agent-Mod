// Bridges: the shared OSC 7501 emitter and the Empryo adapter.
// Runs the real scripts against a temporary HOME; no Herdr, no real hooks.
import fs from "node:fs";
import os from "node:os";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

const HERE = process.env.MA_HOME;
assert.ok(HERE, "MA_HOME is set by scripts/smoke-test.mjs");

function findRepo() {
  const seeds = [process.env.MA_REPO, process.env.INIT_CWD, process.env.PWD, process.cwd()].filter(Boolean);
  for (const seed of seeds) {
    let dir = seed;
    for (;;) {
      if (fs.existsSync(join(dir, "bridges", "lib", "herdr-osc.sh")) && fs.existsSync(join(dir, "bridges", "empryo", "install.mjs"))) return dir;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error("cannot find the checkout; run from the repository root");
}

const REPO = findRepo();
const LIB = join(REPO, "bridges/lib/herdr-osc.sh");
const EMPRYO = join(REPO, "bridges/empryo/install.mjs");
const home = fs.mkdtempSync(join(os.tmpdir(), "ma-bridges-"));
const hooks = join(home, ".empryo", "hooks.json");
fs.mkdirSync(dirname(hooks), { recursive: true });

const env = { ...process.env, HOME: home };
const node = (script, args = []) => spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8" });
const sh = (args) => spawnSync("sh", [LIB, ...args], { env, encoding: "utf8" });
const read = () => fs.readFileSync(hooks, "utf8");

// 1. Existing hooks are kept and ours are added once per event.
fs.writeFileSync(hooks, JSON.stringify({
  hooks: {
    SessionStart: [{ hooks: [{ type: "command", command: "echo other" }] }],
    CustomEvent: [{ hooks: [{ type: "command", command: "echo keep" }] }],
  },
}, null, 2));
let r = node(EMPRYO);
assert.equal(r.status, 0, r.stderr);
let doc = JSON.parse(read());
const commands = (event) => doc.hooks[event].flatMap((rule) => (rule.hooks ?? []).map((h) => h.command));
assert.ok(commands("SessionStart").includes("echo other"), "other hooks kept");
assert.ok(commands("SessionStart").some((c) => c.includes("herdr-osc.sh") && c.includes(" empryo idle")), "SessionStart -> idle");
assert.ok(commands("Stop").some((c) => c.endsWith(" empryo idle")), "Stop -> idle");
assert.ok(commands("UserPromptSubmit").some((c) => c.endsWith(" empryo working")), "prompt -> working");
assert.ok(commands("Notification").some((c) => c.endsWith(" empryo blocked")), "notification -> blocked");
assert.deepEqual(doc.hooks.CustomEvent, [{ hooks: [{ type: "command", command: "echo keep" }] }], "unrelated events kept");

// 2. A second run changes nothing.
const before = read();
r = node(EMPRYO);
assert.equal(r.status, 0, r.stderr);
assert.match(r.stdout, /already match/);
assert.equal(read(), before, "idempotent");

// 3. Uninstall removes only this adapter and leaves other hooks.
r = node(EMPRYO, ["--uninstall"]);
assert.equal(r.status, 0, r.stderr);
doc = JSON.parse(read());
assert.deepEqual(doc.hooks.SessionStart, [{ hooks: [{ type: "command", command: "echo other" }] }], "other hook survives");
assert.ok(!JSON.stringify(doc).includes("herdr-osc.sh"), "no bridge hooks left");
assert.ok(doc.hooks.CustomEvent, "unrelated events survive uninstall");

// 4. Invalid JSON is reported and left untouched.
fs.writeFileSync(hooks, "{oops");
r = node(EMPRYO);
assert.notEqual(r.status, 0, "invalid JSON fails");
assert.equal(read(), "{oops", "file untouched");

// 5. The emitter: valid call with no TTY prints {} and exits 0; bad app/state does nothing.
for (const args of [["empryo", "idle"], ["cursor", "working"], ["command-code", "blocked"], ["bad app", "idle"], ["empryo", "busy"]]) {
  r = sh(args);
  assert.equal(r.status, 0, `exit 0 for ${args.join(" ")}`);
  assert.equal(r.stdout.trim(), "{}", `neutral payload for ${args.join(" ")}`);
  assert.equal(r.stderr, "", `no noise for ${args.join(" ")}`);
}

console.log("bridges.test: emitter + empryo adapter OK (merge, idempotent, uninstall, invalid JSON)");
