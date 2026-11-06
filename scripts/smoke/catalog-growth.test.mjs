// Lane F: community badge, offline freshness, and link status classification.
// The network is never used here: probeUrl gets a fake fetch, and the CLI
// runs only with --offline.
import fs from "node:fs";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { HOME, setShared } from "./stubs.mjs";

const MA_HOME = process.env.MA_HOME;
assert.ok(MA_HOME, "MA_HOME is set by scripts/smoke-test.mjs");
fs.mkdirSync(HOME, { recursive: true });

function findRepo() {
  const seeds = [process.env.MA_REPO, process.env.INIT_CWD, process.env.PWD, process.cwd()].filter(Boolean);
  for (const seed of seeds) {
    let dir = seed;
    for (;;) {
      if (fs.existsSync(join(dir, "scripts", "check-links.mjs"))
        && fs.existsSync(join(dir, "mods", "more-agents", "catalog.js"))) return dir;
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  throw new Error("cannot find the checkout; run the smoke tests from the repository root");
}

const REPO = findRepo();
const links = await import(pathToFileURL(join(REPO, "scripts", "check-links.mjs")).href);
const { probeUrl, staleVerified } = links;

const okFetch = (status) => async () => ({ status });
{
  const ok = await probeUrl("https://example.test/ok", okFetch(200), 1000);
  assert.equal(ok.ok, true, "200");
  assert.equal(ok.status, 200);
  assert.equal(ok.via, "HEAD");

  const moved = await probeUrl("https://example.test/moved", okFetch(301), 1000);
  assert.equal(moved.ok, true, "301");
  assert.equal(moved.status, 301);

  let calls = 0;
  const missing = await probeUrl("https://example.test/missing", async () => {
    calls += 1;
    return { status: 404 };
  }, 1000);
  assert.equal(missing.ok, false, "404");
  assert.equal(missing.status, 404);
  assert.equal(missing.via, "HEAD");
  assert.equal(calls, 1, "404 does not fall back to GET");

  const fallback = await probeUrl("https://example.test/head-blocked", async (_url, opts) => {
    return { status: opts.method === "HEAD" ? 405 : 200 };
  }, 1000);
  assert.equal(fallback.ok, true, "405 then GET 200");
  assert.equal(fallback.status, 200);
  assert.equal(fallback.via, "GET");

  const hang = (_url, opts) => new Promise((_resolve, reject) => {
    const abort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
    if (opts.signal?.aborted) abort();
    else opts.signal.addEventListener("abort", abort, { once: true });
  });
  const timed = await probeUrl("https://example.test/slow", hang, 30);
  assert.equal(timed.ok, false, "timeout");
  assert.equal(timed.error, "timeout");
}
console.log("ok 1: status classification");

// A builtin's `source` has no public page: only its docs are requested.
{
  const seen = [];
  const report = await links.checkCatalog([
    { id: "g", status: "builtin", docs: "https://example.test/docs", source: "https://example.test/src" },
    { id: "v", status: "verified", checked: "2026-11-06", docs: "https://example.test/vd", source: "https://example.test/vs" },
  ], { today: "2026-11-06", fetchImpl: async (url) => { seen.push(url); return { status: 200 }; }, timeoutMs: 1000 });
  assert.ok(!seen.includes("https://example.test/src"), "builtin source is not requested");
  assert.ok(seen.includes("https://example.test/docs") && seen.includes("https://example.test/vs"), "docs and verified source are");
  assert.equal(report.links.length, 0);
}
console.log("ok 1b: builtin source skipped");

// 2026-11-06 minus 90 days is 2026-08-08. More than 90 days is a failure.
{
  const fresh = [{ id: "a", status: "verified", checked: "2026-08-08" }];
  assert.deepEqual(staleVerified(fresh, "2026-11-06"), []);
  const old = [{ id: "a", status: "verified", checked: "2026-08-07" }];
  assert.equal(staleVerified(old, "2026-11-06")[0].days, 91);
  const builtin = [{ id: "g", status: "builtin", checked: "2020-01-01" }];
  assert.deepEqual(staleVerified(builtin, "2026-11-06"), [], "builtin is not a freshness failure");
}
console.log("ok 2: 90-day boundary");

const run = (args) => {
  const r = spawnSync(process.execPath, [join(REPO, "scripts", "check-links.mjs"), ...args], {
    cwd: REPO,
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const writeCatalog = (name, entries) => {
  const file = join(HOME, `${name}.js`);
  fs.writeFileSync(file, `// fixture\nexport default ${JSON.stringify(entries, null, 2)};\n`);
  return file;
};

{
  const live = run(["--offline", "--today", "2026-11-06"]);
  assert.equal(live.status, 0, live.out);
  assert.match(live.out, /offline: network skipped/);
  assert.match(live.out, /0 stale/);

  const staleFile = writeCatalog("stale", [
    { id: "old", status: "verified", checked: "2026-08-07", docs: "https://example.test/d", source: "https://example.test/s" },
  ]);
  const stale = run(["--offline", "--today", "2026-11-06", staleFile]);
  assert.notEqual(stale.status, 0);
  assert.match(stale.out, /STALE old checked 2026-08-07 is 91 days old/);
  assert.match(stale.out, /offline: network skipped/);

  const edgeFile = writeCatalog("edge", [
    { id: "edge", status: "verified", checked: "2026-08-08" },
    { id: "ship", status: "builtin", checked: "2020-01-01" },
  ]);
  const edge = run(["--offline", "--today", "2026-11-06", edgeFile]);
  assert.equal(edge.status, 0, edge.out);
  assert.doesNotMatch(edge.out, /STALE/);
}
console.log("ok 3: --offline freshness");

// The community badge is its own note. It does not change the state line.
{
  const M = (await import("./main.js")).default;
  const { copyFor } = await import("./copy.js");
  const P = HOME + "/programs.json";
  fs.writeFileSync(P, JSON.stringify({ programs: {} }, null, 2));
  setShared("more-agents.keys", {});
  process.env.MA_ONPATH = "omp";
  process.env.MA_KNOWN_AGENTS = "";
  const spawned = [];
  const cx = { spawn: (f) => { spawned.push(f(cx)); }, notify() {} };
  const m = new M();
  m.init({}, cx);
  await Promise.all(spawned.splice(0));
  m.render();
  assert.ok(m.shown.includes("community"), "English badge");
  const row = m.shown.find((s) => typeof s === "string" && s.startsWith("dsh-TUI ::"));
  assert.ok(row, "dsh-TUI row");
  assert.doesNotMatch(row, /community/, "the state line does not absorb the badge");
  assert.equal(copyFor("es").community, "comunidad");
  m.lang = "es";
  m.copy = copyFor("es");
  m.render();
  assert.ok(m.shown.includes("comunidad"), "Spanish badge");
  const rowEs = m.shown.find((s) => typeof s === "string" && s.startsWith("dsh-TUI ::"));
  assert.doesNotMatch(rowEs, /comunidad/);
}
console.log("ok 4: community badge");

console.log("catalog-growth.test: OK");
