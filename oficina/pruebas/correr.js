// correr.js - las pruebas de la oficina y de los scripts. Sin red, sin Slack, sin git remoto y sin escribir nada fuera de
// carpetas temporales. Reloj fijo: cada caso dice a qué hora mira.
// Uso:  node oficina/pruebas/correr.js            todas (sale con código 1 si falla alguna; pásalas antes de cada commit)
//       node oficina/pruebas/correr.js <texto>…   solo las que llevan <texto> en el nombre (o son de ese fichero, p. ej. cursor-cli); varios = cualquiera
// Carga sola cualquier fichero de esta carpeta que exporte sus casos: module.exports = async (ayudas) => { … }.
// Las ayudas: prueba, igual, casa, distinto, T, setAhora, oficina, tema y C (datos.js: m, ts, LOGS0…).
"use strict";
process.env.EDIFICIO_CONFIG = "ninguno";   // las pruebas no leen la config de este equipo: solo los valores de ejemplo (herramientas/config.js)
const fs = require("fs"), path = require("path");

if (process.platform === "win32") {
  let gb = require("../../herramientas/git-bash.js").gitBash(); if (gb && !fs.existsSync(gb)) gb = "";
  const usr = gb && path.join(path.dirname(path.dirname(gb)), "usr", "bin");
  if (usr && fs.existsSync(path.join(usr, "bash.exe"))) gb = path.join(usr, "bash.exe");
  if (gb) { process.env.PATH = path.dirname(gb) + path.delimiter + process.env.PATH; console.log("Git Bash para las pruebas: " + gb); }
  else console.log("⚠ no encuentro Git Bash: las pruebas de los scripts fallarán (instala Git for Windows)");
}

// reloj fijo: la oficina y los módulos usan Date.now() y new Date()
const FechaReal = Date; global.FechaReal = FechaReal; let AHORA = FechaReal.now();
global.Date = class extends FechaReal { constructor(...a) { if (a.length) super(...a); else super(AHORA); } static now() { return AHORA; } };

const C = require("./datos.js");
const S = require("../server.js");
const { T } = C;

let ok = 0, mal = 0, saltadas = 0;
// filtros: uno o varios (cualquiera vale); cada uno casa con el nombre del caso o con el nombre del fichero (sin .js)
const FILTROS = process.argv.slice(2).filter((a) => !a.startsWith("--")).map((a) => a.toLowerCase());
let FICHERO = "";
const pasaFiltro = (n) => !FILTROS.length || FILTROS.some((f) => n.toLowerCase().includes(f) || FICHERO === f);
const prueba = async (n, fn) => { if (!pasaFiltro(n)) { saltadas++; return; }
  try { await fn(); ok++; console.log("  ✔ " + n); } catch (e) { mal++; console.log("  ✘ " + n + "\n      " + String(e.message).split("\n").join("\n      ")); } };
const igual = (a, b, q) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${q}: esperaba ${JSON.stringify(b)} y sale ${JSON.stringify(a)}`); };
const casa = (x, re, q) => { if (!re.test(String(x))) throw new Error(`${q}: «${x}» no casa con ${re}`); };
const distinto = (a, b, q) => { if (a === b) throw new Error(`${q}: no debería ser «${b}»`); };
function oficina(hms, hilos, o = {}) {
  AHORA = T(hms); S.setPR(o.pr || {});
  return S.analizar(hilos, { ...C.LOGS0(), ...(o.L || {}) }, null, o.agentes || null, o.git || []);
}
const tema = (a, h) => a.hilos.find((x) => x.ts === h.ts) || (() => { throw new Error("no sale el hilo " + h.ts); })();

(async () => {
  const NO_CASOS = new Set(["correr.js", "datos.js", "en-vivo.js"]);
  const ficheros = fs.readdirSync(__dirname).filter((f) => f.endsWith(".js") && !NO_CASOS.has(f)).sort();
  for (const f of ficheros) {
    FICHERO = f.replace(/\.js$/, "").toLowerCase();
    const mod = require(path.join(__dirname, f));
    if (typeof mod === "function") await mod({ prueba, igual, casa, distinto, C, T, oficina, tema, setAhora: (t) => { AHORA = t; } });
  }
  console.log(`\n${mal ? "✘" : "✔"} ${ok} bien, ${mal} mal · ${ficheros.length} ficheros${saltadas ? ` · ${saltadas} fuera del filtro` : ""}`);
  process.exit(mal ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
