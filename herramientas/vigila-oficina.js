// Uso: node vigila-oficina.js [--seco]     Log: una línea en ~/.canal-logs/vigia-canal.log solo cuando hace algo.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), { execFileSync } = require("child_process");
const TAREA = "Canal IAs - oficina", TOPE = 4, ESTRENO_MS = 3 * 60e3;

function contesta(url, ms = 10e3) {
  return new Promise((res) => {
    const r = http.get(url, (x) => { x.resume(); res(x.statusCode === 200); });
    r.setTimeout(ms, () => { r.destroy(); res(false); }); r.on("error", () => res(false));
  });
}
const vivePid = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
// ¿ese pid es de verdad la oficina? (Windows reutiliza los pid: nunca se cierra un proceso que no sea oficina/server.js). Solo se
// mira cuando no contesta, así que el PowerShell no cuesta en las pasadas normales.
// (v497: true = es la oficina; false = no existe o es otro programa; null = existe y no se ha podido ver qué es)
function esLaOficina(pid) {
  if (!pid || !vivePid(pid)) return false;
  try {
    const c = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${+pid}').CommandLine`],
      { encoding: "utf8", windowsHide: true, timeout: 30e3, stdio: ["ignore", "pipe", "ignore"] });
    if (!String(c || "").trim()) return null;
    return /oficina[\\/]server\.js/i.test(c);
  } catch (e) { return null; }
}

async function revisa({ consulta, pid, vive = esLaOficina, matar, arrancar, est = {}, ahora = Date.now(), estrenoT = 0,
  esperar = null, hayOficina = null, directa = null, avisar = null, horario = null }) {
  est = { colgada: 0, arranques: [], caida: null, ...est }; est.arranques = est.arranques.filter((t) => ahora - t < 24 * 3600e3);
  if (await consulta()) return { que: "bien", est: { ...est, colgada: 0, caida: null } };
  if (!est.caida) est.caida = { desde: estrenoT && ahora >= estrenoT && ahora - estrenoT < 3600e3 ? estrenoT : ahora, avisado: 0 };
  const fin = (que) => {
    if (avisar && est.caida && !est.caida.avisado && ahora - est.caida.desde > 10 * 60e3 && (!horario || horario(ahora))) {
      try { avisar(est.caida.desde); est.caida.avisado = ahora; que += "+aviso"; } catch (e) {}
    }
    return { que, est };
  };
  if (estrenoT && ahora >= estrenoT && ahora - estrenoT < ESTRENO_MS) return fin("estreno");
  const v = pid ? vive(pid) : false, hay = v === true || v === null;
  if (hay && ++est.colgada < 2) return fin("esperar");
  if (est.arranques.length >= TOPE) return fin("tope");
  if (v === true) matar(pid);                                                   // (solo un proceso que se ha visto que es la oficina)
  arrancar(); est.arranques.push(ahora); est.colgada = 0;
  let que = v === true ? "reiniciada" : "arrancada";
  if (esperar && directa) {
    if (await esperar(25e3)) return { que, est: { ...est, caida: null } };
    if (!(hayOficina && (await hayOficina()) === true)) { directa(); que += "+directa"; }
    if (await esperar(10e3)) return { que, est: { ...est, caida: null } };
    que += "+no vuelve";
  }
  return fin(que);
}
function estadoTareaDe(csv) {
  const l = String(csv || "").split(/\r?\n/).find((x) => /^\s*"/.test(x)); if (!l) return "";
  const c = (l.match(/"([^"]*)"/g) || []).map((x) => x.replace(/"/g, "")), e = c[c.length - 1] || "";
  if (/ejecuci|running/i.test(e)) return "en marcha";
  if (/listo|ready|preparad/i.test(e)) return "parada (lista)";
  if (/deshabilit|disabled/i.test(e)) return "deshabilitada";
  if (/cola|queued/i.test(e)) return "en cola";
  return e.replace(/[^ -~]/g, "?").trim().slice(0, 30);
}
module.exports = { revisa, contesta, TOPE, ESTRENO_MS, estadoTareaDe };

