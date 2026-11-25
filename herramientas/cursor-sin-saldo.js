// cursor-sin-saldo.js - ¿Cursor ya se quedó sin saldo de API en este hilo (o canal)? Si es así, no se le vuelve a lanzar:
// se avisó UNA vez (atender-cursor-slack.sh / el panel) y se espera a que Humano lo lance a mano o vuelva el saldo.
// Bloqueado = en cursor-arranques.log hay un «NO hilo <ts>» (o «NO canal <nombre>») con usage_limit_exceeded / «sin saldo de API»
// de las últimas HORAS (24 por defecto) y NO hay ningún «SI» después (en ningún hilo ni canal: un SI = la API vuelve a aceptar).
// Otros 400 y los 5xx no bloquean (siguen como siempre).
// Uso: node cursor-sin-saldo.js hilo <ts> | canal <nombre>  → sale 0 y escribe la línea del NO si está bloqueado; 1 si no.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const SIN_SALDO = /usage_limit_exceeded|sin saldo de API/i;
const HORAS = 24;

// una línea de cursor-arranques.log → { t, ok, hilo, canal, info } (el mismo formato que lee oficina/server.js)
function entrada(l) {
  const m = String(l).match(/^(\S+) (SI|NO) (hilo|canal) (\S+)\s*(.*)$/); if (!m) return null;
  const t = Date.parse(m[1]); if (isNaN(t)) return null;
  return { t, ok: m[2] === "SI", hilo: m[3] === "hilo" ? m[4] : null, canal: m[3] === "canal" ? m[4] : null, info: m[5] };
}
const entradas = (txt) => String(txt || "").split(/\r?\n/).map(entrada).filter(Boolean);

// es: lista de entradas; donde: { hilo } o { canal }. Devuelve el NO que bloquea, o null.
function bloqueo(es, donde, ahora = Date.now(), horas = HORAS) {
  const mio = (a) => (donde.hilo && a.hilo === donde.hilo) || (donde.canal && a.canal === donde.canal);
  const nos = (es || []).filter((a) => !a.ok && mio(a) && SIN_SALDO.test(a.info || "") && ahora - a.t < horas * 3600e3 && a.t <= ahora + 60e3);
  if (!nos.length) return null;
  const no = nos.reduce((x, y) => (y.t >= x.t ? y : x));
  return (es || []).some((a) => a.ok && a.t >= no.t) ? null : no;
}

function bloqueoLog(donde, logs = path.join(process.env.HOME || os.homedir(), ".canal-logs"), ahora = Date.now()) {
  let txt = ""; try { txt = fs.readFileSync(path.join(logs, "cursor-arranques.log"), "utf8"); } catch (e) { return null; }
  return bloqueo(entradas(txt.split("\n").slice(-400).join("\n")), donde, ahora);
}

const hhmm = (t) => new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });

// ¿Hay CLI de Cursor con sesión (cursor-cli.ps1 + cursor-agent)? Entonces «sin saldo de API» NO bloquea: la vía primaria es el CLI
// y el bloqueo solo se aplica en el respaldo por API (atender-cursor-slack.sh).
function hayCli() {
  try {
    if (!fs.existsSync(path.join(__dirname, "cursor-cli.ps1"))) return false;
    if (process.env.CURSOR_CLI && fs.existsSync(process.env.CURSOR_CLI)) return true;
    const la = process.env.LOCALAPPDATA; if (!la) return false;
    const d = path.join(la, "Packages", "OpenAI.Codex_2p2nqsd0c76g0", "LocalCache", "Local", "cursor-agent");
    return fs.existsSync(path.join(d, "cursor-agent.ps1")) || fs.existsSync(path.join(d, "cursor-agent.cmd"));
  } catch (e) { return false; }
}

module.exports = { entrada, entradas, bloqueo, bloqueoLog, SIN_SALDO, HORAS, hhmm, hayCli };

if (require.main === module) {
  const [tipo, clave] = process.argv.slice(2);
  if (!/^(hilo|canal)$/.test(tipo || "") || !clave) { console.error("uso: node cursor-sin-saldo.js hilo <ts> | canal <nombre>"); process.exit(2); }
  const no = bloqueoLog({ [tipo]: clave });
  if (!no) process.exit(1);
  process.stdout.write(hhmm(no.t));
  process.exit(0);
}
