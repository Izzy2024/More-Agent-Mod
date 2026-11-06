// Tests for scripts/validate-catalog.mjs and scripts/install.mjs.
// They run the real scripts in subprocesses; the smoke harness only gives this
// file a sandbox HOME, so the checkout is found from the inherited environment.
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
      if (fs.existsSync(join(dir, "scripts", "validate-catalog.mjs"))
        && fs.existsSync(join(dir, "scripts", "install.mjs"))
        && fs.existsSync(join(dir, "mods", "more-agents", "catalog.js"))) return dir;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error("cannot find the checkout; run the smoke tests from the repository root");
}

const REPO = findRepo();
const run = (script, args, env) => {
  const r = spawnSync(process.execPath, [join(REPO, script), ...args], {
    cwd: REPO,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const catalogBody = () => {
  const text = fs.readFileSync(join(REPO, "mods", "more-agents", "catalog.js"), "utf8");
  const body = text.replace(/^(\s*\/\/[^\n]*\n)*/, "");
  return JSON.parse(body.match(/^\s*export default\s+([\s\S]*?);\s*$/)[1]);
};
const writeFixture = (name, entry, { icon = true } = {}) => {
  const dir = join(HOME, "fixtures", name);
  const mod = join(dir, "mods", "more-agents");
  fs.mkdirSync(join(mod, "icons"), { recursive: true });
  if (icon) fs.writeFileSync(join(mod, "icons", "own.svg"), "<svg/>");
  const file = join(mod, "catalog.js");
  fs.writeFileSync(file, `// fixture\nexport default ${JSON.stringify([entry], null, 2)};\n`);
  return file;
};

// 1. The shipped catalog is valid, with and without Herdr's icons.
{
  const r = run("scripts/validate-catalog.mjs", []);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /20 agents/);
  assert.match(r.out, /14 verified/);

  const icons = join(HOME, "herdr-icons");
  fs.mkdirSync(icons, { recursive: true });
  for (const e of catalogBody()) {
    if (e.icon.startsWith("icons/")) fs.writeFileSync(join(icons, e.icon.slice("icons/".length)), "<svg/>");
  }
  const withIcons = run("scripts/validate-catalog.mjs", ["--icons", icons]);
  assert.equal(withIcons.status, 0, withIcons.out);
}
console.log("ok 1: current catalog validates");

// 2. checked is required for verified, and has to be a real YYYY-MM-DD date.
const base = {
  id: "x",
  name: "X",
  run: ["x"],
  docs: "https://example.com",
  icon: "mods/more-agents/icons/own.svg",
  status: "verified",
  source: "https://example.com/docs",
  checked: "2026-11-02",
};
{
  const ok = run("scripts/validate-catalog.mjs", [writeFixture("base", base)]);
  assert.equal(ok.status, 0, ok.out);

  const { checked, ...noChecked } = base;
  const missing = run("scripts/validate-catalog.mjs", [writeFixture("no-checked", noChecked)]);
  assert.notEqual(missing.status, 0);
  assert.match(missing.out, /checked/);

  for (const bad of ["2026-13-01", "2026-02-30", "11/02/2026", "2026-1-2"]) {
    const r = run("scripts/validate-catalog.mjs", [writeFixture(`bad-${bad.replace(/\W/g, "-")}`, { ...base, checked: bad })]);
    assert.notEqual(r.status, 0, `accepts ${bad}`);
    assert.match(r.out, /YYYY-MM-DD/);
  }
  const unverified = run("scripts/validate-catalog.mjs", [writeFixture("unverified", { ...noChecked, status: "unverified" })]);
  assert.equal(unverified.status, 0, unverified.out);
}
console.log("ok 2: checked date");

// 3. continue must use run's binary; ids cannot repeat.
{
  const badContinue = run("scripts/validate-catalog.mjs", [writeFixture("bad-continue", { ...base, continue: ["y", "--resume"] })]);
  assert.notEqual(badContinue.status, 0);
  assert.match(badContinue.out, /same binary/);

  const file = writeFixture("dup", base);
  const text = fs.readFileSync(file, "utf8").replace(/\n\];/, `,\n${JSON.stringify(base)}\n];`);
  fs.writeFileSync(file, text);
  const dup = run("scripts/validate-catalog.mjs", [file]);
  assert.notEqual(dup.status, 0);
  assert.match(dup.out, /duplicate id/);
}
console.log("ok 3: continue binary and duplicate ids");

// 4. Icons: Herdr's folder with --icons, and this mod's own icons without it.
{
  const emptyIcons = join(HOME, "empty-icons");
  fs.mkdirSync(emptyIcons, { recursive: true });
  const missingHerdr = run("scripts/validate-catalog.mjs", [
    writeFixture("missing-herdr", { ...base, icon: "icons/nope.svg" }),
    "--icons", emptyIcons,
  ]);
  assert.notEqual(missingHerdr.status, 0);
  assert.match(missingHerdr.out, /does not exist/);

  const missingMod = run("scripts/validate-catalog.mjs", [
    writeFixture("missing-mod", { ...base, icon: "mods/more-agents/icons/nope.svg" }),
  ]);
  assert.notEqual(missingMod.status, 0);
  assert.match(missingMod.out, /does not exist/);
}
console.log("ok 4: icons");

// 5. builtin has to match what Herdr actually ships.
{
  const file = writeFixture("builtin", { ...base, status: "builtin" });
  const empty = join(HOME, "empty-programs.json");
  fs.writeFileSync(empty, JSON.stringify({ programs: {} }));
  const r = run("scripts/validate-catalog.mjs", [file, "--builtin", empty]);
  assert.notEqual(r.status, 0);
  assert.match(r.out, /does not ship/);

  const ships = join(HOME, "ships-programs.json");
  fs.writeFileSync(ships, JSON.stringify({ programs: { x: { run: ["x"] } } }));
  const ok = run("scripts/validate-catalog.mjs", [file, "--builtin", ships]);
  assert.equal(ok.status, 0, ok.out);
}
console.log("ok 5: builtin fixture");

// Bridge metadata: a real adapter passes; a path outside bridges/ or one with
// no installer does not.
{
  const base = { ...catalogBody().find((e) => e.id === "command-code") };
  const okFile = writeFixture("bridge-ok", { ...base, id: "bridge-ok" });
  const okRoot = join(dirname(okFile), "..", "..");
  fs.mkdirSync(join(okRoot, "bridges", "command-code"), { recursive: true });
  fs.writeFileSync(join(okRoot, "bridges", "command-code", "install.mjs"), "// fixture\n");
  let r = run("scripts/validate-catalog.mjs", [okFile]);
  assert.equal(r.status, 0, r.out);
  r = run("scripts/validate-catalog.mjs", [writeFixture("bridge-bad", { ...base, id: "bridge-bad", bridge: "../evil" })]);
  assert.notEqual(r.status, 0, "a bridge outside bridges/ is rejected");
  r = run("scripts/validate-catalog.mjs", [writeFixture("bridge-missing", { ...base, id: "bridge-missing", bridge: "bridges/nope" })]);
  assert.notEqual(r.status, 0, "a bridge without install.mjs is rejected");
}
console.log("ok 5b: bridge field");

// 5c. install is not free text: only the commands the dialog may run.
{
  const good = [
    "npm i -g x",
    "npm install -g @scope/x@latest",
    "pip install aider-chat",
    "python -m pip install aider-install && aider-install",
    "brew install goose",
    "curl -fsSL https://example.com/install.sh | sh",
    "curl -LsSf https://example.com/x.sh | bash",
  ];
  for (const [i, install] of good.entries()) {
    const r = run("scripts/validate-catalog.mjs", [writeFixture(`install-ok-${i}`, { ...base, install })]);
    assert.equal(r.status, 0, `${install}: ${r.out}`);
  }
  const bad = [
    "sudo npm i -g x",
    "npm i -g x; rm -rf /",
    "curl http://example.com/install.sh | sh",
    "npm i -g $(whoami)",
    "npm i -g `id`",
    "curl -fsSL https://example.com/x.sh | sh > /dev/null",
    "brew install x | sh",
    "npm i -g x && sudo rm -rf /",
  ];
  for (const [i, install] of bad.entries()) {
    const r = run("scripts/validate-catalog.mjs", [writeFixture(`install-bad-${i}`, { ...base, install })]);
    assert.notEqual(r.status, 0, `accepts ${install}`);
    assert.match(r.out, /install:/, install);
  }
}
console.log("ok 5c: install command rule");

// 6. --dry-run writes nothing.
const appHome = join(HOME, "app-home");
{
  const before = fs.existsSync(appHome);
  const r = run("scripts/install.mjs", ["--dry-run", "--home", appHome]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /nothing was written/i);
  assert.equal(fs.existsSync(appHome), before, "dry-run created nothing");
}
console.log("ok 6: install --dry-run");

// 7. A fresh install has no nested mods/more-agents/more-agents and leaves
//    programs.json / keys.json alone.
const target = join(appHome, "mods", "more-agents");
{
  const r = run("scripts/install.mjs", ["--home", appHome]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Installed/);
  assert.ok(fs.existsSync(join(target, "mod.json")), "mod.json installed");
  assert.ok(fs.existsSync(join(target, "catalog.js")), "catalog installed");
  assert.ok(fs.existsSync(join(target, "bridges", "lib", "herdr-osc.sh")), "bridges installed with the mod");
  assert.ok(fs.existsSync(join(target, "bridges", "cursor", "install.mjs")), "the cursor bridge is installed");
  assert.ok(!fs.existsSync(join(target, "gpui-kit.d.ts")), "generated typings are not installed");
  assert.ok(!fs.existsSync(join(target, "jsconfig.json")), "editor config is not installed");
  assert.ok(!fs.existsSync(join(target, "more-agents")), "no nested mod folder");
  assert.ok(!fs.existsSync(join(appHome, "programs.json")), "programs.json untouched");
  assert.ok(!fs.existsSync(join(appHome, "keys.json")), "keys.json untouched");
}
console.log("ok 7: fresh install does not nest");

// 8. Updating swaps the folder and keeps one backup of the previous one.
{
  fs.writeFileSync(join(target, "OLD"), "old");
  const r = run("scripts/install.mjs", ["--home", appHome]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Updated/);
  const backup = join(appHome, "mods", "more-agents.bak");
  assert.ok(fs.existsSync(join(backup, "OLD")), "previous folder backed up");
  assert.ok(!fs.existsSync(join(target, "OLD")), "old file not in the new folder");
  assert.ok(fs.existsSync(join(target, "bridges", "lib", "herdr-osc.sh")), "bridges survive an update");
  assert.ok(!fs.existsSync(join(target, "gpui-kit.d.ts")), "still no generated typings");
  assert.ok(!fs.existsSync(join(target, "more-agents")), "still no nesting");
  assert.ok(!fs.existsSync(join(appHome, "programs.json")), "programs.json still untouched");
}
console.log("ok 8: update uses a backup");

// 9. --uninstall removes the mod only.
{
  const r = run("scripts/install.mjs", ["--uninstall", "--home", appHome]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /Removed/);
  assert.match(r.out, /bridges\/<id>\/install\.mjs --uninstall/, "points at the bridge uninstaller before the hooks break");
  assert.ok(!fs.existsSync(target), "mod removed");
  assert.ok(fs.existsSync(join(appHome, "mods", "more-agents.bak")), "backup kept");
  assert.ok(!fs.existsSync(join(appHome, "programs.json")), "programs.json untouched");
  const again = run("scripts/install.mjs", ["--uninstall", "--home", appHome]);
  assert.equal(again.status, 0, again.out);
  assert.match(again.out, /Not installed/);
}
console.log("ok 9: uninstall");

// 10. npm runs a script named `install` on every `npm install`; that would
//     install the mod into the real home, so the manual one is install:mod.
{
  const pkg = JSON.parse(fs.readFileSync(join(REPO, "package.json"), "utf8"));
  assert.equal(pkg.scripts.install, undefined, "no npm install lifecycle script");
  assert.equal(pkg.scripts["install:mod"], "node scripts/install.mjs");
}
console.log("ok 10: npm install leaves the mod alone");

console.log("validate.test: OK");
