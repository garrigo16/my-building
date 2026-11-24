"use strict";
const fs = require("fs"), path = require("path");
const MIN = 60e3, DIA = 24 * 3600e3;

const SIN_CONFIG = "manual", CON_CONFIG = "manual";
const COCINA = { ignora: ["estado-oficina", "canal/*"], minutos: 45, dias: 3, diasPR: 30 };

function leeConfig({ dir = __dirname, env = process.env, leer = (f) => fs.readFileSync(f, "utf8") } = {}) {
  let c = null, fichero = "";
  const cand = env.EDIFICIO_CONFIG === "ninguno" ? [] : [env.EDIFICIO_CONFIG, path.join(dir, "..", "config.local.json"), path.join(dir, "config.local.json")].filter(Boolean);
  for (const f of cand) { try { const x = JSON.parse(String(leer(f)).replace(/^﻿/, "")); if (x && typeof x === "object") { c = x; fichero = f; break; } } catch (e) {} }
  const vale = (v) => (/^(auto|manual)$/.test(String(v || "").trim().toLowerCase()) ? String(v).trim().toLowerCase() : "");
  const k = (c && c.cocina && typeof c.cocina === "object") ? c.cocina : {};
  const num = (v, d) => (Number.isFinite(+v) && +v > 0 ? +v : d);
  return { actualizar: vale(env.OFICINA_ACTUALIZAR) || vale(c && c.actualizar) || (c ? CON_CONFIG : SIN_CONFIG), fichero,
    cocina: { ignora: Array.isArray(k.ignora) ? k.ignora.map(String) : COCINA.ignora, minutos: num(k.minutos, COCINA.minutos), dias: num(k.dias, COCINA.dias), diasPR: num(k.diasPR, COCINA.diasPR) } };
}

