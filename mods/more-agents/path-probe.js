// lane-path: probe binaries the way Herdr's + menu does.
//
// Herdr starts a program through the user's LOGIN INTERACTIVE shell
// (`/bin/zsh -lic '"$@"' zsh <argv>`), so an agent is "installed" when that
// shell finds it. The mod's own exec() runs with the Herdr app's PATH, which is
// shorter (no ~/.cargo/bin, no ~/.opencode/bin, no ~/Library/Python/3.9/bin…),
// so probing that way says "not installed" for agents the + menu would start.
// Pure module: no gpui/herdr imports, so node can test it on its own.

// The tools the install assist needs to know about; probed in the same call.
export const INSTALL_TOOLS = ["npm", "python", "python3", "pip", "brew", "uv", "curl"];

const BEGIN = "__MA_BEGIN__";
const END = "__MA_END__";
// The shells Herdr may start programs with. Anything else falls back to `sh`.
const SHELL_NAMES = new Set(["zsh", "bash", "fish", "sh", "dash", "ksh"]);
// The fallback: the app's own PATH, one lookup per name, no per-file forks.
const SH_LOOP = 'for b in "$@"; do command -v "$b" >/dev/null 2>&1 && echo "$b"; done';

// POSIX single quotes: everything inside is literal, and a quote is '\''.
const quote = (s) => `'${s.split("'").join("'\\''")}'`;

// ONE script for `-c`: markers around one `command -v` per name. sh, bash, zsh
// and fish 3+ all understand it (no arrays, no [[). A name with a newline, a
// carriage return or a NUL cannot be quoted safely, so it is left out: it can
// never be a real command anyway.
export function loginProbeScript(bins) {
  const lines = [`printf '${BEGIN}\\n'`];
  for (const b of bins ?? []) {
    if (typeof b !== "string" || !b || /[\n\r\0]/.test(b)) continue;
    lines.push(`command -v ${quote(b)} >/dev/null 2>&1 && printf 'FOUND %s\\n' ${quote(b)}`);
  }
  lines.push(`printf '${END}\\n'`);
  return lines.join("\n");
}

// The names between the two markers, and only those: an rc file may print a
// banner before the first marker or after the last one. No marker, no answer.
export function parseProbe(stdout) {
  const text = String(stdout ?? "");
  const begin = text.indexOf(BEGIN);
  if (begin < 0) return null;
  const end = text.indexOf(END, begin + BEGIN.length);
  if (end < 0) return null;
  const found = new Set();
  for (const raw of text.slice(begin + BEGIN.length, end).split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("FOUND ")) found.add(line.slice("FOUND ".length));
  }
  return found;
}

// $SHELL, but only one this module can drive: an absolute path to a known
// shell. Anything else (unset, a wrapper, a relative path) means "no login
// shell", and the probe falls back to `sh -c`.
export async function pickShell(execFn) {
  try {
    const r = await execFn("sh", ["-c", 'printf %s "$SHELL"']);
    const path = String(r?.stdout ?? "").trim();
    if (!path.startsWith("/") || /\s/.test(path)) return null;
    const base = path.slice(path.lastIndexOf("/") + 1);
    return SHELL_NAMES.has(base) ? path : null;
  } catch {
    return null;
  }
}

// { ok, found, via }: `ok: false` means "could not check" (the dialog says so
// instead of guessing), never "not installed". Never throws.
export async function probeBinaries(bins, { exec: execFn, windows } = {}) {
  const list = [...new Set((bins ?? []).filter((b) => typeof b === "string" && b))];
  // Windows has no login shell to ask: `where` per name, as before.
  if (windows) {
    const found = new Set();
    for (const b of list) {
      try { if ((await execFn("where", [b]))?.code === 0) found.add(b); } catch {}
    }
    return { ok: true, found, via: "where" };
  }
  const shell = await pickShell(execFn);
  if (shell) {
    try {
      const r = await execFn(shell, ["-lic", loginProbeScript(list)]);
      const found = parseProbe(r?.stdout);
      if (found) return { ok: true, found, via: "login" };
    } catch {}
  }
  // No login shell, or it failed or printed nothing usable: the app's own PATH,
  // which is what the dialog used before this lane.
  try {
    const r = await execFn("sh", ["-c", SH_LOOP, "sh", ...list]);
    const found = new Set(String(r?.stdout ?? "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    return { ok: true, found, via: "sh" };
  } catch {
    return { ok: false, found: new Set(), via: "sh" };
  }
}
