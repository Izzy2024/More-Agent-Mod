import fs from "node:fs";
export const HOME = process.env.MA_HOME;
const chain = () => { const p = new Proxy(function(){}, { get: (_t, k) => k === "then" ? undefined : (...a) => { for (const x of a) if (typeof x === "function" && k === "when") {} ; if (k==="when" && a[0]) a[1](p); if (k==="hover") a[0](p); return p; } }); return p; };
export class View {}
export const div = chain, v_flex = chain, h_flex = chain;
export const Input = { new: () => chain() };
export const InputState = { new: () => { let v = ""; const h = {}; return { value: () => v, set_value: (x) => { v = x; }, _set: (x) => { v = x; }, on: (e, f) => { h[e] = f; return true; }, _fire: (e) => h[e]?.({}, null), focused: false, focus() { this.focused = true; h.focus?.({}, null); } }; } };
export const appHome = () => HOME, home = () => "/home/u";
export const exec = async (c, a) => ({ code: 0, stdout: "omp\naider\n", stderr: "" });
export const readTextFile = async (p) => fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
export const writeTextFile = async (p, text, expected) => {
  const cur = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  if (cur !== expected) throw new Error("stale");
  fs.writeFileSync(p, text); return null;
};
export const knownAgents = async () => [{ key: "claude", run: ["claude"], installed: true }];
const sh = {}; export const shared = (k) => sh[k]; export const setShared = (k, v) => { sh[k] = v; };
export const theme = () => new Proxy({}, { get: () => "#000000" });
export const props = () => ({ overlay: "o1" }), closeOverlay = () => null;
export const notes = []; export const notify = (n) => { notes.push(n); return "n"; };
