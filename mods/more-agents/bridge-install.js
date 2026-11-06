// Bridge plans: status, dry run, install or uninstall for one adapter. No gpui
// here: the dialog asks for a plan, shows it, and runs it only after an explicit
// confirm. A plan can only name bridges/<one-segment>/install.mjs under the
// resolved root.
import { readFile } from "fs/promises";

// Same shape the catalog validator enforces: "bridges/<id>". One segment, no
// dots that could climb out, no absolute path, no backslash.
const BRIDGE_RE = /^bridges\/[a-z0-9][a-z0-9._-]*$/;
// The only four things the dialog may run. Each one is one argv shape.
const ACTIONS = new Set(["status", "preview", "install", "uninstall"]);
const FLAGS = { status: ["--status"], preview: ["--dry-run"], install: [], uninstall: ["--uninstall"] };

const errText = (e) => String(e?.message ?? e);
const stripSlash = (path) => String(path).replace(/[\\/]+$/, "");
// `fs/promises` here has no `exists`, so a successful read is the check.
const defaultFileExists = async (path) => {
  try { await readFile(path); return true; } catch { return false; }
};

// The folder above mods/more-agents: <root>/mods/more-agents/main.js -> <root>.
// A checkout keeps bridges/ there; an installed copy keeps them inside the mod
// folder, which planBridge tries next. Anything else (a test temp folder) has
// no checkout to trust, so it gets null instead of a guess.
export function repoRootFrom(importMetaUrl) {
  let path = String(importMetaUrl ?? "");
  if (path.startsWith("file://")) path = path.slice("file://".length);
  try { path = decodeURIComponent(path); } catch {}
  path = path.replace(/[\\/][^\\/]*$/, ""); // drop main.js
  if (!/[\\/]mods[\\/]more-agents$/.test(path)) return null;
  path = path.replace(/[\\/]mods[\\/]more-agents$/, "");
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1); // file:///C:/... -> C:/...
  return stripSlash(path) || null;
}

function bridgeError(error) {
  return { ok: false, error };
}

// A plan's action. `dryRun` stays understood so older callers keep meaning:
// dryRun: false is an install, anything else a preview.
function actionOf(action, dryRun) {
  if (ACTIONS.has(action)) return action;
  return dryRun === false ? "install" : "preview";
}

function argvFor(script, action) {
  return ["node", script, ...FLAGS[action]];
}

// What the dialog will show and, after the confirm, run. Never writes.
// `fileExists`, `action` and `dryRun` are injectable so tests stay off the real home.
export async function planBridge(agent, { repoRoot, action, dryRun, fileExists = defaultFileExists } = {}) {
  const bridge = agent?.bridge;
  if (typeof bridge !== "string" || !bridge.startsWith("bridges/")) {
    return bridgeError("This agent has no status bridge in the catalog. Nothing was run.");
  }
  if (bridge.includes("..") || !BRIDGE_RE.test(bridge)) {
    return bridgeError(`The catalog's bridge path is not safe: ${JSON.stringify(bridge)}. Nothing was run.`);
  }
  const root = stripSlash(repoRoot ?? "");
  if (!root || typeof repoRoot !== "string") {
    return bridgeError("This dialog was not loaded from a checkout, so it cannot find the bridge installers. Nothing was run.");
  }
  // A checkout keeps bridges/ at the root; an installed copy keeps it next to
  // main.js. Try the checkout layout first, then the installed one.
  const candidates = [root, `${root}/mods/more-agents`];
  let found = null;
  for (const candidate of candidates) {
    const script = `${candidate}/${bridge}/install.mjs`;
    let present = false;
    try {
      present = await fileExists(script);
    } catch {
      present = false;
    }
    if (present) { found = { root: candidate, script }; break; }
  }
  if (!found) {
    return bridgeError(`The bridge installer was not found: neither ${candidates[0]}/${bridge}/install.mjs nor ${candidates[1]}/${bridge}/install.mjs exists. Nothing was run.`);
  }
  const act = actionOf(action, dryRun);
  const script = found.script;
  const argv = argvFor(script, act);
  const name = String(agent?.name ?? agent?.id ?? "this agent").replace(/\s+/g, " ");
  const target = `the ${name} status bridge`;
  const summary = act === "status"
    ? `Reading ${target}: node ${script} --status (read-only).`
    : act === "install"
      ? `Installing ${target}: node ${script} (runs the installer and changes that agent's hooks).`
      : act === "uninstall"
        ? `Removing ${target}: node ${script} --uninstall (changes that agent's hooks).`
        : `Dry run of ${target}: node ${script} --dry-run (shows the hook changes; writes nothing).`;
  return {
    ok: true,
    bridge,
    script,
    repoRoot: found.root,
    cwd: found.root,
    action: act,
    dryRun: act === "preview",
    argv,
    summary,
    writesHome: act === "install" || act === "uninstall",
  };
}

