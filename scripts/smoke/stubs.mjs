import fs from "node:fs";
// Test knobs (env): MA_HOME (sandbox dir), MA_SYS_HOME (fake OS home, drives the
// Windows detection), MA_ONPATH (binaries `command -v`/`where` finds, space separated),
// MA_KNOWN_AGENTS (names knownAgents reports as installed), MA_EXEC_FAIL=1 (detection
// throws), MA_FAIL_WRITE (comma-separated path fragments whose write throws).
export const HOME = process.env.MA_HOME;
const chain = () => { const p = new Proxy(function(){}, { get: (_t, k) => k === "then" ? undefined : (...a) => { for (const x of a) if (typeof x === "function" && k === "when") {} ; if (k==="when" && a[0]) a[1](p); if (k==="hover") a[0](p); return p; } }); return p; };
export class View {}
export const div = chain, v_flex = chain, h_flex = chain;
export const Input = { new: () => chain() };
export const InputState = { new: () => { let v = ""; const h = {}; return { value: () => v, set_value: (x) => { v = x; }, _set: (x) => { v = x; }, on: (e, f) => { h[e] = f; return true; }, _fire: (e) => h[e]?.({}, null), focused: false, focus() { this.focused = true; h.focus?.({}, null); } }; } };
export const appHome = () => HOME, home = () => process.env.MA_SYS_HOME ?? "/home/u";
const onPath = () => (process.env.MA_ONPATH ?? "omp aider").split(/\s+/).filter(Boolean);
const RESOLVE_MARK = "more-agents-resolve-argv0";
export const exec = async (c, a) => {
  if (process.env.MA_EXEC_FAIL === "1") throw new Error("spawn failed");
  const found = onPath();
  if (c === "sh" && typeof a[1] === "string" && a[1].includes(RESOLVE_MARK)) {
    const binary = a[3];
    if (found.includes(binary)) return { code: 0, stdout: "EXACT\n" };
    return { code: 0, stdout: "MISSING\n" };
  }
  // Windows: one `where` per binary. POSIX: one sh -c with the binaries as arguments.
  if (c === "where") {
    const b = a[0];
    if (found.includes(b)) return { code: 0, stdout: `${b}\n` };
    return { code: 1, stdout: "", stderr: "" };
  }
  const wanted = a.slice(3);
  const hits = wanted.filter((b) => found.includes(b));
  return { code: hits.length ? 0 : 1, stdout: hits.join("\n") + (hits.length ? "\n" : ""), stderr: "" };
};
export const readTextFile = async (p) => fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
export const writeTextFile = async (p, text, expected) => {
  const fails = (process.env.MA_FAIL_WRITE ?? "").split(",").filter(Boolean);
  if (fails.some((f) => p.includes(f))) { const e = new Error("EACCES: permission denied"); e.code = "EACCES"; throw e; }
  const cur = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  if (cur !== expected) throw new Error("stale");
  fs.writeFileSync(p, text); return null;
};
export const knownAgents = async () => (process.env.MA_KNOWN_AGENTS ?? "claude").split(/\s+/).filter(Boolean).map((k) => ({ key: k, run: [k], installed: true }));
const sh = {}; export const shared = (k) => sh[k]; export const setShared = (k, v) => { sh[k] = v; };
export const theme = () => new Proxy({}, { get: () => "#000000" });
export const props = () => ({ overlay: "o1" }), closeOverlay = () => null;
export const notes = []; export const notify = (n) => { notes.push(n); return "n"; };
