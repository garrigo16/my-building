// config.js - la identidad de quien usa el Edificio, en UN sitio: <repo>/config.local.json (fuera de git; plantilla en
// config.ejemplo.json). Aquí NO van secretos: los tokens siguen en ~/.config/*.env (ver .env.example).
//
// De dónde sale cada valor, por orden:
//   1. config.local.json (o el fichero que diga EDIFICIO_CONFIG);
//   2. para los IDs de Slack, ~/.config/canal-slack.env (SLACK_HUMANO_ID, SLACK_CLAUDE_ID, SLACK_COO_ID, SLACK_CURSOR_ID,
//      SLACK_CANAL_ID), que la escucha y los scripts ya necesitan;
//   3. los valores de ejemplo de abajo (IDs de mentira: son los que usan las pruebas).
// Las pruebas ponen EDIFICIO_CONFIG=ninguno: solo valen los de ejemplo, haya lo que haya en el equipo.
//
// Uso desde Node:  const C = require("../herramientas/config.js").config();
// Uso desde Bash:  . "$AQUI/config.sh"      (exporta EDIFICIO_NOMBRE, CANAL_RAMA, CANAL2_RAMA, SLACK_WS_URL… si no estaban ya)
// A mano:          node herramientas/config.js          (enseña lo que vale ahora y lo que sigue de ejemplo; sin secretos)
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");

const EJEMPLO = {
  persona: { nombre: "Humano", slackId: "UHUMANO0001" },
  slack: {
    espacio: "https://ocaglobal-grupo.slack.com", canalId: "CCANAL00001", canalNombre: "canal-humano",
    ias: { claude: "UCLAUDE0001", coo: "UCOO0000001", cursor: "UCURSOR0001" },
  },
  canalGit: {
    repoLocal: "~/Documents/Oca Global Repository/oca-salesforce",
    repoUrl: "https://bitbucket.org/oca-global/oca-salesforce",
    bitbucket: "oca-global/oca-salesforce",
    // el primero es el canal principal (el tuyo); el segundo, si lo hay, un canal compartido de proyecto
    canales: [
      { nombre: "principal", rama: "canal/humano/claude-cursor", fichero: "CANAL_CLAUDE_CURSOR.md" },
      { nombre: "proyecto", rama: "canal/proyecto/compartido", fichero: "CANAL_PROYECTO.md" },
    ],
  },
  jira: { sitio: "https://ocaglobal.atlassian.net" },
  codex: { activo: false, modelo: "" },   // Codex como IA del canal git (herramientas/lanzar-codex.sh)
};

