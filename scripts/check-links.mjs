#!/usr/bin/env node
// Checks every catalog docs/source URL, and flags verified entries whose
// `checked` date is more than 90 days before today.
// Usage: node scripts/check-links.mjs [--offline] [--today YYYY-MM-DD] [catalog.js]
// --offline skips the network and runs only the freshness check.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TIMEOUT_MS = 10_000;
const CONCURRENCY = 4;
export const STALE_DAYS = 90;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function utcDay(iso) {
  const m = DATE_RE.exec(iso ?? "");
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

export function todayUtc(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// Whole days from `checked` to `today`. Null when either value is not a real date.
export function ageDays(checked, today) {
  const a = utcDay(checked);
  const b = utcDay(today);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

// Verified entries whose review date is more than STALE_DAYS before today.
export function staleVerified(list, today) {
  const stale = [];
  for (const e of list) {
    if (e?.status !== "verified") continue;
    const days = ageDays(e.checked, today);
    if (days != null && days > STALE_DAYS) stale.push({ id: e.id, checked: e.checked, days });
  }
  return stale;
}

export function loadCatalog(file) {
  const text = readFileSync(file, "utf8");
  const body = text.replace(/^(\s*\/\/[^\n]*\n)*/, "");
  const m = body.match(/^\s*export default\s+([\s\S]*?);\s*$/);
  if (!m) throw new Error(`${file}: must be // comments followed by \`export default [ ... ];\``);
  const list = JSON.parse(m[1]);
  if (!Array.isArray(list)) throw new Error(`${file}: catalog is not a list`);
  return list;
}

// HEAD, then GET when HEAD is 403 or 405. 2xx and 3xx are ok.
export async function probeUrl(url, fetchImpl = globalThis.fetch, timeoutMs = TIMEOUT_MS) {
  const once = async (method) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method,
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "user-agent": "more-agents-catalog-health" },
      });
      const status = res?.status;
      if (typeof status !== "number") return { ok: false, error: "no status", method };
      return { ok: status >= 200 && status < 400, status, method };
    } catch (e) {
      const name = e?.name;
      if (name === "AbortError" || name === "TimeoutError") return { ok: false, error: "timeout", method };
      return { ok: false, error: name || "error", method };
    } finally {
      clearTimeout(timer);
    }
  };
  const head = await once("HEAD");
  if (head.status === 403 || head.status === 405) {
    const get = await once("GET");
    return { ...get, via: "GET" };
  }
  return { ...head, via: "HEAD" };
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  const n = Math.min(limit, items.length) || 0;
  await Promise.all(Array.from({ length: n }, worker));
  return out;
}

function parseArgs(argv) {
  let offline = false;
  let today = null;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--offline") offline = true;
    else if (a === "--today") {
      today = argv[++i];
      if (!today) throw new Error("--today needs YYYY-MM-DD");
    } else if (a.startsWith("-")) throw new Error(`unknown option ${a}`);
    else positional.push(a);
  }
  if (positional.length > 1) throw new Error("too many arguments");
  return { offline, today, file: positional[0] ?? null };
}

export async function checkCatalog(list, { offline, today, fetchImpl, timeoutMs } = {}) {
  const when = today ?? todayUtc();
  if (!utcDay(when)) throw new Error(`--today ${when} is not YYYY-MM-DD`);
  const stale = staleVerified(list, when);
  const links = [];
  if (!offline) {
    const jobs = [];
    for (const e of list) {
      for (const field of ["docs", "source"]) {
        // A builtin's `source` names Herdr's own defaults/programs.json, which has
        // no public page (the old GitHub URL is a 404): only its docs are checked.
        if (field === "source" && e?.status === "builtin") continue;
        if (typeof e?.[field] === "string") jobs.push({ id: e.id ?? "?", field, url: e[field] });
      }
    }
    const results = await mapPool(jobs, CONCURRENCY, async (job) => {
      const result = await probeUrl(job.url, fetchImpl, timeoutMs);
      return { ...job, ...result };
    });
    for (const r of results) if (!r.ok) links.push(r);
  }
  return { today: when, stale, links, entries: list.length };
}

function printReport(report, offline) {
  if (offline) console.log("offline: network skipped");
  for (const r of report.links) {
    const why = r.error ?? r.status;
    console.log(`FAIL ${r.id} ${r.field} ${why} ${r.url}`);
  }
  for (const s of report.stale) {
    console.log(`STALE ${s.id} checked ${s.checked} is ${s.days} days old (limit ${STALE_DAYS})`);
  }
  console.log(`${report.entries} entries, ${report.links.length} link failures, ${report.stale.length} stale`);
}

function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(entry));
  } catch {
    return import.meta.url === pathToFileURL(resolve(entry)).href;
  }
}

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const args = parseArgs(process.argv.slice(2));
  const file = resolve(args.file ?? join(here, "..", "mods", "more-agents", "catalog.js"));
  const list = loadCatalog(file);
  const report = await checkCatalog(list, { offline: args.offline, today: args.today });
  printReport(report, args.offline);
  if (report.links.length || report.stale.length) process.exit(1);
}

if (invokedDirectly()) {
  main().catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