function resumeCommit(s) {
  let t = String(s || "").replace(/^\s*(v\d+(\s*\[[^\]]*\])?(\s*\+\s*v\d+(\s*\[[^\]]*\])?)*)\s*[:·—-]?\s*/i, "").split(/;\s|\.\s/)[0].trim();
  if (t.length > 90) t = t.slice(0, 89).replace(/\s+\S*$/, "") + "…";
  return t;
}
function versionDe(asuntos) { for (const s of asuntos) { const m = String(s).match(/\bv(\d{3,})\b/); if (m) return m[1]; } return ""; }
// asuntos: del más nuevo al más viejo
function queTrae(asuntos, max = 2) {
  const v = asuntos.map(resumeCommit).filter(Boolean);
  if (!v.length) return "";
  return v.slice(0, max).join(" · ") + (v.length > max ? ` · y ${v.length - max} más` : "");
}
const casaGlob = (nombre, globs) => (globs || []).some((g) => new RegExp("^" + String(g).split("*").map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$").test(nombre));
const cuando = (t, ahora) => (new Date(t).toDateString() === new Date(ahora).toDateString() ? "a las " + hhmm(t) : "el " + new Date(t).getDate() + "/" + (new Date(t).getMonth() + 1));
const hhmm = (t) => new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

// ---------- cocina ----------
// ejecuta(cmd, args, opts) → { ok, out } (el `run` de server.js). memo: lo que no hace falta volver a preguntar (por sha).
// est: lo de miraCodigo ({ detras, remotoSha }) · sinEstrenar: hay código en disco que la oficina en marcha no ha estrenado.
async function miraCocina({ ejecuta, repo, ahora = Date.now(), cfg = COCINA, memo = {}, sinEstrenar = false, remotos = ["origin"], stat = (f) => fs.statSync(f).mtimeMs, existe = fs.existsSync, leer = (f) => fs.readFileSync(f, "utf8") } = {}) {
  const g = (...a) => ejecuta("git", ["-C", repo, ...a], { timeout: 60e3 });
  const gd = (dir, ...a) => ejecuta("git", ["-C", dir, ...a], { timeout: 30e3 });
  const sale = { lista: null, cocina: [], t: ahora };
  const local = String((await g("rev-parse", "HEAD")).out || "").trim();
  if (!local) return sale;
  const R = remotos[0] || "origin", refsDe = {};
  for (const r of remotos) { const rem = await g("ls-remote", r); refsDe[r] = {};
    if (rem.ok) for (const l of String(rem.out || "").split("\n")) { const m = l.match(/^([0-9a-f]{40})\s+(\S+)/); if (m) refsDe[r][m[2]] = m[1]; } }
  const refs = refsDe[R] || {};
  const main = refs["refs/heads/main"] || "";
  const tiene = async (sha) => (await g("cat-file", "-e", sha + "^{commit}")).ok;
  let base = "";   // contra qué se mide lo que está en cocina: el main del remoto si lo tenemos; si no hay red, el de la última vez
  if (main && (await tiene(main) || ((await g("fetch", "-q", R, "main")).ok && await tiene(main)))) base = main;
  if (!base) { const o = String((await g("rev-parse", "-q", "--verify", "refs/remotes/" + R + "/main")).out || "").trim(); base = /^[0-9a-f]{40}$/.test(o) ? o : local; }
  // 2) versión nueva lista: lo que main tiene y este equipo no
  if (base !== local) {
    const ls = String((await g("log", "-40", "--format=%H%x09%s", `${local}..${base}`)).out || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => l.split("\t"));
    if (ls.length) { const asuntos = ls.map((x) => x.slice(1).join("\t")); sale.lista = { sha: base, n: ls.length, version: versionDe(asuntos), trae: queTrae(asuntos), bajada: false }; }
  }
  if (!sale.lista && sinEstrenar) {   // ya está en el disco (alguien hizo el pull, o se subió desde aquí) y falta estrenarlo
    const asunto = String((await g("log", "-1", "--format=%s", local)).out || "").trim();
    sale.lista = { sha: local, n: 0, version: versionDe([asunto]), trae: queTrae([asunto]), bajada: true };
  }
  // 3) este equipo: worktrees con trabajo reciente (una IA) y el propio checkout con cambios a medias
  const recienteMs = cfg.minutos * MIN;
  const tocado = async (dir) => {   // { n: ficheros cambiados, t: el más reciente }
    const st = await gd(dir, "status", "--porcelain"); if (!st.ok) return { n: 0, t: 0 };
    const fs_ = String(st.out || "").split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.length > 3).map((l) => l.slice(3).replace(/^.* -> /, "").replace(/^"|"$/g, ""));
    let t = 0; for (const f of fs_.slice(0, 60)) { try { t = Math.max(t, stat(path.join(dir, f))); } catch (e) {} }
    return { n: fs_.length, t };
  };
  const delante = async (sha) => {   // { n: commits que no están en main, t: el último }
    if (!sha || sha === base) return { n: 0, t: 0 };
    const k = sha + ":" + base; if (memo[k]) return memo[k];
    const n = +String((await g("rev-list", "--count", `${base}..${sha}`)).out || "").trim() || 0;
    const t = n ? (+String((await g("log", "-1", "--format=%ct", sha)).out || "").trim() || 0) * 1000 : 0;
    return (memo[k] = { n, t });
  };
  const wl = await g("worktree", "list", "--porcelain");
  const wts = String(wl.out || "").split(/\n\s*\n/).map((b) => ({ dir: (b.match(/^worktree (.+)$/m) || [])[1], sha: (b.match(/^HEAD ([0-9a-f]{40})/m) || [])[1], rama: ((b.match(/^branch refs\/heads\/(.+)$/m) || [])[1] || "").trim() }))
    .filter((w) => w.dir).map((w) => ({ ...w, dir: w.dir.trim() }));
  const vivos = [];
  const mismo = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  for (const w of wts) {
    if (mismo(w.dir, repo) || !existe(w.dir)) continue;   // (este checkout se mira aparte)
    // sin lanzar git: ¿se ha movido algo en su carpeta de git en el último día?
    let gitdir = ""; try { gitdir = (String(leer(path.join(w.dir, ".git"))).match(/^gitdir:\s*(.+)$/m) || [])[1] || ""; } catch (e) {}
    let mov = 0; for (const f of ["index", "HEAD", "logs/HEAD"]) { try { mov = Math.max(mov, stat(path.join(gitdir.trim(), f))); } catch (e) {} }
    if (gitdir && ahora - mov < DIA) vivos.push({ ...w, mov });
  }
  vivos.sort((a, b) => b.mov - a.mov);
  for (const w of vivos.slice(0, 8)) {
    const c = await tocado(w.dir), d = await delante(w.sha), t = Math.max(c.t, d.t);
    if ((c.n || d.n) && ahora - t < recienteMs) sale.cocina.push({ tipo: "ia", nombre: w.rama || path.basename(w.dir), ficheros: c.n, commits: d.n, t: Math.round(t) });
  }
  { const st = await gd(repo, "status", "--porcelain", "--untracked-files=no");
    const fs_ = String(st.out || "").split("\n").filter((l) => l.length > 3).map((l) => l.slice(3).replace(/^.* -> /, "").replace(/\r$/, "").replace(/^"|"$/g, ""));
    let t = 0; for (const f of fs_.slice(0, 60)) { try { t = Math.max(t, stat(path.join(repo, f))); } catch (e) {} }
    const d = await delante(local);
    if ((fs_.length || d.n) && ahora - Math.max(t, d.t) < recienteMs) sale.cocina.push({ tipo: "local", nombre: "este equipo", ficheros: fs_.length, commits: d.n, t: Math.round(Math.max(t, d.t)) }); }
  // 4) el remoto: ramas y PRs abiertas con commits que main no tiene
  const cand = [];
  for (const r of remotos) for (const [ref, sha] of Object.entries(refsDe[r] || {})) {
    let m;
    if (cand.some((c) => c.sha === sha && c.ref === ref)) continue;   // la misma rama en los dos remotos, una vez
    if ((m = ref.match(/^refs\/heads\/(.+)$/)) && m[1] !== "main" && !casaGlob(m[1], cfg.ignora)) cand.push({ tipo: "rama", nombre: m[1], ref, sha, remoto: r });
    else if ((m = ref.match(/^refs\/pull\/(\d+)\/head$/)) && refsDe[r][`refs/pull/${m[1]}/merge`]) cand.push({ tipo: "pr", nombre: "#" + m[1], num: +m[1], ref, sha, remoto: r });
  }
  for (const c of cand.slice(-12)) {
    if (sale.cocina.some((x) => x.tipo === "ia" && x.nombre === c.nombre)) continue;   // la rama de un worktree de aquí ya está contada
    let info = memo["i:" + c.sha];
    if (!info) {
      if (!(await tiene(c.sha)) && !((await g("fetch", "-q", c.remoto, c.ref)).ok && await tiene(c.sha))) continue;
      const l = String((await g("log", "-1", "--format=%ct%x09%an%x09%s", c.sha)).out || "").trim().split("\t");
      info = memo["i:" + c.sha] = { t: (+l[0] || 0) * 1000, autor: (l[1] || "").split(/\s+/)[0], asunto: resumeCommit(l.slice(2).join("\t")) };
    }
    const d = await delante(c.sha);
    if (!d.n || ahora - info.t > (c.tipo === "pr" ? cfg.diasPR : cfg.dias) * DIA) continue;
    sale.cocina.push({ tipo: c.tipo, nombre: c.nombre, autor: info.autor, asunto: info.asunto, commits: d.n, t: info.t });
  }
  if (Object.keys(memo).length > 400) for (const k of Object.keys(memo)) delete memo[k];   // (no crece sin fin)
  return sale;
}

// ---------- la línea ----------
// u: { modo, lista, cocina, pospuesto (ms), estrenando: { version, t }, reciente: { version, t }, bloqueado: "por qué no se pone al día solo" }
function lineaUpdate(u, ahora = Date.now()) {
  if (!u) return null;
  const v = (x) => (x && x.version ? "v" + x.version : "");
  if (u.estrenando) return { que: "estrenando", texto: `⬆ Actualizando${v(u.estrenando) ? " a " + v(u.estrenando) : ""}…`, botones: [] };
  if (u.lista) {
    const L = u.lista, trae = L.trae ? ` (${L.trae})` : "";
    if (u.modo === "manual") {
      if (u.pospuesto > ahora) return { que: "pospuesta", texto: `⬆ ${v(L) || "Versión nueva"} lista · pospuesta hasta las ${hhmm(u.pospuesto)}`, botones: ["ahora"] };
      return { que: "lista", texto: `⬆ Versión nueva lista${v(L) ? ": " + v(L) : ""}${trae}`, botones: ["ahora", "posponer"] };
    }
    if (u.bloqueado) return null;
    return { que: "lista", texto: `⬆ Versión nueva lista${v(L) ? ": " + v(L) : ""}${trae} · se estrena sola en un momento`, botones: [] };
  }
  if (u.reciente && ahora - u.reciente.t < 3 * MIN) return { que: "estrenada", texto: `✔ Estrenada la ${v(u.reciente) || "versión nueva"} a las ${hhmm(u.reciente.t)}`, botones: [] };
  const K = u.cocina || [];
  if (K.length) {
    const ias = K.filter((x) => x.tipo === "ia"), ult = Math.max(0, ...ias.map((x) => x.t));
    const p = [];
    if (ias.length === 1) p.push(`una IA trabajando en la oficina (último cambio, ${cuando(ult, ahora)})`);
    else if (ias.length > 1) p.push(`${ias.length} IAs trabajando en la oficina (último cambio, ${cuando(ult, ahora)})`);
    for (const x of K.filter((x) => x.tipo === "local")) p.push(`cambios en este equipo sin subir (${x.ficheros ? x.ficheros + (x.ficheros === 1 ? " fichero" : " ficheros") : x.commits + (x.commits === 1 ? " commit" : " commits")})`);
    for (const x of K.filter((x) => x.tipo === "pr")) p.push(`PR ${x.nombre}${x.autor ? " de " + x.autor : ""}${x.asunto ? ` («${x.asunto}»)` : ""}`);
    for (const x of K.filter((x) => x.tipo === "rama")) p.push(`rama ${x.nombre}${x.autor ? " de " + x.autor : ""} (${x.commits} ${x.commits === 1 ? "commit" : "commits"}, ${cuando(x.t, ahora)})`);
    const txt = p.slice(0, 3).join(" · ") + (p.length > 3 ? ` · y ${p.length - 3} más` : "");
    return { que: "cocina", texto: "🍳 Update en cocina: " + txt, botones: [] };
  }
  return null;
}

// ---------- lo que se recuerda entre arranques (~/.canal-logs/update.json): { pospuesto: ms, malo: { sha, huella, version, motivo, t } } ----------
function leeMemoria(f) { try { const x = JSON.parse(fs.readFileSync(f, "utf8")); return x && typeof x === "object" ? x : {}; } catch (e) { return {}; } }
function guardaMemoria(f, m) { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + ".tmp", JSON.stringify(m)); fs.renameSync(f + ".tmp", f); return true; } catch (e) { return false; } }