const casa = (p) => String(p || "").replace(/^~(?=$|[\\/])/, os.homedir().split(path.sep).join("/"));
function lee(f) { try { return JSON.parse(fs.readFileSync(f, "utf8").replace(/^\uFEFF/, "")); } catch (e) { return null; } }
function leeEnv(f) {
  const o = {};
  try { for (const l of fs.readFileSync(f, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)=(.*)$/); if (m) o[m[1]] = m[2].trim().replace(/^["']|["']$/g, ""); } } catch (e) {}
  return o;
}
function mezcla(a, b) {   // lo de b gana; los objetos se mezclan, las listas se sustituyen enteras; "" o null no pisan
  if (Array.isArray(b)) return b.length ? b : a;
  if (b && typeof b === "object" && a && typeof a === "object" && !Array.isArray(a)) { const o = { ...a }; for (const k of Object.keys(b)) o[k] = mezcla(a[k], b[k]); return o; }
  return b === undefined || b === null || b === "" ? a : b;
}

function config(o = {}) {
  const fich = o.fichero || process.env.EDIFICIO_CONFIG || path.join(__dirname, "..", "config.local.json");
  const solo = fich === "ninguno";
  const local = solo ? null : lee(fich);
  const env = solo ? {} : leeEnv(o.env || path.join(os.homedir(), ".config", "canal-slack.env"));
  const deEnv = { persona: { slackId: env.SLACK_HUMANO_ID }, slack: { canalId: env.SLACK_CANAL_ID, ias: { claude: env.SLACK_CLAUDE_ID, coo: env.SLACK_COO_ID, cursor: env.SLACK_CURSOR_ID } } };
  const c = mezcla(mezcla(EJEMPLO, deEnv), local || {});
  c.canalGit.repoLocalPuesto = !!(local && local.canalGit && local.canalGit.repoLocal);
  c.canalGit.repoLocal = casa(c.canalGit.repoLocal);
  // Listas a medida de cada persona. Con config.local.json, lo que no pongas queda VACÍO (sin reglas de nadie). Sin fichero
  // (pruebas, modo demo) valen null: el código usa entonces sus reglas de ejemplo.
  const lo = (local && local.oficina) || {}, lista = (x) => (Array.isArray(x) ? x : local ? [] : null);
  c.oficina = { proyectos: lista(lo.proyectos), temas: lista(lo.temas), visitantes: lista(lo.visitantes), appId: lo.appId || env.OFICINA_APP_ID || "" };
  c.coordinadores = lista(local && local.coordinadores);
  // cada canal tiene su worktree en la carpeta de usuario: el primero, wt-canal-claude; los demás, wt-<nombre>-claude
  c.canalGit.canales = c.canalGit.canales.map((x, i) => ({ ...x, worktree: i === 0 ? "wt-canal-claude" : "wt-" + x.nombre + "-claude" }));
  // dónde está este repo (se detecta: es la carpeta de arriba) y cómo llama Claude Code a su carpeta de chats
  c.edificio = { carpeta: path.join(__dirname, ".."), proyectoClaude: path.resolve(__dirname, "..").replace(/[^A-Za-z0-9]/g, "-") };
  c.origen = { fichero: local ? fich : null, env: Object.keys(env).length > 0 };
  return c;
}

// para Bash: una línea por valor, que lo exporta solo si no venía ya del entorno
function paraBash(c) {
  const p = c.canalGit.canales[0] || {}, s = c.canalGit.canales[1] || {};
  const v = {
    EDIFICIO_NOMBRE: c.persona.nombre, SLACK_WS_URL: c.slack.espacio, SLACK_CANAL_NOMBRE: c.slack.canalNombre,
    CANAL_RAMA: p.rama, CANAL_FICHERO: p.fichero, CANAL2_NOMBRE: s.nombre, CANAL2_RAMA: s.rama || "-", CANAL2_FICHERO: s.fichero,
    CODEX_ACTIVO: c.codex.activo ? "1" : "", CODEX_MODELO: c.codex.modelo,
    CANAL_REPO: c.canalGit.repoLocalPuesto ? c.canalGit.repoLocal : "", CANAL_REPO_URL: c.canalGit.repoUrl, BB_REPO: c.canalGit.bitbucket, JIRA_SITE: c.jira.sitio,
  };
  // los IDs de Slack, solo si alguien los ha puesto (los de ejemplo no se exportan: los scripts miran si faltan)
  const ids = { SLACK_HUMANO_ID: [c.persona.slackId, EJEMPLO.persona.slackId], SLACK_CANAL_ID: [c.slack.canalId, EJEMPLO.slack.canalId],
    SLACK_CLAUDE_ID: [c.slack.ias.claude, EJEMPLO.slack.ias.claude], SLACK_COO_ID: [c.slack.ias.coo, EJEMPLO.slack.ias.coo], SLACK_CURSOR_ID: [c.slack.ias.cursor, EJEMPLO.slack.ias.cursor] };
  for (const [k, [x, ej]] of Object.entries(ids)) if (x && x !== ej) v[k] = x;
  return Object.entries(v).filter(([, x]) => x).map(([k, x]) => `[ -n "\${${k}:-}" ] || export ${k}='${String(x).replace(/'/g, "'\\''")}'`).join("\n");
}

module.exports = { config, paraBash, EJEMPLO };

if (require.main === module) {
  const c = config();
  if (process.argv.includes("--sh")) console.log(paraBash(c));
  else {
    console.log(c.origen.fichero ? "Leo " + c.origen.fichero : "No hay config.local.json: copia config.ejemplo.json a config.local.json y rellénalo.");
    console.log(JSON.stringify({ ...c, origen: undefined }, null, 2));
    const falta = [];
    if (c.persona.nombre === EJEMPLO.persona.nombre) falta.push("persona.nombre (tu nombre)");
    if (c.persona.slackId === EJEMPLO.persona.slackId) falta.push("persona.slackId (tu ID de Slack)");
    if (c.slack.canalId === EJEMPLO.slack.canalId) falta.push("slack.canalId (el ID de tu canal)");
    for (const k of ["claude", "coo", "cursor"]) if (c.slack.ias[k] === EJEMPLO.slack.ias[k]) falta.push(`slack.ias.${k} (ID de Slack de ese bot; déjalo si no usas esa IA)`);
    if ((c.canalGit.canales[0] || {}).rama === EJEMPLO.canalGit.canales[0].rama) falta.push("canalGit.canales[0].rama (tu rama canal/<usuario>/…)");
    if (falta.length) console.log("\nSiguen con el valor de ejemplo:\n - " + falta.join("\n - "));
  }
}
