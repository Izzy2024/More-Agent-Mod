// Repair proposals for programs.json entries that no longer match the catalog.
// Pure data helpers: no gpui-kit, no herdr. scan() never mutates its input; the
// dialog applies one proposal at a time after its own confirmation.

// Shells: never worth launching as an agent by accident.
const SHELLS = new Set(["cmd", "command", "powershell", "bash", "sh", "zsh"]);

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const runOf = (entry) => (Array.isArray(entry?.run) && entry.run.length ? entry.run : null);
const tokens = (list) => (Array.isArray(list) ? list : []);
const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// True when a and b differ by exactly one insertion, deletion or substitution.
export function oneEditApart(a, b) {
  if (a === b) return false;
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  if (l.length - s.length > 1) return false;
  let i = 0;
  while (i < s.length && s[i] === l[i]) i++;
  if (s.length === l.length) return s.slice(i + 1) === l.slice(i + 1);
  return s.slice(i) === l.slice(i + 1);
}

// ownedKeys may be the ownership map, its keys, or a Set of them.
function ownedSet(ownedKeys) {
  if (ownedKeys instanceof Set) return ownedKeys;
  if (Array.isArray(ownedKeys)) return new Set(ownedKeys);
  if (isObject(ownedKeys)) return new Set(Object.keys(ownedKeys));
  return new Set();
}

// The catalog command and match replace the entry's; nothing else is touched.
function updated(entry, agent) {
  return { ...entry, run: [...agent.run], ...(agent.match ? { match: [...agent.match] } : {}) };
}

export function scan(programs, catalog, ownedKeys = []) {
  const table = isObject(programs) ? programs : {};
  const list = Array.isArray(catalog) ? catalog : [];
  const owned = ownedSet(ownedKeys);
  const ids = new Set(list.map((a) => a?.id).filter((id) => typeof id === "string"));
  const out = [];

  for (const a of list) {
    if (!a || typeof a.id !== "string" || !Array.isArray(a.run) || !a.run.length) continue;
    if (a.status === "unverified") continue; // no trustworthy command to repair to
    const entry = table[a.id];
    if (!isObject(entry)) continue;
    const run = runOf(entry);
    if (!run || typeof run[0] !== "string") continue;

    // cursor is builtin: the personal entry is not ours to rewrite.
    if (a.status === "builtin" && tokens(entry.match).includes("agent")) {
      out.push({
        kind: "warn",
        key: a.id,
        reason: "match-agent",
        message: `${a.id} is builtin, but its match lists the exact token "agent": Herdr may route generic agent launches to it. This mod did not write it; fix it by hand.`,
      });
      continue;
    }

    // Command Code: `cmd` is the Windows shell, not the CLI. The catalog
    // documents the real command, so this one is worth an update proposal.
    if (a.id === "command-code" && (run[0] === "cmd" || tokens(entry.match).includes("cmd"))) {
      out.push({
        kind: "update",
        key: a.id,
        run: [...a.run],
        match: a.match ? [...a.match] : null,
        entry: updated(entry, a),
        reason: "shell-token",
        message: `${a.id}: run/match use the Windows shell token "cmd"; the catalog command is ${a.run.join(" ")}. Repair asks before writing.`,
      });
      continue;
    }

    if (sameList(run, a.run)) continue; // already the catalog command: nothing to say

    if (SHELLS.has(run[0])) {
      out.push({
        kind: "warn",
        key: a.id,
        reason: "shell",
        message: `${a.id}: run starts with the shell ${JSON.stringify(run[0])}, not the catalog command ${a.run.join(" ")}. Left as is; fix it by hand.`,
      });
    } else if (owned.has(a.id)) {
      out.push({
        kind: "update",
        key: a.id,
        run: [...a.run],
        match: a.match ? [...a.match] : null,
        entry: updated(entry, a),
        reason: "owned-drift",
        message: `${a.id}: this mod wrote run ${JSON.stringify(run)}, the catalog now documents ${JSON.stringify(a.run)}. Repair asks before writing.`,
      });
    } else {
      out.push({
        kind: "warn",
        key: a.id,
        reason: "differs",
        message: `${a.id}: run is ${JSON.stringify(run)}, the catalog documents ${JSON.stringify(a.run)}. This mod did not write it; it is left as is.`,
      });
    }
  }

  // A custom key one edit away from another custom key, whose command is not a
  // plausible lowercase binary, is the typo; the lowercase neighbour is the
  // correction and is never proposed for removal.
  const custom = Object.keys(table).filter((k) => !ids.has(k) && isObject(table[k]) && runOf(table[k]));
  for (const key of custom.sort()) {
    const run = runOf(table[key]);
    if (typeof run[0] !== "string" || run[0] === run[0].toLowerCase()) continue;
    for (const other of custom) {
      if (other === key) continue;
      const otherRun = runOf(table[other]);
      if (typeof otherRun[0] !== "string" || otherRun[0] !== otherRun[0].toLowerCase()) continue;
      if (!oneEditApart(key, other)) continue;
      if (!oneEditApart(run[0].toLowerCase(), otherRun[0].toLowerCase())) continue;
      out.push({
        kind: "remove",
        key,
        neighbor: other,
        owned: owned.has(key),
        message: `${key}: run ${JSON.stringify(run[0])} looks like a typo of ${other} (run ${JSON.stringify(otherRun[0])}). Remove the typo only; ${other} is left as is.`,
      });
      break;
    }
  }
  return out;
}
