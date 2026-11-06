// LANE-REPAIR: scan() proposes repairs for entries that no longer match the
// catalog and never mutates programs.json; a proposal is only written after the
// existing confirm + edit(). The shipped snippet must not keep `cmd`.
import fs from "node:fs";
import assert from "node:assert";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOME, setShared, shared } from "./stubs.mjs";

const M = (await import("./main.js")).default;
const CATALOG = (await import("./catalog.js")).default;
const { scan, oneEditApart } = await import("./repair.js");

fs.mkdirSync(HOME, { recursive: true });
const P = HOME + "/programs.json";
const OWN = "more-agents.keys";

// The real problem entries: Command Code on the Windows shell, the Empryro
// typo next to the good key, and cursor's `agent` match.
const fixture = () => ({
  omp: { name: "Oh My Pi", run: ["omp"], match: ["omp"] },
  "command-code": { run: ["cmd"], match: ["cmd", "command-code"] },
  cursor: { name: "Cursor Agent", run: ["cursor-agent"], match: ["cursor", "cursor-agent", "agent"] },
  "empryro-agent": { name: "Empryro", run: ["Empryro"] },
  "empryo-agent": { name: "Empryo", run: ["empryo"], match: ["empryo", "em"] },
});
const ownership = { "empryro-agent": "fnv1a:0dc89610" };

async function boot({ programs, own } = {}) {
  delete process.env.MA_FAIL_WRITE;
  process.env.MA_ONPATH = "omp aider";
  process.env.MA_KNOWN_AGENTS = "claude";
  setShared(OWN, own);
  fs.rmSync(P, { force: true });
  fs.rmSync(P + ".more-agents.bak", { force: true });
  if (programs !== undefined) fs.writeFileSync(P, JSON.stringify({ programs }, null, 2));
  const spawned = [];
  const cx = { spawn: (f) => { spawned.push(f(cx)); }, notify: () => {} };
  const m = new M();
  m.init({}, cx);
  await Promise.all(spawned.splice(0));
  return { m, cx, drain: () => Promise.all(spawned.splice(0)) };
}
const read = () => JSON.parse(fs.readFileSync(P, "utf8"));

// 1. Three proposals, and the input object is untouched.
{
  const programs = fixture();
  const before = JSON.stringify(programs);
  const proposals = scan(programs, CATALOG, ownership);
  assert.equal(JSON.stringify(programs), before, "scan() must not mutate programs");

  const update = proposals.find((p) => p.kind === "update");
  assert.equal(update?.key, "command-code");
  assert.deepEqual(update.run, ["command-code"], "catalog run");
  assert.deepEqual(update.match, ["cmdc", "command-code"], "catalog match, no cmd");
  assert.deepEqual(update.entry.run, ["command-code"], "proposed entry uses the catalog run");
  assert.deepEqual(update.entry.match, ["cmdc", "command-code"]);

  const remove = proposals.find((p) => p.kind === "remove");
  assert.equal(remove?.key, "empryro-agent");
  assert.equal(remove.neighbor, "empryo-agent");
  assert.equal(remove.owned, true);

  const warn = proposals.find((p) => p.kind === "warn");
  assert.equal(warn?.key, "cursor");
  assert.equal(warn.reason, "match-agent");

  assert.equal(proposals.length, 3, "exactly the three problems");
  assert.ok(!proposals.some((p) => p.key === "omp"), "a matching run proposes nothing");
  assert.ok(!proposals.some((p) => p.key === "empryo-agent"), "the good key is never rewritten");
}
console.log("ok R1.1: scan proposes update/remove/warn without mutating");

// 2. The exact token matters: `cursor-agent` alone is not `agent`, and a match
//    token of `cmd` is enough for the Command Code update even with a good run.
{
  const programs = { cursor: { run: ["cursor-agent"], match: ["cursor-agent"] } };
  assert.equal(scan(programs, CATALOG, []).length, 0, "no substring match for agent");
  const cc = { "command-code": { run: ["command-code"], match: ["cmd", "cmdc"] } };
  const p = scan(cc, CATALOG, []);
  assert.equal(p.length, 1);
  assert.equal(p[0].kind, "update");
  assert.deepEqual(p[0].entry.run, ["command-code"]);
  assert.deepEqual(p[0].entry.match, ["cmdc", "command-code"]);
}
console.log("ok R1.2: token-level detection");

