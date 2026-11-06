// lane-install: pure logic for the install assist. No gpui/herdr imports: the
// dialog passes the catalog, the parsed programs table and the PATH map in, so
// every decision here is testable without a window. scripts/validate-catalog.mjs
// imports the same isRunnableInstall(), so the catalog and the dialog share ONE
// rule for what an `install` string may contain.

const PKG = "[A-Za-z0-9@][A-Za-z0-9@._/+:-]*";
const WORD = "[A-Za-z0-9][A-Za-z0-9._-]*";
const URL = "https://[A-Za-z0-9][A-Za-z0-9.-]*(?::[0-9]+)?/[A-Za-z0-9._~%/-]*";

// Full command shapes. Anything a shell could chain on (`;`, `&`, `$(`, `>`,
// `<`, a second `|`…) cannot survive these patterns.
const SHAPES = [
  new RegExp(`^npm (?:i|install) -g ${PKG}(?: ${PKG})*$`),
  new RegExp(`^(?:python -m pip|pip) install ${PKG}(?: ${PKG})*$`),
  new RegExp(`^brew install ${PKG}(?: ${PKG})*$`),
  new RegExp(`^curl -(?:fsSL|LsSf) ${URL} \\| (?:sh|bash)$`),
];
// The documented `pip install aider-install && aider-install` runs the tool the
// first command just installed: only a "<name>-install" word may follow `&&`.
const BARE = new RegExp(`^${WORD}-install$`);

const hasRun = (entry) => Array.isArray(entry?.run) && entry.run.length > 0;

// Catalog agents that are installed but have no programs.json entry yet: the
// ones the + menu cannot show until they are added.
export function detectedAgents(catalog, programs, onPath) {
  const table = programs ?? {};
  const path = onPath ?? {};
  return (catalog ?? []).filter((a) =>
    a?.status === "verified"
    && typeof a.run?.[0] === "string"
    && path[a.run[0]] === true
    && !hasRun(table[a.id]));
}

// "aider, goose, +3": the banner stays on one line however long the list is.
export function formatDetected(agents, max = 2) {
  const ids = (agents ?? []).map((a) => a.id).filter((id) => typeof id === "string");
  const head = ids.slice(0, max);
  const rest = ids.length - head.length;
  return rest > 0 ? `${head.join(", ")}, +${rest}` : head.join(", ");
}

// One or more simple commands joined by " && ". Only the part after the first
// may be a bare word (the documented `pip install aider-install && aider-install`).
export function isRunnableInstall(text) {
  if (typeof text !== "string" || !text || text !== text.trim()) return false;
  if (/[\n\r\t]/.test(text)) return false;
  const parts = text.split(" && ");
  return parts.every((part, i) =>
    SHAPES.some((re) => re.test(part)) || (i === 1 && BARE.test(part)));
}

// The argv Herdr runs for the install: `sh -c` keeps the tab open after the
// command so its output can be read, then waits for Enter.
export function planInstall(agent) {
  const name = agent?.name ?? agent?.id ?? "the agent";
  if (!agent || typeof agent !== "object" || !isRunnableInstall(agent.install)) {
    return { ok: false, error: `No install command that can run for ${name}.` };
  }
  const command = agent.install;
  const wrapped = `${command}; printf '\\n[finished - press Enter to close]\\n'; read _`;
  return { ok: true, command, argv: ["sh", "-c", wrapped], name: `Install ${name}` };
}
