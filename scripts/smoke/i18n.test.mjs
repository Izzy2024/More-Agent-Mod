// LANE-I18N: with lang = "es" every message the dialog paints comes from
// copy.js (no English left in m.shown / m.msg), the choice survives a reopen,
// and EN/ES keep the same keys. English stays the default: gpui-kit exposes no
// system locale.
import fs from "node:fs";
import assert from "node:assert";
import { HOME, notes, ran, setShared, shared } from "./stubs.mjs";

const M = (await import("./main.js")).default;
const { copyFor, LANGS } = await import("./copy.js");

fs.mkdirSync(HOME, { recursive: true });
const P = HOME + "/programs.json";
const OWN = "more-agents.keys";
const LANG = "more-agents.lang";

// English tell-tales the Spanish copy must not leak. Identifiers, commands and
// file paths are lowercase (programs.json, npm i -g …), so case matters.
const ENGLISH = [
  "Nothing", "Could not", "Added", "Removed", "Cancelled", "Kept", "Saved",
  "already", "not found", "Check at least", "Saving",
];

async function boot({ programs, file, own, onPath = "omp aider", known = "claude", mode, lang, failWrite } = {}) {
  delete process.env.MA_FAIL_WRITE;
  delete process.env.MA_EXEC_FAIL;
  process.env.MA_ONPATH = onPath;
  process.env.MA_KNOWN_AGENTS = known;
  if (failWrite !== undefined) process.env.MA_FAIL_WRITE = failWrite;
  notes.length = 0;
  ran.length = 0;
  setShared(OWN, own);
  if (lang !== undefined) setShared(LANG, lang);
  for (const p of [P, P + ".more-agents.bak", P + ".more-agents.orig.bak"]) fs.rmSync(p, { force: true });
  if (file !== undefined) fs.writeFileSync(P, file);
  else if (programs !== undefined) fs.writeFileSync(P, JSON.stringify({ programs }, null, 2));
  if (mode != null) fs.chmodSync(P, mode);
  const spawned = [];
  const cx = { spawn: (f) => { spawned.push(f(cx)); }, notify() {} };
  const m = new M();
  m.init({}, cx);
  await Promise.all(spawned.splice(0));
  return { m, cx, drain: () => Promise.all(spawned.splice(0)) };
}

const read = () => JSON.parse(fs.readFileSync(P, "utf8"));
const painted = (m) => { m.render(); return [...m.shown, m.msg].join("\n"); };
function noEnglish(m, where) {
  const text = painted(m);
  for (const word of ENGLISH) {
    assert.ok(!text.includes(word), `${where}: English "${word}" leaked into:\n${text}`);
  }
}

// 1. EN and ES expose the same keys, with the same type for each.
{
  assert.deepEqual(LANGS, ["en", "es"]);
  const en = copyFor("en");
  const es = copyFor("es");
  for (const key of Object.keys(en)) {
    assert.ok(Object.prototype.hasOwnProperty.call(es, key), `ES is missing ${key}`);
    assert.equal(typeof es[key], typeof en[key], `${key} keeps its type`);
  }
  for (const key of Object.keys(es)) assert.ok(key in en, `EN is missing ${key}`);
  assert.equal(copyFor("fr"), en, "an unknown language falls back to English");
}
console.log("ok 1: EN/ES parity");

// 2. The language is persisted with setShared and read back in init; nothing
//    else from the dialog is persisted.
{
  const { m } = await boot({ programs: {}, lang: "en" });
  assert.equal(m.lang, "en");
  m.setLang("es");
  assert.equal(shared(LANG), "es", "the choice is persisted");
  const next = await boot({ programs: {} }); // no lang: init reads the saved value
  assert.equal(next.m.lang, "es", "a new view keeps the language");
  assert.equal(next.m.copy.title, copyFor("es").title);
  assert.equal(next.m.inputs.search.value(), "", "the search text is not persisted");
  assert.equal(shared(OWN), undefined, "only the language is written here");
}
console.log("ok 2: language persistence");

