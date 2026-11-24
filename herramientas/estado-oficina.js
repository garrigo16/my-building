//   node estado-oficina.js errores   → lo que falló el último día apuntado en cada equipo (trae antes lo último subido)
//
// Uso: node estado-oficina.js sube|baja|ver|errores [--seco] [--forzar]     (--forzar: baja aunque lo último lo subiera este equipo)
// Pruebas: OFICINA_ESTADO_DIR=<carpeta> (en vez de ~/.oficina), OFICINA_EQUIPO=<nombre>, ESTADO_REPO=<repo git>,
// CANAL_LOGS=<carpeta> (en vez de ~/.canal-logs; con OFICINA_ESTADO_DIR y sin ella, <carpeta>/canal-logs: nunca la de verdad).
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");

const REPO = process.env.ESTADO_REPO || path.join(__dirname, "..");
const RAMA = "estado-oficina", REF = "refs/remotes/origin/" + RAMA;
const FICH = ["apuntes.json", "jira-vistos.json", "privados.json"];
const DIR = process.env.OFICINA_ESTADO_DIR || path.join(os.homedir(), ".oficina");
// v555: lo de ~/.canal-logs que también sigue al turno
const LOGS = process.env.CANAL_LOGS || (process.env.OFICINA_ESTADO_DIR ? path.join(DIR, "canal-logs") : path.join(os.homedir(), ".canal-logs"));
const FICH_LOGS = ["juntados.txt", "estoy-en-ello.json"], DELEG = "delegados", PRE_DELEG = "delegados--";
const EQUIPO = (process.env.OFICINA_EQUIPO || (() => { try { return fs.readFileSync(path.join(os.homedir(), ".config", "oficina-equipo.txt"), "utf8"); } catch (e) { return ""; } })()).trim().toLowerCase();

