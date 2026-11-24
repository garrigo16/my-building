// Uso: node herramientas/informe-trabajo.js [desde AAAA-MM-DD]      (por defecto, todo lo que haya)
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const HOME = process.env.INFORME_HOME || os.homedir();
const CONF = require("./config.js").config(process.env.INFORME_HOME ? { fichero: "ninguno" } : {});   // con INFORME_HOME (pruebas), solo los de ejemplo
const REPO = process.env.OFICINA_REPO || (CONF.canalGit.repoLocalPuesto ? CONF.canalGit.repoLocal : path.join(HOME, "Documents", "Oca Global Repository", "oca-salesforce"));
const SALIDA = process.env.INFORME_SALIDA || path.join(HOME, ".oficina", "informe-trabajo.json");
const JIRA_SITE = process.env.JIRA_SITE || CONF.jira.sitio, BB_REPO = process.env.BB_REPO || CONF.canalGit.bitbucket;
const CH = process.env.SLACK_CANAL_ID || CONF.slack.canalId;

function cfg() {
  const o = {};
  for (const f of ["canal-slack.env", "oficina-slack.env"]) {
    try { for (const l of fs.readFileSync(path.join(HOME, ".config", f), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && !(m[1] in o)) o[m[1]] = m[2].trim().replace(/^["']|["']$/g, ""); } } catch (e) {}
  }
  return o;
}
const CLAVE_JIRA = /\b([A-Z][A-Z0-9]{1,9})-(\d{1,6})\b/g;
const ENTORNOS = new Set(["PROD", "UAT", "DEV", "QA", "SIT", "PRE", "STG", "MAIN", "HOTFIX", "RELEASE", "MERGE"]), ALIAS = {};
const claves = (t) => [...new Set([...String(t || "").matchAll(CLAVE_JIRA)].filter((m) => !ENTORNOS.has(m[1])).map((m) => `${ALIAS[m[1]] || m[1]}-${m[2]}`))];

async function nombresJira(ks, c, pedir = fetch) {
  const out = {};
  if (!ks.length || !c.JIRA_EMAIL || !c.JIRA_API_TOKEN) return out;
  const auth = "Basic " + Buffer.from(c.JIRA_EMAIL + ":" + c.JIRA_API_TOKEN).toString("base64");
  await Promise.all(ks.slice(0, 40).map(async (k) => {
    try {
      const r = await pedir(JIRA_SITE + "/rest/api/3/project/" + encodeURIComponent(k), { headers: { Authorization: auth, Accept: "application/json" }, signal: AbortSignal.timeout(15e3) });
      if (r.status === 404) out[k] = null; else if (r.ok) out[k] = String((await r.json()).name || "") || null;
    } catch (e) {}
  }));
  return out;
}

// sus commits en el repo de OCA (lo de su usuario de git en ese repo)
function commitsDe(repo = REPO, desde = "", git = (a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true })) {
  let email = ""; try { email = git(["config", "user.email"]).trim(); } catch (e) { return { email: "", commits: [] }; }
  if (!email) return { email: "", commits: [] };
  const out = git(["log", "--all", `--author=${email}`, ...(desde ? [`--since=${desde}`] : []), "--pretty=format:%H%x09%aI%x09%s"]);
  const vistos = new Set(), commits = []; let canal = 0;
  for (const l of out.split(/\r?\n/)) {
    const [sha, fecha, ...r] = l.split("\t"); if (!sha || vistos.has(sha)) continue; vistos.add(sha);
    const asunto = r.join("\t"); if (/\[skip ci\]/i.test(asunto)) { canal++; continue; }
    const m = asunto.match(/^Merged in (\S+) \(pull request #(\d+)\)/i);
    commits.push({ sha: sha.slice(0, 10), fecha, asunto: asunto.slice(0, 200), merge: !!m, rama: m ? m[1] : "", pr: m ? +m[2] : ((asunto.match(/(?:pull request |PR ?)#(\d{3,5})/i) || [])[1] || 0) * 1, jira: claves(asunto) });
  }
  return { email, commits, canal };
}

async function prsDe(nums, c, pedir = fetch) {
  if (!c.BITBUCKET_EMAIL || !c.BITBUCKET_API_TOKEN || !nums.length) return [];
  const auth = "Basic " + Buffer.from(c.BITBUCKET_EMAIL + ":" + c.BITBUCKET_API_TOKEN).toString("base64");
  const out = [], cola = [...new Set(nums)].slice(0, 300);
  const uno = async (n) => {
    try {
      const r = await pedir(`https://api.bitbucket.org/2.0/repositories/${BB_REPO}/pullrequests/${n}?fields=id,title,state,created_on,updated_on,author.display_name,source.branch.name,destination.branch.name`, { headers: { Authorization: auth, Accept: "application/json" }, signal: AbortSignal.timeout(20e3) });
      if (!r.ok) return; const p = await r.json();
      out.push({ id: p.id, titulo: String(p.title || "").slice(0, 160), estado: p.state, creada: p.created_on, actualizada: p.updated_on, autor: (p.author && p.author.display_name) || "",
        origen: (p.source && p.source.branch && p.source.branch.name) || "", destino: (p.destination && p.destination.branch && p.destination.branch.name) || "", jira: claves(p.title) });
    } catch (e) {}
  };
  for (let i = 0; i < cola.length; i += 4) await Promise.all(cola.slice(i, i + 4).map(uno));
  return out.sort((a, b) => a.id - b.id);
}

async function jiraDe(c, desde = "", pedir = fetch) {
  if (!c.JIRA_EMAIL || !c.JIRA_API_TOKEN) return [];
  const auth = "Basic " + Buffer.from(c.JIRA_EMAIL + ":" + c.JIRA_API_TOKEN).toString("base64");
  const jql = `(assignee was currentUser() OR reporter = currentUser())${desde ? ` AND updated >= "${desde}"` : ""} ORDER BY created ASC`;
  const out = []; let token = "";
  for (let pag = 0; pag < 20; pag++) {
    const r = await pedir(JIRA_SITE + "/rest/api/3/search/jql", { method: "POST", headers: { Authorization: auth, Accept: "application/json", "Content-Type": "application/json" }, signal: AbortSignal.timeout(30e3),
      body: JSON.stringify({ jql, maxResults: 100, ...(token ? { nextPageToken: token } : {}), fields: ["summary", "status", "project", "issuetype", "created", "updated", "resolutiondate", "assignee", "reporter", "priority"] }) });
    if (!r.ok) break; const j = await r.json();
    for (const i of j.issues || []) { const f = i.fields || {};
      out.push({ clave: i.key, titulo: String(f.summary || "").slice(0, 160), estado: (f.status && f.status.name) || "", categoria: (f.status && f.status.statusCategory && f.status.statusCategory.key) || "",
        proyecto: (f.project && f.project.key) || "", proyectoNombre: (f.project && f.project.name) || "", tipo: (f.issuetype && f.issuetype.name) || "", prioridad: (f.priority && f.priority.name) || "",
        creada: f.created, actualizada: f.updated, resuelta: f.resolutiondate || null, asignada: (f.assignee && f.assignee.displayName) || "", creador: (f.reporter && f.reporter.displayName) || "" }); }
    token = j.nextPageToken; if (!token || j.isLast) break;
  }
  return out;
}

async function temasDe(c, desde = "", pedir = fetch) {
  if (!c.SLACK_BOT_TOKEN) return [];
  const out = []; let cursor = "";
  const oldest = desde ? (Date.parse(desde) / 1000).toFixed(6) : "0";
  for (let pag = 0; pag < 30; pag++) {
    const q = new URLSearchParams({ channel: CH, limit: "200", oldest, ...(cursor ? { cursor } : {}) });
    const r = await pedir("https://slack.com/api/conversations.history?" + q, { headers: { Authorization: "Bearer " + c.SLACK_BOT_TOKEN }, signal: AbortSignal.timeout(30e3) });
    const j = await r.json(); if (!j.ok) break;
    for (const m of j.messages || []) {
      if (m.thread_ts && m.thread_ts !== m.ts) continue;
      const t = String(m.text || ""), tit = (t.match(/^\s*[*_]*Hilo:\s*([^\n*_]+)/m) || [])[1];
      if (!tit) continue;   // (solo los temas: los mensajes sueltos del timbre y similares, no)
      const origen = (t.match(/📥\s*Origen:\s*([^\n·]+)/) || [])[1] || "";
      out.push({ ts: m.ts, titulo: tit.trim().slice(0, 120), fecha: new Date(+m.ts * 1000).toISOString(), ultimo: m.latest_reply ? new Date(+m.latest_reply * 1000).toISOString() : null,
        mensajes: (m.reply_count || 0) + 1, origen: origen.trim(), jira: claves(t.slice(0, 600)) });
    }
    cursor = j.response_metadata && j.response_metadata.next_cursor; if (!cursor) break;
  }
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

function resume({ commits, prs, jira, temas, email, canal = 0 }, ahora = new Date()) {
  const mes = (iso) => String(iso || "").slice(0, 7), meses = {};
  const sumar = (m, k) => { if (!m) return; (meses[m] = meses[m] || { mes: m, commits: 0, merges: 0, prs: 0, jiraCreadas: 0, jiraResueltas: 0, temas: 0 })[k]++; };
  for (const c of commits) sumar(mes(c.fecha), c.merge ? "merges" : "commits");
  for (const p of prs) sumar(mes(p.creada), "prs");
  for (const j of jira) { sumar(mes(j.creada), "jiraCreadas"); if (j.resuelta) sumar(mes(j.resuelta), "jiraResueltas"); }
  for (const t of temas) sumar(mes(t.fecha), "temas");
  const proyectos = {};
  const enProy = (k, campo) => { const p = k.split("-")[0]; (proyectos[p] = proyectos[p] || { clave: p, nombre: "", jira: 0, commits: 0, prs: 0, temas: 0 })[campo]++; };
  for (const j of jira) { enProy(j.clave, "jira"); if (j.proyectoNombre) proyectos[j.proyecto].nombre = j.proyectoNombre; }
  for (const c of commits) for (const k of c.jira) enProy(k, "commits");
  for (const p of prs) for (const k of p.jira) enProy(k, "prs");
  for (const t of temas) for (const k of t.jira) enProy(k, "temas");
  const fechas = [...commits.map((c) => c.fecha), ...jira.map((j) => j.creada), ...temas.map((t) => t.fecha)].filter(Boolean).sort();
  return { generado: ahora.toISOString(), desde: fechas[0] || null, hasta: fechas[fechas.length - 1] || null, autorGit: email,
    cifras: { commits: commits.filter((c) => !c.merge).length, merges: commits.filter((c) => c.merge).length, prs: prs.length, prsFusionadas: prs.filter((p) => p.estado === "MERGED").length,
      bloquesCanal: canal, jira: jira.length, jiraResueltas: jira.filter((j) => j.categoria === "done" || j.resuelta).length, temas: temas.length, proyectos: Object.keys(proyectos).length },
    meses: Object.values(meses).sort((a, b) => a.mes.localeCompare(b.mes)),
    proyectos: Object.values(proyectos).sort((a, b) => (b.jira + b.commits + b.prs + b.temas) - (a.jira + a.commits + a.prs + a.temas)),
    jira, prs, commits: porFecha(commits).slice(-3000), temas };
}
const porFecha = (xs) => xs.slice().sort((a, b) => (Date.parse(a.fecha) || 0) - (Date.parse(b.fecha) || 0));

async function informe({ desde = "", c = cfg(), repo = REPO } = {}) {
  const { email, commits, canal } = commitsDe(repo, desde);
  const nums = commits.map((x) => x.pr).filter(Boolean);
  const [prs, jira, temas] = await Promise.all([prsDe(nums, c), jiraDe(c, desde), temasDe(c, desde)]);
  const r = resume({ commits, prs, jira, temas, email, canal });
  return ponNombres(r, await nombresJira(r.proyectos.filter((p) => !p.nombre).map((p) => p.clave), c));
}
// v522: con lo que dijo Jira (nombre; null = no es un proyecto de Jira; sin respuesta = no se sabe y se deja como estaba)
function ponNombres(r, nombres) {
  for (const p of r.proyectos) {
    if (p.nombre) { p.enJira = true; continue; }
    if (!(p.clave in nombres)) continue;
    if (nombres[p.clave]) { p.nombre = nombres[p.clave]; p.enJira = true; } else p.enJira = false;
  }
  return r;
}

if (require.main === module) {
  informe({ desde: process.argv[2] || "" }).then((r) => {
    fs.mkdirSync(path.dirname(SALIDA), { recursive: true }); fs.writeFileSync(SALIDA + ".tmp", JSON.stringify(r)); fs.renameSync(SALIDA + ".tmp", SALIDA);
    console.log(`informe: ${r.cifras.commits} commits (+${r.cifras.bloquesCanal} bloques del canal de las IAs), ${r.cifras.merges} merges, ${r.cifras.prs} PRs (${r.cifras.prsFusionadas} fusionadas), ${r.cifras.jira} Jira (${r.cifras.jiraResueltas} resueltas), ${r.cifras.temas} temas, ${r.cifras.proyectos} proyectos · ${String(r.desde).slice(0, 10)} → ${String(r.hasta).slice(0, 10)} → ${SALIDA}`);
    process.exit(0);
  }, (e) => { console.error("informe: " + e.message); process.exit(1); });
}
module.exports = { informe, resume, commitsDe, prsDe, jiraDe, temasDe, claves, nombresJira, ponNombres };