// 3. A user-owned run that differs from the catalog is a warning, not an update;
//    the same key written by this mod is an update proposal.
{
  const user = { aider: { run: ["my-aider"] } };
  const p = scan(user, CATALOG, []);
  assert.deepEqual(p.map((x) => [x.kind, x.key]), [["warn", "aider"]], "user entry: warn only");
  const mine = scan(user, CATALOG, { aider: null });
  assert.deepEqual(mine.map((x) => [x.kind, x.key]), [["update", "aider"]], "mod entry: update proposal");
  assert.equal(oneEditApart("empryro", "empryo"), true);
  assert.equal(oneEditApart("empryo", "empryo"), false);
}
console.log("ok R1.3: ownership decides update vs warn");

// 4. The shipped snippet dropped `cmd` as a match token.
{
  const find = (name) => {
    for (const start of [process.env.MA_REPO, process.env.INIT_CWD, process.env.PWD, process.cwd(), dirname(fileURLToPath(import.meta.url))]) {
      if (!start) continue;
      let dir = resolve(start);
      for (let i = 0; i < 6; i++) {
        const p = join(dir, name);
        if (fs.existsSync(p)) return p;
        const up = dirname(dir);
        if (up === dir) break;
        dir = up;
      }
    }
    return null;
  };
  const file = find("programs.snippet.json");
  if (file) {
    const snippet = JSON.parse(fs.readFileSync(file, "utf8"));
    const match = snippet.programs["command-code"].match;
    assert.ok(!match.includes("cmd"), "snippet must not ship the Windows shell token");
    assert.ok(match.includes("cmdc") && match.includes("command-code"), "the real aliases stay");
  } else {
    console.log("skip: programs.snippet.json not reachable from this copy (set MA_REPO)");
  }
}
console.log("ok R1.4: snippet has no cmd token");

// 5. Applying goes through the existing confirm and edit(), one proposal at a time.
{
  const { m, cx, drain } = await boot({ programs: fixture(), own: ownership });
  const before = read();
  assert.equal(m.scanRepairs().length, 3);
  m.render();
  assert.ok(m.shown.includes("Repairs for programs.json (nothing is written until you confirm)"), "banner painted");
  assert.ok(m.shown.includes("button:repair-command-code"));
  assert.ok(m.shown.includes("button:repair-empryro-agent"));
  assert.ok(!m.shown.includes("button:repair-cursor"), "a warning has no Repair button");

  const update = m.scanRepairs().find((p) => p.kind === "update");
  assert.equal(m.askRepair(update, cx), true);
  assert.equal(m.confirm?.kind, "overwrite", "reuses the existing confirm");
  await drain();
  assert.deepEqual(read(), before, "nothing is written before the confirm");

  m.resolveConfirm(true, cx);
  await drain();
  const t = read();
  assert.deepEqual(t.programs["command-code"].run, ["command-code"]);
  assert.deepEqual(t.programs["command-code"].match, ["cmdc", "command-code"]);
  assert.ok(!t.programs["command-code"].match.includes("cmd"));
  assert.ok(!m.scanRepairs().some((p) => p.key === "command-code"), "the proposal is gone");

  const remove = m.scanRepairs().find((p) => p.kind === "remove");
  assert.equal(m.askRepair(remove, cx), true);
  assert.equal(m.confirm?.kind, "remove", "reuses Remove anyway / Keep");
  m.resolveConfirm(true, cx);
  await drain();
  const t2 = read();
  assert.ok(!t2.programs["empryro-agent"], "the typo is removed");
  assert.deepEqual(t2.programs["empryo-agent"], fixture()["empryo-agent"], "the good key is untouched");
  assert.ok(!shared(OWN)["empryro-agent"], "ownership dropped with the typo");
  assert.deepEqual(t2.programs.cursor, fixture().cursor, "a warn is never written");
  assert.equal(m.askRepair(m.scanRepairs().find((p) => p.kind === "warn"), cx), false);
  assert.equal(m.busy, false);
}
console.log("ok R1.5: confirm + edit() applies one repair");

// 6. A typo the mod did not write is proposed but never removed by the mod.
{
  const { m, cx, drain } = await boot({ programs: fixture(), own: {} });
  const remove = m.scanRepairs().find((p) => p.kind === "remove");
  assert.equal(remove.owned, false);
  assert.equal(m.askRepair(remove, cx), false);
  await drain();
  assert.ok(read().programs["empryro-agent"], "unowned entry kept");
  assert.match(m.msg, /did not write/i);
  assert.equal(m.confirm, null);
}
console.log("ok R1.6: the mod does not delete what it did not write");

console.log("repair.test: LANE-REPAIR OK");