// 3. Add: ready and pending agents.
{
  const { m, cx, drain } = await boot({ programs: {}, onPath: "omp", lang: "es" });
  m.selected.add("omp");
  m.addSelected(cx);
  await drain();
  assert.equal(m.msgLevel, "success");
  assert.match(m.msg, /^omp: ya aparece en el menú \+\.$/);
  assert.equal(notes.at(-1).title, "Más agentes");
  assert.equal(notes.at(-1).body, "Añadidos 1");
  noEnglish(m, "add one");
}
{
  const { m, cx, drain } = await boot({ programs: {}, onPath: "omp", lang: "es" });
  m.selected.add("kilo");
  m.addSelected(cx);
  await drain();
  assert.equal(m.msgLevel, "warning", "a pending install is a warning");
  assert.match(m.msg, /^Añadido kilo; aparecerá en el menú \+ cuando `kilo` esté en tu PATH/);
  assert.match(m.msg, /npm install -g @kilocode\/cli/, "the catalog hint stays as is");
  assert.equal(notes.at(-1).body, "Añadidos 1; 1 necesita instalarse");
  noEnglish(m, "add with warning");
}
// An agent already in the file is reported in Spanish and needs no write.
{
  const { m, cx, drain } = await boot({ programs: { kilo: { run: ["kilo"] } }, lang: "es" });
  m.addEntries([["kilo", { run: ["kilo"] }]], cx);
  await drain();
  assert.equal(m.msgLevel, "warning");
  assert.match(m.msg, /^Ya están en tu programs\.json \(sin tocar\): kilo\.$/);
  noEnglish(m, "already in file");
}
console.log("ok 3: add messages");

// 4. Remove, and a remove that needs the extra confirmation.
{
  const { m, cx, drain } = await boot({ programs: {}, onPath: "omp", lang: "es" });
  m.selected.add("omp");
  m.addSelected(cx);
  await drain();
  m.remove(["omp"], cx);
  await drain();
  assert.equal(m.msgLevel, "success");
  assert.match(m.msg, /^Eliminados de tu programs\.json: omp\.$/);
  noEnglish(m, "remove");
}
{
  const { m, cx, drain } = await boot({ programs: {}, onPath: "omp", lang: "es" });
  m.selected.add("omp");
  m.addSelected(cx);
  await drain();
  const edited = read();
  edited.programs.omp.name = "Edited";
  fs.writeFileSync(P, JSON.stringify(edited, null, 2));
  m.remove(["omp"], cx);
  await drain();
  assert.equal(m.confirm?.kind, "remove");
  assert.equal(m.msgLevel, "warning");
  assert.match(m.msg, /^Cambió desde que se añadió \(o la propiedad es desconocida\): omp\. No se eliminó nada\.$/);
  noEnglish(m, "remove needs confirm");
  m.resolveConfirm(false, cx);
  assert.equal(m.msg, "Conservado.");
  assert.equal(m.msgLevel, "info");
}
console.log("ok 4: remove messages");

// 5. Broken files: the banner heading and body are translated.
{
  const { m } = await boot({ file: "SECRET-not-json", mode: 0, lang: "es" });
  try {
    assert.match(m.error, /No se pudo leer/);
    assert.match(m.error, /EACCES|permission/i, "the OS reason is kept");
    assert.equal(m.msg, "", "the banner is not repeated in the status line");
    m.render();
    assert.ok(m.shown.includes("No se puede leer programs.json"));
    assert.ok(!painted(m).includes("Could not"));
  } finally {
    fs.chmodSync(P, 0o644);
  }
}
{
  const { m } = await boot({ file: "{", lang: "es" });
  assert.match(m.error, /^programs\.json no es JSON válido: /);
  m.render();
  assert.ok(m.shown.includes("JSON no válido"));
  const shape = await boot({ file: "[]\n", lang: "es" });
  assert.match(shape.m.error, /^programs\.json debe ser un objeto JSON/);
  shape.m.render();
  assert.ok(shape.m.shown.includes("Estructura inesperada"));
  noEnglish(m, "invalid JSON");
}
console.log("ok 5: load errors");

