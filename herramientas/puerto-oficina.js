// Puerto de la Oficina: OFICINA_PORT, si no el que ella misma deja en <logs>/oficina.puerto, si no 4317 (o "" en pruebas).
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");

function puertoOficina({ env = process.env, logs, pruebas } = {}) {
  if (env.OFICINA_PORT) return String(env.OFICINA_PORT);
  const dir = logs || path.join(env.CANAL_HOME || os.homedir(), ".canal-logs");
  try {
    const t = fs.readFileSync(path.join(dir, "oficina.puerto"), "utf8").trim();
    if (/^\d{2,5}$/.test(t)) return t;
  } catch (e) {}
  return pruebas ? "" : "4317";
}

module.exports = { puertoOficina };
