// Bridges: the shared OSC 7501 emitter and the opt-in adapters.
// Runs the real scripts against a temporary HOME; no Herdr, no real hooks.
import fs from "node:fs";
import os from "node:os";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

const HERE = process.env.MA_HOME;
assert.ok(HERE, "MA_HOME is set by scripts/smoke-test.mjs");

function findRepo() {
  const seeds = [process.env.MA_REPO, process.env.INIT_CWD, process.env.PWD, process.cwd()].filter(Boolean);
  for (const seed of seeds) {
    let dir = seed;
    for (;;) {
      if (
        fs.existsSync(join(dir, "bridges", "lib", "herdr-osc.sh")) &&
        fs.existsSync(join(dir, "bridges", "empryo", "install.mjs")) &&
        fs.existsSync(join(dir, "bridges", "cursor", "install.mjs")) &&
        fs.existsSync(join(dir, "bridges", "command-code", "install.mjs"))
      ) return dir;
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
const CURSOR = join(REPO, "bridges/cursor/install.mjs");
const COMMAND_CODE = join(REPO, "bridges/command-code/install.mjs");
const home = fs.mkdtempSync(join(os.tmpdir(), "ma-bridges-"));
const hooks = join(home, ".empryo", "hooks.json");
fs.mkdirSync(dirname(hooks), { recursive: true });

const env = { ...process.env, HOME: home };
const node = (script, args = []) => spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8" });
const sh = (args) => spawnSync("sh", [LIB, ...args], { env, encoding: "utf8" });
const read = () => fs.readFileSync(hooks, "utf8");
const sha16 = (value) => createHash("sha256").update(value).digest("hex").slice(0, 16);

function runIn(homeDir, script, args = []) {
  return spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, HOME: homeDir },
    encoding: "utf8",
  });
}

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