if (require.main === module) {
  const seco = process.argv.includes("--seco");
  const LOGS = process.env.CANAL_LOGS || path.join(os.homedir(), ".canal-logs");
  const fEst = path.join(LOGS, "vigila-oficina.json");
  const leer = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return ""; } };
  let est = {}; try { est = JSON.parse(leer(fEst)) || {}; } catch (e) {}
  const pid = +leer(path.join(LOGS, "oficina.pid")).trim() || 0;
  // (v547: lo que contesta schtasks, para saber por qué no arranca la tarea cuando no arranca)
  let salidaRun = "", estaba = "";
  const tarea = (orden) => { try { const o = execFileSync("schtasks", [orden, "/tn", TAREA], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 30e3 });
    if (orden === "/run") salidaRun = String(o || "").replace(/\s+/g, " ").trim(); } catch (e) { if (orden === "/run") salidaRun = `error: ${String((e.stderr || e.message || "")).replace(/\s+/g, " ").trim()}`; } };
  const log = (t) => { const d = new Date(), p = (n) => String(n).padStart(2, "0");
    fs.appendFileSync(path.join(LOGS, "vigia-canal.log"), `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} oficina: ${t}\n`); };
  const estrenoT = (() => { try { return fs.statSync(path.join(LOGS, "relanzar-oficina.ps1")).mtimeMs; } catch (e) { return 0; } })();
  const puerto = +process.env.OFICINA_PORT || 4317, url = `http://127.0.0.1:${puerto}/`;
  const esperar = async (ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await contesta(url, 3e3)) return true; await new Promise((r) => setTimeout(r, 3e3)); } return false; };
  // ¿hay algún proceso de la oficina (aunque aún no conteste)? true / false / null (no se sabe)
  const hayOficina = async () => { try {
    const c = execFileSync("powershell", ["-NoProfile", "-Command", "@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'oficina.server.js' }).Count"],
      { encoding: "utf8", windowsHide: true, timeout: 15e3, stdio: ["ignore", "pipe", "ignore"] });
    return +String(c).trim() > 0; } catch (e) { return null; } };
  const server = path.join(__dirname, "..", "oficina", "server.js");
  const directa = () => { try { require("child_process").spawn(process.execPath, [server], { cwd: path.dirname(server), detached: true, stdio: "ignore", windowsHide: true }).unref(); } catch (e) {} };
  const horario = (t) => { const d = new Date(t); return d.getDay() >= 1 && d.getDay() <= 5 && d.getHours() >= 8 && d.getHours() < 20; };
  const hh = (t) => new Date(t).toTimeString().slice(0, 5);
  const avisar = (desde) => { const bash = require("./git-bash.js").gitBash() || "bash";
    execFileSync(bash, [path.join(__dirname, "avisar-humano.sh"), `la oficina de casa no contesta desde las ${hh(desde)} y no consigo arrancarla (ni su tarea ni directa). Arráncala a mano: doble clic en oficina\\arrancar-oficina.cmd.`],
      { stdio: "ignore", windowsHide: true, timeout: 30e3 }); };
  revisa({ consulta: () => contesta(url), pid, est, estrenoT, horario,
    ...(seco ? {} : { esperar, hayOficina, directa, avisar }),
    matar: (p) => { if (!seco) { try { process.kill(p); } catch (e) {} tarea("/end"); } },
    arrancar: () => { if (seco) return;
      try { estaba = estadoTareaDe(execFileSync("schtasks", ["/query", "/tn", TAREA, "/fo", "csv", "/nh"], { encoding: "latin1", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 15e3 })); } catch (e) {}
      tarea("/run"); } }).then((r) => {
    const base = r.que.split("+")[0];
    let dice = { arrancada: "no contestaba y no estaba en marcha: arranco su tarea", reiniciada: `colgada dos pasadas seguidas (pid ${pid}): la cierro y la arranco`,
      tope: `no contesta y ya la he arrancado ${TOPE} veces en 24 h: no lo intento más; mira ~/.canal-logs`, esperar: `no contesta (pid ${pid} vivo): lo miro en la pasada siguiente`,
      estreno: "no contesta, pero se está reiniciando para estrenar código (su relanzador es de hace menos de 3 min): espero" }[base];
    if (dice && /^(arrancada|reiniciada)$/.test(base) && estaba) dice += ` (su tarea estaba ${estaba}${salidaRun ? "; schtasks: " + salidaRun.replace(/[^ -~áéíóúñÁÉÍÓÚÑ«»¿¡]/g, "?").slice(0, 80) : ""})`;   // v565
    if (/\+directa/.test(r.que)) dice += `; la tarea no arrancó en 25 s (schtasks: ${salidaRun || "?"}): la arranco directa (node server.js)`;
    if (/\+no vuelve/.test(r.que)) dice += `; NO VUELVE: no contesta ni con el arranque directo (caída desde las ${hh(r.est.caida.desde)})`;
    if (/\+aviso/.test(r.que)) dice += "; aviso a Humano por Slack (más de 10 min caída)";
    if (seco) { console.log(r.que + (dice ? ": " + dice : "")); return; }
    if (dice && !["esperar", "estreno"].includes(r.que)) log(dice);
    try { fs.writeFileSync(fEst, JSON.stringify(r.est)); } catch (e) {}
  });
}