// 6. Custom form errors.
{
  const { m, cx, drain } = await boot({ programs: {}, onPath: "omp", lang: "es" });
  const submit = async (key, run) => {
    m.inputs.key._set(key);
    m.inputs.name._set("");
    m.inputs.run._set(run);
    m.addCustom(cx);
    await drain();
  };
  await submit("Bad Key", "whatever");
  assert.equal(m.invalidField, "key");
  assert.match(m.msg, /^Clave no válida: minúsculas, dígitos/);
  noEnglish(m, "invalid key");

  await submit("shell", "whatever");
  assert.match(m.msg, /^"shell" es una clave de programa reservada \(shell, program, agent\)\.$/);

  await submit("foo-continue", "foo");
  assert.match(m.msg, /reservadas para las variantes del catálogo/);

  await submit("ok-key", "");
  assert.match(m.msg, /^Falta el comando\.$/);

  await submit("ok-key", `foo "bar`);
  assert.match(m.msg, /^Hay una comilla doble sin cerrar en el comando\.$/);
  m.inputs.run._set("foo 'bar");
  assert.match(m.runPreview().error, /^Hay una comilla simple sin cerrar en el comando\.$/);
  noEnglish(m, "custom form errors");
}
console.log("ok 6: custom form errors");

// 7. PATH-missing question, cancel, and the saved note.
{
  const { m, cx, drain } = await boot({ programs: {}, onPath: "omp", lang: "es" });
  m.inputs.key._set("ghost-agent");
  m.inputs.run._set("ghost-cmd");
  m.addCustom(cx);
  await drain();
  assert.equal(m.confirm?.kind, "path-missing");
  assert.equal(m.msgLevel, "warning");
  assert.match(m.msg, /^`ghost-cmd` no está en tu PATH, así que no aparecerá en el menú \+ hasta que exista\. ¿Añadirlo igualmente\?$/);
  noEnglish(m, "path missing");

  m.resolveConfirm(false, cx);
  await drain();
  assert.equal(m.msg, "Cancelado.");
  assert.equal(m.msgLevel, "info");

  m.addCustom(cx);
  await drain();
  m.resolveConfirm(true, cx);
  await drain();
  assert.equal(m.msgLevel, "warning", "the missing PATH keeps the warning");
  assert.match(m.msg, /^Guardado ghost-agent en tu programs\.json\./);
  assert.match(m.msg, /`ghost-cmd` no está en tu PATH/);
  assert.match(m.msg, /^.*Panel de agentes: si no informa OSC 7501, necesita un bridge de estado/);
  assert.deepEqual(read().programs["ghost-agent"].run, ["ghost-cmd"]);
  noEnglish(m, "add anyway");
}
console.log("ok 7: path-missing confirm");

// 8. Overwrite question, keep, and the saved message.
{
  const { m, cx, drain } = await boot({ programs: {}, onPath: "omp", lang: "es" });
  m.inputs.key._set("omp");
  m.inputs.run._set("omp");
  m.addCustom(cx);
  await drain();
  assert.equal(m.confirm?.kind, "overwrite");
  assert.match(m.msg, /^"omp" ya está en el catálogo: ¿lo sobrescribes o lo dejas como está\?$/);
  noEnglish(m, "overwrite question");

  m.resolveConfirm(false, cx);
  assert.match(m.msg, /^Se conserva el "omp" existente\.$/);
  assert.equal(m.msgLevel, "info");

  m.inputs.key._set("omp");
  m.inputs.run._set("omp");
  m.addCustom(cx);
  await drain();
  m.resolveConfirm(true, cx);
  await drain();
  assert.match(m.msg, /^Guardado omp en tu programs\.json\./);
  noEnglish(m, "overwrite confirmed");
}
console.log("ok 8: overwrite confirm");

