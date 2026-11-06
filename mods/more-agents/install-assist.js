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
  new RegExp(`^npm (?:i|install) -g(?: --ignore-scripts)? ${PKG}(?: ${PKG})*$`),
  new RegExp(`^uv tool install ${PKG}(?: ${PKG})*$`),
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

// lane-guided: the tools an install command needs before it can run, in the
// order they appear. Only the first word of each ` && ` part counts, so
// `python -m pip install x` needs `python` (not `pip`) and a trailing
// `aider-install` needs nothing.
const INSTALL_TOOLS = ["npm", "python", "pip", "brew", "uv", "curl"];
export function requiredTools(install) {
  if (typeof install !== "string" || !install) return [];
  const tools = [];
  for (const part of install.split(" && ")) {
    const word = part.trim().split(/\s+/)[0];
    if (INSTALL_TOOLS.includes(word) && !tools.includes(word)) tools.push(word);
  }
  return tools;
}

// A tool is missing only when the login shell said so: an unknown tool
// (undefined) must never turn into a false alarm. `python3Only` means the
// installer wants `python` and the computer has `python3`, which is a hint,
// not a different requirement.
export function missingTools(install, onPath) {
  const path = onPath ?? {};
  return requiredTools(install)
    .filter((tool) => path[tool] === false)
    .map((tool) => ({ tool, python3Only: tool === "python" && path.python3 === true }));
}

// Where to get each tool. `id` selects the wording in copy.js; `url` is shown
// as plain text (never opened) and is null for a tool that ships with the
// system. `pip` uses the Python page: it is installed with Python.
export const TOOL_HELP = {
  npm: { id: "node", url: "https://nodejs.org" },
  python: { id: "python", url: "https://www.python.org/downloads/" },
  pip: { id: "python", url: "https://www.python.org/downloads/" },
  brew: { id: "brew", url: "https://brew.sh" },
  uv: { id: "uv", url: "https://docs.astral.sh/uv/" },
  curl: { id: "curl", url: null },
};

// The argv Herdr runs for the install: `sh -c` keeps the tab open after the
// command so its output can be read, then waits for Enter.
export function planInstall(agent) {
  const name = agent?.name ?? agent?.id ?? "the agent";
  if (!agent || typeof agent !== "object" || !isRunnableInstall(agent.install)) {
    // lane-i18n: `code` lets the dialog translate the reason; `error` keeps the
    // English text the tests use.
    return { ok: false, code: "no-install", name, error: `No install command that can run for ${name}.` };
  }
  const command = agent.install;
  const wrapped = `${command}; printf '\\n[finished - press Enter for a shell]\\n'; read _`;
  return { ok: true, command, argv: ["sh", "-c", wrapped], name: `Install ${name}` };
}
