// Tests for scripts/check-syntax.mjs: a temp tree with one good and one broken
// file per area, no package.json anywhere (so ESM detection cannot come from it).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { spawnSync } from "node:child_process";

function findRepo() {
  const seeds = [process.env.MA_REPO, process.env.INIT_CWD, process.env.PWD, process.cwd()].filter(Boolean);
  for (const seed of seeds) {
    let dir = seed;
    for (;;) {
      if (fs.existsSync(path.join(dir, "scripts", "check-syntax.mjs"))) return dir;
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error("cannot find the checkout; run the smoke tests from the repository root");
}

const REPO = findRepo();
const tree = fs.mkdtempSync(path.join(os.tmpdir(), "ma-syntax-"));

const write = (rel, text) => {
  const file = path.join(tree, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

write("mods/more-agents/good.js", 'import { x } from "./x.js";\nexport const y = x + 1;\n');
write("mods/more-agents/broken.js", "export const = ;\n");
write("scripts/good.mjs", "#!/usr/bin/env node\nexport const ok = true;\n");
write("bridges/demo/install.mjs", "export function install() {}\n");
write("scripts/ignored.js", "this is not checked: only .mjs under scripts/\n");

const run = () => {
  const r = spawnSync(process.execPath, [path.join(REPO, "scripts", "check-syntax.mjs"), tree], {
    cwd: REPO,
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

// 1. One broken file: exit 1, FAIL names it, the good ones are not reported.
{
  const r = run();
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}: ${r.out}`);
  assert.ok(r.out.includes("FAIL mods/more-agents/broken.js"), r.out);
  assert.ok(!r.out.includes("FAIL mods/more-agents/good.js"), r.out);
  assert.ok(!r.out.includes("FAIL scripts/good.mjs"), r.out);
  assert.ok(!r.out.includes("FAIL bridges/demo/install.mjs"), r.out);
  assert.ok(/[1-9]\d* of 4 files failed/.test(r.out), r.out);
}
console.log("ok 1: broken file fails and is named");

// 2. Without it: exit 0 and the count of the three remaining files.
{
  fs.rmSync(path.join(tree, "mods", "more-agents", "broken.js"));
  const r = run();
  assert.equal(r.status, 0, r.out);
  assert.ok(r.out.includes("3 files OK"), r.out);
}
console.log("ok 2: clean tree passes with a count");

// 3. A missing root is an error, not a silent pass.
{
  const r = spawnSync(process.execPath, [path.join(REPO, "scripts", "check-syntax.mjs"), path.join(tree, "nope")], {
    cwd: REPO,
    encoding: "utf8",
  });
  assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
}
console.log("ok 3: missing root fails");

console.log("check-syntax.test: OK");