async function rollback({ ejecuta, repo, r, motivo, antes = "" }) {
  const g = (...a) => ejecuta("git", ["-C", repo, ...a], { timeout: 60e3 });
  const que = String(motivo || "no ha arrancado").replace(/\s+/g, " ").trim().slice(0, 160);
  const nueva = r && r.version ? "v" + r.version : "versión nueva";
  if (!r || !r.deSha || !r.aSha || r.deSha === r.aSha)
    return { vuelta: false, aviso: `El código nuevo de este equipo (${nueva}) no arranca: ${que}. La oficina sigue en marcha con el de antes; no se probará otra vez hasta que cambie.` };
  const cabeza = String((await g("rev-parse", "HEAD")).out || "").trim();
  const sucio = String((await g("status", "--porcelain", "--untracked-files=no")).out || "").trim();
  let vuelta = false;
  if (cabeza === r.aSha && !sucio) vuelta = (await g("reset", "-q", "--keep", r.deSha)).ok;
  const va = antes ? "v" + antes : "anterior";
  return { vuelta, aviso: vuelta
    ? `La ${nueva} no arranca: ${que}. He vuelto sola a la ${va} y la oficina sigue en marcha (sin corte). Se probará otra vez cuando haya otra versión en main.`
    : `La ${nueva} no arranca: ${que}. La oficina sigue en marcha con la ${va} en memoria, pero el disco tiene la nueva (no he podido deshacerla): no reinicies la oficina hasta que se arregle.` };
}

function remotosDe(lista) { const l = String(lista || "").split(/\s+/).filter(Boolean); return l.includes("beta") ? ["beta", ...(l.includes("origin") ? ["origin"] : [])] : ["origin"]; }
module.exports = { remotosDe, leeConfig, resumeCommit, versionDe, queTrae, casaGlob, miraCocina, lineaUpdate, leeMemoria, guardaMemoria, rollback, COCINA, SIN_CONFIG, CON_CONFIG };