const git = (args, input) => execFileSync("git", ["-C", REPO, "-c", "gc.auto=0", ...args], { encoding: "utf8", input, timeout: 90e3, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" } }).trim();
const quiza = (f) => { try { return f(); } catch (e) { return null; } };
const traer = () => quiza(() => git(["fetch", "-q", "--no-write-fetch-head", "origin", `+refs/heads/${RAMA}:${REF}`])) !== null;

function meta() { const t = quiza(() => git(["show", `${REF}:meta.json`])); return t ? quiza(() => JSON.parse(t)) || {} : null; }

// v555: los ficheros de ~/.canal-logs que viajan: [{ nombre (en la rama), ruta (en este equipo) }]. Solo nombres sencillos.
const NOMBRE_DELEG = /^[\w.-]{1,60}\.txt$/i;
function deLogs(logs = LOGS) {
  const o = FICH_LOGS.map((f) => ({ nombre: f, ruta: path.join(logs, f) }));
  const fichs = quiza(() => fs.readdirSync(path.join(logs, DELEG))) || [];
  for (const f of fichs.filter((x) => NOMBRE_DELEG.test(x)).sort()) o.push({ nombre: PRE_DELEG + f, ruta: path.join(logs, DELEG, f) });
  return o;
}
const DIARIO = require(path.join(__dirname, "..", "oficina", "diario.js"));
const locales = () => FICH.map((f) => ({ nombre: f, ruta: path.join(DIR, f) })).concat(deLogs()).concat(DIARIO.enCarpeta(DIR).map(({ nombre, ruta }) => ({ nombre, ruta })));
const lineasDe = (t) => String(t || "").replace(/^﻿/, "").split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
function juntaLineas(bajado, local) {
  const vistas = new Set(), o = [];
  for (const l of lineasDe(bajado).concat(lineasDe(local))) { if (vistas.has(l.trim())) continue; vistas.add(l.trim()); o.push(l); }
  return o.length ? o.join("\n") + "\n" : "";
}
// lo que queda en este equipo al bajar uno de los ficheros de ~/.canal-logs (null = no se toca)
function mezcla(nombre, bajado, local, { localMasNuevo = false } = {}) {
  if (nombre === "estoy-en-ello.json") {
    const b = quiza(() => JSON.parse(bajado)), l = quiza(() => JSON.parse(local || "{}")) || {};
    if (!b || typeof b !== "object" || Array.isArray(b)) return null;   // nunca se escribe algo que no sea JSON válido
    return JSON.stringify({ ...b, ...l });   // lo enviado desde cualquiera de los dos equipos, enviado está
  }
  if (nombre === "juntados.txt") return juntaLineas(bajado, local);
  return localMasNuevo ? juntaLineas(bajado, local) : bajado;   // delegados--<coordinador>.txt
}

function sube({ seco } = {}) {
  if (!EQUIPO) return "sin ~/.config/oficina-equipo.txt: no hay turno, nada que subir";
  traer();
  const padre = quiza(() => git(["rev-parse", "--verify", "-q", REF]));
  const filas = [], cambian = [];
  for (const { nombre: f, ruta: p } of locales()) {
    if (!fs.existsSync(p)) continue;
    const blob = git(["hash-object", "-w", p]);
    if (!padre || quiza(() => git(["rev-parse", `${REF}:${f}`])) !== blob) cambian.push(f);
    filas.push(`100644 blob ${blob}\t${f}`);
  }
  const m = meta();
  if (padre && !cambian.length && m && m.equipo === EQUIPO) return "sin cambios";
  if (seco) return `subiría (${EQUIPO}): ${cambian.join(", ") || "solo quién lo tiene"}`;
  const mb = git(["hash-object", "-w", "--stdin"], JSON.stringify({ equipo: EQUIPO, t: Date.now() }));
  filas.push(`100644 blob ${mb}\tmeta.json`);
  const arbol = git(["mktree"], filas.sort((a, b) => a.split("\t")[1].localeCompare(b.split("\t")[1])).join("\n") + "\n");
  const commit = git(["commit-tree", arbol, ...(padre ? ["-p", padre] : []), "-m", `estado de la oficina (${EQUIPO}) ${new Date().toISOString()}`]);
  for (let i = 0; i < 2; i++) {
    if (quiza(() => git(["push", "-q", "origin", `${commit}:refs/heads/${RAMA}`])) !== null) { quiza(() => git(["update-ref", REF, commit])); return `subido (${EQUIPO}): ${cambian.join(", ") || "quién lo tiene"}`; }
    traer();   // otro subió entre medias: lo mío va encima (el turno es mío)
  }
  throw new Error("no he podido subir el estado (push rechazado dos veces)");
}

function baja({ seco, forzar } = {}) {
  if (!traer() && !quiza(() => git(["rev-parse", "--verify", "-q", REF]))) return "no hay estado subido todavía (rama estado-oficina)";
  const m = meta() || {};
  if (m.equipo === EQUIPO && !forzar) return `lo último lo subió este equipo (${EQUIPO}): no hace falta bajarlo`;
  const hechos = [];
  const antes = path.join(DIR, "antes"), sello = new Date().toISOString().replace(/[:.]/g, "-");
  const muestra = (f) => quiza(() => execFileSync("git", ["-C", REPO, "show", `${REF}:${f}`], { encoding: "utf8", timeout: 60e3, stdio: ["pipe", "pipe", "pipe"] }));
  const escribe = (p, f, txt) => {   // lo de aquí se guarda antes en ~/.oficina/antes/
    fs.mkdirSync(antes, { recursive: true }); fs.mkdirSync(path.dirname(p), { recursive: true });
    if (fs.existsSync(p)) fs.copyFileSync(p, path.join(antes, `${f}.${sello}`));
    fs.writeFileSync(p + ".tmp", txt); fs.renameSync(p + ".tmp", p);
  };
  for (const f of FICH) {
    const txt = muestra(f);
    if (txt === null) continue;
    if (quiza(() => JSON.parse(txt)) === null) continue;   // nunca se escribe algo que no sea JSON válido
    if (!seco) escribe(path.join(DIR, f), f, txt);
    hechos.push(f);
  }
  // v555: lo de ~/.canal-logs se junta con lo local (ver arriba). Si el otro equipo aún no lo sube (código viejo), no se toca nada.
  const enRama = (quiza(() => git(["ls-tree", "--name-only", REF])) || "").split(/\r?\n/).filter(Boolean);
  for (const f of enRama.filter((x) => FICH_LOGS.includes(x) || (x.startsWith(PRE_DELEG) && NOMBRE_DELEG.test(x.slice(PRE_DELEG.length))))) {
    const txt = muestra(f); if (txt === null) continue;
    const p = f.startsWith(PRE_DELEG) ? path.join(LOGS, DELEG, f.slice(PRE_DELEG.length)) : path.join(LOGS, f);
    const local = quiza(() => fs.readFileSync(p, "utf8")), mt = quiza(() => fs.statSync(p).mtimeMs) || 0;
    const queda = mezcla(f, txt, local, { localMasNuevo: local !== null && mt > (m.t || 0) });
    if (queda === null || queda === local) continue;
    if (!seco) escribe(p, f, queda);
    hechos.push(f);
  }
  hechos.push(...bajaDiarios({ seco }));
  // en ~/.oficina/antes quedan las 30 copias más nuevas
  quiza(() => fs.readdirSync(antes).sort().reverse().slice(30).forEach((f) => fs.unlinkSync(path.join(antes, f))));
  const de = m.equipo ? `de «${m.equipo}», ${new Date(m.t || 0).toLocaleString("es-ES")}` : "";
  return `${seco ? "bajaría" : "bajado"} ${de}: ${hechos.join(", ") || "nada"}`;
}

// v563: los diarios de errores de los OTROS equipos que hay en la rama → ~/.oficina (sin copia en antes/: son del otro equipo y
// se rehacen solos). El de este equipo no se toca. Devuelve los nombres escritos.
function bajaDiarios({ seco } = {}) {
  const o = [];
  for (const f of (quiza(() => git(["ls-tree", "--name-only", REF])) || "").split(/\r?\n/).filter((x) => DIARIO.NOMBRE.test(x))) {
    if (f.match(DIARIO.NOMBRE)[1].toLowerCase() === EQUIPO) continue;
    const txt = quiza(() => git(["show", `${REF}:${f}`])); if (txt === null) continue;
    const d = quiza(() => JSON.parse(txt)); if (!d || typeof d !== "object" || !d.dias) continue;   // nunca se escribe algo roto
    const p = path.join(DIR, f); if (quiza(() => fs.readFileSync(p, "utf8").trim()) === txt.trim()) continue;
    if (!seco) { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(p + ".tmp", txt); fs.renameSync(p + ".tmp", p); }
    o.push(f);
  }
  return o;
}
// lo que falló el último día apuntado en cada equipo (primero el otro: es lo que no se ve desde aquí)
function errores() {
  if (traer()) bajaDiarios();
  const ds = DIARIO.enCarpeta(DIR).sort((a, b) => (a.equipo === EQUIPO) - (b.equipo === EQUIPO));
  if (!ds.length) return "Ningún equipo tiene diario de errores todavía (lo escribe la oficina desde la v563: git pull y reiniciarla en los dos).";
  const m = meta() || {}, o = [];
  for (const x of ds) o.push(...DIARIO.resumen(DIARIO.lee(x.ruta, x.equipo)));
  if (m.equipo && m.equipo !== EQUIPO && !ds.some((x) => x.equipo === m.equipo)) o.unshift(`«${m.equipo}» no ha subido su diario de errores: su oficina tiene código anterior a la v563 (allí: git pull y reiniciarla).`);
  return o.join("\n");
}

module.exports = { sube, baja, meta, FICH, RAMA, FICH_LOGS, deLogs, mezcla, juntaLineas, bajaDiarios, errores };

if (require.main === module) {
  const [orden] = process.argv.slice(2), seco = process.argv.includes("--seco"), forzar = process.argv.includes("--forzar");
  try {
    if (orden === "sube") console.log(sube({ seco }));
    else if (orden === "baja") console.log(baja({ seco, forzar }));
    else if (orden === "errores") console.log(errores());
    else if (orden === "ver") { traer(); console.log(JSON.stringify(meta())); }
    else { console.log("uso: node estado-oficina.js sube|baja|ver|errores [--seco] [--forzar]"); process.exit(2); }
  } catch (e) { console.error("estado-oficina: " + String(e.message).split("\n")[0]); process.exit(1); }
}
