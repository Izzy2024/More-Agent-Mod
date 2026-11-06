// Tests for scripts/install.mjs: the npx bin entry, --with-key, the key
// cleanup of --uninstall, and the herdr-app version warning.
// Every run gets a temp home; the real ~/.config/herdr-app is never touched.
// The smoke harness only gives this file a sandbox HOME, so the checkout is
// found from the inherited environment (same as validate.test.mjs).
import fs from "node:fs";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";

const HOME = process.env.MA_HOME;
assert.ok(HOME, "MA_HOME is set by scripts/smoke-test.mjs");
fs.mkdirSync(HOME, { recursive: true });

function findRepo() {
  const seeds = [process.env.MA_REPO, process.env.INIT_CWD, process.env.PWD, process.cwd()].filter(Boolean);
  if (process.env.npm_package_json) seeds.unshift(dirname(process.env.npm_package_json));
  for (const seed of seeds) {
    let dir = seed;
    for (;;) {
      if (fs.existsSync(join(dir, "scripts", "install.mjs"))
        && fs.existsSync(join(dir, "mods", "more-agents", "mod.json"))) return dir;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error("cannot find the checkout; run the smoke tests from the repository root");
}

const REPO = findRepo();
const BIN = join(REPO, "scripts", "install.mjs");
const CHORD = "alt-shift-a";
const COMMAND = "mod.open:more-agents";

const run = (args, env = {}) => {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const tempDir = (name) => fs.mkdtempSync(join(HOME, `${name}-`));
const tempHome = (name) => {
  const home = join(tempDir(name), "herdr-app");
  fs.mkdirSync(home, { recursive: true });
  return home;
};
const keysPath = (home) => join(home, "keys.json");
const keysBackup = (home) => join(home, "keys.json.more-agents.bak");
const modTarget = (home) => join(home, "mods", "more-agents");
const installed = (home) => fs.existsSync(join(modTarget(home), "mod.json"));
const read = (path) => fs.readFileSync(path, "utf8");
const write = (path, text) => fs.writeFileSync(path, text);
const canonic = (value) => `${JSON.stringify(value, null, 2)}\n`;

// 1. The npx entry: a bin pointing at the installer, still private, and a
//    help text that lists every flag.
{
  const pkg = JSON.parse(read(join(REPO, "package.json")));
  assert.equal(pkg.private, true, "the package is not published to npm");
  assert.equal(pkg.version, "0.2.0");
  assert.deepEqual(pkg.bin, { "more-agents": "scripts/install.mjs" });
  assert.ok(fs.statSync(BIN).mode & 0o111, "the bin target is executable");
  // The repo's keys.json is what the installer writes; keep them in sync.
  assert.equal(JSON.parse(read(join(REPO, "keys.json"))).global?.[CHORD], COMMAND);

  const help = run(["--help"]);
  assert.equal(help.status, 0, help.out);
  for (const flag of ["--home", "--dry-run", "--uninstall", "--with-key", "--help"]) {
    assert.ok(help.out.includes(flag), `--help lists ${flag}`);
  }
}
console.log("ok 1: npx bin metadata and --help");

// 2. Plain install still never touches keys.json (even when it exists).
{
  const home = tempHome("plain");
  const original = canonic({ global: { "cmd-q": "app.quit" } });
  write(keysPath(home), original);
  const r = run(["--home", home]);
  assert.equal(r.status, 0, r.out);
  assert.ok(installed(home));
  assert.equal(read(keysPath(home)), original, "keys.json untouched");
  assert.ok(!fs.existsSync(keysBackup(home)), "no key backup");
  assert.ok(!fs.existsSync(join(home, "programs.json")), "programs.json untouched");
}
console.log("ok 2: plain install leaves keys.json alone");

// 3. --dry-run writes nothing in install, update and uninstall, including
//    the key merge.
{
  const home = tempHome("dry");
  const original = canonic({ global: { "cmd-q": "app.quit" } });
  write(keysPath(home), original);

  let r = run(["--home", home, "--dry-run", "--with-key"]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Would add alt-shift-a/);
  assert.ok(!installed(home), "dry-run installs nothing");
  assert.equal(read(keysPath(home)), original);
  assert.ok(!fs.existsSync(keysBackup(home)));

  assert.equal(run(["--home", home]).status, 0);
  const afterInstall = read(keysPath(home));
  r = run(["--home", home, "--dry-run"]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Would copy/);
  assert.equal(read(keysPath(home)), afterInstall);

  r = run(["--home", home, "--dry-run", "--uninstall"]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Would remove .*more-agents/);
  assert.ok(installed(home), "dry-run uninstall keeps the mod");
  assert.equal(read(keysPath(home)), afterInstall);
}
console.log("ok 3: --dry-run writes nothing in every mode");

// 4. --with-key with no keys.json creates it with just the binding.
{
  const home = tempHome("key-fresh");
  const r = run(["--home", home, "--with-key"]);
  assert.equal(r.status, 0, r.out);
  assert.ok(installed(home));
  assert.equal(read(keysPath(home)), canonic({ global: { [CHORD]: COMMAND } }));
  assert.ok(!fs.existsSync(keysBackup(home)), "a new file has nothing to back up");
  assert.match(r.out, /Created/);
}
console.log("ok 4: --with-key creates keys.json");

// 5. --with-key with no global object: global is appended, other top-level
//    keys keep their order, and the previous file is backed up.
{
  const home = tempHome("key-noglobal");
  const original = `{\n  "zeta": 1,\n  "alpha": 2\n}\n`;
  write(keysPath(home), original);
  const r = run(["--home", home, "--with-key"]);
  assert.equal(r.status, 0, r.out);
  const data = JSON.parse(read(keysPath(home)));
  assert.deepEqual(Object.keys(data), ["zeta", "alpha", "global"]);
  assert.equal(data.global[CHORD], COMMAND);
  assert.equal(read(keysBackup(home)), original, "backup holds the previous file");
}
console.log("ok 5: --with-key keeps other top-level keys");

// 6. --with-key with existing bindings: only the chord is added.
{
  const home = tempHome("key-others");
  const original = canonic({ zeta: { a: 1 }, global: { "cmd-x": "app.quit", "ctrl-y": "app.palette" }, alpha: [1, 2] });
  write(keysPath(home), original);
  const r = run(["--home", home, "--with-key"]);
  assert.equal(r.status, 0, r.out);
  const data = JSON.parse(read(keysPath(home)));
  assert.deepEqual(Object.keys(data), ["zeta", "global", "alpha"]);
  assert.deepEqual(Object.keys(data.global), ["cmd-x", "ctrl-y", CHORD]);
  assert.equal(data.global["cmd-x"], "app.quit");
  assert.equal(data.global["ctrl-y"], "app.palette");
  assert.deepEqual(data.zeta, { a: 1 });
  assert.deepEqual(data.alpha, [1, 2]);
}
console.log("ok 6: --with-key merges only the chord");

// 7. A chord someone else owns is left alone, with the owner named, after
//    the mod install succeeds.
{
  const home = tempHome("key-owned");
  const original = canonic({ global: { [CHORD]: "app.palette" } });
  write(keysPath(home), original);
  const r = run(["--home", home, "--with-key"]);
  assert.equal(r.status, 0, r.out);
  assert.ok(installed(home), "the mod install still happens");
  assert.match(r.out, /app\.palette/);
  assert.equal(read(keysPath(home)), original, "the binding is not replaced");
  assert.ok(!fs.existsSync(keysBackup(home)));
}
console.log("ok 7: --with-key leaves a chord someone else owns");

// 8. The same binding again: no write at all.
{
  const home = tempHome("key-same");
  const original = canonic({ global: { "cmd-x": "app.quit", [CHORD]: COMMAND } });
  write(keysPath(home), original);
  const before = fs.statSync(keysPath(home), { bigint: true });
  const r = run(["--home", home, "--with-key"]);
  assert.equal(r.status, 0, r.out);
  const after = fs.statSync(keysPath(home), { bigint: true });
  assert.equal(read(keysPath(home)), original);
  assert.equal(after.mtimeNs, before.mtimeNs, "an identical binding causes no write");
  assert.ok(!fs.existsSync(keysBackup(home)), "no backup without a change");
}
console.log("ok 8: --with-key is idempotent");

// 9. Broken keys.json (invalid JSON or not an object): refuse before
//    installing anything, and change nothing.
{
  for (const [name, text] of [["bad-json", "{ nope\n"], ["array", "[1, 2]\n"]]) {
    const home = tempHome(`key-${name}`);
    write(keysPath(home), text);
    const r = run(["--home", home, "--with-key"]);
    assert.notEqual(r.status, 0, `${name}: refused`);
    assert.match(r.out, /nothing was changed/i);
    assert.equal(read(keysPath(home)), text, `${name}: keys.json untouched`);
    assert.ok(!fs.existsSync(keysBackup(home)), `${name}: no backup`);
    assert.ok(!installed(home), `${name}: the mod is not installed either`);
  }
}
console.log("ok 9: --with-key refuses a broken keys.json");

// 10. The key backup is written once and never overwritten.
{
  const home = tempHome("key-backup-once");
  const first = `{\n  "global": {}\n}\n`;
  write(keysPath(home), first);
  assert.equal(run(["--home", home, "--with-key"]).status, 0);
  assert.equal(read(keysBackup(home)), first);

  // Change the file by hand so the next run writes again.
  const second = canonic({ global: { "cmd-y": "app.hide" } });
  write(keysPath(home), second);
  assert.equal(run(["--home", home, "--with-key"]).status, 0);
  assert.equal(read(keysBackup(home)), first, "the first backup is never overwritten");
  assert.deepEqual(JSON.parse(read(keysPath(home))).global, { "cmd-y": "app.hide", [CHORD]: COMMAND });
}
console.log("ok 10: the key backup is written once");

// 11. --uninstall (without --with-key) removes only this mod's exact chord.
{
  const home = tempHome("uninstall-key");
  assert.equal(run(["--home", home, "--with-key"]).status, 0);
  const data = JSON.parse(read(keysPath(home)));
  data.global["cmd-x"] = "app.quit";
  data.top = 1;
  const previous = canonic(data);
  write(keysPath(home), previous);

  const dry = run(["--home", home, "--dry-run", "--uninstall"]);
  assert.equal(dry.status, 0, dry.out);
  assert.match(dry.out, /Would remove alt-shift-a/);
  assert.equal(read(keysPath(home)), previous);

  const r = run(["--home", home, "--uninstall"]);
  assert.equal(r.status, 0, r.out);
  assert.ok(!installed(home));
  const left = JSON.parse(read(keysPath(home)));
  assert.equal(left.global[CHORD], undefined);
  assert.equal(left.global["cmd-x"], "app.quit");
  assert.equal(left.top, 1);
  assert.ok(fs.existsSync(keysPath(home)), "keys.json is never deleted");
  assert.match(r.out, /Removed alt-shift-a/);
}
console.log("ok 11: --uninstall removes only this mod's chord");

// 12. --uninstall drops a global object it emptied, but keeps the file.
{
  const home = tempHome("uninstall-empty");
  write(keysPath(home), canonic({ global: { [CHORD]: COMMAND }, keep: true }));
  const r = run(["--home", home, "--uninstall"]);
  assert.equal(r.status, 0, r.out);
  assert.deepEqual(JSON.parse(read(keysPath(home))), { keep: true });
}
console.log("ok 12: --uninstall drops an empty global object");

// 13. A chord bound to another command survives --uninstall.
{
  const home = tempHome("uninstall-owned");
  const original = canonic({ global: { [CHORD]: "app.palette" } });
  write(keysPath(home), original);
  const r = run(["--home", home, "--uninstall"]);
  assert.equal(r.status, 0, r.out);
  assert.equal(read(keysPath(home)), original);
  assert.ok(!fs.existsSync(keysBackup(home)));
}
console.log("ok 13: --uninstall leaves another command's chord alone");

// 14. A broken keys.json does not block --uninstall; it is left untouched.
{
  const home = tempHome("uninstall-bad");
  write(keysPath(home), "{ nope");
  assert.equal(run(["--home", home]).status, 0);
  const r = run(["--home", home, "--uninstall"]);
  assert.equal(r.status, 0, r.out);
  assert.ok(!installed(home));
  assert.equal(read(keysPath(home)), "{ nope");
}
console.log("ok 14: --uninstall ignores a broken keys.json");

// 15. Update still keeps one backup of the previous folder.
{
  const home = tempHome("update");
  assert.equal(run(["--home", home]).status, 0);
  fs.writeFileSync(join(modTarget(home), "OLD"), "old");
  const r = run(["--home", home]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Updated/);
  assert.equal(read(join(home, "mods", "more-agents.bak", "OLD")), "old");
  assert.ok(!fs.existsSync(join(modTarget(home), "OLD")));
}
console.log("ok 15: update keeps one folder backup");

// 16. The herdr-app version warning: older than 0.1.8 warns but still
//     installs; newer, equal, unparsable or absent stays quiet.
{
  const fakeHerdr = (text) => {
    const bin = tempDir("fake-herdr");
    fs.writeFileSync(join(bin, "herdr-app"), `#!/bin/sh\nprintf '%s\\n' ${JSON.stringify(text)}\n`);
    fs.chmodSync(join(bin, "herdr-app"), 0o755);
    return bin;
  };
  const pathWith = (bin) => ({ PATH: `${bin}:${process.env.PATH ?? ""}` });
  const cases = [
    ["herdr-app 0.1.7", true],
    ["herdr-app 0.1.8", false],
    ["herdr-app 0.1.10", false],
    ["herdr-app 0.10.0", false],
    ["not a version", false],
    ["", false],
  ];
  for (const [version, warns] of cases) {
    const home = tempHome("version");
    const r = run(["--home", home], pathWith(fakeHerdr(version)));
    assert.equal(r.status, 0, `${version}: install succeeds\n${r.out}`);
    assert.ok(installed(home), `${version}: still installed`);
    assert.equal(/older than 0\.1\.8/.test(r.out), warns, `${version}: warning=${warns}\n${r.out}`);
  }

  const home = tempHome("version-missing");
  const empty = tempDir("empty-bin");
  const r = run(["--home", home], { PATH: `${empty}:/usr/bin:/bin` });
  assert.equal(r.status, 0, r.out);
  assert.ok(installed(home));
  assert.doesNotMatch(r.out, /older than/);
}
console.log("ok 16: herdr-app version warning");

console.log("installer.test: OK");
