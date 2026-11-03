#!/usr/bin/env node
// Validates mods/more-agents/catalog.js without running it: the file must be
// comments + `export default <strict JSON>;`.
// Usage: node scripts/validate-catalog.mjs [catalog.js] [--icons <Herdr icons folder>] [--builtin <Herdr programs.json>]
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const iconsDir = opt("--icons");
const builtinPath = opt("--builtin");
const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(args[0] ?? join(here, "..", "mods", "more-agents", "catalog.js"));
const modRoot = dirname(file);
const repoRoot = resolve(modRoot, "..", "..");

const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

const text = readFileSync(file, "utf8");
const body = text.replace(/^(\s*\/\/[^\n]*\n)*/, "");
const m = body.match(/^\s*export default\s+([\s\S]*?);\s*$/);
if (!m) { console.error(`${file}: must be // comments followed by \`export default [ ... ];\` (nothing else)`); process.exit(1); }
let list;
try { list = JSON.parse(m[1]); } catch (e) { console.error(`${file}: the body is not strict JSON: ${e.message}`); process.exit(1); }

const KEYS = new Set(["id", "name", "run", "match", "continue", "install", "docs", "icon", "status", "source", "checked", "bridge", "note"]);
const STATUS = new Set(["verified", "unverified", "builtin"]);
const ID = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const URL_RE = /^https:\/\/\S+$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
// Icons are paths in the app home: Herdr's own `icons/` or this mod's folder.
const HERDR_ICON = /^icons\/[a-z0-9._-]+\.svg$/;
const MOD_ICON = /^mods\/more-agents\/icons\/[a-z0-9._-]+\.svg$/;
const argv = (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.length > 0);
const strs = (v) => Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0 && !/\s/.test(s));
const isDate = (v) => {
  const d = DATE_RE.exec(v ?? "");
  if (!d) return false;
  const [y, mo, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const dt = new Date(Date.UTC(y, mo - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === day;
};

const builtin = builtinPath ? JSON.parse(readFileSync(builtinPath, "utf8")).programs ?? {} : null;

if (!Array.isArray(list) || list.length === 0) err("catalog", "must be a non-empty list");
const ids = new Set();
for (const [i, e] of (Array.isArray(list) ? list : []).entries()) {
  const at = `#${i} ${e?.id ?? "?"}`;
  if (typeof e !== "object" || e === null || Array.isArray(e)) { err(at, "is not an object"); continue; }
  for (const k of Object.keys(e)) if (!KEYS.has(k)) err(at, `unknown field "${k}"`);
  if (typeof e.id !== "string" || !ID.test(e.id)) err(at, "id: lowercase letters, digits, . _ - (max. 32)");
  else if (e.id.endsWith("-continue")) err(at, 'id cannot end in "-continue" (reserved for the continue variant)');
  if (ids.has(e.id)) err(at, "duplicate id");
  ids.add(e.id);
  if (typeof e.name !== "string" || !e.name.trim()) err(at, "name is required");
  if (!argv(e.run)) err(at, "run: non-empty argument list");
  else if (/\s/.test(e.run[0])) err(at, "run[0] is a binary, no spaces");
  if (e.match !== undefined && !strs(e.match)) err(at, "match: list of names without spaces");
  if (e.continue !== undefined) {
    if (!argv(e.continue)) err(at, "continue: non-empty argument list");
    else if (argv(e.run) && e.continue[0] !== e.run[0]) err(at, "continue must use the same binary as run");
  }
  if (e.install !== undefined && (typeof e.install !== "string" || !e.install.trim())) err(at, "install: text");
  if (typeof e.docs !== "string" || !URL_RE.test(e.docs)) err(at, "docs: URL https");
  if (typeof e.source !== "string" || !URL_RE.test(e.source)) err(at, "source: https URL the command comes from");
  if (!STATUS.has(e.status)) err(at, `status: ${[...STATUS].join(" | ")}`);
  if (e.status === "verified" && e.checked === undefined) err(at, "checked: verified entries need the date their source was reviewed");
  if (e.checked !== undefined && !isDate(e.checked)) err(at, 'checked: "YYYY-MM-DD"');
  if (typeof e.icon !== "string" || !(HERDR_ICON.test(e.icon) || MOD_ICON.test(e.icon))) {
    err(at, 'icon: "icons/<name>.svg" (Herdr) or "mods/more-agents/icons/<name>.svg" (this mod)');
  } else if (MOD_ICON.test(e.icon)) {
    if (!existsSync(join(modRoot, e.icon.slice("mods/more-agents/".length)))) err(at, `icon ${e.icon} does not exist in ${modRoot}`);
  } else if (iconsDir && !existsSync(join(iconsDir, e.icon.slice("icons/".length)))) {
    err(at, `icon ${e.icon} does not exist in ${iconsDir}`);
  }
  if (e.bridge !== undefined) {
    if (typeof e.bridge !== "string" || !/^bridges\/[a-z0-9._-]+$/.test(e.bridge)) err(at, 'bridge: "bridges/<id>"');
    else if (!existsSync(join(repoRoot, e.bridge, "install.mjs"))) err(at, `bridge ${e.bridge}/install.mjs does not exist`);
  }
  if (e.note !== undefined && typeof e.note !== "string") err(at, "note: text");
  if (builtin && typeof e.id === "string") {
    const b = builtin[e.id];
    const ships = Boolean(b?.run?.length);
    if (e.status === "builtin" && !ships) err(at, "status builtin but Herdr does not ship it with run");
    if (e.status !== "builtin" && ships) err(at, `Herdr already ships it with run ${JSON.stringify(b.run)}: use status "builtin"`);
  }
}
for (const id of ids) if (ids.has(`${id}-continue`)) err(id, "clashes with the continue variant of another id");

if (errors.length) { console.error(errors.join("\n")); console.error(`\n${errors.length} error${errors.length === 1 ? "" : "s"} in ${file}`); process.exit(1); }
const count = (s) => list.filter((e) => e.status === s).length;
console.log(`OK: ${list.length} agents (${count("verified")} verified, ${count("unverified")} unverified, ${count("builtin")} builtin)`);
