// Bridge installs: turn an agent's `bridge` catalog field into a dry-run plan.
// No gpui here: the dialog asks for the plan, shows it, and runs it only after
// an explicit confirm. The plan can only name bridges/<one-segment>/install.mjs
// under the checkout the dialog was loaded from.
import { readFile } from "fs/promises";

// Same shape the catalog validator enforces: "bridges/<id>". One segment, no
// dots that could climb out, no absolute path, no backslash.
const BRIDGE_RE = /^bridges\/[a-z0-9][a-z0-9._-]*$/;

const errText = (e) => String(e?.message ?? e);
const stripSlash = (path) => String(path).replace(/[\\/]+$/, "");
// `fs/promises` here has no `exists`, so a successful read is the check.
const defaultFileExists = async (path) => {
  try { await readFile(path); return true; } catch { return false; }
};

// The repo root of a checkout: <root>/mods/more-agents/main.js -> <root>.
// Anything else (an installed copy, a test temp folder) has no checkout to
// trust, so it gets null instead of a guess.
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

// What the dialog will show and, after the confirm, run. Never writes.
// `fileExists` and `dryRun` are injectable so tests stay off the real home.
export async function planBridge(agent, { repoRoot, dryRun = true, fileExists = defaultFileExists } = {}) {
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
  const script = `${root}/${bridge}/install.mjs`;
  let present = false;
  try {
    present = await fileExists(script);
  } catch {
    present = false;
  }
  if (!present) {
    return bridgeError(`The bridge installer was not found: ${script}. Nothing was run.`);
  }
  const dry = dryRun !== false;
  const argv = ["node", script, ...(dry ? ["--dry-run"] : [])];
  const name = String(agent?.name ?? agent?.id ?? "this agent").replace(/\s+/g, " ");
  const summary = `Dry run of the ${name} status bridge: node ${script}${dry ? " --dry-run" : ""} (shows the hook changes; writes nothing).`;
  return {
    ok: true,
    bridge,
    script,
    repoRoot: root,
    cwd: root,
    dryRun: dry,
    argv,
    summary,
    writesHome: !dry,
  };
}

// Rebuilds the one command a plan is allowed to run. A plan that was tampered
// with (another script, another cwd, an absolute path) is refused here too.
function checkedPlan(plan) {
  if (!plan || plan.ok !== true) return null;
  if (typeof plan.bridge !== "string" || plan.bridge.includes("..") || !BRIDGE_RE.test(plan.bridge)) return null;
  if (typeof plan.repoRoot !== "string") return null;
  const root = stripSlash(plan.repoRoot);
  if (!root) return null;
  const script = `${root}/${plan.bridge}/install.mjs`;
  if (plan.script !== script || plan.cwd !== plan.repoRoot) return null;
  const dry = plan.dryRun !== false;
  const argv = ["node", script, ...(dry ? ["--dry-run"] : [])];
  if (!Array.isArray(plan.argv) || plan.argv.length !== argv.length) return null;
  if (plan.argv.some((value, i) => value !== argv[i])) return null;
  return { argv, root, dry };
}

// Runs only that argv, from the checkout root. A failed run is not "installed".
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
    return bridgeError(`The bridge installer exited with code ${result.code}${detail ? `: ${detail}` : ""}. Nothing was installed.`);
  }
  return checked.dry
    ? { ok: true, installed: false, text: "Bridge dry run finished; nothing was written." }
    : { ok: true, installed: true, text: "Bridge installer finished." };
}
