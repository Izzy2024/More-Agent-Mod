// LANE-FULLPATH: the usual-folder scan and the "use full path" action.
// Sandboxes only: a temp home with fake executables, and the dialog stubs.
import fs from "node:fs";
import os from "node:os";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { HOME, setShared, shared } from "./stubs.mjs";
import { commonDirs, parseScan, scanFound, scanScript } from "./path-scan.js";

const M = (await import("./main.js")).default;
const OWN = "more-agents.keys";
const P = HOME + "/programs.json";

const realExec = async (command, args) => {
  const r = spawnSync(command, args, { encoding: "utf8" });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

// 1. The folders: per-user tool folders, the two system ones, and one Python
//    glob. No nvm or version-numbered folders.
{
  const dirs = commonDirs("/home/u");
  assert.deepEqual(dirs, [
    "/home/u/.local/bin",
    "/home/u/.cargo/bin",
    "/home/u/.bun/bin",
    "/home/u/.deno/bin",
    "/home/u/go/bin",
    "/home/u/.npm-global/bin",
    "/home/u/.opencode/bin",
    "/home/u/.volta/bin",
    "/home/u/.yarn/bin",
    "/home/u/.local/share/pnpm",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/home/u/Library/Python/*/bin",
  ]);
  assert.ok(dirs.every((dir) => !dir.includes("nvm")), "no nvm");
  assert.equal(dirs[dirs.length - 1].includes("*"), true, "the Python folders are a glob");
  // A trailing slash does not double up.
  assert.equal(commonDirs("/home/u/")[0], "/home/u/.local/bin");
}
console.log("ok 1: commonDirs");

// 2. The script never interpolates a bin name, and a quote in a folder stays quoted.
{
  const script = scanScript(commonDirs("/home/u"));
  assert.match(script, /for b in "\$@"; do/, "bins are positional");
  assert.match(script, /printf 'FOUND %s=%s\\n' "\$b" "\$d\/\$b"/);
  assert.match(script, /continue 2/, "first hit per bin");
  assert.ok(!scanScript(["/home/u/.local/bin", "/tmp/x"]).includes("evil; touch"), "no bin text in the script");
  assert.ok(scanScript(["/tmp/a'b"]).includes(`'/tmp/a'\\''b'`), "a quote is escaped");
  assert.equal(scanScript([]).includes("for d in ''; do"), true, "an empty list still parses");
}
console.log("ok 2: scanScript safety");

// 3. parseScan: only FOUND <bin>=<absolute path>, first hit wins, noise ignored.
{
  const parsed = parseScan([
    "omp",
    "FOUND plain",
    "FOUND a=",
    "FOUND b=rel/bin",
    "FOUND c=/usr/local/bin/c",
    "FOUND c=/other/c",
    "  FOUND spaced=/ignored/lead",
    "FOUND d=/opt/d",
    "FOUND e=/bad/\u0007name",
    "FOUND f=/has space/f",
    "FOUND g=/crlf/g\r",
  ].join("\n"));
  assert.deepEqual(parsed, {
    c: "/usr/local/bin/c",
    d: "/opt/d",
    "f": "/has space/f",
    g: "/crlf/g",
  });
  assert.deepEqual(parseScan(""), {});
  assert.deepEqual(parseScan(null), {});
}
console.log("ok 3: parseScan");

// 4. scanFound: fake exec, failure, throw, Windows; and a real run against a
// temp home with an executable, a non-executable and a hostile name.
{
  const fake = await scanFound(["omp", "kilo"], {
    exec: async () => ({ code: 0, stdout: "noise\nFOUND kilo=/home/u/.local/bin/kilo\n" }),
    home: "/home/u",
  });
  assert.deepEqual(fake, { kilo: "/home/u/.local/bin/kilo" });
  assert.deepEqual(await scanFound(["omp"], { exec: async () => ({ code: 1, stdout: "FOUND omp=/x" }), home: "/home/u" }), {}, "a failed probe is empty");
  assert.deepEqual(await scanFound(["omp"], { exec: async () => { throw new Error("boom"); }, home: "/home/u" }), {}, "a throw is empty");
  let called = 0;
  const spy = async () => { called++; return { code: 0, stdout: "" }; };
  assert.deepEqual(await scanFound(["omp"], { exec: spy, home: "/home/u", windows: true }), {}, "Windows is empty");
  assert.equal(called, 0, "Windows runs nothing");
  assert.deepEqual(await scanFound([], { exec: spy, home: "/home/u" }), {});

  const home = fs.mkdtempSync(join(os.tmpdir(), "ma-fullpath-"));
  fs.mkdirSync(join(home, ".local/bin"), { recursive: true });
  fs.writeFileSync(join(home, ".local/bin/fake-agent"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(join(home, ".local/bin/not-exec"), "plain text");
  const marker = join(home, "PWNED");
  const hostile = `evil; touch ${marker}`;
  const real = await scanFound(["fake-agent", "not-exec", hostile, "missing"], { exec: realExec, home });
  assert.deepEqual(real, { "fake-agent": join(home, ".local/bin/fake-agent") }, "only the executable is found");
  assert.equal(fs.existsSync(marker), false, "a hostile name is never executed");
  assert.deepEqual(await scanFound(["fake-agent"], { exec: realExec, home: "/nonexistent-home" }), {}, "another home finds nothing");
}
console.log("ok 4: scanFound real and fake");

// --- Dialog ------------------------------------------------------------------

async function boot({ programs, own, onPath = "omp aider" } = {}) {
  delete process.env.MA_FAIL_WRITE;
  delete process.env.MA_EXEC_FAIL;
  process.env.MA_ONPATH = onPath;
  process.env.MA_KNOWN_AGENTS = "claude";
  setShared(OWN, own);
  fs.rmSync(P, { force: true });
  if (programs !== undefined) fs.writeFileSync(P, JSON.stringify({ programs }, null, 2));
  const spawned = [];
  const cx = { spawn: (f) => { spawned.push(f(cx)); }, notify: () => {} };
  const m = new M();
  m.init({}, cx);
  await Promise.all(spawned.splice(0));
  return { m, cx, drain: () => Promise.all(spawned.splice(0)) };
}
const read = () => JSON.parse(fs.readFileSync(P, "utf8"));

// 5. Catalog row with no entry: the button appears only when the file was found,
//    the confirm names it, and nothing is written before it.
{
  const { m, cx, drain } = await boot({ programs: {} });
  const kilo = m.agentOf("kilo");
  assert.equal(m.fullPathFor(kilo), null, "nothing found yet");
  m.foundAt = { kilo: "/home/u/.local/bin/kilo" };
  assert.deepEqual(m.fullPathFor(kilo), { action: "add", key: "kilo", name: "Kilo Code CLI", bin: "kilo", path: "/home/u/.local/bin/kilo" });
  m.render();
  assert.ok(m.shown.includes("button:fullpath-kilo"), "the row paints the button");
  const bytes = fs.readFileSync(P, "utf8");
  assert.equal(m.previewFullPath(kilo, cx), true);
  assert.equal(m.confirm?.kind, "fullpath");
  assert.equal(m.confirm.action, "add");
  assert.match(m.msg, /^Add Kilo Code CLI using \/home\/u\/\.local\/bin\/kilo\?$/);
  assert.equal(fs.readFileSync(P, "utf8"), bytes, "nothing is written before the confirm");

  process.env.MA_ONPATH = "omp aider /home/u/.local/bin/kilo";
  m.resolveConfirm(true, cx);
  await drain();
  const t = read();
  assert.deepEqual(t.programs.kilo.run, ["/home/u/.local/bin/kilo"]);
  assert.deepEqual(t.programs.kilo.match, ["kilo"], "the catalog match is kept");
  assert.equal(t.programs.kilo.name, "Kilo Code CLI");
  assert.ok(shared(OWN).kilo, "the new entry is owned");
  assert.equal(m.msgLevel, "success");
  assert.equal(m.busy, false);
}
console.log("ok 5: add using the full path");

// 6. An entry this mod wrote: the button repoints only run[0] and refreshes the
//    fingerprint; the rest of the entry is untouched.
{
  const { m, cx, drain } = await boot({
    programs: { kilo: { name: "Mine", run: ["kilo"], tile: "#123456" }, other: { run: ["other"] } },
    own: { kilo: null },
    onPath: "omp aider",
  });
  m.foundAt = { kilo: "/opt/kilo" };
  assert.equal(m.fullPathFor(m.agentOf("kilo")).action, "update");
  m.render();
  assert.ok(m.shown.includes("button:fullpath-kilo"));
  assert.equal(m.previewFullPath(m.agentOf("kilo"), cx), true);
  assert.match(m.msg, /^Change Kilo Code CLI to run \/opt\/kilo\?$/);
  assert.deepEqual(read().programs.kilo.run, ["kilo"], "nothing is written before the confirm");

  process.env.MA_ONPATH = "omp aider /opt/kilo";
  const beforeOwn = shared(OWN).kilo;
  m.resolveConfirm(true, cx);
  await drain();
  const t = read();
  assert.deepEqual(t.programs.kilo.run, ["/opt/kilo"], "only run[0] changed");
  assert.equal(t.programs.kilo.name, "Mine");
  assert.equal(t.programs.kilo.tile, "#123456");
  assert.deepEqual(t.programs.other.run, ["other"], "other entries untouched");
  assert.notEqual(shared(OWN).kilo, beforeOwn, "the fingerprint is refreshed");
  assert.ok(shared(OWN).kilo, "the entry is owned");
  assert.equal(m.msgLevel, "success");
  assert.match(m.msg, /^Kilo Code CLI now runs \/opt\/kilo\.$/);
}

// 6b. The same repoint works for a custom entry this mod wrote (no catalog row).
{
  const { m, cx, drain } = await boot({
    programs: { "my-tool": { name: "My Tool", run: ["my-tool"] } },
    own: { "my-tool": null },
    onPath: "omp aider",
  });
  const row = { id: "my-tool", name: "My Tool", run: ["my-tool"], status: "custom" };
  m.foundAt = { "my-tool": "/opt/my-tool" };
  assert.equal(m.fullPathFor(row).action, "update");
  m.previewFullPath(row, cx);
  assert.match(m.msg, /^Change My Tool to run \/opt\/my-tool\?$/);
  m.resolveConfirm(true, cx);
  await drain();
  assert.deepEqual(read().programs["my-tool"].run, ["/opt/my-tool"]);
  assert.equal(read().programs["my-tool"].name, "My Tool");
  assert.ok(shared(OWN)["my-tool"], "the custom entry keeps its ownership");
}
console.log("ok 6: repoint an owned entry");

// 7. A foreign entry is never offered, and a non-verified row (builtin) neither.
{
  const { m } = await boot({ programs: { kilo: { run: ["kilo"] } }, own: {} });
  m.foundAt = { kilo: "/opt/kilo" };
  assert.equal(m.fullPathFor(m.agentOf("kilo")), null, "an entry we did not write is left alone");
  m.render();
  assert.ok(!m.shown.includes("button:fullpath-kilo"));

  const builtin = await boot({ programs: {} });
  builtin.m.foundAt = { cursor: "/opt/cursor-agent" };
  assert.equal(builtin.m.fullPathFor(builtin.m.agentOf("cursor")), null, "builtin rows are not addable");
}
console.log("ok 7: foreign and builtin rows get no button");

// 8. Windows: the whole action is off, even with a found path.
{
  const probe = spawnSync(process.execPath, ["--input-type=module", "-e", `
import { HOME } from "./stubs.mjs";
const M = (await import("./main.js")).default;
const spawned = [];
const cx = { spawn: (f) => { spawned.push(f(cx)); }, notify() {} };
const m = new M();
m.init({}, cx);
await Promise.all(spawned.splice(0));
m.foundAt = { kilo: "C:/bin/kilo" };
m.render();
console.log(JSON.stringify({
  buttons: m.shown.filter((s) => s.startsWith("button:fullpath-")),
  found: Object.keys(m.foundAt).length,
  action: m.fullPathFor(m.agentOf("kilo")),
}));
`], {
    cwd: process.cwd(),
    env: { ...process.env, MA_SYS_HOME: "C:\\Users\\x", MA_HOME: fs.mkdtempSync(join(os.tmpdir(), "ma-fullpath-win-")) },
    encoding: "utf8",
  });
  assert.equal(probe.status, 0, probe.stderr);
  const out = JSON.parse(probe.stdout.trim());
  assert.deepEqual(out.buttons, [], "no full-path button on Windows");
  assert.equal(out.action, null);
}
console.log("ok 8: Windows gets nothing");

console.log("path-scan.test: LANE-FULLPATH OK");
