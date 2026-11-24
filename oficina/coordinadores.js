"use strict";
const fs = require("fs"), fsp = fs.promises, path = require("path"), os = require("os");

const CLAUDE = path.join(os.homedir(), ".claude");
const SF = "coord-salesforce";
const MIN = 60e3, HORA = 3600e3;
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const corta = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…" : t; };

const JIRA = /\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g;
const PERSONAS = [];   // [["Nombre", /expresión/], …]: personas cuyo nombre en un tema lo marca como del proyecto
const PALABRA = /salesforce|backpromote|\bapex\b|\bsoql\b|full copy|\bsandbox\b/;
const FLOJA = /\buat\b|\brelease\b|\bquotes?\b|presupuestos?\b|\bqa\b|\bprod\b|\bpedidos?\b|\bfactura\w*|\boferta\b|\bcontactos?\b|\bquery\b/;
const META = /oficina de (?:las )?ias|edificio|beta ?testers?|\bbiblia\b|manera de trabajar|canal de (?:las )?ias|\bgithub\b/;

function detectaSF(h, raiz) {
  if (!h) return null;
  const r = String(raiz || ""), origen = (r.match(/^[^\n\w]*Origen:\s*(.+)$/mi) || [])[1] || "";
  const e = h.esperaA && !h.esperaA.proceso ? h.esperaA : null;
  const tit = `${h.titulo || ""} · ${h.tema || ""}`, cab = `${tit}\n${h.objetivo || ""}\n${origen}`, llano = sinTildes(cab);
  const todo = `${cab}\n${e ? e.que || "" : ""}\n${(h.asuntoJ || []).join(" ")}\n${r.slice(0, 800)}`;
  const por = [];
  const jira = [...new Set(todo.match(JIRA) || [])];
  if (jira.length) por.push("Jira " + jira.slice(0, 2).join(", "));
  const prs = [...new Set([...`${cab}\n${e ? e.que || "" : ""}`.matchAll(/(?:\bPR\s*#?|#)(\d{4,5})\b/gi)].map((m) => m[1]))];
  if (prs.length) por.push("PR #" + prs.slice(0, 2).join(", #"));
  else if (/oca-salesforce/i.test(r)) por.push("PR de oca-salesforce");
  if ((h.git || []).some((b) => b && b.canal !== "principal") || /#[\w-]*salesforce[\w-]*/i.test(cab)) por.push("canal de proyecto");
  const fuerte = por.length > 0, meta = META.test(llano);
  if (meta && !fuerte) return null;
  const pal = (llano.match(PALABRA) || [])[0];
  if (pal) por.push(`«${pal}»`);
  const trae = PERSONAS.filter(([, re]) => new RegExp(`^[^·\\n]{0,40}(?:${re.source})[^·\\n]{0,40}·`).test(sinTildes(h.titulo || "")) || re.test(sinTildes(origen))).map((p) => p[0]);
  const espera = e ? PERSONAS.filter(([, re]) => re.test(sinTildes(e.quien || ""))).map((p) => p[0]) : [];
  const menc = PERSONAS.filter(([, re]) => re.test(llano)).map((p) => p[0]);
  const pers = [...new Set([...trae, ...espera])];
  if (pers.length) por.push(pers.slice(0, 3).join(" y "));
  else if (menc.length && (fuerte || pal || FLOJA.test(llano))) por.push(menc.slice(0, 3).join(" y "));
  const es = fuerte || !!pal || pers.length > 0 || (menc.length > 0 && FLOJA.test(llano));
  return es ? { por, fuerte: fuerte || !!pal } : null;
}

const lineaNo = (l) => String(l || "").trim().match(/^no\s+(?:(C[A-Z0-9]{6,})\s+)?(\d{9,}\.\d{6})\b/i);
function leeAuto(dir) {
  const o = { no: {}, apagado: false };
  let txt = ""; try { txt = fs.readFileSync(path.join(dir, SF + ".txt"), "utf8"); } catch (e) { return o; }
  for (const l of txt.replace(/^﻿/, "").split(/\r?\n/)) {
    const m = lineaNo(l); if (m) { o.no[m[2]] = true; continue; }
    if (/^\s*auto\s+(?:no|off|0)\s*$/i.test(l)) o.apagado = true;
  }
  return o;
}
function guarda(f, lineas) { fs.mkdirSync(path.dirname(f), { recursive: true }); const t = lineas.join("\n").replace(/\n+$/, "") + "\n"; fs.writeFileSync(f + ".tmp", t); fs.renameSync(f + ".tmp", f); }
function apuntaNo(hilo, titulo, si, dir, canal) {
  const f = path.join(dir, SF + ".txt");
  let txt = ""; try { txt = fs.readFileSync(f, "utf8").replace(/^﻿/, ""); } catch (e) {}
  const ls = txt ? txt.split(/\r?\n/) : [`# hilos que lleva ${SF} (una línea por hilo: «${canal} <ts del hilo> — nota»; «no <canal> <ts>» = Humano lo deshizo; ver COMO-FUNCIONA.md, v549, v555 y v562)`];
  const sin = ls.filter((l) => { const m = lineaNo(l); return !(m && m[2] === hilo); });
  const habia = sin.length !== ls.length;
  if (!si) { if (habia) guarda(f, sin); return habia; }
  const nota = String(titulo || "").replace(/\s+/g, " ").replace(/^[-—·:|#\s]+/, "").trim().slice(0, 140);
  guarda(f, sin.filter((l, i) => l.trim() || i < sin.length - 1).concat(`no ${canal} ${hilo}${nota ? " — " + nota : ""}`));
  return true;
}

//   "pausa"      Humano lo tiene en pausa en la oficina: se queda con él (v567)
// marcaJ(h) → "resuelto" | "quitado" | "pausa" | "" (v567): lo que Humano dio por resuelto o quitó en la oficina y nadie ha tocado
// después no es un tema abierto: ni se pasa ni entra en la lista (sin h.sf). Lo apuntado a mano en delegados/ no se toca.
function autoSalesforce(hilos, raizDe, deleg, cfg, marcaJ) {
  const auto = {}; if (!cfg) return auto;
  for (const h of hilos || []) {
    if (!h || ["cerrado", "frenado"].includes(h.estado) || h.sigueEn) continue;
    const d = (deleg || {})[h.ts], s = detectaSF(h, raizDe(h));
    if (d) { if (d.quien === SF) h.sf = { por: s ? s.por : ["apuntado a mano"], modo: "manual" }; continue; }
    if (!s) continue;
    const mj = marcaJ ? marcaJ(h) : "";
    if (mj === "resuelto" || mj === "quitado") continue;
    const modo = cfg.no[h.ts] ? "devuelto" : mj === "pausa" ? "pausa" : h.estado === "humano" || h.caja === "toca" ? "decide"
      : h.caja === "esperando" && !(h.enMarcha || []).length ? (cfg.apagado ? "apagado" : "auto") : "trabajando";
    h.sf = { por: s.por, modo };
    if (modo === "auto") auto[h.ts] = { quien: SF, nota: s.por.join(", "), auto: true, por: s.por };
  }
  return auto;
}

const TEXTO_MODO = {
  tuyo: "Tema de Salesforce para ti (te lo ha pasado la oficina)",
  "tuyo-manual": "Tema de Salesforce que llevas tú (apuntado a mano)",
  "decide-humano": "Tema de Salesforce que espera una decisión de Humano: no lo lleves tú, solo entérate",
  "ias-trabajando": "Tema de Salesforce que están haciendo las IAs del canal: solo entérate",
  "lo-lleva-humano": "Tema de Salesforce que Humano se ha quedado (deshizo el paso): no lo lleves tú",
  "sin-pasar": "Tema de Salesforce sin pasar (el paso automático está apagado)",
  "en-pausa": "Tema de Salesforce que Humano tiene en pausa en la oficina: no lo lleves tú",
};
const MODO_LISTA = { auto: "tuyo", manual: "tuyo-manual", decide: "decide-humano", trabajando: "ias-trabajando", devuelto: "lo-lleva-humano", apagado: "sin-pasar", pausa: "en-pausa" };
const iso = (t) => { const d = new Date(t), z = -d.getTimezoneOffset(), p = (n) => String(Math.abs(n)).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${z < 0 ? "-" : "+"}${p(Math.trunc(Math.abs(z) / 60))}:${p(Math.abs(z) % 60)}`; };
function listaParaCoord(hilos, canal, previas = {}, ahora = Date.now()) {
  const out = [];
  for (const h of hilos || []) {
    if (!h || !h.sf || h.estado === "cerrado") continue;
    const modo = MODO_LISTA[h.sf.modo]; if (!modo) continue;
    const titulo = String(h.titulo || h.tema || "").slice(0, 200), por = (h.sf.por || []).join("; ");
    const l = { ts: iso(ahora), id: "sf-" + h.ts, de: "oficina", canal, thread_ts: h.ts, titulo, por, modo,
      estado: corta(h.delegado && h.delegado.antes ? h.delegado.antes : h.motivo || "", 200), url: h.url || "", desde: iso(ahora),
      texto: `${TEXTO_MODO[modo]}: «${corta(titulo, 90)}» (${por})` };
    const p = previas[l.id];
    if (p) { l.desde = p.desde || p.ts || l.desde; if (p.modo === l.modo && p.titulo === l.titulo && p.por === l.por && p.estado === l.estado) l.ts = p.ts || l.ts; }
    out.push(l);
  }
  return out.sort((a, b) => (a.thread_ts < b.thread_ts ? -1 : 1));
}
const PARA_COORD = path.join(CLAUDE, "avisos", "para-coord-salesforce.jsonl");
let ultParaCoord = null;
// escribeParaCoord(hilos, canal, { fichero }) → true si escribió. Solo si existe ~/.claude (no la crea) y solo si cambia algo.
async function escribeParaCoord(hilos, canal, { fichero = PARA_COORD, ahora = Date.now() } = {}) {
  try {
    if (!fs.existsSync(path.dirname(path.dirname(fichero)))) return false;
    let viejo = ""; try { viejo = await fsp.readFile(fichero, "utf8"); } catch (e) {}
    const previas = {}; for (const l of viejo.split(/\r?\n/)) { try { const j = JSON.parse(l); if (j && j.id) previas[j.id] = j; } catch (e) {} }
    const txt = listaParaCoord(hilos, canal, previas, ahora).map((l) => JSON.stringify(l)).join("\n") + "\n";
    if (txt === viejo || (txt === "\n" && !viejo)) { ultParaCoord = txt; return false; }
    await fsp.mkdir(path.dirname(fichero), { recursive: true });
    await fsp.writeFile(fichero + ".tmp", txt === "\n" ? "" : txt); await fsp.rename(fichero + ".tmp", fichero);
    ultParaCoord = txt; return true;
  } catch (e) { return false; }
}
const firmaTemas = (ls) => ls.map((l) => `${l.id}|${l.modo}`).sort().join("\n");
async function quizaParaCoord(hilos, canal, st, { listo = true, fichero = PARA_COORD, ahora = Date.now(), anotar = () => {} } = {}) {
  if (!listo) return "nada";
  const hu = huellaSF(hilos); if (hu === st.huella) return "nada";
  st.huella = hu;
  if (st.temas == null) { let viejo = ""; try { viejo = await fsp.readFile(fichero, "utf8"); } catch (e) {}
    st.temas = firmaTemas(viejo.split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter((j) => j && j.id)); }
  if (!(await escribeParaCoord(hilos, canal, { fichero, ahora }))) return "nada";
  const ls = listaParaCoord(hilos, canal, {}, ahora), firma = firmaTemas(ls);
  if (firma === st.temas) return "escrita";
  st.temas = firma; anotar(`SALESFORCE: lista para coord-salesforce actualizada (${ls.length} tema(s))`); return "anotada";
}
// (para no leer el fichero en cada vuelta: solo se llama a escribeParaCoord si la lista cambió respecto a la última)
function huellaSF(hilos) { return (hilos || []).filter((h) => h && h.sf && h.estado !== "cerrado").map((h) => `${h.ts}|${h.sf.modo}|${h.titulo}|${(h.sf.por || []).join(";")}|${(h.delegado && h.delegado.antes) || h.motivo || ""}`).sort().join("\n"); }

// =====================================================================================================================
// A) El estado de los coordinadores
// =====================================================================================================================
// Los de ejemplo. Los tuyos, en config.local.json → coordinadores: [{ "id": "coord-x", "nombre": "X", "proyecto": "x",
// "titulo": "expresión", "carpetas": "expresión" }]. La oficina llama a configura() al arrancar; con la lista vacía, este módulo
// no lee nada de ~/.claude ni pasa temas a nadie.
let LISTA = [];
const reg = (x) => { try { return x ? new RegExp(String(x), "i") : null; } catch (e) { return null; } };
function configura(lista, proyectoClaude) {
  if (!Array.isArray(lista)) return LISTA;
  LISTA = lista.filter((c) => c && c.id).map((c) => { const id = String(c.id).toLowerCase(), nombre = String(c.nombre || id.replace(/^coord-/, ""));
    return { id, nombre, proy: id === "jefe" ? null : String(c.proyecto || id.replace(/^coord-/, "")), tit: reg(c.titulo) || reg(nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      dirs: reg(c.carpetas) || (c.esteRepo && proyectoClaude ? reg("^" + proyectoClaude) : null) }; });
  return LISTA;
}
const haySF = () => LISTA.some((c) => c.id === SF);
const esCoord = (c, titulo) => !!titulo && (c.id === "jefe" ? c.tit.test(titulo) : /^\s*coord(?:inador)?\b/i.test(titulo) && !/\bjefe\b/i.test(titulo) && c.tit.test(titulo));

function modeloLlano(m) {
  const x = String(m || "").match(/^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?(?:-\d{6,})?$/);
  return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}${x[3] ? "." + x[3] : ""}` : "";
}
const limpiaMd = (s) => String(s || "").replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\blocal_[0-9a-f]{8}[0-9a-f-]*(?:…|\.{3})?\s*[,;]?\s*/g, "").replace(/\s*\(\s*\)/g, "").replace(/\s+/g, " ").trim();
function reinicioDe(texto, tFichero, ahora = Date.now()) {
  const t = String(texto || ""), r = t.match(/reinici\w*\s+(?:es\s+)?(?:el\s+)?(?:\S+\s+)?(\d{1,2})\/(\d{1,2})(?:[^\d%]{1,12}(\d{1,2})[:.h](\d{2}))?/i);
  if (!r) return {};
  const base = new Date(tFichero || ahora), fecha = (d, m, h, mi) => {
    let x = new Date(base.getFullYear(), m - 1, d, h, mi, 0, 0).getTime();
    if (x - base.getTime() > 200 * 86400e3) x = new Date(base.getFullYear() - 1, m - 1, d, h, mi).getTime();
    if (base.getTime() - x > 200 * 86400e3) x = new Date(base.getFullYear() + 1, m - 1, d, h, mi).getTime();
    return x; };
  const reinicio = fecha(+r[1], +r[2], r[3] ? +r[3] : 0, r[4] ? +r[4] : 0);
  const md = t.slice(0, r.index).match(/(\d{1,2})\/(\d{1,2})\D{1,4}(\d{1,2}):(\d{2})/), medida = md ? fecha(+md[1], +md[2], +md[3], +md[4]) : tFichero || 0;
  return { reinicio, caducado: reinicio <= ahora && medida < reinicio };
}
function leeRelevo(txt) {
  const secs = []; let act = { titulo: "", items: [], sueltas: [] };
  for (const l0 of String(txt || "").replace(/^﻿/, "").split(/\r?\n/)) {
    const cab = l0.match(/^#{1,3}\s+(.+?)\s*#*$/);
    if (cab) { secs.push(act); act = { titulo: limpiaMd(cab[1]), items: [], sueltas: [] }; continue; }
    if (!l0.trim() || /^\s*\|/.test(l0) || /^\s*(?:---+|```)/.test(l0)) continue;
    const it = l0.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (it) act.items.push(limpiaMd(it[1])); else if (/^\S/.test(l0)) act.sueltas.push(limpiaMd(l0)); else if (act.items.length) act.items[act.items.length - 1] += " " + limpiaMd(l0);
  }
  secs.push(act);
  const con = secs.map((s) => ({ titulo: s.titulo, lineas: (s.items.length ? s.items : s.sueltas).filter(Boolean) })).filter((s) => s.lineas.length);
  const fechada = con.slice().reverse().find((s) => /^\d{1,2}[/-]\d{1,2}\b/.test(s.titulo));
  const marcha = con.find((s) => /en marcha|chats/i.test(s.titulo)), pend = con.find((s) => /pendiente/i.test(s.titulo));
  let eleg = [fechada, marcha, pend].filter(Boolean).filter((s, i, a) => a.indexOf(s) === i);
  if (!eleg.length) eleg = con.slice(0, 2);
  const pres = String(txt || "").split(/\r?\n/).map(limpiaMd).find((l) => /presupuesto/i.test(l) && /\d\s?%/.test(l) && !/^#/.test(l))
    || ((con.find((s) => /presupuesto/i.test(s.titulo)) || { lineas: [] }).lineas.find((l) => /\d\s?%/.test(l)) || "");
  return { secciones: eleg.slice(0, 3).map((s) => ({ titulo: corta(s.titulo, 80), lineas: s.lineas.slice(0, 3).map((l) => corta(l, 200)), mas: Math.max(0, s.lineas.length - 3) })),
    presupuesto: corta(pres.replace(/^[-*]\s*/, ""), 220) };
}

// la COLA de un transcript (son enormes): título de la sesión y modelo de lo último
async function colaDe(f, n = 96 * 1024) {
  let fh; try {
    fh = await fsp.open(f, "r"); const st = await fh.stat(), len = Math.min(n, st.size), b = Buffer.alloc(len);
    await fh.read(b, 0, len, st.size - len); const s = b.toString("utf8");
    const ult = (re) => { let m, x = ""; while ((m = re.exec(s))) x = m[1]; return x; };
    const des = (x) => { try { return JSON.parse(`"${x}"`); } catch (e) { return x; } };
    return { titulo: des(ult(/"type":"custom-title","customTitle":"((?:[^"\\]|\\.)*)"/g) || ult(/"type":"agent-name","agentName":"((?:[^"\\]|\\.)*)"/g)),
      modelo: ult(/"model":"(claude-[a-z0-9-]+)"/g) };
  } catch (e) { return { titulo: "", modelo: "" }; } finally { if (fh) await fh.close().catch(() => {}); }
}
const pidVivo = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

// los subagentes que lanzó una sesión (<sesión>/subagents/agent-*.meta.json): su descripción y si han terminado
async function subagentes(dirSes, ahora) {
  const out = []; let fs2 = []; try { fs2 = (await fsp.readdir(path.join(dirSes, "subagents"))).filter((x) => /\.meta\.json$/.test(x)); } catch (e) { return out; }
  for (const f of fs2.slice(-300)) { try {
    const st = await fsp.stat(path.join(dirSes, "subagents", f.replace(/\.meta\.json$/, ".jsonl"))); if (ahora - st.mtimeMs > 24 * HORA) continue;
    const j = JSON.parse(await fsp.readFile(path.join(dirSes, "subagents", f), "utf8")); if (!j || !j.description) continue;
    const m = String(j.model || "");
    out.push({ nombre: corta(j.description, 70), estado: j.finished ? "terminado" : ahora - st.mtimeMs < 10 * MIN ? "trabajando" : "parado", ult: st.mtimeMs, modelo: modeloLlano(m) || (m ? m[0].toUpperCase() + m.slice(1) : "") });
  } catch (e) {} }
  return out;
}

const cacheCola = new Map();   // ruta → { size, mtime, titulo, modelo }
// leeCoordinacion({ dir, ahora, vivo }) → lo que va en estado.coordinacion. Nunca lanza: lo que no se puede leer, no está.
async function leeCoordinacion({ dir = CLAUDE, ahora = Date.now(), vivo = pidVivo } = {}) {
  const hay = async (p) => { try { await fsp.access(p); return true; } catch (e) { return false; } };
  const out = { equipo: false, t: ahora, viejo: false, presupuesto: null, piden: [], lista: [] };
  if (!LISTA.length) return out;   // sin coordinadores: nada que leer
  const [hHand, hAv, hProj, hSes] = await Promise.all([hay(path.join(dir, "handoffs")), hay(path.join(dir, "avisos", "pendientes.jsonl")), hay(path.join(dir, "projects")), hay(path.join(dir, "sessions"))]);
  let fresco = 0;
  // 1) lo que piden a Humano (pendientes.jsonl: solo se añade; los de los últimos 7 días)
  if (hAv) { try {
    const txt = await fsp.readFile(path.join(dir, "avisos", "pendientes.jsonl"), "utf8"); let tAnt = 0;
    for (const l of txt.split(/\r?\n/).slice(-400)) { let j; try { j = JSON.parse(l); } catch (e) { continue; }
      if (!j || !j.id || !j.texto) continue; let t = Date.parse(j.ts) || 0;
      // una hora que aún no ha llegado es un error de quien la escribió: vale la del aviso anterior (o ahora)
      if (t > ahora + 60e3) t = Math.min(ahora, tAnt || ahora);
      tAnt = Math.max(tAnt, t); if (ahora - t > 7 * 24 * HORA) continue;
      out.piden.push({ id: String(j.id).slice(0, 120), de: String(j.de || "").toLowerCase().slice(0, 40), t, prioridad: j.prioridad === "alta" ? "alta" : "normal", texto: corta(j.texto, 400) }); }
    out.piden.sort((a, b) => b.t - a.t); out.piden = out.piden.slice(0, 40);
    if (out.piden.length) fresco = Math.max(fresco, out.piden[0].t);
  } catch (e) {} }
  // 2) sesiones abiertas (un fichero por proceso de Claude Code)
  const ses = [];
  if (hSes) { try { for (const f of (await fsp.readdir(path.join(dir, "sessions"))).filter((x) => /^\d+\.json$/.test(x)).slice(0, 80)) { try {
    const j = JSON.parse(await fsp.readFile(path.join(dir, "sessions", f), "utf8"));
    if (j && j.sessionId && vivo(+j.pid)) ses.push({ id: j.sessionId, nombre: String(j.name || ""), estado: j.status === "busy" ? "trabajando" : "libre", t: +j.statusUpdatedAt || +j.updatedAt || +j.startedAt || 0 });
  } catch (e) {} } } catch (e) {} }
  // 3) transcripts con movimiento en los últimos 3 días (solo la cola; se recuerda mientras el fichero no cambie)
  const trans = [];
  if (hProj) { try { for (const d of await fsp.readdir(path.join(dir, "projects"))) { let fs2 = []; try { fs2 = (await fsp.readdir(path.join(dir, "projects", d))).filter((x) => /^[0-9a-f-]{20,}\.jsonl$/i.test(x)); } catch (e) { continue; }
    for (const f of fs2) { const ruta = path.join(dir, "projects", d, f); let st; try { st = await fsp.stat(ruta); } catch (e) { continue; }
      if (ahora - st.mtimeMs > 72 * HORA) continue; trans.push({ dir: d, id: f.replace(/\.jsonl$/i, ""), ruta, size: st.size, t: st.mtimeMs }); } } } catch (e) {} }
  trans.sort((a, b) => b.t - a.t);
  for (const x of trans.slice(0, 60)) { let c = cacheCola.get(x.ruta);
    if (!c || c.size !== x.size || c.mtime !== x.t) { const n = await colaDe(x.ruta);
      try { n.titulo = String(JSON.parse(await fsp.readFile(path.join(x.ruta.replace(/\.jsonl$/i, ""), "custom-title.json"), "utf8")).customTitle || "") || n.titulo; } catch (e) {} c = { size: x.size, mtime: x.t, titulo: n.titulo || (c && c.titulo) || "", modelo: n.modelo || (c && c.modelo) || "" }; cacheCola.set(x.ruta, c); }
    const s = ses.find((y) => y.id === x.id); x.titulo = c.titulo || (s && s.nombre) || ""; x.modelo = modeloLlano(c.modelo); x.ses = s || null; }
  for (const k of [...cacheCola.keys()]) if (!trans.some((x) => x.ruta === k)) cacheCola.delete(k);
  const vistos = trans.slice(0, 60);
  // 4) cada coordinador
  const coordDe = new Map();   // transcript → coordinador
  for (const c of LISTA) { const t = vistos.find((x) => esCoord(c, x.titulo) && !coordDe.has(x)); if (t) coordDe.set(t, c); }
  for (const c of LISTA) {
    const o = { id: c.id, nombre: c.nombre, estado: "sin_datos", ult: 0, modelo: "", sesion: "", relevo: null, chats: [], piden: out.piden.filter((p) => p.de === c.id).length };
    const tr = [...coordDe.entries()].find(([, cc]) => cc === c), sv = ses.find((s) => esCoord(c, s.nombre));
    if (tr) { o.ult = tr[0].t; o.modelo = tr[0].modelo; o.sesion = tr[0].titulo; }
    const s = (tr && tr[0].ses) || sv;
    if (s) { o.estado = s.estado; o.sesion = o.sesion || s.nombre; o.ult = Math.max(o.ult, s.estado === "trabajando" ? ahora : s.t); }
    const fRel = c.proy ? path.join(dir, "handoffs", c.proy, "coordinador.md") : path.join(dir, "handoffs", "jefe.md");
    if (hHand) { try { const st = await fsp.stat(fRel); if (st.size < 400000) { o.relevo = { t: st.mtimeMs, ...leeRelevo(await fsp.readFile(fRel, "utf8")) }; fresco = Math.max(fresco, st.mtimeMs); } } catch (e) {} }
    if (o.estado === "sin_datos" && (tr || o.relevo)) o.estado = "parado";
    // sus chats de tarea: las otras sesiones de sus carpetas (con nombre, o abiertas) y los subagentes que ha lanzado él, de las últimas 24 h
    if (c.dirs) o.chats = vistos.filter((x) => c.dirs.test(x.dir) && !coordDe.has(x) && !/^\s*coord(?:inador)?\b/i.test(x.titulo) && (x.ses || (x.titulo && ahora - x.t < 24 * HORA)))
      .map((x) => ({ nombre: corta(x.titulo, 70) || "chat sin nombre", estado: x.ses ? x.ses.estado : "parado", ult: x.t, modelo: x.modelo }));
    if (tr) o.chats.push(...await subagentes(tr[0].ruta.replace(/\.jsonl$/i, ""), ahora));
    { const orden = { trabajando: 0, libre: 1, parado: 2, terminado: 3 }, nombres = new Set();
      o.chats = o.chats.sort((a, b) => orden[a.estado] - orden[b.estado] || b.ult - a.ult).filter((x) => !nombres.has(x.nombre) && nombres.add(x.nombre));
      o.masChats = Math.max(0, o.chats.length - 6); o.chats = o.chats.slice(0, 6); }
    fresco = Math.max(fresco, o.ult);
    if (c.id === "jefe" && o.relevo && o.relevo.presupuesto) { const p = o.relevo.presupuesto, m = p.match(/(\d{1,3})\s?%/); out.presupuesto = { texto: p, pct: m ? Math.min(100, +m[1]) : null, t: o.relevo.t, ...reinicioDe(p, o.relevo.t, ahora) }; }
    out.lista.push(o);
  }
  out.equipo = out.lista.some((o) => o.estado !== "sin_datos") || out.piden.length > 0;
  if (!out.equipo) { out.lista = []; return out; }
  out.fresco = fresco; out.viejo = !!fresco && ahora - fresco > 48 * HORA;
  return out;
}
// lo último leído (la oficina lo refresca cada minuto, en asíncrono: analizar no espera al disco)
let ultima = { equipo: false, t: 0, viejo: false, presupuesto: null, piden: [], lista: [] }, leyendo = false;
async function refresca(o) { if (leyendo) return ultima; leyendo = true; try { ultima = await leeCoordinacion(o); } catch (e) {} finally { leyendo = false; } return ultima; }
const coordinacion = () => ultima;

module.exports = { reinicioDe, configura, haySF, SF, detectaSF, leeAuto, apuntaNo, autoSalesforce, listaParaCoord, escribeParaCoord, quizaParaCoord, huellaSF, PARA_COORD,
  leeRelevo, leeCoordinacion, refresca, coordinacion, modeloLlano, LISTA };