// 6. Cursor: Orca and other apps stay, the legacy emitter is replaced, a second
//    run does not write, uninstall removes only this adapter.
{
  const cursorHome = fs.mkdtempSync(join(os.tmpdir(), "ma-bridges-cursor-"));
  const cursorHooks = join(cursorHome, ".cursor", "hooks.json");
  const cursorBackup = `${cursorHooks}.bak-herdr-cursor-osc`;
  fs.mkdirSync(dirname(cursorHooks), { recursive: true });
  const original = {
    version: 1,
    hooks: {
      sessionStart: [
        { command: "orca-session", timeout: 30 },
        { command: "sh /Users/admin/.local/share/herdr-cursor-osc/herdr-osc.sh idle", timeout: 10 },
      ],
      stop: [
        { command: "sh /Users/admin/.local/share/herdr-cursor-osc/herdr-osc.sh working", timeout: 10 },
      ],
      afterAgentResponse: [
        { command: "orca-after" },
        { command: "sh '/somewhere/bridges/lib/herdr-osc.sh' command-code idle", timeout: 10 },
      ],
    },
    keep: true,
  };
  fs.writeFileSync(cursorHooks, `${JSON.stringify(original, null, 2)}\n`);
  let result = runIn(cursorHome, CURSOR);
  assert.equal(result.status, 0, result.stderr);
  let cursor = JSON.parse(fs.readFileSync(cursorHooks, "utf8"));
  assert.equal(cursor.keep, true, "cursor settings kept");
  assert.equal(cursor.version, 1);
  assert.deepEqual(Object.keys(cursor.hooks), [
    "sessionStart",
    "stop",
    "afterAgentResponse",
    "beforeSubmitPrompt",
    "preToolUse",
    "postToolUse",
  ]);
  const flat = (event) => cursor.hooks[event].map((hook) => hook.command);
  assert.deepEqual(flat("sessionStart").filter((command) => command === "orca-session"), ["orca-session"]);
  assert.equal(flat("sessionStart").some((command) => command.includes("herdr-cursor-osc")), false, "legacy cursor command replaced");
  assert.equal(flat("sessionStart").filter((command) => command.endsWith(" cursor idle")).length, 1);
  assert.equal(flat("stop").filter((command) => command.endsWith(" cursor idle")).length, 1);
  assert.ok(flat("beforeSubmitPrompt").some((command) => command.endsWith(" cursor working")));
  assert.ok(flat("preToolUse").some((command) => command.endsWith(" cursor working")));
  assert.ok(flat("postToolUse").some((command) => command.endsWith(" cursor working")));
  assert.ok(flat("afterAgentResponse").includes("orca-after"), "Orca stays");
  assert.ok(flat("afterAgentResponse").some((command) => command.includes(" command-code ")), "other app stays");
  assert.deepEqual(JSON.parse(fs.readFileSync(cursorBackup, "utf8")), original, "backup is the pre-bridge file");
  const cursorBytes = fs.readFileSync(cursorHooks);
  const cursorMtime = fs.statSync(cursorHooks).mtimeMs;
  const backupMtime = fs.statSync(cursorBackup).mtimeMs;
  result = runIn(cursorHome, CURSOR);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already match/);
  assert.ok(cursorBytes.equals(fs.readFileSync(cursorHooks)), "second cursor install does not write");
  assert.equal(fs.statSync(cursorHooks).mtimeMs, cursorMtime);
  assert.equal(fs.statSync(cursorBackup).mtimeMs, backupMtime);
  result = runIn(cursorHome, CURSOR, ["--uninstall"]);
  assert.equal(result.status, 0, result.stderr);
  cursor = JSON.parse(fs.readFileSync(cursorHooks, "utf8"));
  assert.equal(cursor.keep, true);
  assert.deepEqual(cursor.hooks.sessionStart, [{ command: "orca-session", timeout: 30 }]);
  assert.deepEqual(cursor.hooks.afterAgentResponse, [
    { command: "orca-after" },
    { command: "sh '/somewhere/bridges/lib/herdr-osc.sh' command-code idle", timeout: 10 },
  ]);
  assert.equal(cursor.hooks.stop, undefined);
  assert.equal(JSON.stringify(cursor).includes(" cursor "), false);
  assert.equal(JSON.stringify(cursor).includes("herdr-cursor-osc"), false);
  const afterUninstall = fs.readFileSync(cursorHooks);
  result = runIn(cursorHome, CURSOR, ["--uninstall"]);
  assert.match(result.stdout, /No Cursor/);
  assert.ok(afterUninstall.equals(fs.readFileSync(cursorHooks)), "second cursor uninstall does not write");
  fs.writeFileSync(cursorHooks, "{oops");
  result = runIn(cursorHome, CURSOR);
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(cursorHooks, "utf8"), "{oops");
}

