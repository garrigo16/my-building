//       node cursor-agente.js apunta <clave> <agentId>   → lo recuerda para la próxima vez
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");
const HOME = process.env.HOME || os.homedir();   // (en las pruebas, la carpeta falsa)
const F = process.env.CURSOR_AGENTES_F || path.join(HOME, ".canal-logs", "cursor-agentes.json");
const API = process.env.CANAL_PRUEBAS === "1" && process.env.CURSOR_API_URL ? process.env.CURSOR_API_URL : "https://api.cursor.com/v1/agents";
const MAX = (+process.env.CURSOR_REUSO_H || 8) * 3600e3;   // (el canal git usa 2 h)

function clave() {
  if (process.env.CURSOR_API_KEY) return process.env.CURSOR_API_KEY;
  try { for (const l of fs.readFileSync(path.join(os.homedir(), ".config", "canal-slack.env"), "utf8").split("\n")) { const x = l.replace("\r", "").trim(); if (x.startsWith("CURSOR_API_KEY=")) return x.slice(15).trim().replace(/^["']|["']$/g, ""); } } catch (e) {}
  return "";
}
const lee = () => { try { return JSON.parse(fs.readFileSync(F, "utf8")); } catch (e) { return {}; } };
// (v565: entero o nada. Dos lanzamientos de Cursor a la vez escribían el mismo fichero: uno a medias es un JSON roto, y con él
// se pierde qué agente lleva cada hilo —el siguiente mensaje abriría un agente nuevo, sin lo hablado—)
const guarda = (m) => { try { fs.mkdirSync(path.dirname(F), { recursive: true }); const tmp = `${F}.${process.pid}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(m)); fs.renameSync(tmp, F); } catch (e) { try { fs.unlinkSync(tmp); } catch (x) {} } } catch (e) {} };
const api = async (url, opts = {}) => {
  const k = clave(); if (!k) throw new Error("sin CURSOR_API_KEY");
  const r = await fetch(url, { ...opts, headers: { Authorization: "Basic " + Buffer.from(k + ":").toString("base64"), "Content-Type": "application/json", ...(opts.headers || {}) }, signal: AbortSignal.timeout(30e3) });
  let j = {}; try { j = await r.json(); } catch (e) {}
  return { status: r.status, j };
};

async function reusa(cl, bodyF) {
  const a = lee()[cl];
  if (!a || !a.id || Date.now() - (a.t || 0) > MAX) return null;
  const st = await api(`${API}/${a.id}`);
  const ag = st.j.agent || st.j;
  if (st.status !== 200 || String(ag.status || "").toUpperCase() !== "IDLE") return null;
  const body = JSON.parse(fs.readFileSync(bodyF, "utf8"));
  const r = await api(`${API}/${a.id}/runs`, { method: "POST", body: JSON.stringify({ prompt: body.prompt }) });
  if (r.status < 200 || r.status > 299) return null;
  const run = (r.j.run && r.j.run.id) || r.j.id || "";
  if (!run) return null;
  const m = lee(); m[cl] = { id: a.id, t: Date.now() }; guarda(m);
  return { id: a.id, run };
}
function apunta(cl, id) {
  const m = lee(), ahora = Date.now();
  for (const [k, v] of Object.entries(m)) if (!v || ahora - (v.t || 0) > 24 * 3600e3) delete m[k];
  m[cl] = { id, t: ahora }; guarda(m);
}

if (require.main === module) {
  const [orden, cl, x] = process.argv.slice(2);
  if (orden === "apunta" && cl && x) { apunta(cl, x); process.exit(0); }
  if (orden === "reusa" && cl && x) {
    reusa(cl, x).then((r) => { if (!r) process.exit(1); process.stdout.write(`${r.id}\t${r.run}`); process.exit(0); }).catch(() => process.exit(1));
  } else { console.error("uso: cursor-agente.js reusa <clave> <body.json> | apunta <clave> <agentId>"); process.exit(2); }
}
module.exports = { reusa, apunta };
