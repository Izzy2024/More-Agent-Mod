// lane-path: the probe that asks the login shell, the way Herdr's + menu starts
// a program. Pure module: quoting, marker parsing, shell picking, fallback order,
// Windows, and one real login shell.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert";
import { spawnSync } from "node:child_process";

const { INSTALL_TOOLS, loginProbeScript, parseProbe, pickShell, probeBinaries } = await import("./path-probe.js");

// 1. The install tools ride along in the same call.
assert.deepEqual(INSTALL_TOOLS, ["npm", "python", "python3", "pip", "brew", "uv", "curl"]);
console.log("ok 1: install tools");

// 2. One script, markers around one lookup per name, every name quoted.
{
  const script = loginProbeScript([
    "omp", "my tool", "it's", "omp; touch /tmp/pwned", "$(touch /tmp/pwned2)",
    "bad\nname", "bad\0name", "", null, 7,
  ]);
  assert.ok(script.startsWith("printf '__MA_BEGIN__\\n'\n"), "opens by printing the marker");
  assert.ok(script.endsWith("\nprintf '__MA_END__\\n'"), "closes by printing the marker");
  assert.ok(script.includes("command -v 'omp' >/dev/null 2>&1 && printf 'FOUND %s\\n' 'omp'"));
  assert.ok(script.includes("'my tool'"), "a space stays inside the quotes");
  assert.ok(script.includes("'it'\\''s'"), "a quote is escaped as '\\''");
  assert.ok(script.includes("'omp; touch /tmp/pwned'"), "a hostile name stays quoted");
  assert.ok(script.includes("'$(touch /tmp/pwned2)'"), "a substitution stays quoted");
  assert.ok(!script.includes("bad\nname"), "a name with a newline is left out");
  assert.equal(script.split("command -v ").length - 1, 5, "one lookup per usable name");
}
console.log("ok 2: script quoting");

