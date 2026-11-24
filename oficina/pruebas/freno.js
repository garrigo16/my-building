// freno.js - v296: freno.sh (el freno anti ping-pong de los lanzamientos automáticos) y una prueba de humo de salud.js, con una
// carpeta de usuario temporal. Nada sale del equipo (salud.js solo lee).
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("el freno anti ping-pong (freno.sh) y salud.js");
  await prueba("v296: por hilo, como mucho N en una hora; global, también, salvo la PRIMERA vez de cada IA en un hilo; cerrojo viejo, fuera", () => {
    const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "freno-"));
    try {
      const f = (quien, hilo) => spawnSync("bash", [path.join(HERR, "freno.sh"), quien, ...(hilo ? [hilo] : [])], { encoding: "utf8",
        env: { ...process.env, HOME, FRENO_MAX: "3", FRENO_MAX_HILO: "2" } }).status;
      igual([f("claude", "h1"), f("cursor", "h1"), f("coo", "h1")], [0, 0, 12], "hilo h1: dos y el tercero, frenado");
      igual([f("claude"), f("claude")], [0, 12], "global (máx. 3): el cuarto sin hilo, frenado");
      igual([f("cursor", "h2"), f("cursor", "h2")], [0, 12], "pero la primera vez de Cursor en el hilo h2 pasa; la segunda, no");
      const log = fs.readFileSync(path.join(HOME, ".canal-lanzamientos.log"), "utf8").trim().split("\n");
      igual(log.map((l) => l.split(" ").slice(1).join(" ")), ["claude h1", "cursor h1", "claude -", "cursor h2"], "solo se apunta lo que pasa");
      fs.mkdirSync(path.join(HOME, ".canal-lanzamientos.log.cerrojo")); const t = Date.now() / 1000 - 300;
      fs.utimesSync(path.join(HOME, ".canal-lanzamientos.log.cerrojo"), t, t);
      igual(f("grok", "h3"), 0, "un cerrojo de hace 5 min (de un freno que murió) se quita y no frena todo para siempre");
    } finally { fs.rmSync(HOME, { recursive: true, force: true }); }
  });
  await prueba("v296: salud.js en un equipo sin nada (carpeta de usuario vacía) dice qué falta y no se rompe", () => {
    const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "salud-"));
    try {
      const r = spawnSync(process.execPath, [path.join(HERR, "salud.js")], { encoding: "utf8", timeout: 150e3, env: { ...process.env, HOME, USERPROFILE: HOME } });
      igual(r.status === 0 || r.status === 1, true, "termina con 0 (bien) o 1 (fallos), no con 2 (error suyo): " + (r.stderr || "").slice(0, 160));
      for (const s of ["Este equipo", "Código", "Claves (solo los nombres)", "Piezas", "Para trabajar"]) casa(r.stdout, new RegExp(`^${s.replace(/[()]/g, "\\$&")}$`, "m"), "sección " + s);
      casa(r.stdout, /no está ~\/\.config\/canal-slack\.env/, "dice que faltan las claves");
    } finally { fs.rmSync(HOME, { recursive: true, force: true }); }
  });
};
