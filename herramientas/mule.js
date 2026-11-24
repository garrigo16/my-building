// Secretos en ~/.config/mulesoft.env (los pone Humano; nunca se imprimen):
//   MULE_CLIENT_ID=…  MULE_CLIENT_SECRET=…  [MULE_ORG_ID=…]  [MULE_HOST=anypoint.mulesoft.com | eu1.anypoint.mulesoft.com]
// Uso (mejor con mule.sh):
//   node mule.js entornos
//   node mule.js apps <entorno>                      (entorno por nombre, p. ej. QA, UAT, PROD, o por id)
//   node mule.js app <entorno> <app>                 (estado, versión, workers y propiedades con los secretos tapados)
//   node mule.js logs <entorno> <app> [n=100] [texto] (últimas n líneas del despliegue actual; filtra por texto)
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const CFG = path.join(os.homedir(), ".config", "mulesoft.env");
function env() {
  const e = {};
  try { for (const l of fs.readFileSync(CFG, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/); if (m) e[m[1]] = m[2].replace(/^["']|["']$/g, ""); } }
  catch (x) { fallo(`No encuentro ${CFG}. Humano tiene que crear la Connected App de solo lectura y poner ahí MULE_CLIENT_ID y MULE_CLIENT_SECRET.`, 8); }
  if (!e.MULE_CLIENT_ID || !e.MULE_CLIENT_SECRET) fallo(`Faltan MULE_CLIENT_ID o MULE_CLIENT_SECRET en ${CFG}.`, 8);
  return e;
}
class Fallo extends Error {}
function fallo(msg, rc = 1) { process.stderr.write("mule: " + msg + "\n"); process.exitCode = rc; throw new Fallo(msg); }
const SECRETO = /pass|secret|token|key|pwd|credential|cert|private|salt|signature|auth/i;
const tapa = (k, v) => (SECRETO.test(k) ? "•••• (tapado)" : v);
// Todo lo que escribe mule (stdout y stderr) pasa por la redacción común; además se tapan tal cual el token y el client secret.
const { tapaSecretos } = require("./tapar-secretos.js");
const VIVOS = [];   // los secretos de esta ejecución (client secret y token)
const tapaLinea = (s) => tapaSecretos(s, { secretos: VIVOS });
for (const f of [process.stdout, process.stderr]) {
  const escribe = f.write.bind(f);
  f.write = (c, ...r) => escribe(typeof c === "string" ? tapaLinea(c) : Buffer.isBuffer(c) || c instanceof Uint8Array ? tapaLinea(Buffer.from(c).toString("utf8")) : c, ...r);
}
process.on("uncaughtException", (e) => { process.stderr.write("mule: " + String((e && e.message) || e) + "\n"); process.exitCode = 1; });

async function main() {
  const [orden, a1, a2, a3, a4] = process.argv.slice(2);
  if (!orden || !["entornos", "apps", "app", "logs"].includes(orden)) fallo("uso: entornos | apps <entorno> | app <entorno> <app> | logs <entorno> <app> [n] [texto]", 2);
  const E = env(), HOST = "https://" + (E.MULE_HOST || "anypoint.mulesoft.com");
  VIVOS.push(E.MULE_CLIENT_SECRET);
  // token de la Connected App (client credentials)
  const rt = await fetch(HOST + "/accounts/api/v2/oauth2/token", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: E.MULE_CLIENT_ID, client_secret: E.MULE_CLIENT_SECRET }) });
  if (!rt.ok) fallo(`Anypoint no da token (HTTP ${rt.status}). ¿Client id/secret correctos? ¿Control plane EU? (MULE_HOST=eu1.anypoint.mulesoft.com)`, 9);
  const tok = (await rt.json()).access_token; VIVOS.push(tok);
  const get = async (ruta, hdr = {}) => {
    const r = await fetch(HOST + ruta, { headers: { Authorization: "Bearer " + tok, ...hdr } });
    if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`HTTP ${r.status} en ${ruta.split("?")[0]}${r.status === 403 ? " (a la Connected App le falta ese permiso de lectura)" : ""}${t ? ": " + tapaLinea(t).slice(0, 200) : ""}`); }
    return r.json();
  };
  let org = E.MULE_ORG_ID;
  if (!org) { const me = await get("/accounts/api/me"); org = (me.client && (me.client.org_id || me.client.orgId)) || (me.user && me.user.organization && me.user.organization.id); }
  if (!org) fallo("No sé el id de la organización: pon MULE_ORG_ID en " + CFG, 2);
  const envs = (await get(`/accounts/api/organizations/${org}/environments`)).data || [];
  if (orden === "entornos") { for (const e of envs) console.log(`${e.name}\t${e.type || ""}\t${e.id}`); return; }
  const ent = envs.find((e) => e.id === a1 || (e.name || "").toLowerCase() === String(a1 || "").toLowerCase());
  if (!ent) fallo(`No encuentro el entorno «${a1}». Hay: ${envs.map((e) => e.name).join(", ")}`, 2);
  const H = { "X-ANYPNT-ORG-ID": org, "X-ANYPNT-ENV-ID": ent.id };
  if (orden === "apps") {
    const apps = await get("/cloudhub/api/v2/applications", H);
    for (const a of apps) console.log(`${a.domain}\t${a.status}\tmule ${a.muleVersion && a.muleVersion.version || "?"}\t${a.workers && a.workers.amount || "?"}×${a.workers && a.workers.type && a.workers.type.name || "?"}\t${a.lastUpdateTime ? new Date(a.lastUpdateTime).toISOString().slice(0, 16).replace("T", " ") : ""}`);
    return;
  }
  if (!a2) fallo("falta el nombre de la app", 2);
  if (orden === "app") {
    const a = await get(`/cloudhub/api/v2/applications/${encodeURIComponent(a2)}`, H);
    console.log(`app: ${a.domain}\nestado: ${a.status}\nmule: ${a.muleVersion && a.muleVersion.version || "?"}\nregión: ${a.region || "?"}\nworkers: ${a.workers && a.workers.amount || "?"} × ${a.workers && a.workers.type && a.workers.type.name || "?"}\núltimo cambio: ${a.lastUpdateTime ? new Date(a.lastUpdateTime).toISOString() : "?"}\nfichero: ${a.fileName || "?"}`);
    const p = a.properties || {};
    console.log(`propiedades (${Object.keys(p).length}, las que parecen secretos van tapadas):`);
    for (const k of Object.keys(p).sort()) console.log(`  ${k} = ${tapa(k, p[k])}`);
    return;
  }
  if (orden === "logs") {
    const n = Math.min(500, Math.max(1, parseInt(a3 || "100", 10) || 100)), texto = (a4 || "").toLowerCase();
    const deps = await get(`/cloudhub/api/v2/applications/${encodeURIComponent(a2)}/deployments?orderByDate=DESC`, H);
    const d = (deps.data || deps || [])[0]; if (!d) fallo("esa app no tiene despliegues", 3);
    const lineas = await get(`/cloudhub/api/v2/applications/${encodeURIComponent(a2)}/deployments/${d.deploymentId}/logs?descending=true&limit=${texto ? 500 : n}&limitMsgLen=2000`, H);
    const sal = (Array.isArray(lineas) ? lineas : lineas.data || []).map((l) => l.event || l)
      .filter((ev) => !texto || String(ev.message || "").toLowerCase().includes(texto)).slice(0, n).reverse();
    // cada mensaje se tapa por separado y todas las líneas salen de una vez
    if (sal.length) console.log(sal.map((ev) => `${ev.timestamp ? new Date(ev.timestamp).toISOString().slice(0, 19).replace("T", " ") : ""} ${tapaLinea(String(ev.priority || ""))} ${tapaLinea(String(ev.message || "").replace(/\s+$/, ""))}`).join("\n"));
    if (!sal.length) console.log("(sin líneas" + (texto ? ` con «${a4}»` : "") + ")");
  }
}
main().catch((e) => { if (e instanceof Fallo) return; process.stderr.write("mule: " + String((e && e.message) || e) + "\n"); process.exitCode = 1; });
