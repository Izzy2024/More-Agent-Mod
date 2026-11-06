// lane-catalog (fix/catalog-ux): dialog copy, English and Spanish.
//
// English is the default, and its strings are byte for byte the ones the dialog
// already painted, so the smoke tests that match them keep passing. `copyFor()`
// falls back to English for anything that is not "es".
//
// Scope: only the chrome this lane owns lives here — the header, the search box,
// the list's labels and the status-bridge notes. The messages the write paths
// build (added / saved / removed / row badges) still live in main.js, whose
// regions this lane may not reflow, and they stay English for now.
export const LANGS = ["en", "es"];
export const DEFAULT_LANG = "en";

const EN = {
  title: "More agents for the + menu",
  writes: (path) => `Writes to ${path}; after a successful save the previous version goes to programs.json.more-agents.bak (best-effort: a backup failure is reported, not blocking the write). Herdr reloads it by itself.`,
  agents: "Agents",
  close: "Close",
  reload: "Reload",
  search: "Search by name, key or command",
  searchNoMatch: "No agent matches that search.",
  sectionReady: "Ready to add",
  sectionInstall: "Needs install",
  sectionAdded: "Already in your + menu",
  sectionBuiltin: "Ships with Herdr",
  addOwn: "Add your own agent...",
  continueLabel: 'Also add the "continue" variant (if it has one)',
  add: (n) => (n ? `Add ${n}` : "Add"),
  hint: "Custom agent · Tab: search, continue, Add, this form, Remove, Close (no wrap) · ↓ from search, then ↑/↓ and Space/Enter: agents · Enter in the command adds it",
  key: "Key",
  name: "Display name",
  command: "Command",
  run: "run:",
  notOnPath: (bin) => `\`${bin}\` is not on your PATH`,
  saving: "Saving…",
  overwrite: "Overwrite",
  removeAnyway: "Remove anyway",
  addAnyway: "Add anyway",
  keep: "Keep",
  keepAsIs: "Keep as is",
  cancel: "Cancel",
  dryRun: "Run dry run",
  bridgeCatalog: (name, bridge, docs) => `Agents panel: ${name} needs the status bridge ${bridge} — see ${docs}.`,
  bridgeCustom: (docs) => `Agents panel: if it does not report OSC 7501, it needs a status bridge — see ${docs}.`,
  // lane-bridge
  bridge: "Bridge",
  bridgeInstall: "Install bridge",
  bridgeRemove: "Remove bridge",
  bridgeInstalled: "installed",
  bridgeNotInstalled: "not installed",
  bridgePrompt: (action, name, file, command, summary) => {
    const verb = action === "install" ? "Install" : action === "uninstall" ? "Remove" : "Dry run";
    return `${verb} the ${name} status bridge? Hook file: ${file}. Command: ${command}. ${summary}`;
  },
  // lane-install
  install: "Install",
  installConfirm: (name, command) => `Install ${name}? This runs in a new tab: ${command}`,
  installStarted: (name) => `Installing ${name} in a new tab; press Re-check when it finishes.`,
  detected: (n, list) => `${n} installed ${n === 1 ? "agent is" : "agents are"} not in your + menu: ${list}`,
  addAll: "Add all",
  recheck: "Re-check",
};

const ES = {
  title: "Más agentes para el menú +",
  writes: (path) => `Escribe en ${path}; tras guardar, la versión anterior va a programs.json.more-agents.bak (mejor esfuerzo: si la copia falla se avisa, pero no bloquea la escritura). Herdr lo recarga solo.`,
  agents: "Agentes",
  close: "Cerrar",
  reload: "Recargar",
  search: "Buscar por nombre, clave o comando",
  searchNoMatch: "Ningún agente coincide con esa búsqueda.",
  sectionReady: "Listos para añadir",
  sectionInstall: "Hay que instalarlos",
  sectionAdded: "Ya están en tu menú +",
  sectionBuiltin: "Vienen con Herdr",
  addOwn: "Añadir tu propio agente...",
  continueLabel: 'Añadir también la variante "continue" (si la tiene)',
  add: (n) => (n ? `Añadir ${n}` : "Añadir"),
  hint: "Agente propio · Tab: búsqueda, continue, Añadir, este formulario, Remove, Cerrar (sin vuelta) · ↓ desde la búsqueda, luego ↑/↓ y Espacio/Intro: agentes · Intro en el comando lo añade",
  key: "Clave",
  name: "Nombre visible",
  command: "Comando",
  run: "run:",
  notOnPath: (bin) => `\`${bin}\` no está en tu PATH`,
  saving: "Guardando…",
  overwrite: "Sobrescribir",
  removeAnyway: "Eliminar igualmente",
  addAnyway: "Añadir igualmente",
  keep: "Conservar",
  keepAsIs: "Dejarlo como está",
  cancel: "Cancelar",
  dryRun: "Probar sin escribir",
  bridgeCatalog: (name, bridge, docs) => `Panel de agentes: ${name} necesita el bridge de estado ${bridge} — ver ${docs}.`,
  bridgeCustom: (docs) => `Panel de agentes: si no informa OSC 7501, necesita un bridge de estado — ver ${docs}.`,
  // lane-bridge
  bridge: "Bridge",
  bridgeInstall: "Instalar bridge",
  bridgeRemove: "Quitar bridge",
  bridgeInstalled: "instalado",
  bridgeNotInstalled: "no instalado",
  bridgePrompt: (action, name, file, command, summary) => {
    const title = action === "install" ? `¿Instalar el bridge de estado de ${name}?`
      : action === "uninstall" ? `¿Quitar el bridge de estado de ${name}?`
        : `¿Probar sin escribir el bridge de estado de ${name}?`;
    return `${title} Archivo de hooks: ${file}. Comando: ${command}. ${summary}`;
  },
  // lane-install
  install: "Instalar",
  installConfirm: (name, command) => `¿Instalar ${name}? Se ejecuta en una pestaña nueva: ${command}`,
  installStarted: (name) => `Instalando ${name} en una pestaña nueva; pulsa Volver a comprobar al terminar.`,
  detected: (n, list) => `${n} ${n === 1 ? "agente instalado no está" : "agentes instalados no están"} en tu menú +: ${list}`,
  addAll: "Añadir todos",
  recheck: "Volver a comprobar",
};

export function copyFor(lang) {
  return lang === "es" ? ES : EN;
}