// Rebuilds the one command a plan is allowed to run. A plan that was tampered
// with (another script, another argv, another cwd) is refused here too.
function checkedPlan(plan) {
  if (!plan || plan.ok !== true) return null;
  if (typeof plan.bridge !== "string" || plan.bridge.includes("..") || !BRIDGE_RE.test(plan.bridge)) return null;
  if (typeof plan.repoRoot !== "string") return null;
  const root = stripSlash(plan.repoRoot);
  if (!root) return null;
  const script = `${root}/${plan.bridge}/install.mjs`;
  if (plan.script !== script || plan.cwd !== plan.repoRoot) return null;
  const action = actionOf(plan.action, plan.dryRun);
  const argv = argvFor(script, action);
  if (!Array.isArray(plan.argv) || plan.argv.length !== argv.length) return null;
  if (plan.argv.some((value, i) => value !== argv[i])) return null;
  return { argv, root, action };
}

// The one line `--status` prints. Anything else is refused, never "installed".
function parseStatus(stdout) {
  const lines = String(stdout ?? "").trim().split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) return bridgeError("The bridge status did not print exactly one JSON line; nothing was read.");
  let status;
  try {
    status = JSON.parse(lines[0]);
  } catch {
    return bridgeError("The bridge status is not valid JSON; nothing was read.");
  }
  if (!status || typeof status !== "object" || Array.isArray(status)
    || typeof status.app !== "string" || typeof status.installed !== "boolean") {
    return bridgeError("The bridge status is missing app or installed; nothing was read.");
  }
  return { ok: true, status };
}

// Runs only that argv, from the resolved root. A failed run is not "installed".
export async function runBridgePlan(plan, { exec: execFn } = {}) {
  const checked = checkedPlan(plan);
  if (!checked) return bridgeError("The bridge plan is not valid; nothing was run.");
  if (typeof execFn !== "function") return bridgeError("Could not run the bridge installer: no exec function. Nothing was installed.");
  const [command, ...args] = checked.argv;
  let result;
  try {
    result = await execFn(command, args, { cwd: checked.root });
  } catch (e) {
    return bridgeError(`Could not run the bridge installer: ${errText(e)}. Nothing was installed.`);
  }
  if (!result || typeof result.code !== "number") {
    return bridgeError("The bridge installer returned no exit code. Nothing was installed.");
  }
  if (result.code !== 0) {
    const detail = String(result.stderr ?? "").trim().split("\n")[0].slice(0, 200);
    const suffix = checked.action === "status" ? "Nothing was read."
      : checked.action === "uninstall" ? "Nothing was removed." : "Nothing was installed.";
    return bridgeError(`The bridge installer exited with code ${result.code}${detail ? `: ${detail}` : ""}. ${suffix}`);
  }
  if (checked.action === "status") {
    const parsed = parseStatus(result.stdout);
    if (!parsed.ok) return parsed;
    return {
      ok: true,
      installed: parsed.status.installed,
      status: parsed.status,
      text: `Bridge status: ${parsed.status.installed ? "installed" : "not installed"}.`,
    };
  }
  if (checked.action === "preview") return { ok: true, installed: false, text: "Bridge dry run finished; nothing was written." };
  if (checked.action === "uninstall") return { ok: true, installed: false, text: "Bridge uninstaller finished." };
  return { ok: true, installed: true, text: "Bridge installer finished." };
}