// 9. Repair rows: the banner, the notes and the button are translated; the
//    English text built from copy is still byte-identical to repair.js.
const REPAIR_PROGRAMS = {
  omp: { name: "Oh My Pi", run: ["omp"], match: ["omp"] },
  "command-code": { run: ["cmd"], match: ["cmd", "command-code"] },
  cursor: { name: "Cursor Agent", run: ["cursor-agent"], match: ["cursor", "cursor-agent", "agent"] },
  "empryro-agent": { name: "Empryro", run: ["Empryro"] },
  "empryo-agent": { name: "Empryo", run: ["empryo"], match: ["empryo", "em"] },
};
const REPAIR_OWN = { "empryro-agent": "fnv1a:0dc89610" };
{
  const { m } = await boot({ programs: REPAIR_PROGRAMS, own: REPAIR_OWN, lang: "es" });
  const text = painted(m);
  assert.ok(text.includes("Reparaciones para programs.json (no se escribe nada hasta que confirmes)"));
  assert.ok(text.includes("es integrado, pero su match incluye el token exacto"));
  assert.ok(text.includes("run/match usan el token"));
  assert.ok(text.includes("parece una errata de empryo-agent"));
  noEnglish(m, "repair rows");
}
{
  const { m } = await boot({ programs: REPAIR_PROGRAMS, own: REPAIR_OWN, lang: "en" });
  const proposals = m.scanRepairs();
  assert.equal(proposals.length, 3);
  for (const p of proposals) assert.equal(m.repairText(p), p.message, `EN ${p.code} is byte-identical`);
  assert.equal(m.repairText({ message: "fallback" }), "fallback", "an unknown code falls back");
}
console.log("ok 9: repair rows");

// 10. The install-assist banner.
{
  const { m } = await boot({ programs: {}, onPath: "omp aider", lang: "es" });
  const text = painted(m);
  assert.ok(text.includes("2 agentes instalados no están en tu menú +: omp, aider"), text);
  noEnglish(m, "detected plural");
  const one = await boot({ programs: { aider: { run: ["aider"] } }, onPath: "omp aider", lang: "es" });
  assert.ok(painted(one.m).includes("1 agente instalado no está en tu menú +: omp"));
}
console.log("ok 10: detected banner");

// 11. Install confirm, cancel, started, and the refusal.
{
  const { m, cx, drain } = await boot({ programs: {}, onPath: "omp", lang: "es" });
  const aider = m.agentOf("aider");
  assert.equal(m.previewInstall(aider, cx), true);
  assert.match(m.msg, /^¿Instalar Aider\? Se ejecuta en una pestaña nueva: python -m pip install aider-install && aider-install$/);
  noEnglish(m, "install confirm");

  m.resolveConfirm(false, cx);
  assert.equal(m.msg, "Cancelado.");
  assert.equal(ran.length, 0, "cancel runs nothing");

  m.previewInstall(aider, cx);
  m.resolveConfirm(true, cx);
  await drain();
  assert.equal(ran.length, 1);
  assert.match(m.msg, /^Instalando Aider en una pestaña nueva; pulsa Volver a comprobar al terminar\.$/);
  noEnglish(m, "install started");

  assert.equal(m.previewInstall(m.agentOf("trae-agent"), cx), false);
  assert.equal(m.msgLevel, "error");
  assert.match(m.msg, /^No hay un comando de instalación que se pueda ejecutar para Trae Agent\.$/);
}
console.log("ok 11: install confirm");

// 12. Switching language rebuilds an error already on screen.
{
  const { m } = await boot({ file: "{", lang: "es" });
  assert.match(m.error, /no es JSON válido/);
  m.setLang("en");
  assert.match(m.error, /is not valid JSON/);
  assert.equal(m.errorHeading(), "Invalid JSON");
  m.setLang("es");
  assert.match(m.error, /no es JSON válido/);
  assert.equal(m.errorHeading(), "JSON no válido");
}
console.log("ok 12: an on-screen error follows the language");

// 13. No saved value, no locale API: English is the default.
{
  setShared(LANG, undefined);
  const { m } = await boot({ programs: {} });
  assert.equal(m.lang, "en", "English by default");
  assert.equal(m.copy.title, copyFor("en").title);
}
console.log("ok 13: English default");

console.log("i18n.test: LANE-I18N OK");
