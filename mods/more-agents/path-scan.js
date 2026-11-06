// lane-fullpath: find a command in the usual per-user folders when the dialog's
// own lookup missed it. Pure data plus one `sh -c` probe; no gpui, no herdr.

// Folders an official installer uses but the app's PATH often misses. No nvm or
// other version-numbered folders: they move on every upgrade. The Python ones
// are globs, expanded by the script (the version changes).
export function commonDirs(home) {
  const h = String(home ?? "").replace(/[\\/]+$/, "");
  return [
    `${h}/.local/bin`,
    `${h}/.cargo/bin`,
    `${h}/.bun/bin`,
    `${h}/.deno/bin`,
    `${h}/go/bin`,
    `${h}/.npm-global/bin`,
    `${h}/.opencode/bin`,
    `${h}/.volta/bin`,
    `${h}/.yarn/bin`,
    `${h}/.local/share/pnpm`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    `${h}/Library/Python/*/bin`,
  ];
}

const shellQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
const CONTROL = /[\u0000-\u001f\u007f]/;

// A dir with "*" is expanded by the shell, so only its head is quoted. The
// wildcard tail stays unquoted on purpose; anything unusual is quoted whole.
function globWord(dir) {
  const at = String(dir).indexOf("*");
  const head = dir.slice(0, at);
  const tail = dir.slice(at);
  if (!/^[*/A-Za-z0-9._-]+$/.test(tail)) return shellQuote(dir);
  return `${shellQuote(head)}${tail}`;
}

// ONE sh -c script. The bins are positional ("$@"), never interpolated, so a
// hostile name is just a name. `continue 2` stops at the first hit per bin.
export function scanScript(dirs) {
  const list = Array.isArray(dirs) ? dirs.filter((d) => typeof d === "string" && d) : [];
  const fixed = list.filter((d) => !d.includes("*")).map(shellQuote);
  const globs = list.filter((d) => d.includes("*")).map(globWord);
  const lines = ["for b in \"$@\"; do"];
  if (fixed.length) {
    lines.push(`  for d in ${fixed.join(" ")}; do`);
  } else {
    lines.push("  for d in ''; do");
  }
  lines.push(
    "    if [ -f \"$d/$b\" ] && [ -x \"$d/$b\" ]; then",
    "      printf 'FOUND %s=%s\\n' \"$b\" \"$d/$b\"",
    "      continue 2",
    "    fi",
    "  done",
  );
  if (globs.length) {
    lines.push(
      `  for d in ${globs.join(" ")}; do`,
      "    if [ -f \"$d/$b\" ] && [ -x \"$d/$b\" ]; then",
      "      printf 'FOUND %s=%s\\n' \"$b\" \"$d/$b\"",
      "      continue 2",
      "    fi",
      "  done",
    );
  }
  lines.push("done");
  return lines.join("\n");
}

// Only exact FOUND <bin>=<absolute path> lines, first hit wins. Everything else
// (the exec stub prints other lines) is ignored.
export function parseScan(stdout) {
  const found = {};
  for (const raw of String(stdout ?? "").split("\n")) {
    const line = raw.replace(/\r$/, "");
    const match = /^FOUND ([^=\s]+)=(.+)$/.exec(line);
    if (!match) continue;
    const [, bin, path] = match;
    if (!path.startsWith("/") || CONTROL.test(path) || CONTROL.test(bin)) continue;
    if (!Object.prototype.hasOwnProperty.call(found, bin)) found[bin] = path;
  }
  return found;
}

// Never throws: Windows, a failed probe or no bins all give {}.
export async function scanFound(bins, { exec: execFn, home: homeDir, windows } = {}) {
  if (windows) return {};
  const list = [...new Set((Array.isArray(bins) ? bins : []).filter((bin) => typeof bin === "string" && bin))];
  if (!list.length || typeof execFn !== "function") return {};
  try {
    const result = await execFn("sh", ["-c", scanScript(commonDirs(homeDir)), "sh", ...list]);
    if (!result || result.code !== 0) return {};
    return parseScan(result.stdout);
  } catch {
    return {};
  }
}
