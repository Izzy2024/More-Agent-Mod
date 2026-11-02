// Real shell PATH resolution: temp dirs on PATH, not stubs. Catches slow scans and
// RESOLVE_SH interpolation bugs that stubbed exec would miss.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ma-path-"));
const binDir = path.join(tmp, "bin");
const slowDir = path.join(tmp, "slow");
const emptyDir = path.join(tmp, "empty");
fs.mkdirSync(binDir, { recursive: true });
fs.mkdirSync(slowDir, { recursive: true });
fs.mkdirSync(emptyDir, { recursive: true });

fs.writeFileSync(path.join(binDir, "empryo"), "#!/bin/sh\necho ok\n", { mode: 0o755 });
// Many non-matching executables: a per-file PATH scan would blow the budget.
for (let i = 0; i < 500; i++) {
  fs.writeFileSync(path.join(slowDir, `tool-${i}`), "#!/bin/sh\necho x\n", { mode: 0o755 });
}

const testPath = `${binDir}:${slowDir}:${emptyDir}`;

const realExec = (cmd, args) => {
  // The temporary PATH has no /bin, so `sh` itself is resolved absolutely.
  const r = spawnSync(cmd === "sh" ? "/bin/sh" : cmd, args, {
    encoding: "utf8",
    env: { ...process.env, PATH: testPath },
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

const { resolveArgv0OnPath } = await import("./main.js");
const opts = { exec: realExec, windows: false };

let r = await resolveArgv0OnPath("empryo", opts);
assert.equal(r.status, "exact", "exact name on PATH");

r = await resolveArgv0OnPath("Empryro", opts);
assert.equal(r.status, "missing", "typo is missing, not case-corrected");

const t0 = performance.now();
r = await resolveArgv0OnPath("nope-xyz-abc", opts);
const ms = performance.now() - t0;
assert.equal(r.status, "missing", "unknown binary is missing");
assert.ok(ms < 300, `missing resolve took ${ms.toFixed(1)}ms, expected <300ms`);

// Windows: `where` returns the .EXE path and matching is case-insensitive.
{
  const where = (stdout) => async (cmd, args) => {
    assert.equal(cmd, "where");
    return { code: 0, stdout, stderr: "" };
  };
  assert.deepEqual(await resolveArgv0OnPath("empryo", { exec: where("C:\\bin\\EMPRYO.EXE\r\n"), windows: true }), { status: "exact" });
  assert.deepEqual(await resolveArgv0OnPath("empryo", { exec: where("C:\\bin\\other.exe\r\n"), windows: true }), { status: "missing" });
}

console.log(`path-resolve.test: exact/missing/windows OK; nope-xyz-abc=${ms.toFixed(1)}ms`);
