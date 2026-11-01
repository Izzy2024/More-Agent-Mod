#!/usr/bin/env node
// Runs every scripts/smoke/*.test.mjs against a copy of the mod with its
// gpui-kit/gpui-base/herdr imports pointed at stubs.mjs (does not test the real UI).
// Each test file gets its own temp dir and MA_HOME. Usage: node scripts/smoke-test.mjs [test.mjs ...]
import { mkdtempSync, cpSync, readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const mod = join(root, "mods", "more-agents");
const smoke = join(root, "scripts", "smoke");
const only = process.argv.slice(2);
const tests = (only.length ? only : readdirSync(smoke).filter((f) => f.endsWith(".test.mjs"))).sort();
if (!tests.length) { console.error("no *.test.mjs in scripts/smoke"); process.exit(1); }

const failed = [];
for (const file of tests) {
  const testPath = join(smoke, basename(file));
  if (!existsSync(testPath)) { console.error(`missing test: ${testPath}`); failed.push(file); continue; }
  // Fresh copy of the whole mod: a new local module needs no harness change.
  const dir = mkdtempSync(join(tmpdir(), "more-agents-"));
  cpSync(mod, dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), '{ "type": "module" }\n');
  writeFileSync(
    join(dir, "main.js"),
    readFileSync(join(mod, "main.js"), "utf8").replace(/from "(gpui-kit|gpui-base|herdr)"/g, 'from "./stubs.mjs"'),
  );
  cpSync(smoke, dir, { recursive: true }); // stubs.mjs and any helper the tests share
  const home = join(dir, "home");
  mkdirSync(home, { recursive: true });
  console.log(`\n# ${file}`);
  const r = spawnSync(process.execPath, [join(dir, basename(file))], {
    cwd: dir,
    stdio: "inherit",
    env: { ...process.env, MA_HOME: home },
  });
  if (r.status !== 0) failed.push(file);
}

if (failed.length) { console.error(`\nFAILED: ${failed.join(", ")}`); process.exit(1); }
console.log(`\nALL OK (${tests.length} test file${tests.length === 1 ? "" : "s"})`);