// 3. That script really runs in sh: found names are reported, hostile ones never run.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ma-probe-"));
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(bin);
  for (const name of ["tool-a", "my tool", "it's"]) {
    fs.writeFileSync(path.join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  const pwned = [path.join(tmp, "pwned"), path.join(tmp, "pwned2")];
  const names = ["tool-a", "my tool", "it's", `omp; touch ${pwned[0]}`, `$(touch ${pwned[1]})`, "missing-bin", "bad\nname"];
  const r = spawnSync("/bin/sh", ["-c", loginProbeScript(names)], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin` },
  });
  const found = parseProbe(r.stdout);
  assert.deepEqual([...found].sort(), ["it's", "my tool", "tool-a"].sort(), "exactly the names that exist");
  for (const p of pwned) assert.equal(fs.existsSync(p), false, "a hostile name never runs");
}
console.log("ok 3: the script in a real sh");

// 4. Only what sits between the markers counts: an rc file may print anything.
{
  const noisy = "last login: today\nFOUND ghost-before\n__MA_BEGIN__\nFOUND omp\nFOUND my tool\n__MA_END__\nFOUND ghost-after\n";
  assert.deepEqual([...parseProbe(noisy)].sort(), ["my tool", "omp"]);
  assert.deepEqual([...parseProbe("__MA_BEGIN__\n__MA_END__")], [], "nothing found is an empty set");
  assert.deepEqual([...parseProbe("__MA_BEGIN__\r\nFOUND omp\r\n__MA_END__\r\n")], ["omp"], "CRLF output");
  assert.equal(parseProbe("no markers here\nFOUND omp"), null, "no begin marker");
  assert.equal(parseProbe("__MA_BEGIN__\nFOUND omp"), null, "no end marker");
  assert.equal(parseProbe(""), null);
  assert.equal(parseProbe(null), null);
}
console.log("ok 4: marker parsing");

// 5. $SHELL is used only when it is an absolute path to a shell we can drive.
{
  const answers = (stdout) => async (cmd, args) => {
    assert.equal(cmd, "sh");
    assert.deepEqual(args, ["-c", 'printf %s "$SHELL"']);
    return { code: 0, stdout };
  };
  assert.equal(await pickShell(answers("/bin/zsh\n")), "/bin/zsh");
  assert.equal(await pickShell(answers("/usr/local/bin/fish")), "/usr/local/bin/fish");
  assert.equal(await pickShell(answers("/usr/bin/env")), null, "not a shell");
  assert.equal(await pickShell(answers("zsh")), null, "not absolute");
  assert.equal(await pickShell(answers("")), null, "unset");
  assert.equal(await pickShell(answers("/bin /zsh")), null, "whitespace is not a path");
  assert.equal(await pickShell(async () => { throw new Error("spawn failed"); }), null);
}
console.log("ok 5: shell picking");

// 6. Login first, `sh -c` second, "could not check" only when both fail.
{
  const calls = [];
  const login = async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd === "sh" && args[1].includes("$SHELL")) return { code: 0, stdout: "/bin/zsh" };
    if (cmd === "/bin/zsh" && args[0] === "-lic") return { code: 0, stdout: "__MA_BEGIN__\nFOUND omp\n__MA_END__\n" };
    throw new Error(`unexpected ${cmd} ${args.join(" ")}`);
  };
  const r = await probeBinaries(["omp", "kilo"], { exec: login, windows: false });
  assert.equal(r.ok, true);
  assert.equal(r.via, "login");
  assert.deepEqual([...r.found], ["omp"]);
  assert.deepEqual(calls.at(-1), { cmd: "/bin/zsh", args: ["-lic", loginProbeScript(["omp", "kilo"])] }, "one login call for the whole list");

  // A login shell that throws falls back to the app's own PATH.
  const fallbackCalls = [];
  const thrown = async (cmd, args) => {
    fallbackCalls.push({ cmd, args });
    if (cmd === "sh" && args[1].includes("$SHELL")) return { code: 0, stdout: "/bin/bash" };
    if (cmd === "/bin/bash") throw new Error("login shell failed");
    return { code: 0, stdout: "omp\n" };
  };
  const f = await probeBinaries(["omp", "kilo"], { exec: thrown, windows: false });
  assert.equal(f.via, "sh");
  assert.deepEqual([...f.found], ["omp"]);
  const loop = fallbackCalls.at(-1);
  assert.equal(loop.cmd, "sh");
  assert.equal(loop.args[0], "-c");
  assert.deepEqual(loop.args.slice(3), ["omp", "kilo"], "the names travel as arguments");

  // A login shell that prints no markers (a broken rc file) is not an answer.
  const silent = async (cmd, args) => {
    if (cmd === "sh" && args[1].includes("$SHELL")) return { code: 0, stdout: "/bin/zsh" };
    if (cmd === "/bin/zsh") return { code: 1, stdout: "rc banner\n" };
    return { code: 0, stdout: "kilo\n" };
  };
  const s = await probeBinaries(["kilo"], { exec: silent, windows: false });
  assert.equal(s.via, "sh");
  assert.deepEqual([...s.found], ["kilo"]);

  // No usable $SHELL: straight to the fallback.
  const noShell = async (cmd, args) => (args[1].includes("$SHELL") ? { code: 0, stdout: "" } : { code: 0, stdout: "omp\n" });
  assert.equal((await probeBinaries(["omp"], { exec: noShell, windows: false })).via, "sh");

  // Both fail: "could not check", never "not installed".
  const dead = async () => { throw new Error("spawn failed"); };
  const d = await probeBinaries(["omp"], { exec: dead, windows: false });
  assert.equal(d.ok, false);
  assert.equal(d.via, "sh");
  assert.deepEqual([...d.found], []);
}
console.log("ok 6: login then fallback then could not check");

// 7. Windows keeps `where` per binary, and a failing `where` is "not found".
{
  const calls = [];
  const where = async (cmd, args) => {
    calls.push({ cmd, args });
    if (cmd !== "where") throw new Error(`unexpected ${cmd}`);
    return args[0] === "omp" ? { code: 0, stdout: "C:\\bin\\omp.exe\r\n" } : { code: 1, stdout: "" };
  };
  const r = await probeBinaries(["omp", "kilo"], { exec: where, windows: true });
  assert.equal(r.ok, true);
  assert.equal(r.via, "where");
  assert.deepEqual([...r.found], ["omp"]);
  assert.deepEqual(calls.map((c) => c.args[0]), ["omp", "kilo"]);

  const boom = async () => { throw new Error("no where"); };
  const b = await probeBinaries(["omp"], { exec: boom, windows: true });
  assert.equal(b.ok, true);
  assert.deepEqual([...b.found], []);
}
console.log("ok 7: windows where");

// 8. A real login shell. A temp HOME with an rc file puts a temp dir on its
// PATH (/etc/zprofile rebuilds PATH first, so the rc file is what makes this
// deterministic), and a hostile name must not run.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ma-login-"));
  const bin = path.join(tmp, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "ma-login-only"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const line = `export PATH="$PATH:${bin}"\n`;
  for (const rc of [".zshrc", ".zprofile", ".bash_profile", ".bashrc", ".profile"]) {
    fs.writeFileSync(path.join(tmp, rc), line);
  }
  const shell = ["/bin/zsh", "/bin/bash"].find((p) => fs.existsSync(p));
  if (!shell) {
    console.log("ok 8: no login shell on this machine, skipped");
  } else {
    const pwned = path.join(tmp, "pwned");
    const realExec = (cmd, args) => {
      const r = spawnSync(cmd, args, {
        encoding: "utf8",
        env: { ...process.env, HOME: tmp, SHELL: shell, PATH: "/usr/bin:/bin" },
      });
      return { code: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
    };
    const r = await probeBinaries(["ma-login-only", "ma-no-such-bin-xyz", `omp; touch ${pwned}`], { exec: realExec, windows: false });
    assert.equal(r.ok, true, "the probe answered");
    assert.ok(r.found.has("ma-login-only"), `the login shell sees the temp binary (via ${r.via})`);
    assert.ok(!r.found.has("ma-no-such-bin-xyz"), "a missing name stays missing");
    assert.equal(fs.existsSync(pwned), false, "a hostile name never runs");
    console.log(`ok 8: a real login shell (${shell}, via ${r.via})`);
  }
}

console.log("path-probe.test: LANE-PATH OK");
