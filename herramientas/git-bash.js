// git-bash.js - v356: dónde está Git Bash, para lanzar los .sh de las IAs. Antes había cuatro copias de esta búsqueda (escucha,
// oficina, salud.js y las pruebas) y solo miraban las dos rutas de siempre: con Git instalado en otro sitio (p. ej.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");

function whereGit() {
  try { return require("child_process").execFileSync("where", ["git"], { encoding: "utf8", windowsHide: true, timeout: 10000, stdio: ["ignore", "pipe", "ignore"] }).split(/\r?\n/).map((l) => l.trim()).filter(Boolean); }
  catch (e) { return []; }
}
function gitBash({ env = process.env, home = os.homedir(), existe = fs.existsSync, where = whereGit } = {}) {
  if (env.CANAL_BASH) return env.CANAL_BASH;
  const fija = [path.join(home, "AppData", "Local", "Programs", "Git", "bin", "bash.exe"), path.join(env.ProgramFiles || "C:\\Program Files", "Git", "bin", "bash.exe")].find((p) => existe(p));
  if (fija) return fija;
  // …\Git\cmd\git.exe o …\Git\bin\git.exe; desde dentro de Git Bash el primero es …\Git\mingw64\bin\git.exe (un nivel más abajo)
  for (const g of [].concat(where() || [])) {
    for (const raiz of [path.dirname(path.dirname(g)), path.dirname(path.dirname(path.dirname(g)))]) { const b = path.join(raiz, "bin", "bash.exe"); if (existe(b)) return b; }
  }
  return "";
}
module.exports = { gitBash };
