#!/usr/bin/env node
// Prueba la lógica de main.js en Node con stubs de gpui-kit/gpui-base/herdr
// (no prueba la UI real). Uso: node scripts/smoke-test.mjs
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = mkdtempSync(join(tmpdir(), "more-agents-"));
const main = readFileSync(join(root, "mods/more-agents/main.js"), "utf8")
  .replace(/from "(gpui-kit|gpui-base|herdr)"/g, 'from "./stubs.mjs"').replace("./catalog.js", "./catalog.mjs");
writeFileSync(join(dir, "main.mjs"), main);
copyFileSync(join(root, "mods/more-agents/catalog.js"), join(dir, "catalog.mjs"));
for (const f of ["stubs.mjs", "test.mjs"]) copyFileSync(join(root, "scripts/smoke", f), join(dir, f));
mkdirSync(join(dir, "home"));
const r = spawnSync(process.execPath, [join(dir, "test.mjs")], { stdio: "inherit", env: { ...process.env, MA_HOME: join(dir, "home") } });
process.exit(r.status ?? 1);