// 7. Command Code: foreign hooks stay, legacy command and fingerprint are
//    replaced, trust is recorded on "" and existing roots, a second run does
//    not write, uninstall removes only our hooks and fingerprints.
{
  const cmdHome = fs.mkdtempSync(join(os.tmpdir(), "ma-bridges-cmd-"));
  const settingsPath = join(cmdHome, ".commandcode", "settings.json");
  const trustPath = join(cmdHome, ".commandcode", "trusted-hooks.json");
  fs.mkdirSync(dirname(settingsPath), { recursive: true });
  const legacy = "sh /Users/admin/.local/share/herdr-cmd-osc/herdr-osc.sh";
  const legacyFp = sha16(legacy);
  const foreignFp = "deadbeefdeadbeef";
  const projectFp = "cafebabecafebabe";
  fs.writeFileSync(settingsPath, `${JSON.stringify({
    theme: "dark",
    hooks: {
      SessionStart: [{ hooks: [{ type: "command", command: "echo other" }] }],
      PreToolUse: [{
        matcher: "Bash",
        hooks: [
          { type: "command", command: "echo bash" },
          { type: "command", command: legacy, timeout: 10 },
        ],
      }],
      Custom: [{ hooks: [{ type: "command", command: "echo keep" }] }],
      Stop: [{ hooks: [{ type: "command", command: "sh '/somewhere/herdr-osc.sh' empryo idle", timeout: 5 }] }],
    },
  }, null, 2)}\n`);
  fs.writeFileSync(trustPath, `${JSON.stringify({
    "": [
      { fingerprint: foreignFp, trustedAt: "2020-01-01T00:00:00.000Z" },
      { fingerprint: legacyFp, trustedAt: "2020-01-01T00:00:00.000Z" },
    ],
    "/proj": [{ fingerprint: projectFp, trustedAt: "2020-01-01T00:00:00.000Z" }],
    "/old": [{ fingerprint: legacyFp, trustedAt: "2020-01-01T00:00:00.000Z" }],
  }, null, 2)}\n`);
  let result = runIn(cmdHome, COMMAND_CODE);
  assert.equal(result.status, 0, result.stderr);
  let settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(settings.theme, "dark");
  const commands = (event) => settings.hooks[event].flatMap((rule) => (rule.hooks ?? [rule]).map((hook) => hook.command));
  assert.ok(commands("SessionStart").includes("echo other"));
  assert.ok(commands("SessionStart").some((command) => command.endsWith(" command-code idle")));
  assert.ok(commands("PreToolUse").includes("echo bash"));
  assert.equal(commands("PreToolUse").some((command) => command.includes("herdr-cmd-osc")), false, "legacy command code hook replaced");
  const pre = commands("PreToolUse").find((command) => command.includes("AskUserQuestion"));
  assert.ok(pre, "PreToolUse dispatcher installed");
  assert.ok(pre.includes(" command-code ") || pre.includes("command-code"));
  assert.ok(commands("PostToolUse").some((command) => command.endsWith(" command-code working")));
  assert.ok(commands("Stop").some((command) => command.endsWith(" command-code idle")));
  assert.ok(commands("Stop").some((command) => command.includes(" empryo idle")), "other app stays");
  assert.deepEqual(settings.hooks.Custom, [{ hooks: [{ type: "command", command: "echo keep" }] }]);
  const bashRule = settings.hooks.PreToolUse.find((rule) => rule.matcher === "Bash");
  assert.deepEqual(bashRule.hooks, [{ type: "command", command: "echo bash" }]);
  const ours = [...new Set(commands("SessionStart").concat(commands("PreToolUse"), commands("PostToolUse"), commands("Stop")))]
    .filter((command) => command.includes("herdr-osc.sh") && command.includes("command-code"));
  const ourFps = ours.map(sha16);
  assert.equal(new Set(ourFps).size, 3, "idle, working, and PreToolUse are three commands");
  let trust = JSON.parse(fs.readFileSync(trustPath, "utf8"));
  for (const root of ["", "/proj", "/old"]) {
    const fps = trust[root].map((entry) => entry.fingerprint);
    for (const fp of ourFps) assert.ok(fps.includes(fp), `${root} trusts ${fp}`);
    assert.equal(fps.includes(legacyFp), false, `${root} drops the legacy fingerprint`);
  }
  assert.equal(trust[""].find((entry) => entry.fingerprint === foreignFp).trustedAt, "2020-01-01T00:00:00.000Z");
  assert.equal(trust["/proj"].find((entry) => entry.fingerprint === projectFp).trustedAt, "2020-01-01T00:00:00.000Z");
  assert.deepEqual(Object.keys(trust).sort(), ["", "/old", "/proj"].sort());
  const trustedAt = trust[""].find((entry) => entry.fingerprint === ourFps[0]).trustedAt;
  const settingsBytes = fs.readFileSync(settingsPath);
  const trustBytes = fs.readFileSync(trustPath);
  const settingsMtime = fs.statSync(settingsPath).mtimeMs;
  const trustMtime = fs.statSync(trustPath).mtimeMs;
  result = runIn(cmdHome, COMMAND_CODE);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already match/);
  assert.ok(settingsBytes.equals(fs.readFileSync(settingsPath)), "second command-code install does not write settings");
  assert.ok(trustBytes.equals(fs.readFileSync(trustPath)), "second command-code install does not write trust");
  assert.equal(fs.statSync(settingsPath).mtimeMs, settingsMtime);
  assert.equal(fs.statSync(trustPath).mtimeMs, trustMtime);
  trust = JSON.parse(fs.readFileSync(trustPath, "utf8"));
  assert.equal(trust[""].find((entry) => entry.fingerprint === ourFps[0]).trustedAt, trustedAt, "trustedAt is not refreshed");

  const stub = join(cmdHome, "stub-osc.sh");
  fs.writeFileSync(stub, "#!/bin/sh\nprintf '%s\\n' \"$1 $2\"\n");
  const classify = (payload) => spawnSync(pre.replaceAll(LIB, stub), {
    shell: true,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, HOME: cmdHome, PATH: "/usr/bin:/bin" },
  });
  for (const tool of ["AskUserQuestion", "Question", "ask_user_question"]) {
    const classified = classify({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: { note: "tool_name" } });
    assert.equal(classified.status, 0, classified.stderr);
    assert.equal(classified.stdout.trim(), "command-code blocked", tool);
  }
  const working = classify({ tool_name: "Bash", tool_input: { command: "echo \"tool_name\": \"AskUserQuestion\"" } });
  assert.equal(working.status, 0, working.stderr);
  assert.equal(working.stdout.trim(), "command-code working");
  const bare = classify({});
  assert.equal(bare.stdout.trim(), "command-code working");

  result = runIn(cmdHome, COMMAND_CODE, ["--uninstall"]);
  assert.equal(result.status, 0, result.stderr);
  settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  trust = JSON.parse(fs.readFileSync(trustPath, "utf8"));
  assert.equal(settings.theme, "dark");
  assert.deepEqual(settings.hooks.SessionStart, [{ hooks: [{ type: "command", command: "echo other" }] }]);
  assert.deepEqual(settings.hooks.PreToolUse, [{ matcher: "Bash", hooks: [{ type: "command", command: "echo bash" }] }]);
  assert.deepEqual(settings.hooks.Custom, [{ hooks: [{ type: "command", command: "echo keep" }] }]);
  assert.ok(JSON.stringify(settings.hooks.Stop).includes("empryo idle"));
  assert.equal(JSON.stringify(settings).includes("command-code"), false);
  assert.equal(JSON.stringify(settings).includes("herdr-cmd-osc"), false);
  const left = JSON.stringify(trust);
  for (const fp of ourFps) assert.equal(left.includes(fp), false, `fingerprint ${fp} removed`);
  assert.equal(left.includes(legacyFp), false);
  assert.ok(left.includes(foreignFp));
  assert.ok(left.includes(projectFp));
  assert.equal(trust["/old"], undefined, "root that only had our fingerprints is dropped");
  const settingsAfter = fs.readFileSync(settingsPath);
  const trustAfter = fs.readFileSync(trustPath);
  result = runIn(cmdHome, COMMAND_CODE, ["--uninstall"]);
  assert.match(result.stdout, /No Command Code/);
  assert.ok(settingsAfter.equals(fs.readFileSync(settingsPath)));
  assert.ok(trustAfter.equals(fs.readFileSync(trustPath)));
  fs.writeFileSync(settingsPath, "{oops");
  const trustBeforeBad = fs.readFileSync(trustPath);
  result = runIn(cmdHome, COMMAND_CODE);
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(settingsPath, "utf8"), "{oops");
  assert.ok(trustBeforeBad.equals(fs.readFileSync(trustPath)), "invalid settings leaves trust untouched");
}

// --dry-run prints the target and must not create the hook file.
{
  const dryHome = fs.mkdtempSync(join(os.tmpdir(), "ma-bridges-dry-"));
  for (const [script, file, needle] of [
    [EMPRYO, join(dryHome, ".empryo", "hooks.json"), /empryo-bridge: dry run/],
    [CURSOR, join(dryHome, ".cursor", "hooks.json"), /cursor-bridge: dry run/],
    [COMMAND_CODE, join(dryHome, ".commandcode", "settings.json"), /command-code-bridge: dry run/],
  ]) {
    const result = runIn(dryHome, script, ["--dry-run"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, needle);
    assert.equal(fs.existsSync(file), false, `${file} must not be created`);
  }
}

console.log("bridges.test: emitter + empryo, cursor, command-code adapters OK");
