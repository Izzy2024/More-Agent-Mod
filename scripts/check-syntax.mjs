#!/usr/bin/env node
// Syntax-checks every mod file and script with `node --check`, no dependencies.
// The mod's .js files are ES modules even in a checkout without package.json
// (the smoke test builds such a tree), so each file goes through stdin with
// --input-type=module instead of relying on "type": "module".
// Usage: node scripts/check-syntax.mjs [root]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.argv[2] ?? join(here, ".."));

// mods/more-agents/gpui-kit.d.ts is gitignored and is not JavaScript; the
// .js filter already leaves it alone.
const TARGETS = [
  { dir: "mods/more-agents", ext: ".js" },
  { dir: "scripts", ext: ".mjs" },
  { dir: "bridges", ext: ".mjs" },
];

function walk(dir, ext, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // a checkout without bridges/, say
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, ext, out);
    else if (entry.isFile() && entry.name.endsWith(ext)) out.push(path);
  }
  return out;
}

if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
  console.error(`not a directory: ${root}`);
  process.exit(1);
}

const files = [];
for (const { dir, ext } of TARGETS) files.push(...walk(join(root, dir), ext, []));

const failed = [];
for (const file of files) {
  const shown = relative(root, file).split(sep).join("/");
  const r = spawnSync(process.execPath, ["--input-type=module", "--check"], {
    input: readFileSync(file, "utf8"),
    encoding: "utf8",
  });
  if (r.status === 0) continue;
  const first = (r.stderr ?? "").split("\n").map((line) => line.trim()).find(Boolean) ?? "node --check failed";
  console.log(`FAIL ${shown}`);
  console.log(`  ${first.replace("[stdin]", shown)}`);
  failed.push(shown);
}

if (failed.length) {
  console.error(`\n${failed.length} of ${files.length} files failed`);
  process.exit(1);
}
console.log(`${files.length} files OK`);
