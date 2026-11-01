#!/usr/bin/env node
// Valida mods/more-agents/catalog.js sin ejecutarlo: el archivo tiene que ser
// comentarios + `export default <JSON estricto>;`.
// Uso: node scripts/validate-catalog.mjs [catalog.js] [--icons <carpeta icons de Herdr>] [--builtin <programs.json de Herdr>]
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const iconsDir = opt("--icons");
const builtinPath = opt("--builtin");
const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(args[0] ?? join(here, "..", "mods", "more-agents", "catalog.js"));

const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

const text = readFileSync(file, "utf8");
const body = text.replace(/^(\s*\/\/[^\n]*\n)*/, "");
const m = body.match(/^\s*export default\s+([\s\S]*?);\s*$/);
if (!m) { console.error(`${file}: debe ser comentarios // y luego \`export default [ ... ];\` (nada más)`); process.exit(1); }
let list;
try { list = JSON.parse(m[1]); } catch (e) { console.error(`${file}: el cuerpo no es JSON estricto: ${e.message}`); process.exit(1); }

const KEYS = new Set(["id", "name", "run", "match", "continue", "install", "docs", "icon", "status", "source", "note"]);
const STATUS = new Set(["verified", "unverified", "builtin"]);
const ID = /^[a-z0-9][a-z0-9._-]{0,31}$/;
const URL_RE = /^https:\/\/\S+$/;
const argv = (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.length > 0);
const strs = (v) => Array.isArray(v) && v.every((s) => typeof s === "string" && s.length > 0 && !/\s/.test(s));

const builtin = builtinPath ? JSON.parse(readFileSync(builtinPath, "utf8")).programs ?? {} : null;

if (!Array.isArray(list) || list.length === 0) err("catalog", "tiene que ser una lista no vacía");
const ids = new Set();
for (const [i, e] of (Array.isArray(list) ? list : []).entries()) {
  const at = `#${i} ${e?.id ?? "?"}`;
  if (typeof e !== "object" || e === null || Array.isArray(e)) { err(at, "no es un objeto"); continue; }
  for (const k of Object.keys(e)) if (!KEYS.has(k)) err(at, `campo desconocido "${k}"`);
  if (typeof e.id !== "string" || !ID.test(e.id)) err(at, "id: minúsculas, números, . _ - (máx. 32)");
  else if (e.id.endsWith("-continue")) err(at, 'id no puede acabar en "-continue" (reservado para la variante continuar)');
  if (ids.has(e.id)) err(at, "id repetido");
  ids.add(e.id);
  if (typeof e.name !== "string" || !e.name.trim()) err(at, "name obligatorio");
  if (!argv(e.run)) err(at, "run: lista de argumentos no vacía");
  else if (/\s/.test(e.run[0])) err(at, "run[0] es un binario, sin espacios");
  if (e.match !== undefined && !strs(e.match)) err(at, "match: lista de nombres sin espacios");
  if (e.continue !== undefined) {
    if (!argv(e.continue)) err(at, "continue: lista de argumentos no vacía");
    else if (argv(e.run) && e.continue[0] !== e.run[0]) err(at, "continue tiene que usar el mismo binario que run");
  }
  if (e.install !== undefined && (typeof e.install !== "string" || !e.install.trim())) err(at, "install: texto");
  if (typeof e.docs !== "string" || !URL_RE.test(e.docs)) err(at, "docs: URL https");
  if (typeof e.source !== "string" || !URL_RE.test(e.source)) err(at, "source: URL https de donde sale el comando");
  if (!STATUS.has(e.status)) err(at, `status: ${[...STATUS].join(" | ")}`);
  if (typeof e.icon !== "string" || !/^icons\/[a-z0-9._-]+\.svg$/.test(e.icon)) err(at, 'icon: "icons/<nombre>.svg" de los iconos de Herdr');
  else if (iconsDir && !existsSync(join(iconsDir, e.icon.slice("icons/".length)))) err(at, `icon ${e.icon} no existe en ${iconsDir}`);
  if (e.note !== undefined && typeof e.note !== "string") err(at, "note: texto");
  if (builtin && typeof e.id === "string") {
    const b = builtin[e.id];
    const ships = Boolean(b?.run?.length);
    if (e.status === "builtin" && !ships) err(at, "status builtin pero Herdr no lo trae con run");
    if (e.status !== "builtin" && ships) err(at, `Herdr ya lo trae con run ${JSON.stringify(b.run)}: usa status "builtin"`);
  }
}
for (const id of ids) if (ids.has(`${id}-continue`)) err(id, "choca con la variante continuar de otro id");

if (errors.length) { console.error(errors.join("\n")); console.error(`\n${errors.length} error(es) en ${file}`); process.exit(1); }
const count = (s) => list.filter((e) => e.status === s).length;
console.log(`OK: ${list.length} agentes (${count("verified")} verified, ${count("unverified")} unverified, ${count("builtin")} builtin)`);
