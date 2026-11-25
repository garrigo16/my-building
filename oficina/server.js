// oficina/server.js - "La oficina de las IAs": panel LOCAL y de SOLO LECTURA para Humano.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http");
const { execFile } = require("child_process");
// v159: los tests (oficina/pruebas) cargan este fichero con require(): sin timers, sin http y sin escribir nada
const PRUEBAS = require.main !== module;
if (!PRUEBAS) try { require("os").setPriority(0, require("os").constants.priority.PRIORITY_ABOVE_NORMAL); } catch (e) {}
const trasAbrir = [];
function alAbrir(f) { if (!PRUEBAS) trasAbrir.push(f); }
const fetchSinTope = global.fetch;
function fetchConTope(u, o = {}, ms = 30e3) { return fetchSinTope(u, o && o.signal ? o : { ...(o || {}), signal: AbortSignal.timeout(ms) }); }
global.fetch = (u, o) => fetchConTope(u, o);
async function leeRed(u, o = {}, ms = 8e3, intentos = 2) {
  let ult;
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(u, { ...(o || {}), signal: AbortSignal.timeout(ms) });
      let json = null;
      if (r.status !== 429) try { json = await r.json(); } catch (e) { if (/abort|timeout/i.test(`${e && e.name} ${e && e.message}`)) throw e; }
      return { status: r.status, ok: r.ok !== undefined ? !!r.ok : r.status >= 200 && r.status < 300, headers: r.headers, json };
    } catch (e) { ult = e; }
  }
  throw ult;
}
const ESPERA_FUENTE = { slack: 8e3, procesos: 8e3, cursor: 3e3 };
const fuentesEnCurso = {};
function leeFuente(nombre, leer, bien, mal, tope = 0, o = {}) {
  const en = o.en || fuentesEnCurso, reloj = o.reloj || Date.now;
  if (en[nombre]) return Promise.resolve("sigue");
  const f = en[nombre] = { t0: reloj(), suelta: false };
  const p = Promise.resolve().then(leer).then(bien, mal).catch(() => {}).then(() => {
    delete en[nombre];
    try { (o.nota || notaPaso)(nombre, reloj() - f.t0, f.suelta); if (f.suelta) (o.alLlegar || llegaTarde)(nombre); } catch (e) {}
    return "leida";
  });
  if (!(tope > 0)) return p;
  let t;
  return Promise.race([p, new Promise((r) => { t = setTimeout(() => { f.suelta = true; r("suelta"); }, tope); })]).finally(() => clearTimeout(t));
}
const llegaTarde = () => { setTimeout(() => { tic(true).catch(() => {}); }, 0); };
// v159: UN solo lector de los bloques del canal git, el mismo que usa el vigía (herramientas/canal-bloques.js)
const canal = require(path.join(__dirname, "..", "herramientas", "canal-bloques.js"));

const HOME = os.homedir();
const LOGS = path.join(HOME, ".canal-logs");
const PORT = +process.env.OFICINA_PORT || 4317;
const CONF = require(path.join(__dirname, "..", "herramientas", "config.js")).config(PRUEBAS ? { fichero: "ninguno" } : {});
const REPO = process.env.OFICINA_REPO || CONF.canalGit.repoLocal.split(path.sep).join("/");
const CH = CONF.slack.canalId;
const SLACK_WS = CONF.slack.espacio.replace(/\/+$/, "");
const HUMANO = CONF.persona.slackId;
const NOMBRE = CONF.persona.nombre, NOMBRE_RE = NOMBRE.toLowerCase() === "humano" ? "" : "@" + NOMBRE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\wáéíóúñ])|";
const ID = { [HUMANO]: "Humano", [CONF.slack.ias.claude]: "Claude", [CONF.slack.ias.coo]: "Coo", [CONF.slack.ias.cursor]: "Cursor" };
const IAS = ["Coo", "Claude", "Cursor"];
const CANALES = CONF.canalGit.canales.map((c) => ({ nombre: c.nombre, rama: c.rama, fichero: c.fichero }));
const VENTANA_H = 36;              // hilos con actividad en las últimas 36 h
const MIN = 60e3;

const CFG_MEMORIA_MS = 60e3;
let cfgCache = { t: 0, v: null };
function cfg(txt) {
  const delDisco = txt === undefined;
  // (v520: lo de memoria SIEMPRE; lo refresca refrescaConfig en asíncrono cada minuto. Del disco, solo la primera vez)
  if (delDisco && !PRUEBAS && cfgCache.v) return { ...cfgCache.v };
  const o = {};
  try {
    if (txt === undefined) txt = fs.readFileSync(path.join(HOME, ".config", "canal-slack.env"), "utf8");
    for (const l of txt.split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch (e) {}
  if (delDisco && !PRUEBAS) cfgCache = { t: Date.now(), v: { ...o } };
  return o;
}
const leer = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return ""; } };
const pre = { lineas: new Map(), lista: null, st: new Map(), txt: new Map() };
async function lineasAsync(f, n = 400) {
  let fh; try {
    fh = await fs.promises.open(f, "r"); const tam = (await fh.stat()).size, cuanto = Math.min(tam, Math.max(65536, n * 300));
    const buf = Buffer.alloc(cuanto); await fh.read(buf, 0, cuanto, tam - cuanto);
    const ls = buf.toString("utf8").split(/\r?\n/); if (cuanto < tam) ls.shift();
    return ls.filter(Boolean).slice(-n);
  } catch (e) { return []; } finally { if (fh) try { await fh.close(); } catch (e) {} }
}
const LINEAS_VUELTA = () => [["freno.log", 300], ["avisar-coo.log", 200], ["traspasos.log", 300], ["sesiones-slack.log", 600], ["escucha-slack.log", 200],
  ["cursor-arranques.log", 100], ["slack-no-enviado.log", 50]].map(([x, n]) => [path.join(LOGS, x), n]).concat([[path.join(HOME, ".canal-lanzamientos.log"), 400]]);
const PRECARGA_LOGS = /^(cursor-slack-.*\.log|esperar-bc-[\w-]+\.log|slack-\d{8}-\d{6}\.log|claude-\d{8}-\d{6}-\w+\.log)$/;
async function precargaLogs(dir = LOGS, ahora = Date.now(), vuelta = LINEAS_VUELTA()) {
  const P = fs.promises, lista = await P.readdir(dir).catch(() => null);
  const st = new Map(), txt = new Map(), ls = new Map();
  if (lista) {
    const quiero = lista.filter((x) => PRECARGA_LOGS.test(x));
    await Promise.all(quiero.map(async (x) => { try { st.set(x, await P.stat(path.join(dir, x))); } catch (e) {} }));
    await Promise.all(quiero.filter((x) => /^cursor-slack-/.test(x) && st.has(x) && ahora - st.get(x).mtimeMs < 24 * 3600e3)
      .map(async (x) => { try { txt.set(x, await P.readFile(path.join(dir, x), "utf8")); } catch (e) {} }));
  }
  await Promise.all(vuelta.map(async ([x, n]) => ls.set(x + "|" + n, await lineasAsync(x, n))));
  // v516: la cabeza (1 KB) del log de Claude más reciente de las últimas 24 h, para authClaude (el token), también en asíncrono
  const cabezas = new Map();
  if (lista) { const auth = [...st.entries()].filter(([x, y]) => /^(slack-\d{8}-\d{6}\.log|claude-\d{8}-\d{6}-\w+\.log)$/.test(x) && ahora - y.mtimeMs < 24 * 3600e3).sort((a, b) => b[1].mtimeMs - a[1].mtimeMs)[0];
    if (auth) { let fh; try { fh = await fs.promises.open(path.join(dir, auth[0]), "r"); const b = Buffer.alloc(1024); const { bytesRead } = await fh.read(b, 0, 1024, 0); cabezas.set(auth[0], b.toString("utf8", 0, bytesRead)); } catch (e) {} finally { if (fh) try { await fh.close(); } catch (e) {} } } }
  Object.assign(pre, { lineas: ls, lista, st, txt, cabezas, t: Date.now() });
  return pre;
}
const sueltaPrecarga = () => Object.assign(pre, { lineas: new Map(), lista: null, st: new Map(), txt: new Map(), cabezas: new Map() });
function lineas(f, n = 400) {
  const pre_ = pre.lineas.get(f + "|" + n); if (pre_ && Date.now() - (pre.t || 0) < 20e3) return pre_;   // v515: lo precargado (asíncrono) de esta vuelta, si es de ahora
  let fd; try {
    fd = fs.openSync(f, "r"); const tam = fs.fstatSync(fd).size, cuanto = Math.min(tam, Math.max(65536, n * 300));
    const buf = Buffer.alloc(cuanto); fs.readSync(fd, buf, 0, cuanto, tam - cuanto);
    const ls = buf.toString("utf8").split(/\r?\n/); if (cuanto < tam) ls.shift();   // la primera puede venir cortada
    return ls.filter(Boolean).slice(-n);
  } catch (e) { return []; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (e) {} }
}
function estadoEscucha(ls, ahora = Date.now()) {
  let con = 0, caida = 0, primera = 0, espera = 0, lCaida = "", lEspera = "";
  for (const l of ls) {
    const t = ms(l.split(" ")[0]); if (!t) continue; const x = l.slice(l.indexOf(" ") + 1);
    if (/^conectado$/.test(x)) { con = t; primera = 0; }
    else if (/^(cerrado \(|no abre la conexión|error de socket|FALTA SLACK_APP_TOKEN)/.test(x)) { caida = t; lCaida = x; if (!primera) primera = t; }
    else if (/no escucho|dejo de escuchar/.test(x)) { espera = t; lEspera = x; }
  }
  if (espera && espera >= con && espera >= caida) return { estado: "en_espera", desde: espera, linea: lEspera.slice(0, 120) };
  // (caída desde la PRIMERA tras la última conexión: con reintentos cada 30 s, la última siempre es reciente)
  if (caida > con && ahora - primera > 2 * MIN) return { estado: "caida", desde: primera, linea: lCaida.slice(0, 120) };
  return con ? { estado: "conectada", desde: con } : { estado: "?" };
}
const TAREA_ESCUCHA = "Canal IAs - escucha Slack";
const vivePid = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
function vigilaEscucha(ls, est, { vive = vivePid, arrancar, ahora = Date.now() } = {}) {
  let pid = 0; for (let i = ls.length - 1; i >= 0 && !pid; i--) { const m = ls[i].match(/ arranco \(pid (\d+)\)\s*$/); if (m) pid = +m[1]; }
  pid = est.pid = pid || est.pid || 0;                                  // el último que se vio (el log puede no traerlo)
  if (!pid || vive(pid)) { est.muerta = 0; return { que: pid ? "viva" : "?" }; }
  est.arranques = (est.arranques || []).filter((t) => ahora - t < 3600e3);
  if (++est.muerta < 2) return { que: "esperar", pid };                 // una vuelta más: por si estaba reiniciándose
  if (est.arranques.length >= 3) return { que: "tope", pid, n: est.arranques.length };
  est.arranques.push(ahora); est.muerta = 0; arrancar && arrancar(pid); return { que: "arrancada", pid };
}
const vigilaEsc = {};
const TAREA_VIGIA = "Canal IAs - vigía";
let vigiaRun = 0;
function vigiaParado(txt, ahora = Date.now()) { const t = Date.parse(String(txt || "").trim()); return t && ahora - t > 45 * MIN ? t : 0; }
const rutaSesion = new Map();
function transcriptDe(ses, base = path.join(HOME, ".claude", "projects")) {
  if (rutaSesion.has(ses)) return rutaSesion.get(ses);
  let p = ""; try { for (const d of fs.readdirSync(base)) { const f = path.join(base, d, ses + ".jsonl"); if (fs.existsSync(f)) { p = f; break; } } } catch (e) {}
  if (p) rutaSesion.set(ses, p);
  return p;
}
function claudesColgados(P, sesionHilo, ahora = Date.now(), mtimeDe = (ses) => { const f = transcriptDe(ses); try { return f ? fs.statSync(f).mtimeMs : 0; } catch (e) { return 0; } }) {
  return ((P && P.claudeHilo) || []).map((c) => ({ ...c, hilo: (sesionHilo || {})[c.ses] || "", ult: mtimeDe(c.ses) }))
    .filter((c) => c.ini && ahora - c.ini > 90 * MIN && c.ult && ahora - c.ult > 90 * MIN);
}
const codigo = { detras: 0, comprobado: 0 };
let REMOTOS = ["origin"];
alAbrir(() => { run("git", ["-C", path.join(__dirname, ".."), "remote"], { timeout: 15e3 }).then((r) => { if (r && r.ok) { REMOTOS = UPD.remotosDe(r.out); codigo.comprobado = 0; } }).catch(() => {}); });
try { const x = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".canal-logs", "al-dia.json"), "utf8")); if (Date.now() - x.t < 6 * 3600e3) codigo.alDia = x; } catch (e) {}
async function miraCodigo(ejecuta = run, repo = path.join(__dirname, ".."), ahora = Date.now(), est = codigo) {
  const g = (...a) => ejecuta("git", ["-C", repo, ...a], { timeout: 30e3 });
  const rem = await g("ls-remote", REMOTOS[0], "refs/heads/main"); if (!rem.ok) return est;
  const remoto = (String(rem.out).match(/^([0-9a-f]{40})/) || [])[1], local = String((await g("rev-parse", "HEAD")).out || "").trim();
  if (!remoto || !local) return est;
  let detras = false;
  if (remoto !== local) {
    const existe = (await g("cat-file", "-e", remoto + "^{commit}")).ok;
    detras = !existe || (await g("merge-base", "--is-ancestor", local, remoto)).ok;
  }
  est.detras = detras ? (est.detras || ahora) : 0; est.local = local.slice(0, 7); est.remoto = remoto.slice(0, 7); est.remotoSha = remoto; est.comprobado = ahora;   // (v566: remotoSha, para no traer otra vez una versión que no arrancó)
  return est;
}
// (v566: traer=false → no se trae nada de main, solo se estrena lo que ya está en el disco; deSha/aSha enteros, para el rollback)
async function ponAlDia({ ejecuta = run, repo = path.join(__dirname, ".."), reiniciaEscucha, reiniciaOficina, anotar = () => {}, sinEstrenar = () => ({}), traer = true } = {}) {
  const g = (...a) => ejecuta("git", ["-C", repo, ...a], { timeout: 60e3 });
  const sucio = String((await g("status", "--porcelain", "--untracked-files=no")).out || "").trim();
  if (sucio) return { que: "sucio", aviso: `No me pongo al día solo: hay ${sucio.split("\n").length} fichero(s) cambiados sin subir en el repo del Edificio (súbelos o descártalos).` };
  const antes = String((await g("rev-parse", "HEAD")).out || "").trim();
  if (traer && !(await g("fetch", "-q", REMOTOS[0], "main")).ok) return { que: "sin red" };
  if (traer && !(await g("merge", "--ff-only", "-q", REMOTOS[0] + "/main")).ok)
    return { que: "no ff", aviso: "No me pongo al día solo: este equipo tiene commits que no están en main (git pull --rebase y push)." };
  const despues = String((await g("rev-parse", "HEAD")).out || "").trim();
  if (!despues) return { que: "igual" };
  if (despues === antes) {
    const s = sinEstrenar() || {};
    if (!s.oficina && !s.escucha) return { que: "igual" };
    const ver = (String((await g("log", "-30", "--format=%s", despues)).out || "").match(/\bv(\d{3,})\b/) || [])[1] || despues.slice(0, 7);
    const r = { que: "estrenar", de: despues.slice(0, 7), a: despues.slice(0, 7), deSha: despues, aSha: despues, version: ver, esc: !!s.escucha, ofi: !!s.oficina, instalar: false, n: 0, t: Date.now() };
    anotar(`al día solo: código subido desde este equipo sin estrenar (v${ver})${s.escucha ? "; reinicio la escucha" : ""}${s.oficina ? "; reinicio la oficina" : ""}`);
    if (s.escucha && reiniciaEscucha) await reiniciaEscucha();
    if (s.oficina && reiniciaOficina) reiniciaOficina(r);
    return r;
  }
  const cambiados = String((await g("diff", "--name-only", antes, despues)).out || "").split("\n").map((s) => s.trim()).filter(Boolean);
  const rel = (f) => path.relative(path.join(__dirname, ".."), f).split(path.sep).join("/");
  const esc = cambiados.some((f) => DEP_ESCUCHA.map(rel).includes(f)), ofi = cambiados.some((f) => DEP_OFICINA.map(rel).includes(f));
  const ver = (String((await g("log", "-30", "--format=%s", despues)).out || "").match(/\bv(\d{3,})\b/) || [])[1] || despues.slice(0, 7);
  const r = { que: "actualizado", de: antes.slice(0, 7), a: despues.slice(0, 7), deSha: antes, aSha: despues, version: ver, esc, ofi, instalar: cambiados.includes("instalar.ps1"), n: cambiados.length, t: Date.now() };
  anotar(`al día solo: ${r.de} → ${r.a} (v${ver}), ${r.n} fichero(s)${esc ? "; reinicio la escucha" : ""}${ofi ? "; reinicio la oficina" : ""}${r.instalar ? "; ojo: cambió instalar.ps1" : ""}`);
  if (esc && reiniciaEscucha) await reiniciaEscucha();
  if (ofi && reiniciaOficina) reiniciaOficina(r);
  return r;
}
const reiniciaEscuchaYa = async () => {
  if (DEMO) return;   // en modo demo no se toca la escucha del equipo
  await run("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ? { $_.CommandLine -match 'escucha-slack\\.js' } | % { Stop-Process -Id $_.ProcessId -Force }"], { timeout: 60e3 });
  await run("schtasks", ["/end", "/tn", TAREA_ESCUCHA], { timeout: 30e3 }); await run("schtasks", ["/run", "/tn", TAREA_ESCUCHA], { timeout: 30e3 });
};
let relacionadosTxt = "";
function relacionadosDe(hilos, ahora = Date.now()) {
  const vivos = (hilos || []).filter((h) => h && h.ts && ahora - ((h.ult && h.ult.t) || h.desde || h.creado || 0) < 72 * 3600e3);
  const persona = (t) => { const m = String(t || "").match(/^([A-ZÁÉÍÓÚÑ][\wáéíóúñ.]+(?:\s[A-ZÁÉÍÓÚÑ][\wáéíóúñ.]+)?)\s*·/); return m ? m[1].toLowerCase() : ""; };
  const hora = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} ${d.getDate()}/${d.getMonth() + 1}`; };
  const out = {};
  for (const h of vivos) {
    const p = persona(h.titulo);
    const otros = vivos.filter((x) => x.ts !== h.ts && ((h.tema && x.tema === h.tema) || (p && persona(x.titulo) === p)))
      .sort((a, b) => (((b.ult && b.ult.t) || b.desde || 0) - ((a.ult && a.ult.t) || a.desde || 0))).slice(0, 6)
      .map((x) => ({ ts: x.ts, titulo: String(x.titulo || "").slice(0, 90), origen: x.origen || "", hora: hora((x.ult && x.ult.t) || x.desde || x.creado || 0),
        por: h.tema && x.tema === h.tema ? "tema" : "persona" }));
    if (otros.length) out[h.ts] = otros;
  }
  return out;
}
function escribeRelacionados(hilos, f = path.join(LOGS, "temas-relacionados.json"), ahora = Date.now()) {
  const txt = JSON.stringify({ hilos: relacionadosDe(hilos, ahora) });
  if (txt === relacionadosTxt) return false;
  try { fs.writeFileSync(f + ".tmp", txt); fs.renameSync(f + ".tmp", f); relacionadosTxt = txt; return true; } catch (e) { return false; }
}
function guionRelanzar(pid, tarea = "Canal IAs - oficina", puerto = PORT, node = process.execPath, server = __filename, log = path.join(LOGS, "relanzar-oficina.log"), o = {}) {
  const paso = +o.paso || 2000, patron = o.patron || "oficina.server.js";
  const run = `(schtasks /run /tn "${tarea}" 2>&1 | Out-String).Trim() -replace '\\s+', ' '`;
  const estaba = `((schtasks /query /tn "${tarea}" /fo csv /nh 2>&1 | Out-String).Trim() -replace '\\s+', ' ' -replace '[^ -~]', '?')`;
  return ["$ErrorActionPreference = 'SilentlyContinue'", ...(o.prefijo ? [o.prefijo] : []),
    `function Apunta($t) { Add-Content -Path '${log}' -Value ("{0} {1}" -f (Get-Date -Format s), $t) -Encoding UTF8 }`,
    `function Contesta { try { $c = New-Object Net.Sockets.TcpClient; $ok = $c.ConnectAsync('127.0.0.1', ${+puerto}).Wait(500) -and $c.Connected; $c.Close(); return $ok } catch { return $false } }`,
    `function HayOficina { [bool](Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match '${patron}' }) }`,
    `Wait-Process -Id ${+pid} -Timeout ${+o.espera || 60}`,
    // (v566, estreno en caliente: este guion es solo la red. Si la oficina de antes sigue viva, el relevo no se hizo y sigue ella;
    // si ya se fue y la nueva contesta, no hay nada que hacer; si no contesta nadie, el camino de siempre: la tarea y el plan B)
    ...(o.relevo ? [`if (Get-Process -Id ${+pid} -ErrorAction SilentlyContinue) { Apunta 'relevo (pid ${+pid}): no se hizo, sigue la oficina de antes'; exit 0 }`,
      `for ($k = 0; $k -lt 4; $k++) { Start-Sleep -Milliseconds ${Math.round(paso / 4)}; if (Contesta) { Apunta 'vuelve (relevo en caliente, pid ${+pid})'; exit 0 } }`] : [`Start-Sleep -Milliseconds ${paso}`]),
    `Apunta ("estreno (pid ${+pid}): pido la tarea; schtasks: " + ${run})`,
    `for ($k = 0; $k -lt 16; $k++) { Start-Sleep -Milliseconds ${paso}; if (Contesta) { Apunta 'vuelve (la tarea)'; exit 0 }`,
    `  if ($k -eq 7 -and -not (HayOficina)) { $antes = ${estaba}; Apunta ("a los 20 s sin proceso: la pido otra vez; schtasks: " + (${run}) + "; la tarea estaba: " + $antes) } }`,
    `if (-not (HayOficina)) { Apunta 'a los 40 s ni proceso ni puerto: la arranco directa (node server.js)'; Start-Process -FilePath '${node}' -ArgumentList '"${server}"' -WorkingDirectory '${path.dirname(server)}' -WindowStyle Hidden }`,
    `for ($k = 0; $k -lt 24; $k++) { Start-Sleep -Milliseconds ${paso}; if (Contesta) { Apunta 'vuelve (directa)'; exit 0 } }`,
    "Apunta 'NO VUELVE: ni la tarea ni el arranque directo'", "exit 1"].join("\r\n");
}
let saliendo = false;
function relanzaOficina() {
  if (DEMO) { anota("modo demo: no relanzo la oficina por la tarea del equipo"); return; }
  if (saliendo) return; saliendo = true;
  const ps1 = path.join(LOGS, "relanzar-oficina.ps1");
  try { fs.writeFileSync(ps1, "﻿" + guionRelanzar(process.pid)); } catch (e) {}   // (v547: con BOM: PowerShell 5.1 lee como ANSI un .ps1 sin él)
  execFile("powershell", ["-NoProfile", "-Command", "Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + ps1 + "\"'} | Out-Null"],
    { windowsHide: true, timeout: 30e3 }, () => setTimeout(() => process.exit(0), 500));
}
const UPD = require("./update.js");
const FICH_UPDATE = path.join(LOGS, "update.json");
const upd = { cfg: UPD.leeConfig(PRUEBAS ? { env: { EDIFICIO_CONFIG: "ninguno" } } : {}), mem: PRUEBAS ? {} : UPD.leeMemoria(FICH_UPDATE), lista: null, cocina: [], estrenando: null, memo: {}, enCurso: false, manual: false, arrEsc: 0 };
const relevo = { enCurso: false, token: "", t: 0, r: null, pid: 0, reloj: null, err: "" };
const RELEVO = !PRUEBAS && process.argv.includes("--relevo");   // esta oficina es la nueva de un estreno en caliente
let postsVivos = 0;
const huellaDisco = () => DEP_OFICINA.map(hashDe).join(",");
function motivoArranque(txt) {
  const ls = String(txt || "").replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const err = ls.find((l) => /^(\w+Error|Error)\b/.test(l)) || ls.find((l) => /\b\w*Error\b/.test(l)) || "";
  const donde = (ls.map((l) => l.match(/([\w.-]+\.js):(\d+)/)).find(Boolean) || []);
  return limpiaErr(err ? err + (donde[1] ? ` (${donde[1]}:${donde[2]})` : "") : "").slice(0, 160);
}
// arranca la oficina nueva FUERA de la tarea (un hijo normal moriría con ella: v385) y devuelve su pid (0 si no se pudo).
// (OFICINA_RELEVO_LANZA=directo, para las pruebas: un hijo desligado, sin WMI ni relanzador de red)
function lanzaNueva(errLog) {
  return new Promise((res) => {
    if (process.env.OFICINA_RELEVO_LANZA === "directo" || DEMO) {   // (en modo demo, sin relanzador de red: no toca las tareas del equipo)
      try { const fd = fs.openSync(errLog, "w");
        const p = require("child_process").spawn(process.execPath, [__filename, "--relevo"], { cwd: __dirname, detached: true, windowsHide: true, stdio: ["ignore", "ignore", fd] });
        p.on("error", () => {}); p.unref(); fs.closeSync(fd); res(p.pid || 0); } catch (e) { res(0); }
      return;
    }
    const q = (x) => String(x).replace(/'/g, "''");
    const ps1 = path.join(LOGS, "relanzar-oficina.ps1");
    try { fs.writeFileSync(ps1, "\uFEFF" + guionRelanzar(process.pid, undefined, undefined, undefined, undefined, undefined, { relevo: true })); } catch (e) {}
    // (un proceso creado por WMI nace con el entorno limpio del usuario: lo que distingue a ESTA oficina —su puerto, su carpeta— va en la orden)
    const ent = Object.keys(process.env).filter((k) => /^(OFICINA_|EDIFICIO_|CANAL_|HOME$|USERPROFILE$)/i.test(k) && !/["%\r\n]/.test(process.env[k])).map((k) => `set "${k}=${process.env[k]}"&& `).join("");
    const cmd = `cmd /d /c "${ent}"${process.execPath}" "${__filename}" --relevo 2> "${errLog}""`;
    const guion = ["$si = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }",
      `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${q(cmd)}'; CurrentDirectory = '${q(__dirname)}'; ProcessStartupInformation = $si }`,
      `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "${q(ps1)}"' } | Out-Null`,
      "[int]$r.ProcessId"].join("; ");
    execFile("powershell", ["-NoProfile", "-Command", guion], { windowsHide: true, timeout: 30e3 }, (e, out) => res(+String(out || "").trim().split(/\s+/).pop() || 0));
  });
}
function estadoUpdate(ahora = Date.now()) {
  const ad = codigo.alDia, m = upd.mem.malo, maloVale = !!(m && upd.lista && m.sha && m.sha === upd.lista.sha);
  const u = { modo: upd.cfg.actualizar, lista: upd.lista, cocina: upd.cocina, pospuesto: upd.mem.pospuesto > ahora ? upd.mem.pospuesto : 0, estrenando: upd.estrenando,
    reciente: ad && ad.t && ad.version && ahora - ad.t < 3 * MIN ? { version: ad.version, t: ad.t } : null, bloqueado: !!(errores.alDia || maloVale) };
  return { ...u, linea: UPD.lineaUpdate(u, ahora) };
}
function refrescaUpdate() { if (!estado.listo) return; estado.update = estadoUpdate(); estado.errores = { ...errores }; estado.t = Date.now(); avisaOyentes(estado.t); }
function estrena(r) {
  if (saliendo || relevo.enCurso) return;
  if (!(process.platform === "win32" && process.env.OFICINA_RELEVO !== "0" && puertoAbierto)) {
    if (r.que !== "reiniciar") try { fs.writeFileSync(path.join(LOGS, "al-dia.json"), JSON.stringify(r)); } catch (e) {}
    anota("me reinicio para estrenar el código nuevo (relanzador por WMI: espera a que me cierre y comprueba que vuelvo)");
    return relanzaOficina();
  }
  Object.assign(relevo, { enCurso: true, r, t: Date.now(), token: require("crypto").randomBytes(16).toString("hex"), pid: 0, err: path.join(LOGS, `relevo-error-${process.pid}.log`) });
  upd.estrenando = { version: r.version || "", t: relevo.t }; refrescaUpdate();
  try { fs.mkdirSync(LOGS, { recursive: true }); fs.writeFileSync(path.join(LOGS, "relevo.json"), JSON.stringify({ token: relevo.token, pid: process.pid, puerto: PORT, t: relevo.t })); } catch (e) {}
  anota(`estreno en caliente${r.version ? ` (v${r.version})` : ""}: arranco la oficina nueva al lado; esta sigue atendiendo hasta que la nueva pida el relevo`);
  lanzaNueva(relevo.err).then((pid) => {
    if (!relevo.enCurso) return;
    if (pid) { relevo.pid = pid; return; }
    // no se ha podido ni lanzar (WMI): no es culpa de la versión → el estreno de siempre
    clearInterval(relevo.reloj); relevo.enCurso = false;
    if (r.que !== "reiniciar") try { fs.writeFileSync(path.join(LOGS, "al-dia.json"), JSON.stringify(r)); } catch (e) {}
    anota("estreno en caliente: no he podido arrancar la nueva al lado; me reinicio por el camino de siempre (relanzador por WMI)");
    relanzaOficina();
  });
  relevo.reloj = setInterval(() => {
    const seg = (Date.now() - relevo.t) / 1000;
    if (relevo.pid && seg > 2 && !vivePid(relevo.pid)) { let t = ""; try { t = fs.readFileSync(relevo.err, "utf8"); } catch (e) {} return fallaRelevo("se cierra al arrancar" + (motivoArranque(t) ? ": " + motivoArranque(t) : "")); }
    if (seg > 45) fallaRelevo("no ha pedido el relevo en 45 s");
  }, 500);
}
async function fallaRelevo(motivo) {
  if (!relevo.enCurso || saliendo) return;
  clearInterval(relevo.reloj); relevo.enCurso = false; relevo.token = "";
  const r = relevo.r || {}, pid = relevo.pid, repo = path.join(__dirname, "..");
  if (pid && vivePid(pid)) execFile("taskkill", ["/pid", String(pid), "/t", "/f"], { windowsHide: true }, () => {});
  try { fs.unlinkSync(path.join(LOGS, "relevo.json")); } catch (e) {}
  const huella = huellaDisco();   // (antes de deshacer: si el código malo es de este equipo y no de main, se reconoce por su contenido)
  try {
    const antes = r.deSha && r.deSha !== r.aSha ? UPD.versionDe(String((await run("git", ["-C", repo, "log", "-30", "--format=%s", r.deSha], { timeout: 30e3 })).out || "").split("\n")) : "";
    const x = await UPD.rollback({ ejecuta: run, repo, r, motivo, antes });
    upd.mem.malo = { sha: r.deSha !== r.aSha ? r.aSha || "" : "", huella, version: r.version || "", aviso: x.aviso, t: Date.now() }; UPD.guardaMemoria(FICH_UPDATE, upd.mem);
    errores.update = x.aviso; anota(`estreno en caliente FALLIDO: ${x.aviso}`);
  } catch (e) { errores.update = `La versión nueva no arranca (${motivo}) y no he podido deshacerla: ${limpiaErr(e && e.message)}`; anota("estreno en caliente FALLIDO: " + errores.update); }
  if (codigo.alDia === r) codigo.alDia = null;
  upd.estrenando = null; refrescaUpdate();
}
// POST /api/relevo { token, pid }: la oficina nueva pide el puerto. Solo vale con el relevo en marcha y su clave de un solo uso.
function relevoRuta(req, res) {
  const fin = (code, o) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)); };
  if (!HOSTS.has(req.headers.host || "")) return fin(403, { ok: false, error: "origen no permitido" });
  let cuerpo = ""; req.on("data", (d) => { cuerpo += d; if (cuerpo.length > 2000) req.destroy(); });
  req.on("end", () => {
    let j; try { j = JSON.parse(cuerpo); } catch (e) { return fin(400, { ok: false, error: "json roto" }); }
    if (!relevo.enCurso || saliendo || !j || !relevo.token || j.token !== relevo.token) return fin(409, { ok: false, error: "no hay relevo en marcha" });
    clearInterval(relevo.reloj); saliendo = true; relevo.token = "";
    const t0 = Date.now(), r = { ...relevo.r, t: Date.now() };
    const cede = () => {
      if (r.que !== "reiniciar") try { fs.writeFileSync(path.join(LOGS, "al-dia.json"), JSON.stringify(r)); } catch (e) {}
      if (upd.mem.malo) { delete upd.mem.malo; UPD.guardaMemoria(FICH_UPDATE, upd.mem); }
      try { fs.unlinkSync(path.join(LOGS, "relevo.json")); } catch (e) {}
      anota(`estreno en caliente: la oficina nueva (pid ${+j.pid || "?"}) pide el relevo a los ${((Date.now() - relevo.t) / 1000).toFixed(1)} s: le paso lo último leído y suelto el puerto`);
      for (const o of oyentes) { try { o.write(`event: estreno\ndata: ${JSON.stringify({ version: r.version || "" })}\n\n`); } catch (e) {} }
      let fuera = false; const sal = () => { if (fuera) return; fuera = true; try { servidor.close(); if (servidor.closeAllConnections) servidor.closeAllConnections(); } catch (e) {} process.exit(0); };
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(cuerpoRelevo(r)), () => setTimeout(sal, 20));
      setTimeout(sal, 1500);
    };
    const espera = () => (postsVivos <= 0 || Date.now() - t0 > 5000 ? cede() : setTimeout(espera, 50));   // (un envío a medias acaba antes)
    espera();
  });
}
function cuerpoRelevo(r, est = estado) {
  const alDia = r && r.que !== "reiniciar" ? r : null;
  return { ok: true, alDia, estado: est.listo && !est.heredado ? { ...est, update: estadoUpdate(), ...(alDia ? { alDia } : {}) } : null };
}
// …y lo que la nueva hace con ello. Devuelve el estado que enseña hasta su primera vuelta (null si no le pasaron ninguno)
function heredaRelevo(j, clave = CLAVE) {
  if (j.alDia && j.alDia.t) codigo.alDia = j.alDia;
  // (lo que había en cocina también se hereda: la línea no parpadea hasta el primer repaso)
  const u = j.estado && j.estado.update; if (u) { upd.lista = u.lista || null; upd.cocina = Array.isArray(u.cocina) ? u.cocina : []; }
  if (!(j.estado && j.estado.listo)) return null;
  return { ...j.estado, ...(j.alDia ? { alDia: j.alDia } : {}), envio: { ...(j.estado.envio || {}), k: clave }, heredado: true };
}
function pideRelevo() {
  return new Promise((res) => {
    let x = null; try { x = JSON.parse(fs.readFileSync(path.join(LOGS, "relevo.json"), "utf8")); } catch (e) {}
    if (!x || !x.token || +x.puerto !== PORT || Date.now() - x.t > 90e3) return res(false);
    const cuerpo = JSON.stringify({ token: x.token, pid: process.pid });
    const rq = http.request({ host: "127.0.0.1", port: PORT, path: "/api/relevo", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(cuerpo) }, timeout: 15e3 }, (r) => {
      let t = ""; r.setEncoding("utf8"); r.on("data", (d) => { t += d; });
      r.on("end", () => { let j = null; try { j = JSON.parse(t); } catch (e) {}
        if (!j || !j.ok) return res(false);
        const h = heredaRelevo(j); if (h) estado = h;
        res(true); });
      r.on("error", () => res(false));
    });
    rq.on("timeout", () => rq.destroy()); rq.on("error", () => res(false)); rq.end(cuerpo);
  });
}
async function repasaCodigo({ ahoraMismo = false, repo = path.join(__dirname, ".."), reinicia = estrena, reiniciaEsc = async () => { estrenaEscT = Date.now(); await reiniciaEscuchaYa(); } } = {}) {
  const apagado = process.env.OFICINA_SIN_AL_DIA === "1";
  if (!PRUEBAS) upd.cfg = UPD.leeConfig();   // (se lee cada vez: cambiar el modo no pide reiniciar)
  const m = upd.mem.malo;
  if (!ahoraMismo && upd.cfg.actualizar === "manual") delete errores.alDia;
  const sin = ahoraMismo ? { oficina: cambioOficina(arranque) > 0, escucha: !!upd.arrEsc && Math.max(...DEP_ESCUCHA.map(mtimeDe)) > upd.arrEsc } : sinEstrenarAhora(arranque, upd.arrEsc);
  if (!ahoraMismo && m && sin.oficina && m.huella === huellaDisco()) sin.oficina = false;
  const est = await miraCodigo(run, repo);
  let r = null;
  if (est && (est.detras || sin.oficina || sin.escucha) && !apagado && !relevo.enCurso && !saliendo && (ahoraMismo || upd.cfg.actualizar === "auto")) {
    const traer = ahoraMismo || !(m && m.sha && m.sha === est.remotoSha);   // la versión que no arrancó no se trae otra vez sola
    if (traer || sin.oficina || sin.escucha) {
      r = await ponAlDia({ repo, reiniciaEscucha: reiniciaEsc, reiniciaOficina: reinicia, anotar: anota, sinEstrenar: () => sin, traer });
      if (r.que === "actualizado" || r.que === "estrenar") { codigo.alDia = r; codigo.detras = 0; delete errores.alDia; }
      else if (r.aviso && est.detras) errores.alDia = r.aviso;
    }
  }
  if (!apagado && !saliendo) await repasaCocina(sin, repo);
  return r;
}
async function repasaCocina(sin, repo = path.join(__dirname, "..")) {
  if (upd.enCurso) return; upd.enCurso = true;
  try { const k = await UPD.miraCocina({ ejecuta: run, repo, remotos: REMOTOS, cfg: upd.cfg.cocina, memo: upd.memo, sinEstrenar: !!(sin && (sin.oficina || sin.escucha)) });
    upd.lista = k.lista; upd.cocina = k.cocina; refrescaUpdate(); }
  catch (e) {} finally { upd.enCurso = false; }
}
function actualizarRuta(req, res) {
  const fin = (code, o) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)); };
  if (!postLocal(req)) return fin(403, { ok: false, error: "origen no permitido" });
  let cuerpo = ""; req.on("data", (d) => { cuerpo += d; if (cuerpo.length > 2000) req.destroy(); });
  req.on("end", async () => {
    let j; try { j = JSON.parse(cuerpo); } catch (e) { return fin(400, { ok: false, error: "json roto" }); }
    if (!j || j.k !== CLAVE) return fin(403, { ok: false, error: "clave" });
    const que = String(j.que || "");
    if (que === "posponer") {
      upd.mem.pospuesto = Date.now() + Math.min(24, Math.max(1, +j.horas || 3)) * 3600e3; UPD.guardaMemoria(FICH_UPDATE, upd.mem);
      anota(`update: pospuesto hasta las ${hhmm(upd.mem.pospuesto)}`); refrescaUpdate(); return fin(200, { ok: true, pospuesto: upd.mem.pospuesto });
    }
    if (que === "reanudar") { delete upd.mem.pospuesto; UPD.guardaMemoria(FICH_UPDATE, upd.mem); refrescaUpdate(); return fin(200, { ok: true }); }
    if (que !== "ahora" && que !== "reiniciar") return fin(400, { ok: false, error: "no sé qué es eso" });
    if (relevo.enCurso || saliendo || upd.manual) return fin(409, { ok: false, error: "Ya se está actualizando." });
    upd.manual = true;
    try {
      if (que === "reiniciar") { anota("update: reinicio pedido desde la página (mismo código, sin corte)"); estrena({ que: "reiniciar", version: "" }); return fin(200, { ok: true, que }); }
      for (let k = 0; codigo.enCurso && k < 120; k++) await new Promise((r) => setTimeout(r, 250));   // de uno en uno (v371)
      codigo.enCurso = true; codigo.comprobado = Date.now();
      delete upd.mem.pospuesto; delete upd.mem.malo; delete errores.update; UPD.guardaMemoria(FICH_UPDATE, upd.mem);
      anota("update: «Actualizar ahora» desde la página");
      let r = null; try { r = await repasaCodigo({ ahoraMismo: true }); } finally { codigo.enCurso = false; }
      refrescaUpdate();
      if (r && r.aviso) return fin(409, { ok: false, error: r.aviso });
      if (r && r.que === "sin red") return fin(502, { ok: false, error: "No llego al repositorio: prueba en un momento." });
      return fin(200, { ok: true, que: r ? r.que : "igual", version: (r && r.version) || "", ofi: !!(r && r.ofi) });
    } catch (e) { return fin(500, { ok: false, error: limpiaErr(e && e.message) }); }
    finally { upd.manual = false; }
  });
}
const caidas = { ts: [], vistos: {} };
function trasExcepcion(e, tipo, est = caidas, ahora = Date.now()) {
  est.ts = (est.ts || []).filter((t) => ahora - t < 10 * MIN); est.ts.push(ahora);
  const txt = limpiaErr(String((e && (e.stack || e.message)) || e).split("\n").slice(0, 3).map((l) => l.trim()).join(" ← "));
  const h = txt.slice(0, 80);
  for (const k of Object.keys(est.vistos)) if (ahora - est.vistos[k] > 10 * MIN) delete est.vistos[k];
  const apunta = est.vistos[h] ? null : `error no capturado (${tipo}; la oficina sigue en marcha): ${txt}`;
  if (apunta) est.vistos[h] = ahora;
  return { apunta, reinicia: est.ts.length >= 20 };
}
let puertoAbierto = false;
if (!PRUEBAS) for (const [ev, tipo] of [["uncaughtException", "excepción"], ["unhandledRejection", "promesa sin recoger"]]) process.on(ev, (e) => {
  try {
    const r = trasExcepcion(e, tipo);
    if (!puertoAbierto) { anota(`error no capturado al arrancar (${tipo}): ${limpiaErr(String((e && (e.stack || e.message)) || e).split("\n").slice(0, 3).join(" ← "))}; salgo con 1`); process.exit(1); }
    if (r.apunta) anota(r.apunta);
    if (r.reinicia && !saliendo) { anota("error: 20 errores no capturados en 10 min: me reinicio (relanzador por WMI: espera a que me cierre y comprueba que vuelvo)"); relanzaOficina(); }
  } catch (x) { if (!puertoAbierto) process.exit(1); }
});
function avisoCodigo(est, ahora = Date.now(), cambios = []) {
  if (est.detras && ahora - est.detras > 30 * MIN)
    return `Este equipo no tiene el código de main desde las ${hhmm(est.detras)} (aquí ${est.local}, en GitHub ${est.remoto}): git pull y reinicia la oficina y la escucha (SETUP.md, paso 4b)`;
  const sin = cambios.filter((c) => c.cambio && c.arranque && c.cambio > c.arranque && ahora - c.cambio > 10 * MIN).map((c) => c.que);
  return sin.length ? `Hay código nuevo sin estrenar: ${sin.join(" y ")} ${sin.length > 1 ? "han" : "ha"} cambiado después de arrancar. Reinícialas (SETUP.md, paso 4b)` : null;
}
const DEP_OFICINA = [__filename, path.join(__dirname, "calendario.js"), path.join(__dirname, "privados.js"), path.join(__dirname, "..", "herramientas", "git-bash.js"),
  path.join(__dirname, "..", "herramientas", "canal-bloques.js"), path.join(__dirname, "..", "herramientas", "regla-ok.js"), path.join(__dirname, "..", "herramientas", "llano.js"),   // v390: también los que carga con require
  path.join(__dirname, "diario.js"), path.join(__dirname, "update.js"), path.join(__dirname, "..", "herramientas", "tapar-secretos.js")];
const DEP_ESCUCHA = ["escucha-slack.js", "git-bash.js", "regla-ok.js"].map((f) => path.join(__dirname, "..", "herramientas", f));
const mtimeDe = (f) => { try { return fs.statSync(f).mtimeMs; } catch (e) { return 0; } };
const hashDe = (f) => { try { return require("crypto").createHash("sha1").update(fs.readFileSync(f)).digest("hex"); } catch (e) { return ""; } };
const huellaArranque = Object.fromEntries(DEP_OFICINA.map((f) => [f, hashDe(f)]));
// la fecha del cambio más reciente que de verdad cambió algo desde que arrancó (0 si nada)
function cambioOficina(desde, deps = DEP_OFICINA, huellas = huellaArranque, mt = mtimeDe, hash = hashDe) {
  let c = 0; for (const f of deps) { const m = mt(f); if (m > desde && hash(f) !== huellas[f]) c = Math.max(c, m); } return c;
}
function cuerpoEstado(est, ver, acepta, zlib = require("zlib")) {
  const txt = JSON.stringify(est.listo ? { ...est, version: ver } : est);
  if (!est.listo || !/\bgzip\b/i.test(acepta || "")) return { buf: Buffer.from(txt), gzip: false };
  return { buf: zlib.gzipSync(txt, { level: 1 }), gzip: true };
}
// v504: ¿hay código que esta oficina o la escucha no han estrenado? Solo si el cambio tiene más de 2 min (alguien puede estar subiendo
// varias cosas seguidas) y, la escucha, como mucho una vez cada 30 min (si no arrancara, no se reinicia en bucle).
let estrenaEscT = 0;
function sinEstrenarAhora(arrOfi, arrEsc, ahora = Date.now(), cOfi = cambioOficina(arrOfi), cEsc = Math.max(...DEP_ESCUCHA.map(mtimeDe)), ultEsc = estrenaEscT) {
  return { oficina: cOfi > 0 && ahora - cOfi > 2 * MIN, escucha: !!arrEsc && cEsc > arrEsc && ahora - cEsc > 2 * MIN && ahora - ultEsc > 30 * MIN };
}
function noEnviadas(ls, ahora = Date.now()) {
  return ls.map((l) => { const m = l.match(/^(\S+) NO SALIÓ hilo (\S+) canal (\S+): (.*?) · texto en (.+)$/); return m ? { t: ms(m[1]), hilo: m[2], err: m[4].slice(0, 80), f: m[5].trim() } : null; })
    .filter((x) => x && ahora - x.t < 3 * 3600e3);
}
const WORKTREES = Object.fromEntries(CONF.canalGit.canales.map((c) => [c.nombre, c.worktree]));
const sucios = {}; let suciosT = 0;
async function miraWorktrees(ejecuta = run, ahora = Date.now(), home = HOME, est = sucios) {
  for (const [can, d] of Object.entries(WORKTREES)) {
    const wt = path.join(home, d); if (!fs.existsSync(wt)) { delete est[can]; continue; }
    const r = await ejecuta("git", ["-C", wt, "status", "--porcelain", "--untracked-files=no"], { timeout: 30e3 });
    if (!r.ok) continue;
    if (String(r.out || "").trim()) est[can] = est[can] || ahora; else delete est[can];
  }
  return est;
}
function avisoSucio(est, ahora = Date.now()) {
  const c = Object.entries(est).filter(([, t]) => ahora - t > 10 * MIN).map(([can]) => can);
  if (!c.length) return null;
  const d = WORKTREES[c[0]];
  return `El canal git «${c.join("» y «")}» tiene cambios a medias en ~/${d}${c.length > 1 ? " (y el otro)" : ""} desde las ${hhmm(est[c[0]])}: ninguna IA puede publicar ahí hasta que se limpie. Mira qué hay (git -C ~/${d} status) y, si sobra, git -C ~/${d} checkout -- .`;
}
const AUTH_MAL = /^\s*(Failed to authenticate|.*OAuth access token is invalid|Invalid API key|Please run \/login|.*authentication_error)/im;
function authClaude(dir = LOGS, ahora = Date.now()) {
  let ult = null;
  const usaPre = dir === LOGS && pre.lista;   // v515
  try { for (const f of (usaPre ? pre.lista : fs.readdirSync(dir))) {
    if (!/^(slack-\d{8}-\d{6}\.log|claude-\d{8}-\d{6}-\w+\.log)$/.test(f)) continue;
    const t = ((usaPre && pre.st.get(f)) || fs.statSync(path.join(dir, f))).mtimeMs; if (ahora - t < 24 * 3600e3 && (!ult || t > ult.t)) ult = { f, t };
  } } catch (e) { return null; }
  if (!ult) return null;
  if (usaPre && pre.cabezas && pre.cabezas.has(ult.f)) return AUTH_MAL.test(pre.cabezas.get(ult.f)) ? ult : null;
  let cabeza = ""; try { const fd = fs.openSync(path.join(dir, ult.f), "r"); const b = Buffer.alloc(1024); const n = fs.readSync(fd, b, 0, 1024, 0); fs.closeSync(fd); cabeza = b.toString("utf8", 0, n); } catch (e) {}
  return AUTH_MAL.test(cabeza) ? ult : null;
}
// v186: rotación de ~/.canal-logs (antes no había ninguna): una vez al día, fuera los logs de cada lanzamiento de más de
// 14 días y los cerrojos de hilo huérfanos; los logs que solo crecen, si pasan de 5 MB, se quedan con su último 1 MB
const POR_LANZAMIENTO = /^(slack-\d{8}-\d{6}\.log|slack-respuesta-[\d.]+\.txt|claude-\d{8}-\d{6}-\w+\.log|cursor-slack-\d{8}-\d{6}\.log|esperar-bc-[\w-]+\.log|freno-avisado-[\d.]+)$/;
const QUE_CRECEN = ["escucha-slack.log", "slack-no-enviado.log", "oficina-envios.log", "avisar-coo.log", "sesiones-slack.log", "freno.log", "cursor-arranques.log", "traspasos.log",
  "notas-sin-publicar.log", "timbre.log", "vigia-canal.log", "sesiones-slack-rotas.log"];
const cacheSes = { dir: "", m: -1, mapa: {} };
function sesionesPorHilo(dir) {
  let m; try { m = fs.statSync(dir).mtimeMs; } catch (e) { return {}; }
  if (cacheSes.dir === dir && cacheSes.m === m) return cacheSes.mapa;
  const mapa = {};
  try { for (const f of fs.readdirSync(dir)) { if (f.endsWith(".reglas")) continue; const u = leer(path.join(dir, f)).trim(); if (u) mapa[u] = f.replace(/^C[A-Z0-9]+-/, ""); } } catch (e) {}
  Object.assign(cacheSes, { dir, m, mapa }); return mapa;
}
function rotaLogs(dir = LOGS, extra = [path.join(HOME, ".canal-lanzamientos.log")], ahora = Date.now(), proy = path.join(HOME, ".claude", "projects")) {
  const hecho = { borrados: 0, recortados: [] };
  let fs_ = []; try { fs_ = fs.readdirSync(dir); } catch (e) { return hecho; }
  for (const f of fs_) {
    const p = path.join(dir, f); let st; try { st = fs.statSync(p); } catch (e) { continue; }
    if (POR_LANZAMIENTO.test(f) && st.isFile() && ahora - st.mtimeMs > 14 * 86400e3) { try { fs.unlinkSync(p); hecho.borrados++; } catch (e) {} }
  }
  const SD = path.join(dir, "sesiones-slack");
  try {
    const fsd = fs.readdirSync(SD), vivo = {}, edad = (p) => ahora - fs.statSync(p).mtimeMs;
    let dirs = null; const transcr = (id) => { if (dirs === null) { try { dirs = fs.readdirSync(proy); } catch (e) { dirs = []; } }
      for (const d of dirs) { const t = path.join(proy, d, id + ".jsonl"); if (fs.existsSync(t)) return t; } return ""; };
    for (const f of fsd) { if (f.endsWith(".reglas")) continue; const p = path.join(SD, f);
      try { const id = leer(p).trim(), t = /^[\w-]+$/.test(id) ? transcr(id) : ""; vivo[f] = Math.min(edad(p), t ? edad(t) : Infinity) <= 30 * 86400e3; } catch (e) {} }
    for (const f of fsd) { const p = path.join(SD, f), base = f.replace(/\.reglas$/, "");
      try { if (base in vivo ? !vivo[base] : edad(p) > 30 * 86400e3) { fs.unlinkSync(p); hecho.borrados++; } } catch (e) {} }
  } catch (e) {}
  for (const p of [...QUE_CRECEN.map((f) => path.join(dir, f)), ...extra]) {
    let st; try { st = fs.statSync(p); } catch (e) { continue; }
    if (st.size <= 5 * 1024 * 1024) continue;
    try { const ultimas = lineas(p, 4000).join("\n") + "\n"; fs.writeFileSync(p + ".tmp", ultimas); fs.renameSync(p + ".tmp", p); hecho.recortados.push(path.basename(p)); } catch (e) {}
  }
  return hecho;
}
const ms = (s) => { const t = Date.parse(s); return isNaN(t) ? 0 : t; };
const tsMs = (ts) => Math.round(parseFloat(ts) * 1000);
// v252: ¿se despertó a esta IA para este hilo después de t? (Claude: lanzamiento; Cursor: arranque por API bueno; Coo: aviso
// por webhook aceptado). Antes, la misma expresión copiada en tres sitios de analizar.
const despertada = (L, hilo, ia, t) => (ia === "Claude" && ((L.lanzHilo || {})[hilo] || 0) > t)
  || (ia === "Cursor" && (L.arranquesCursor || []).some((a) => a.ok && a.hilo === hilo && a.t > t))
  || (ia === "Coo" && (L.avisosCoo || []).some((a) => a.hilo === hilo && a.t > t));
// v390: cuándo se despertó por última vez a esta IA para este hilo (0 si nunca)
const despertadaEn = (L, hilo, ia) => ia === "Claude" ? ((L.lanzHilo || {})[hilo] || 0)
  : Math.max(0, ...(ia === "Cursor" ? (L.arranquesCursor || []).filter((a) => a.ok && a.hilo === hilo) : ia === "Coo" ? (L.avisosCoo || []).filter((a) => a.hilo === hilo) : []).map((a) => a.t));
const relanzadoEn = (L, clave) => (L.traspasos || []).filter((x) => x.clave === clave && x.tipo === "RELANZO").map((x) => x.t).pop() || 0;
const claveJira = (tit) => (String(tit || "").match(/\b([A-Z][A-Z0-9]+-\d+)\b/) || [])[1] || "";
const hhmm = (t) => new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
function esperaDeFrase(t) {
  const s = String(t || "").replace(/\s+/g, " "), sinCitas = s.replace(/«[^»]*»|"[^"]*"|“[^”]*”/g, "");
  if (/\?/.test(sinCitas)) return null;
  const NO = /^(?:tu|tus|ti|vuestr[oa]s?|humano|jj|que (?:me|nos|le) (?:digas|confirmes|des|contestes|respondas|pases|mandes)|claude|cursor|coo|grok)\b/i;
  const VERBO = "(?:contest|respond|confirm)(?:e|en|a|an)|diga(?:n)?\\s+algo|lo\\s+confirme(?:n)?";
  const NOMBRES = "([A-ZÁÉÍÓÚÑ][\\wáéíóúñü]+(?:\\s*(?:,|y|o|e)\\s*[A-ZÁÉÍÓÚÑ][\\wáéíóúñü]+)*)";
  const aviso = sinCitas.match(new RegExp(`\\b(?:[Tt]e|[Oo]s)\\s+(?:aviso|avisar[eé]|digo|dir[eé]|traigo|traer[eé])\\s+(?:en\\s+cuanto|cuando)\\s+(?:${VERBO})\\s+${NOMBRES}`))
    || sinCitas.match(new RegExp(`\\b(?:[Ee]n\\s+cuanto|[Cc]uando)\\s+(?:${VERBO})\\s+${NOMBRES}[^.;:!\\n]{0,20}?\\b(?:te|os)\\s+(?:aviso|avisar[eé]|lo\\s+traigo)`))
    || sinCitas.match(new RegExp(`\\b(?:[Ff]altan?|[Qq]ueda|[Qq]uedamos\\s+pendientes\\s+de|[Pp]endiente\\s+de)\\s+que\\s+(?:${VERBO})\\s+${NOMBRES}`));
  if (aviso && !NO.test(aviso[1]) && !NO_PERSONA.test(aviso[1].split(/[\s,]+/)[0])) {
    const quien = aviso[1].replace(/\s+(?:o|e)\s+/g, " y ").replace(/\s*,\s*/g, ", ").slice(0, 60);
    const frase = (s.match(new RegExp(`[^.!\\n]*${aviso[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^.!\\n]*`)) || [aviso[0]])[0].trim();
    return { quien, que: `«${frase.slice(0, 160)}»` };
  }
  let x = sinCitas.match(/\b(?:qued(?:o|amos|a|an)|estoy|estamos|est[aá]n?|seguimos|sigo)\s+a\s+la\s+espera\s+de\s+(?:que\s+)?([^.;:!\n]{3,100})/i);
  if (!x) x = sinCitas.match(/\b(?:sigo|seguimos|estoy|estamos|quedo|quedamos)\s+esperando\s+(?:a\s+(?:que\s+)?|que\s+)([^.;:!\n]{3,100})/i);
  if (!x) return null;
  const r = x[1].trim().replace(/,\s*(?:y\s+)?(?:luego|despu[eé]s|entonces)\b.*$/i, "");
  if (NO.test(r)) return null;
  const n = r.match(/^([A-ZÁÉÍÓÚÑ][\wáéíóúñü]+(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñü]+)?)(?:[\s,]+(?:que\s+)?(.*))?$/);
  if (n && !/^(?:La|El|Los|Las|Que)$/.test(n[1].split(" ")[0])) return { quien: n[1].slice(0, 60), que: (n[2] || "").slice(0, 200) };
  return { quien: r.slice(0, 60), que: "" };
}
const desdeCuando = (t, ahora = Date.now()) => {
  const d = new Date(t), h = new Date(ahora), dia = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dif = Math.round((dia(h) - dia(d)) / 86400e3);
  return dif <= 0 ? `las ${hhmm(t)}` : dif === 1 ? `ayer a las ${hhmm(t)}`
    : `el ${d.toLocaleDateString("es-ES", { weekday: "long" })} ${d.getDate()}/${d.getMonth() + 1} a las ${hhmm(t)}`;
};
const GIT_RED = new Set(["fetch", "ls-remote", "push", "pull", "clone"]);
const esGit = (cmd) => /(^|[\\/])git(\.exe)?$/i.test(String(cmd || ""));
const esGitRed = (cmd, args) => esGit(cmd) && (args || []).some((a) => GIT_RED.has(a));
const ENV_GIT = { GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };
const GIT_RED_MAX = 2, gitRed = { activos: 0, cola: [], max: 0 };
function mataArbol(p) {
  if (!p || !p.pid) return;
  if (process.platform === "win32") execFile("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true }, () => {});
  else { try { p.kill("SIGKILL"); } catch (e) {} }
}
function run1(cmd, args, opts = {}) {
  return new Promise((res) => {
    const { timeout = 60e3, ...resto } = opts;
    const env = esGit(cmd) ? { ...process.env, ...ENV_GIT, ...(resto.env || {}) } : resto.env;
    let tarde = false, t = null;
    const t0 = Date.now();   // v517: arrancar un proceso en Windows bloquea mientras dura (con el equipo a tope, segundos)
    const p = execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...resto, ...(env ? { env } : {}) }, (err, out, errOut) => {
      clearTimeout(t);
      res({ ok: !err && !tarde, out: out || "", err: tarde ? `sin respuesta en ${Math.round(timeout / 1000)} s: cortado (con lo que había abierto)` : (errOut || (err && err.message) || "") });
    });
    notaLento(`arrancar «${path.basename(String(cmd))} ${String((args || [])[0] === "-C" ? (args || [])[2] : (args || [])[0] || "").slice(0, 30)}»`, Date.now() - t0);
    if (timeout > 0) t = setTimeout(() => { tarde = true; mataArbol(p); }, timeout);
  });
}
// OFICINA_DEMO=1: para mirar la oficina sin instalar nada. No toca las tareas programadas del equipo ni la escucha.
const DEMO = process.env.OFICINA_DEMO === "1";
const run = (cmd, args, opts = {}) => {
  if (DEMO && cmd === "schtasks") return Promise.resolve({ ok: false, out: "", err: "modo demo: no se tocan las tareas" });
  if (!esGitRed(cmd, args)) return run1(cmd, args, opts);
  return new Promise((res) => {
    const va = () => {
      gitRed.activos++; gitRed.max = Math.max(gitRed.max, gitRed.activos);
      run1(cmd, args, opts).then((r) => { gitRed.activos--; const sig = gitRed.cola.shift(); if (sig) sig(); res(r); });
    };
    if (gitRed.activos < GIT_RED_MAX) va(); else gitRed.cola.push(va);
  });
};
const errores = {};
let DIARIO = null;
// redacción común, sin tapar las ristras largas sueltas (en un error de git son los hash de los commits)
const limpiaErr = (s) => require(path.join(__dirname, "..", "herramientas", "tapar-secretos.js")).tapaSecretos(String(s || ""), { largos: false }).slice(0, 200);

// ---------- Slack (solo lectura) ----------
const cacheReplies = new Map();   // ts -> { latest, msgs }
async function slack(metodo, params, intento = 0) {
  const tok = cfg().SLACK_BOT_TOKEN;
  if (!tok) throw new Error("falta SLACK_BOT_TOKEN");
  // (v565: cada llamada, 10 s como mucho y un reintento si no llega; antes 30 s, y la vuelta entera esperando)
  const r = await leeRed(`https://slack.com/api/${metodo}?` + new URLSearchParams(params), { headers: { Authorization: "Bearer " + tok } }, 10e3);
  // v63: si Slack frena (429), se espera lo que diga y se reintenta una vez
  if (r.status === 429 && intento < 1) { const s = Math.min(30, +(r.headers.get("retry-after") || 3)); await new Promise((ok) => setTimeout(ok, s * 1000)); return slack(metodo, params, intento + 1); }
  const j = r.json;
  if (!j) throw new Error(`${metodo}: Slack contestó algo que no se puede leer (http ${r.status})`);
  if (!j.ok) throw new Error(`${metodo}: ${j.error}`);
  return j;
}
// v322: lo único que PUBLICA en Slack desde la oficina (contestar en un hilo, tema nuevo, tema de Jira, privado y su copia).
// Antes, cuatro copias del mismo fetch.
const slackPost = async (payload, tok) => (await fetch("https://slack.com/api/chat.postMessage", { method: "POST",
  headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(payload) })).json();
// v141: un hilo entero, por páginas (conversations.replies va del más viejo al más nuevo: con limit=200, en un hilo de más
// de 200 mensajes se perdían justo los últimos)
async function repliesTodas(ts) {
  const todas = []; let cur = "";
  for (let p = 0; p < 5; p++) {
    const rep = await slack("conversations.replies", { channel: CH, ts, limit: 200, ...(cur ? { cursor: cur } : {}) });
    todas.push(...(rep.messages || [])); cur = rep.response_metadata && rep.response_metadata.next_cursor; if (!cur) break;
  }
  return { messages: todas };
}
const APP_OFICINA = process.env.OFICINA_APP_ID || CONF.oficina.appId || "AOFICINA001";
const esPrefijoCoo = (t) => /^\s*Coo:/.test(String(t || ""));
function quien(m) {
  if (/^\s*\*?Cursor \(v[ií]a API\)/.test(m.text || "")) return "Cursor";
  if (m.user === HUMANO && esPrefijoCoo(m.text)) return "Coo";   // el conector de Coo publica con la cuenta de Humano: «Coo: …»
  if (m.user === HUMANO && (m.app_id || m.bot_id) && m.app_id !== APP_OFICINA) {
    const t = m.text || "";
    if (/^\s*(?:💬|:speech_balloon:)?\s*\*?Charla\*?\s*:/i.test(t) || /Origen:\s*\*?Chat\b/i.test(t)) return "Charla";
    if (/^\s*(?:✉️?|:email:|:envelope:)?\s*\*?Gus\*?\s*:/i.test(t) || /Origen:\s*\*?(Correo|Email|Mail)\b/i.test(t)) return "Gus";
  }
  if (m.user === HUMANO && m.app_id === APP_OFICINA) return "Humano";
  if (m.user === HUMANO) return (m.app_id || m.bot_id) ? "Coo" : "Humano";
  if (ID[m.user]) return ID[m.user];
  if (m.bot_id) return "Sistema";
  return m.user || "?";
}
const menciones = (t) => [...new Set([...(t || "").replace(/[*_]*Enviado usando[*_]*\s*<@U[A-Z0-9]+>/gi, "").matchAll(/<@(U[A-Z0-9]+)>/g)].map((x) => ID[x[1]]).filter(Boolean))];
const EMOJI = { bell: "🔔", rocket: "🚀", warning: "⚠️", fire: "🔥", white_check_mark: "✅", heavy_check_mark: "✔️", x: "❌", eyes: "👀", memo: "📝",
  bug: "🐛", tada: "🎉", pushpin: "📌", red_circle: "🔴", large_green_circle: "🟢", zap: "⚡", table_tennis_paddle_and_ball: "🏓", ping_pong: "🏓",
  thumbsup: "👍", "+1": "👍", thumbsdown: "👎", "-1": "👎", ok_hand: "👌", pray: "🙏", clap: "👏", muscle: "💪", raised_hands: "🙌", wave: "👋",
  smile: "😄", joy: "😂", sweat_smile: "😅", wink: "😉", thinking_face: "🤔", heart: "❤️", no_entry_sign: "🚫", no_entry: "⛔",
  hourglass_flowing_sand: "⏳", hourglass: "⌛", rotating_light: "🚨", sos: "🆘", point_right: "👉", point_up: "☝️", bulb: "💡", lock: "🔒",
  key: "🔑", calendar: "📅", speech_balloon: "💬", leftwards_arrow_with_hook: "↩️", inbox_tray: "📥", closed_lock_with_key: "🔐", email: "📧", envelope: "✉️", link: "🔗", robot_face: "🤖", coffee: "☕", sparkles: "✨", star: "⭐", boom: "💥",
  construction: "🚧", wrench: "🔧", hammer_and_wrench: "🛠️", gear: "⚙️", package: "📦", chart_with_upwards_trend: "📈", question: "❓",
  exclamation: "❗", slightly_smiling_face: "🙂", grinning: "😀", sob: "😭", scream: "😱", see_no_evil: "🙈", face_palm: "🤦", shrug: "🤷",
  zzz: "💤", checkered_flag: "🏁", dart: "🎯", mag: "🔍", clipboard: "📋", inbox_tray: "📥", outbox_tray: "📤", arrows_counterclockwise: "🔄",
  large_orange_circle: "🟠", large_yellow_circle: "🟡", large_blue_circle: "🔵", white_circle: "⚪", black_circle: "⚫", stopwatch: "⏱️" };
const emojiSlack = (t) => String(t || "").split(/(```[\s\S]*?```)/).map((p, i) => i % 2 ? p : p.replace(/:([a-z0-9_+-]+)(?:::skin-tone-\d)?:/g, (m, k) => EMOJI[k] || m)).join("");
function textoPlano(t) {
  const bloques = [];
  t = String(t || "").replace(/```[a-z]*\n?([\s\S]*?)```/gi, (_, c) => { bloques.push(c.replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/\n+$/, "")); return `\u0000${bloques.length - 1}\u0000`; });
  return textoPlanoSin(t).replace(/\u0000(\d+)\u0000/g, (_, i) => "\n```\n" + bloques[+i] + "\n```\n");
}
function textoPlanoSin(t) {
  return (t || "").replace(/<@(U[A-Z0-9]+)>/g, (_, u) => "@" + (ID[u] || "alguien"))
    .replace(/<mailto:([^|>]+)\|([^>]+)>/g, "$2").replace(/<mailto:([^>]+)>/g, "$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2").replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/[*`]/g, "").replace(/(^|[^\p{L}\p{N}_])_+(?=\S)/gu, "$1").replace(/(\S)_+(?=$|[^\p{L}\p{N}_])/gu, "$1")
    .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
}
const enlace = (ts, raiz) => `${SLACK_WS}/archives/${CH}/p${ts.replace(".", "")}` + (raiz && raiz !== ts ? `?thread_ts=${raiz}&cid=${CH}` : "");
function objetivoDe(t) { const m = textoPlano(t || "").match(/(?:🎯\s*)?Objetivo:\s*([^\n]+)/i); return m ? m[1].trim().slice(0, 220) : ""; }
function cuerpoPrivado(t) { return String(t || "").replace(/^\s*💬[^\n]*\n?/, "").split("\n").map((l) => l.replace(/^\s*>\s?/, "").trim()).filter(Boolean).join(" · "); }
function esAcuse(t) {
  const c = cuerpoPrivado(t), p = sinTildes(c);
  if (!p || c.length > 240 || /\?/.test(c)) return false;
  if (/\b(ya (esta|lo tienes|lo he|he|se)|listo|hecho|subid[oa]|terminad[oa]|mergead[oa]|arreglad[oa]|funciona|desplegad[oa]|no puedo|no se puede|error|falla|fallo|problema|bloquead[oa]|pero)\b/.test(p)) return false;
  return /\b(ok|oki|okis|okey|okay|vale|sip|si|dale|perfecto|genial|de acuerdo|entendido|guay|oido|recibido)\b|👍/.test(p)
    || /\b(manana|manna|luego|ahora|esta tarde|en la tarde|en un rato|en breve|despues|el (lunes|martes|miercoles|jueves|viernes)|lo (miro|hago|reviso|actualizo|subo|preparo|paso|mando)|me pongo)\b/.test(p);
}
// (la gente de tu equipo, de la config: oficina.visitantes; sus nombres se reconocen en los títulos)
const GENTE_TIT = ["humano", ...(CONF.oficina.visitantes || []).flatMap((v) => String(v).toLowerCase().split("|")).filter(Boolean)];
function limpiaTitulo(t) {
  const o = String(t || "").trim(); let s = o;
  const m = s.match(/^(?:(?:vale|hola|oye|buenas|chic[oa]s|a ver)[\s,]+)*(?:@(?:claude|cursor|coo|grok|charla|gus|alguien|todos|ias)\b[\s,:]*)+/i);
  if (m && s.slice(m[0].length).trim().split(/\s+/).length >= 2) {
    s = s.slice(m[0].length).trim();
    const f = s.match(/^(?:hola|vale|oye|buenas)[\s,]+/i);
    if (f && s.slice(f[0].length).trim().split(/\s+/).length >= 2) s = s.slice(f[0].length).trim();
  }
  s = s.replace(/\s+([?!,;:])(?=\s|$)/g, "$1");
  s = s.replace(new RegExp("(^|[\\s(«¿¡])(" + GENTE_TIT.join("|") + ")(?=$|[\\s,.;:?!)»])", "g"),(x, a, n) => a + n.charAt(0).toUpperCase() + n.slice(1));
  const q = s.indexOf("?");
  if (q > 0 && !/^@/.test(s) && !/[¿.!…·|(]/.test(s.slice(0, q))) s = "¿" + s.replace(/^(que|como|cuando|donde|quien|cual|cuanto)\b/i, (w) => ({ que: "qué", como: "cómo", cuando: "cuándo", donde: "dónde", quien: "quién", cual: "cuál", cuanto: "cuánto" })[w.toLowerCase()]);
  if (!/^\S+\s·/.test(s) || s !== o) s = s.replace(/^([¿¡«(]*)([a-zñáéíóú])/, (x, a, c) => a + c.toUpperCase());
  return s || o;
}
// los apuntes con sus claves pasadas por limpiaTitulo (fijados, resueltos, quitados, pausas, pendientes, objetivos y notas)
function apuntesLimpios(a) {
  if (!a || typeof a !== "object") return a;
  const mapa = (o) => { if (!o || typeof o !== "object" || Array.isArray(o)) return o; const r = {};
    for (const [k, v] of Object.entries(o)) { const n = limpiaTitulo(k); r[n] = n in r && typeof v === "number" && typeof r[n] === "number" ? Math.max(r[n], v) : n in r && n !== k ? r[n] : v; } return r; };
  const x = { ...a }; if (x.notas) x.notas = mapa(x.notas);
  if (x.ajustes && typeof x.ajustes === "object") { x.ajustes = { ...x.ajustes };
    if (Array.isArray(x.ajustes.fijados)) x.ajustes.fijados = [...new Set(x.ajustes.fijados.map((k) => limpiaTitulo(k)))];
    for (const k of ["cerrados", "quitados", "pausas", "pendientes", "objetivos"]) if (x.ajustes[k]) x.ajustes[k] = mapa(x.ajustes[k]); }
  return x;
}
function tituloHilo(t) {
  const b = (t || "").match(/\*Hilo:\s*([^*\n]+)\*/);   // "*Hilo: tema*" en negrita: solo lo de dentro
  if (b) return textoPlano(b[1]).trim().slice(0, 90);
  const p = textoPlano(t);
  const m = p.match(/Hilo:\s*([^\n]+)/);
  let s = (m ? m[1] : p.split("\n")[0]).replace(/^Coo:\s*/, "").trim();
  if (!m) { const e = s.match(/^(.{12,}?[.:!?)»])\s+1[.)]\s+\S/); if (e) s = e[1].replace(/[.:]$/, ""); }
  return s.length > 90 ? s.slice(0, 88) + "…" : s;
}
const PROMETE = /\b(te aviso|te avisar[eé]|te lo (paso|traigo|confirmo)|te (paso|traigo|confirmo)|ajustamos|ajusto|lo ajusto|lo preparo|preparo (el|la|los|las)|lo dejo (listo|hecho)|en cuanto (tenga|est[eé]|conteste|salga)|lo confirmo|vuelvo con|me pongo con|lo actualizo|actualizamos|lo cruzamos|lo cruzo|me encargo|nos encargamos|lo reviso|lo revisamos|estamos (revisando|mirando|cruzando)|primero hay que revisar\w*|a[uú]n no tengo)\b/i;
const A_LA_ESPERA = /\bcuando (entre|salga|est[eé]|llegue|conteste|contesten|termine|responda|se (suba|despliegue|haga))\b[^.]{0,120}\b(dime|av[ií]same|me dices|te pido|te aviso|seguimos|lo retomo|pongo aqu[ií]|lo pongo|te cuento|te lo (paso|traigo|cuento)|lo traigo)\b/i;
// v133: la IA deja algo pendiente de una respuesta tuya sin signo de interrogación
const ESPERA_TU = /\b(hasta que me digas|cuando me digas|dime si|me dices si|esperan? tu (ok|respuesta|decisi[oó]n)|pendientes? de tu (ok|respuesta|decisi[oó]n))\b/i;
const OFRECE = /\b(si quieres|si prefieres|si te parece|¿quieres|¿prefieres|¿te parece)/i;
const sinFut = (x) => String(x || "").replace(/\b(para|a por)\s+tu\s+(ok|visto bueno|decisi[oó]n|respuesta)\b/gi, "");
const PIDE_HUMANO = /((necesito|falta|espero|esperando|pendiente de|dame|me das|a la espera de|sin)\s+(el\s+|tu\s+)?ok\b|\bok\b[^.\n]{0,40}\?|decisi[oó]n tuya|necesito (tu|una) (ok|decisi[oó]n|respuesta)|que humano (elija|decida|d[eé] (el )?ok|confirme)|humano,? (elige|decide|confirma)|elige (entre|la|el|una)|opci[oó]n a\b[\s\S]*opci[oó]n b\b|¿(lo |la |los )?(subo|hago|mando|env[ií]o|lanzo|despliego|aplico|publico|mergeo)\b|¿(te parece|vale|seguimos|adelante)\b)/i;
function reglasDe(lista) {
  if (!Array.isArray(lista)) return [];
  const o = [];
  for (const r of lista) { try { if (Array.isArray(r) && r[0] && r[1]) o.push([String(r[0]), new RegExp(String(r[1]), r[2] === undefined ? "i" : String(r[2]))]); } catch (e) {} }
  return o;
}
const PROYECTOS = reglasDe(CONF.oficina.proyectos);
const proyectoDe = (t) => {  // primero el título (1.ª línea); si no encaja nada, el resto del texto
  const [tit, ...resto] = t.split("\n");
  for (const s of [tit, resto.join("\n")]) for (const [n, re] of PROYECTOS) if (re.test(s)) return n;
  return "General";
};
const TEMAS = reglasDe(CONF.oficina.temas);
const temaDe = (titulo, texto) => {
  for (const s of [titulo, texto]) for (const [n, re] of TEMAS) if (re.test(s)) return n;
  return limpiaTitulo(titulo);
};
function opciones(t) {
  const o = [];
  const letras = [...new Set([...t.matchAll(/opci[oó]n ([A-D])\b/gi)].map((m) => m[1].toUpperCase()))];
  const ult = letras.length ? Math.max(...letras.map((l) => l.charCodeAt(0))) : 0;
  for (let c = 65; c <= ult; c++) o.push("Opción " + String.fromCharCode(c));
  const hayOk = /tu ok|\bok\b/i.test(t);
  if (hayOk) o.push("OK, adelante");
  if (!letras.length && !hayOk && /\?/.test(t)) o.push("Sí, adelante");
  o.push("No, espera");
  return [...new Set(o)].slice(0, 5);
}

// v141: copia en el hilo de lo que Humano contestó por privado (oficina: /api/privado; Claude: responder-privado.sh)
const PRIV_J = /^\s*(?:↩️?|:leftwards_arrow_with_hook:)\s*\*?Humano\*?\s+a\s+\*?([^*\n]+?)\*?\s+por privado\b/;
const RELEVO_PERSONA = /^(?:💬|📧)\s*(?:Charla|Gus):\s*([A-ZÁÉÍÓÚÑ][\wáéíóúñü]+)(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñü]+)?(?:\s*\([^)]{0,60}\))?\s+(?:ha\s+vuelto\s+a\s+(?:escribir|contestar|responder|preguntar)|ha\s+(?:escrito|contestado|respondido|preguntado)|te\s+(?:escribe|pregunta|contesta|responde|menciona|pide)|(?:dice|escribe|pregunta|contesta|responde|pide)\b|(?:dijo|escribió|preguntó|contestó|respondió|pidió)(?![\wáéíóúñü]))/;
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const esRaiz = (m) => (!m.subtype || m.subtype === "bot_message") && (!m.thread_ts || m.thread_ts === m.ts);
const DIAS_SLACK = 14, VIEJOS_POR_VUELTA = 6;
let slackViejos = [];
async function leerSlack() {
  const ventana = Date.now() / 1000 - VENTANA_H * 3600;
  let cursor = "", todos = [];
  for (let pag = 0; pag < 6; pag++) {
    const h = await slack("conversations.history", { channel: CH, limit: 200, oldest: (Date.now() / 1000 - DIAS_SLACK * 86400).toFixed(6), ...(cursor ? { cursor } : {}) });
    todos.push(...(h.messages || [])); cursor = h.response_metadata && h.response_metadata.next_cursor; if (!cursor) break;
  }
  const reciente = (m) => Math.max(parseFloat(m.ts), parseFloat(m.latest_reply || 0)) >= ventana;
  const raices = todos.filter(esRaiz).filter(reciente);
  // v540: los viejos, con su hilo de la caché; los que falten, unos pocos por vuelta (después de los recientes: no frenan el arranque)
  const viejos = todos.filter(esRaiz).filter((m) => !reciente(m));
  const faltan = viejos.filter((r) => { const c = r.reply_count && cacheReplies.get(r.ts); return r.reply_count && !(c && c.latest === r.latest_reply); }).slice(0, VIEJOS_POR_VUELTA);
  // v350: los hilos que hay que (re)leer, de 4 en 4 (antes, uno detrás de otro: al arrancar, ≈ 36 llamadas seguidas, 5,5 s).
  // Lejos del límite de Slack para conversations.replies; y si frena, slack() espera lo que diga y reintenta.
  const pend = raices.filter((r) => { const c = r.reply_count && cacheReplies.get(r.ts); return r.reply_count && !(c && c.latest === r.latest_reply); });
  const traidos = new Map();
  for (let i = 0; i < pend.length; i += 4) {
    const lote = pend.slice(i, i + 4), res = await Promise.all(lote.map((r) => repliesTodas(r.ts)));
    lote.forEach((r, k) => traidos.set(r.ts, res[k]));
  }
  const hiloDe = (r, msgs) => ({ ts: r.ts, msgs: msgs.map((m) => {
      const q = quien(m), texto = emojiSlack(String(m.text || "").replace(/\s*[*_]*Enviado usando[*_]*\s*<@U[A-Z0-9]+>\s*$/i, ""));
      const pj = q === "Claude" && (texto.match(PRIV_J) || [])[1];
      return { ts: m.ts, quien: pj ? "Humano" : q, texto, menc: menciones(m.text), ...(pj ? { privJ: pj.trim() } : {}), ...(m.app_id === APP_OFICINA ? { ofi: true } : {}) };
    }) });
  const soloMsgs = (rep) => (rep.messages || []).filter((m) => !m.subtype || m.subtype === "bot_message" || m.subtype === "thread_broadcast");
  const hilos = [];
  for (const r of raices) {
    let msgs = [r];
    if (r.reply_count) {
      const c = cacheReplies.get(r.ts);
      if (c && c.latest === r.latest_reply) msgs = c.msgs;
      else {
        const rep = traidos.get(r.ts) || await repliesTodas(r.ts);
        msgs = soloMsgs(rep);
        cacheReplies.set(r.ts, { latest: r.latest_reply, msgs, visto: Date.now() });
      }
    }
    const c = cacheReplies.get(r.ts); if (c) c.visto = Date.now();
    hilos.push(hiloDe(r, msgs));
  }
  // v540: los viejos (de 36 h a 14 días): primero los que faltan (pocos por vuelta), luego los que ya están en la caché
  for (let i = 0; i < faltan.length; i += 3) {
    const lote = faltan.slice(i, i + 3), res = await Promise.all(lote.map((r) => repliesTodas(r.ts).catch(() => null)));
    lote.forEach((r, k) => { if (res[k]) cacheReplies.set(r.ts, { latest: r.latest_reply, msgs: soloMsgs(res[k]), visto: Date.now() }); });
  }
  const vs = [];
  for (const r of viejos) {
    const c = r.reply_count ? cacheReplies.get(r.ts) : null;
    if (r.reply_count && !(c && c.latest === r.latest_reply)) continue;   // (aún sin traer: en otra vuelta)
    if (c) c.visto = Date.now();
    vs.push(hiloDe(r, c ? c.msgs : [r]));
  }
  slackViejos = vs;
  // v63: la caché no crece sin límite: fuera lo que no se ha visto en 15 días
  for (const [k, v] of cacheReplies) if (Date.now() - (v.visto || 0) > 15 * 86400e3) cacheReplies.delete(k);
  return hilos;
}

// ---------- logs locales ----------
function leerLogs() {
  const ahora = Date.now();
  const frenos = lineas(path.join(LOGS, "freno.log"), 300).map((l) => {
    const m = l.match(/^(\S+) FRENO: no (?:abro|lanzo|llamo a) (\w+)?.*?hilo ([\d.]+)/);
    if (!m) return null;
    const ia = /Cursor/.test(l) ? "Cursor" : /Claude/.test(l) ? "Claude" : /Coo/.test(l) ? "Coo" : "?";
    return { t: ms(m[1]), ia, hilo: m[3] };
  }).filter((x) => x && ahora - x.t < 60 * MIN);
  const avisosCoo = lineas(path.join(LOGS, "avisar-coo.log"), 200).map((l) => {
    const m = l.match(/^(\S+) webhook de Coo \(hilo ([\d.]+).*?: http (\d+)\s*$/); if (!(m && m[3][0] === "2")) return null;
    const de = (l.match(/\(hilo [\d.]+, de (.+?)\): http \d+\s*$/) || [])[1] || "";   // v473: quién lo despertó (Humano, una IA, el canal git)
    return { t: ms(m[1]), hilo: m[2], de };
  }).filter(Boolean);
  const traspasos = lineas(path.join(LOGS, "traspasos.log"), 300).map((l) => {
    const [iso, tipo, ia, can, clave, tit] = l.split("\t"); return clave ? { t: ms(iso), tipo, ia, canal: can, clave, tit: tit || "" } : null;
  }).filter((x) => x && ahora - x.t < 24 * 3600e3);
  const frenosCoo = lineas(path.join(LOGS, "avisar-coo.log"), 200).map((l) => {
    const m = l.match(/^(\S+) FRENO: no llamo a Coo \(hilo ([\d.]+)/); return m ? { t: ms(m[1]), ia: "Coo", hilo: m[2] } : null;
  }).filter((x) => x && ahora - x.t < 60 * MIN);
  // sesiones de Claude por hilo: uuid -> hilo (v270: solo se relee si cambia la carpeta)
  const sesionHilo = sesionesPorHilo(path.join(LOGS, "sesiones-slack"));
  const lanzHilo = {}, colaHilo = {}, nadaHilo = {};
  for (const l of lineas(path.join(LOGS, "sesiones-slack.log"), 600)) {
    const m = l.match(/^(\S+) hilo ([\d.]+) quien=/); if (m) lanzHilo[m[2]] = Math.max(lanzHilo[m[2]] || 0, ms(m[1]));
    const c = l.match(/^(\S+) hilo ([\d.]+) (espera hueco|espera turno|modelo=)/);
    if (c) { const t = ms(c[1]); if (c[3] === "modelo=") { if (colaHilo[c[2]] && t >= colaHilo[c[2]].t) delete colaHilo[c[2]]; }
      else colaHilo[c[2]] = { t, por: c[3] === "espera hueco" ? "hueco" : "hilo" }; }
    const nd = l.match(/^(\S+) hilo ([\d.]+) terminó: NADA/); if (nd) nadaHilo[nd[2]] = Math.max(nadaHilo[nd[2]] || 0, ms(nd[1]));
  }
  for (const k of Object.keys(colaHilo)) if (ahora - colaHilo[k].t > 60 * MIN) delete colaHilo[k];
  // lanzamientos de Cursor por API desde Slack: log por lanzamiento, sin "estado final" = sigue
  const cursorSlack = [];
  try {
    for (const f of (pre.lista || fs.readdirSync(LOGS)).filter((f) => /^cursor-slack-.*\.log$/.test(f))) {
      const st = pre.st.get(f) || fs.statSync(path.join(LOGS, f));   // v515
      if (ahora - st.mtimeMs > 24 * 3600e3) continue;
      const t = pre.txt.has(f) ? pre.txt.get(f) : leer(path.join(LOGS, f));   // v515
      const hilo = (t.match(/hilo ([\d.]+)/) || [])[1];
      const agente = (t.match(/agente (bc-[\w-]+)/) || [])[1];
      const fin = (t.match(/estado final: (\w+)/) || [])[1];
      cursorSlack.push({ hilo, agente, fin, ini: st.birthtimeMs || st.mtimeMs, mod: st.mtimeMs, freno: /FRENO/.test(t) });
    }
  } catch (e) {}
  // agentes de Cursor lanzados por notas del canal git (esperar-bc-<id>.log)
  const esperas = [];
  try {
    for (const f of (pre.lista || fs.readdirSync(LOGS)).filter((f) => /^esperar-(bc-[\w-]+)\.log$/.test(f))) {
      const st = pre.st.get(f) || fs.statSync(path.join(LOGS, f));   // v515
      esperas.push({ agente: f.replace(/^esperar-|\.log$/g, ""), mod: st.mtimeMs });
    }
  } catch (e) {}
  // escucha: última línea "arranco"/"conectado"
  const esc = lineas(path.join(LOGS, "escucha-slack.log"), 200);
  const ultEsc = esc.length ? ms(esc[esc.length - 1].split(" ")[0]) : 0;
  const conexion = estadoEscucha(esc, ahora);   // v204
  const lanz = lineas(path.join(HOME, ".canal-lanzamientos.log"), 400).map((l) => {
    const [e, q, h] = l.split(/\s+/); return { t: +e * 1000, quien: q, hilo: h };
  }).filter((x) => ahora - x.t < 60 * MIN);
  const arranquesCursor = lineas(path.join(LOGS, "cursor-arranques.log"), 100).map((l) => {
    const m = l.match(/^(\S+) (SI|NO) (hilo|canal) (\S+)\s*(.*)$/); return m ? { t: ms(m[1]), ok: m[2] === "SI", hilo: m[3] === "hilo" ? m[4] : null, canal: m[3] === "canal" ? m[4] : null, info: m[5].slice(0, 160) } : null;
  }).filter((x) => x && ahora - x.t < 24 * 3600e3);
  // relevo de Claude entre la cuenta de empresa y la personal (herramientas/relevo-claude.js deja el último aviso aquí)
  let avisoClaude = ""; try { const j = JSON.parse(leer(path.join(LOGS, "claude-aviso.json"))); const t = ms(j.ts); if (j.aviso && ahora - t < 6 * 3600e3) avisoClaude = { aviso: String(j.aviso).slice(0, 400), t }; } catch {}
  return { avisoClaude, arranquesCursor, frenos: frenos.concat(frenosCoo), avisosCoo, sesionHilo, lanzHilo, colaHilo, nadaHilo, cursorSlack, esperas, ultEsc, lanz, conexion, escLineas: esc,
    timbreHilo: leer(path.join(LOGS, "timbre-hilo.txt")).trim(), traspasos, delegados: leeDelegados(), juntados: leeJuntados(), estoyEnEllo: leeEnEllo() };
}
const TEXTO_EN_ELLO = "Lo he visto, estoy en ello 👀";
const EN_ELLO = path.join(LOGS, "estoy-en-ello.json");
function leeEnEllo(f = EN_ELLO) { try { return JSON.parse(leer(f) || "{}") || {}; } catch (e) { return {}; } }
const JUNTADOS = path.join(LOGS, "juntados.txt");
function leeJuntados(f = JUNTADOS) {
  const o = { si: [], no: [] };
  for (const l of leer(f).replace(/^﻿/, "").split(/\r?\n/)) {
    const m = l.trim().match(/^(no\s+)?(\d{9,}\.\d{6})\s+(\d{9,}\.\d{6})\b/i); if (!m) continue;
    const lista = m[1] ? o.no : o.si;
    if (!lista.some((x) => x[0] === m[2] && x[1] === m[3])) lista.push([m[2], m[3]]);   // el mismo par dos veces (doble clic, dos pestañas) cuenta una
  }
  return o;
}
const DELEGADOS = path.join(LOGS, "delegados");
function leeDelegados(dir = DELEGADOS) {
  const o = {};
  let fichs = []; try { fichs = fs.readdirSync(dir).filter((f) => /\.txt$/i.test(f)); } catch (e) { return o; }
  for (const f of fichs) {
    const quien = f.replace(/\.txt$/i, "");
    for (const l of leer(path.join(dir, f)).replace(/^﻿/, "").split(/\r?\n/)) {
      const m = lineaDelegado(l);
      if (!m || (m[1] && m[1] !== CH)) continue;   // (otro canal: la oficina solo mira #canal-humano)
      o[m[2]] = { quien, nota: String(m[3] || "").replace(/^[-—·:|]\s*/, "").trim().slice(0, 140) };
    }
  }
  return o;
}
// una línea de delegados/<coordinador>.txt → [, canal|undefined, ts del hilo, nota] (null: vacía, comentario o no se entiende)
function lineaDelegado(l) {
  const s = String(l || "").trim(); if (!s || s.startsWith("#")) return null;
  const enl = s.match(/\/archives\/(C[A-Z0-9]+)\/p(\d{10})(\d{6})\b\S*\s*(.*)$/);
  return enl ? [null, enl[1], `${enl[2]}.${enl[3]}`, enl[4]] : s.match(/^(?:(C[A-Z0-9]{6,})\s+)?(\d{9,}\.\d{6})\b\s*(.*)$/);
}
const COORDINADORES = Array.isArray(CONF.coordinadores) ? CONF.coordinadores.map((c) => String((c && c.id) || "").toLowerCase()).filter((x) => x && x !== "jefe")
  : [], ES_COORD = /^coord-[a-z0-9][a-z0-9-]{1,30}$/;
function coordinadores(dir = DELEGADOS) {
  let fichs = []; try { fichs = fs.readdirSync(dir).filter((f) => /\.txt$/i.test(f)).map((f) => f.replace(/\.txt$/i, "").toLowerCase()); } catch (e) {}
  return [...new Set(COORDINADORES.concat(fichs.filter((f) => ES_COORD.test(f)).sort()))];
}
function apuntaDelegado(quien, hilo, nota, si, dir = DELEGADOS) {
  const guarda = (f, lineas) => { const t = lineas.join("\n").replace(/\n+$/, "") + "\n"; fs.writeFileSync(f + ".tmp", t); fs.renameSync(f + ".tmp", f); };
  let fichs = []; try { fichs = fs.readdirSync(dir).filter((f) => /\.txt$/i.test(f)); } catch (e) {}
  let quitados = 0;
  for (const f of fichs) {
    if (si && f.toLowerCase() === quien + ".txt") continue;
    const ls = leer(path.join(dir, f)).replace(/^﻿/, "").split(/\r?\n/), sin = ls.filter((l) => { const m = lineaDelegado(l); return !(m && m[2] === hilo && (!m[1] || m[1] === CH)); });
    if (sin.length !== ls.length) { quitados += ls.length - sin.length; guarda(path.join(dir, f), sin); }
  }
  if (!si) return { quitados };
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, quien + ".txt"), limpia = String(nota || "").replace(/\s+/g, " ").replace(/^[-—·:|#\s]+/, "").trim().slice(0, 140);
  const ls = (leer(f).replace(/^﻿/, "") || `# hilos que lleva ${quien} (una línea por hilo: «${CH} <ts del hilo> — nota»; ver COMO-FUNCIONA.md, v549 y v555)\n`).split(/\r?\n/);
  const ya = ls.some((l) => { const m = lineaDelegado(l); return m && m[2] === hilo && (!m[1] || m[1] === CH); });
  if (!ya) guarda(f, ls.filter((l, i) => l.trim() || i < ls.length - 1).concat(`${CH} ${hilo}${limpia ? " — " + limpia : ""}`));
  return { quitados, ya };
}

// v562 [profunda]: el estado de los coordinadores y lo de Salesforce que pasa solo a coord-salesforce (coordinadores.js)
const COORD = require("./coordinadores.js");
if (!PRUEBAS) COORD.configura(CONF.coordinadores, CONF.edificio.proyectoClaude);
const paraCoord = { huella: null, temas: null, enCurso: false };   // v564 (antes huellaParaCoord)
alAbrir(() => { COORD.refresca().catch(() => {}); setInterval(() => { COORD.refresca().catch(() => {}); }, MIN).unref(); });

const FALLOS_CURSOR = 2; let fallosCursor = 0;
function trasCursor(x, e, u = ultimo, errs = errores) {
  if (!e) { fallosCursor = 0; u.cursor = x; delete errs.cursor; return 0; }
  if (++fallosCursor < FALLOS_CURSOR) return fallosCursor;
  errs.cursor = limpiaErr(e.message); u.cursor = null; return fallosCursor;
}

// ---------- procesos vivos ----------
const cpuAnterior = new Map();
let fallosEscucha = 0;
let psW = null;
function psConsulta(cmd, ms = 20e3) {
  return new Promise((res, rej) => {
    if (!psW) {
      const p = require("child_process").spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "-"], { windowsHide: true });
      const w = psW = { p, buf: "", pend: null };
      const cierra = (e) => { if (psW === w) psW = null; const q = w.pend; w.pend = null; if (q) { clearTimeout(q.to); q.rej(e); } };
      p.stdout.setEncoding("utf8");
      p.stdout.on("data", (d) => {
        w.buf += d; const q = w.pend; if (!q) { w.buf = ""; return; }
        const i = w.buf.indexOf(q.m); if (i < 0) return;   // marca aleatoria de cada consulta: no sale en ninguna línea de comandos
        const out = w.buf.slice(0, i); w.buf = ""; w.pend = null; clearTimeout(q.to); q.res(out);
      });
      p.stderr.on("data", () => {});
      p.on("exit", () => cierra(new Error("powershell se cerró")));
      p.on("error", (e) => cierra(e));
    }
    const w = psW; if (w.pend) return rej(new Error("powershell ocupado"));
    const m = "FIN" + require("crypto").randomBytes(8).toString("hex");
    const to = setTimeout(() => { if (psW === w) psW = null; w.pend = null; try { w.p.kill(); } catch (e) {} rej(new Error("powershell no contesta")); }, ms);
    w.pend = { m, res, rej, to };
    try { w.p.stdin.write(`${cmd}; Write-Output '${m}'\n`); } catch (e) { clearTimeout(to); w.pend = null; rej(e); }
  });
}
const UTF8_PS = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; ";
function parseProcesos(sale) {
  const t = String(sale || "").replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f]/g, " ").trim();
  if (!t) return [];
  const a = JSON.parse(t);
  return Array.isArray(a) ? a : [a];
}
let procesosT = 0;
function hacenFaltaProcesos(mirando, turnoMio, hayQueRelanzar, edad) {
  if (mirando) return true;
  if (!turnoMio) return false;
  return hayQueRelanzar || edad > 3 * MIN;
}
async function leerProcesos() {
  const ps = UTF8_PS + `Get-CimInstance Win32_Process -Filter "Name='claude.exe' OR Name='node.exe' OR Name='bash.exe'" | ` +
    `Select-Object ProcessId,Name,CreationDate,KernelModeTime,UserModeTime,CommandLine | ConvertTo-Json -Compress`;
  // (el PowerShell abierto ocupa ~120 MB: solo mientras alguien mira la oficina; si no, se cierra y se usa uno suelto, que con
  // el ritmo lento de 45 s - 2 min sale más barato que tenerlo abierto)
  const mirando = Date.now() - ultimaVista < 3 * MIN;
  if (!mirando && psW) { try { psW.p.stdin.end(); } catch (e) {} psW = null; }
  const sale = await (mirando ? psConsulta(ps) : Promise.reject(new Error("sin nadie mirando"))).catch(async () => {
    const viejo = UTF8_PS + `Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('claude.exe','node.exe','bash.exe') } | ` +
      `Select-Object ProcessId,Name,CreationDate,KernelModeTime,UserModeTime,CommandLine | ConvertTo-Json -Compress`;   // sin comillas dobles en la línea de comandos
    const r = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", viejo]);
    if (!r.ok) throw new Error("procesos: " + limpiaErr(r.err)); return r.out;
  });
  let arr; try { arr = parseProcesos(sale); } catch (e) { throw new Error("procesos: no se puede leer la lista de Windows (" + e.message.slice(0, 80) + ")"); }
  { const vivos = new Set(arr.map((p) => p.ProcessId)); for (const k of cpuAnterior.keys()) if (!vivos.has(k)) cpuAnterior.delete(k); }   // v63: sin crecer sin límite
  const out = { claudeHilo: [], escritorio: [], escucha: false, bashCursor: 0 };
  for (const p of arr) {
    const c = p.CommandLine || "";
    const cpu = ((+p.KernelModeTime || 0) + (+p.UserModeTime || 0)) / 1e7; // segundos
    const prev = cpuAnterior.get(p.ProcessId); cpuAnterior.set(p.ProcessId, cpu);
    const activo = prev === undefined ? null : cpu - prev > 0.5;
    const ini = p.CreationDate ? ms(String(p.CreationDate).replace(/^\/Date\((\d+)\)\/$/, (_, n) => new Date(+n).toISOString())) : 0;
    if (p.Name === "claude.exe" && /claude-code/i.test(c)) {
      const ses = (c.match(/--(?:resume|session-id)\s+"?([0-9a-f-]{36})/) || [])[1];
      if (/\s-p(\s|$)/.test(c) && ses) out.claudeHilo.push({ pid: p.ProcessId, ses, ini, activo });
      else out.escritorio.push({ pid: p.ProcessId, ini, activo });   // sesiones del Code tab (como esta)
    } else if (p.Name === "node.exe" && /escucha-slack\.js/.test(c)) out.escucha = true;
    else if (p.Name === "bash.exe" && /(atender-cursor-slack|esperar-cursor)\.sh/.test(c)) out.bashCursor++;
  }
  fallosEscucha = out.escucha ? 0 : fallosEscucha + 1;
  if (!out.escucha && fallosEscucha < 2) out.escucha = true;
  return out;
}

// ---------- Cursor ----------
const cacheRuns = new Map();
// El mismo interruptor que miran los scripts (herramientas/cursor-apagado). Se mira en cada vuelta, sin guardar nada: al borrar el
// fichero, la lectura vuelve sola. Con él puesto NO se llama a api.cursor.com (ni se cuenta como lectura o fallo).
const cursorApagadoRuta = () => process.env.OFICINA_CURSOR_APAGADO || path.join(__dirname, "..", "herramientas", "cursor-apagado");
const cursorApagado = () => { try { return fs.existsSync(cursorApagadoRuta()); } catch (e) { return false; } };
async function leerCursor(o = {}) {
  if (cursorApagado()) return ultimo.cursor;   // (la vuelta ni llega aquí: lo último conocido, sin tocar nada)
  const k = o.clave || cfg().CURSOR_API_KEY;
  if (!k) throw new Error("falta CURSOR_API_KEY");
  const auth = { Authorization: "Basic " + Buffer.from(k + ":").toString("base64") };
  // v565: 8 s y un reintento (1 de cada 12 llamadas a su API no contesta: antes eran 30 s de vuelta parada)
  const r = await leeRed("https://api.cursor.com/v1/agents?limit=25", { headers: auth });
  if (!r.ok) throw new Error("cursor agents http " + r.status);
  const j = r.json || {};
  const agentes = [];
  for (const a of j.items || []) {
    let run = null;
    if (a.status !== "IDLE" && Date.now() - ms(a.updatedAt) < 6 * 3600e3) {
      const c = cacheRuns.get(a.id);
      if (c && c.upd === a.updatedAt && Date.now() - c.t < 60e3) run = c.run;
      else {
        try {
          const rr = await leeRed(`https://api.cursor.com/v1/agents/${a.id}/runs`, { headers: auth });
          const jj = rr.json || {}; const x = (jj.items || jj.runs || jj.data || [])[0] || {};
          run = x.status || null;
        } catch (e) {}
        cacheRuns.set(a.id, { upd: a.updatedAt, t: Date.now(), run });
      }
    }
    agentes.push({ id: a.id, nombre: a.name, estado: a.status, run, creado: ms(a.createdAt), upd: ms(a.updatedAt), url: a.url });
  }
  return agentes;
}

// ---------- canal git ----------
let gitCache = { sha: {}, bloques: {}, idT: {}, idS: {} };
async function leerGit() {
  const out = [];
  const fetches = await Promise.all(CANALES.map((c) => run("git", ["-C", REPO, "-c", "gc.auto=0", "-c", "maintenance.auto=false", "fetch", "-q",
    "--no-write-fetch-head", "origin", `+refs/heads/${c.rama}:refs/remotes/origin/${c.rama}`])));
  for (const [i, c] of CANALES.entries()) {
    const ref = `refs/remotes/origin/${c.rama}`, f = fetches[i];
    if (f.ok) { gitBienT[c.nombre] = Date.now(); delete errores["git " + c.nombre]; }
    else if (avisoGit(gitBienT[c.nombre], Date.now(), arranque)) errores["git " + c.nombre] = limpiaErr(f.err);
    const s = await run("git", ["-C", REPO, "log", "-1", "--format=%H%x09%ct", ref]);
    const [sha, ct] = s.out.trim().split("\t");
    if (!sha) continue;
    if (gitCache.sha[c.nombre] !== sha) {
      // hora real de cada bloque = hora del commit que lo añadió (la cabecera solo trae HH:MM, sin día)
      const idT = gitCache.idT[c.nombre] = gitCache.idT[c.nombre] || new Map();
      const vistos = gitCache.commits = gitCache.commits || new Set();
      const lg = await run("git", ["-C", REPO, "log", "-60", "--format=%H %ct", ref, "--", c.fichero]);
      const nuevos = lg.out.trim().split("\n").filter(Boolean).map((l) => l.split(" ")[0]).filter((h) => !vistos.has(h));
      const idSc = gitCache.idS[c.nombre] = gitCache.idS[c.nombre] || new Map();
      const d = nuevos.length ? await run("git", ["-C", REPO, "show", "--format=%x00%H %ct", "--unified=0", ...nuevos, "--", c.fichero]) : { out: "" };
      for (const trozo of d.out.split("\x00").slice(1)) {
        const nl = trozo.indexOf("\n"), [h, cts] = trozo.slice(0, nl < 0 ? undefined : nl).trim().split(" "), dif = nl < 0 ? "" : trozo.slice(nl + 1);
        for (const m of dif.matchAll(/^\+<!--.*?\bid:\s*([^|]+?)\s*\|/gm)) if (!idT.has(m[1])) idT.set(m[1], +cts * 1000);
        for (const m of dif.matchAll(/^\+#{2,3}\s+(.+)$/gm)) { const k = "tit:" + m[1].trim().slice(0, 160); if (!idT.has(k)) idT.set(k, +cts * 1000); if (!idSc.has(k)) idSc.set(k, h); }
        vistos.add(h);
      }
      const t = await run("git", ["-C", REPO, "show", `${ref}:${c.fichero}`]);
      const idS = gitCache.idS[c.nombre] || new Map();
      gitCache.bloques[c.nombre] = bloquesDeTexto(t.out, (x) => horaBloque(idT, x), (x) => idS.get("tit:" + x.tit.slice(0, 160)) || "").reverse();
      gitCache.sha[c.nombre] = sha;
    }
    out.push({ canal: c.nombre, rama: c.rama, sha: sha.slice(0, 10), t: +ct * 1000, bloques: (gitCache.bloques[c.nombre] || []).slice(0, 10), todos: gitCache.bloques[c.nombre] || [] });
  }
  return out;
}

// v159: los últimos 40 bloques del canal con lo que necesita la oficina. Etiquetas, autor, a quién se pide algo (faltan) y
// si es el turno de Humano salen de herramientas/canal-bloques.js, el MISMO lector que usa el vigía; aquí, lo propio del panel.
const horaBloque = (idT, x) => idT.get("tit:" + x.tit.slice(0, 160)) || idT.get(x.id) || 0;
const enHorario = (t) => { const d = new Date(t); return d.getDay() >= 1 && d.getDay() <= 5 && d.getHours() >= 8 && d.getHours() < 20; };
// v476: el instante en que se cumplen `ms` de horario contados desde `desde` (la próxima mirada del vigilante)
function sumaHorasTrabajo(desde, ms) {
  let t = desde, falta = ms;
  for (let i = 0; i < 400 && falta > 0; i++) {
    const d = new Date(t), i0 = new Date(t), i1 = new Date(t); i0.setHours(8, 0, 0, 0); i1.setHours(20, 0, 0, 0);
    if (d.getDay() < 1 || d.getDay() > 5 || t >= i1.getTime()) { const n = new Date(t); n.setDate(n.getDate() + 1); n.setHours(8, 0, 0, 0); t = n.getTime(); continue; }
    if (t < i0.getTime()) { t = i0.getTime(); continue; }
    const cabe = i1.getTime() - t; if (cabe >= falta) return t + falta;
    falta -= cabe; t = i1.getTime();
  }
  return t;
}
function proximo805(t) { const d = new Date(t); d.setHours(8, 5, 0, 0); if (d.getTime() <= t || !enHorario(d.getTime())) { do { d.setDate(d.getDate() + 1); } while (!enHorario(d.getTime())); } return d.getTime(); }
// cuánto de [a, b] cae en ese horario (ms)
function horasTrabajo(a, b) {
  if (!(b > a)) return 0;
  let n = 0; const d = new Date(a); d.setHours(0, 0, 0, 0);
  for (let i = 0; i < 400 && d.getTime() < b; i++) {
    if (d.getDay() >= 1 && d.getDay() <= 5) {
      const i0 = new Date(d.getTime()); i0.setHours(8, 0, 0, 0); const i1 = new Date(d.getTime()); i1.setHours(20, 0, 0, 0);
      n += Math.max(0, Math.min(b, i1.getTime()) - Math.max(a, i0.getTime()));
    }
    d.setDate(d.getDate() + 1);
  }
  return n;
}
function bloquesDeTexto(txt, tDe, shaDe) {
  const raws = canal.partir(String(txt || "").replace(/\r/g, "")).slice(-40);
  const out = canal.leerLista(raws).map((x, i) => {
        const b = raws[i];
        const cab = (b.match(/^<!--(.*?)-->/) || [])[1] || "";
        const tit = x.tit, de = x.de, tag = x.tag;
        const hora = (tit.match(/\b(\d{1,2}:\d{2})\b/) || [])[1] || "";
        const etq = x.etiquetas.join(" ");
        const proyecto = (PROYECTOS.find(([, re]) => re.test(etq)) || [""])[0];   // el proyecto del bloque, por sus etiquetas (reglas de la config)
        const t = tDe(x);
        const cuerpo = x.cuerpo;
        const decision = (cuerpo.match(/^(?:PARA HUMANO:.*|\**Pregunta a Humano\b.*\?.*|DECISI[OÓ]N HUMANO:.*|Tu OK:.*|.*elecci[oó]n de Humano.*|(?:Falta|Pendiente) de Humano:.*)$/mi) || [])[0] || "";
        const borrador = (() => {
          const ls = cuerpo.split("\n"); const i = ls.findIndex((l) => /borrador[^\n]*:\**\s*$/i.test(l.replace(/\*+$/, "")) || /^\s*\d+\.\s*\**borrador/i.test(l)); if (i < 0) return "";
          const out = []; for (const l of ls.slice(i + 1)) { if (/^\s*>/.test(l)) out.push(l.replace(/^\s*>\s?/, "")); else if (out.length && l.trim()) break; }
          return out.join("\n").trim().slice(0, 3000);
        })();
        const boB = borrador ? null : borradorDe(cuerpo);
        const decJ = (() => {
          const i = cuerpo.search(/DECISI[OÓ]N HUMANO/i); if (i < 0) return null;
          const ls = cuerpo.slice(i, i + 3000).split("\n"); const id = (ls[0].match(/`([^`]+)`/) || [])[1] || "";
          const ops = []; let voto = "";
          for (const l of ls.slice(1)) {
            const m = l.match(/^\s*[-*•]\s*\*{0,2}\(([a-e])\)\*{0,2}\s*(.+)$/i);
            if (m) { ops.push({ l: m[1].toLowerCase(), t: m[2].replace(/\*\*|`/g, "").trim().slice(0, 200) }); continue; }
            const v = l.match(/voto[^:]*:\s*\*{0,2}\(([a-e])\)/i); if (v) { voto = v[1].toLowerCase(); continue; }
            if (ops.length && /^\s*\d+\.\s|^#{2,3}\s/.test(l)) break;
          }
          return ops.length >= 2 ? { id, ops, voto } : null;
        })();
        return { para: (canal.cabecera(b).para || "").trim(), id: x.id, accion: x.accion, tit: tit.slice(0, 160), hora, de, tag, etiquetas: x.etiquetas,
          proyecto, t, decJ, borrador: borrador || (boB ? boB.borrador : ""), borradorPara: boB ? boB.para : "", borradorCanal: boB ? boB.canal : "", clave: x.clave, estadoCab: x.estado, sha: String((shaDe && shaDe(x)) || "").slice(0, 10),
          cuerpo: cuerpo.slice(0, 3000), loHace: ((cuerpo.match(/\[lo hace:\s*[^\]]+\]/gi) || []).pop() || ""), decision: decision.replace(/[*_`]/g, "").replace(/^Pregunta a Humano\s*(\([^)]*\))?\s*[.:]?\s*/i, "").slice(0, /^\**Pregunta a Humano/i.test(decision) ? 480 : 300),
          pideIA: x.pideIA, faltan: x.faltan, pideHumano: x.pideHumano,
          pideHumanoTexto: !!x.pideHumanoTexto, retenido: x.retenido || null, enPreparacion: x.enPreparacion || null, respondeA: x.respondeA || "", tocaDe: x.tocaDe || "",
          humano: /(^|\n)@humano\b|para:[^|]*humano/i.test(b) || /para:[^|]*Humano/.test(cab) || (!!NOMBRE_RE && new RegExp("(^|\\n)" + NOMBRE_RE.slice(0, -1) + "|para:[^|]*" + NOMBRE_RE.slice(1, -1), "i").test(b)) };
  });
  // v398: la hora del bloque que aún espera (si lleva más de 2 h sin la IA, la pregunta a Humano sale igual: ver pideJ)
  for (const o of out) if (o.enPreparacion) { const p = out.find((y) => y.id && y.id === o.enPreparacion.id); o.prepT = p ? p.t : 0; }
  return out;
}

let raicesSemana = [];
function asuntoClaves(texto) {
  const tit = tituloHilo(texto || ""), pl = textoPlano(texto || "").slice(0, 400);
  const n = sinTildes(tit).replace(/^\s*hilo:\s*/i, "").replace(/\s*[·|]\s*parte\s*\d+\b.*$/i, "").replace(/\bparte\s*\d+\b/gi, "");
  const ks = [...tit.matchAll(/\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g)].map((m) => "j:" + m[1]);
  const segs = n.split("·").map((s) => s.replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
  const pr = proyectoDe(tit + "\n" + pl);
  if (segs.length > 1 && segs[0].split(" ").length <= 3 && pr !== "General") ks.push("s:" + segs[0] + "|" + pr);
  const t = n.replace(/\d+/g, " ").replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();
  if (t.length >= 8) ks.push("t:" + t);
  return ks;
}
const vieneDe = (texto) => {
  const u = (String(texto || "").match(/Viene de:\s*<?(https?:\/\/[^\s>|]+)/) || [])[1] || "";
  const m1 = u.match(/thread_ts=(\d+\.\d+)/), m2 = u.match(/\/p(\d{10})(\d{6})/);
  return m1 ? m1[1] : m2 ? `${m2[1]}.${m2[2]}` : "";
};
// hilos: [{ts, texto}] (los de ahora y los de 14 días); etq: ts → etiquetas del canal git que lo unen. Devuelve ts → ms
function temasDesde(hilos, etq, creadas) {
  const ids = [...new Set(hilos.map((h) => h.ts))], i0 = new Map(ids.map((t, i) => [t, i])), pad = ids.map((_, i) => i);
  const raiz = (i) => { while (pad[i] !== i) { pad[i] = pad[pad[i]]; i = pad[i]; } return i; };
  const une = (a, b) => { a = raiz(a); b = raiz(b); if (a !== b) pad[b] = a; };
  const primero = ids.map((t) => tsMs(t)), porClave = new Map();
  for (const h of hilos) {
    const i = i0.get(h.ts), v = vieneDe(h.texto);
    if (v && v !== h.ts) { if (i0.has(v)) une(i0.get(v), i); else primero[i] = Math.min(primero[i], tsMs(v)); }   // el hilo viejo puede no estar
    for (const k of [...asuntoClaves(h.texto), ...((etq && etq[h.ts]) || []).map((e) => "e:" + e)]) {
      if (k.startsWith("j:") && creadas && creadas[k.slice(2)] > 0) primero[i] = Math.min(primero[i], creadas[k.slice(2)]);   // la incidencia es de antes
      if (porClave.has(k)) une(porClave.get(k), i); else porClave.set(k, i);
    }
  }
  const min = new Map(); ids.forEach((t, i) => { const r = raiz(i); min.set(r, Math.min(min.get(r) ?? Infinity, primero[i])); });
  return Object.fromEntries(ids.map((t, i) => [t, min.get(raiz(i))]));
}

// ---------- el cerebro: estado de cada hilo ----------
function analizar(hilosSlack, L, P, agentes, git, previos) {
  const bloquesGit = (git || []).flatMap((g) => (g.todos || []).map((b) => ({ ...b, canal: g.canal })));
  const ahora = Date.now();
  const pideJ = (b) => !!b.pideHumano || (!!b.enPreparacion && !b.retenido && !!b.prepT && ahora - b.prepT > 2 * 3600e3);
  // quién trabaja en cada hilo AHORA
  const trabajando = {};  // hilo -> Set(IA)
  const desdeT = {};   // v157: hilo -> { IA: desde cuándo trabaja }
  const pon = (h, ia, t) => { if (!h) return; (trabajando[h] = trabajando[h] || new Set()).add(ia); const d = desdeT[h] = desdeT[h] || {}; if (t && (!d[ia] || t < d[ia])) d[ia] = t; };
  const claudeVivos = P ? P.claudeHilo.map((p) => ({ ...p, hilo: L.sesionHilo[p.ses] })) : [];
  claudeVivos.forEach((p) => pon(p.hilo, "Claude", p.ini));
  const agenteActivo = (id) => { const a = agentes && agentes.find((x) => x.id === id); return a ? /RUNNING|CREATING|PENDING/i.test(a.run || "") : null; };
  const cursorVivos = L.cursorSlack.filter((c) => c.agente && !c.fin && ahora - c.mod < 65 * MIN && agenteActivo(c.agente) !== false);
  cursorVivos.forEach((c) => pon(c.hilo, "Cursor", c.ini));
  const arrancan = {}, terminaron = {}, avisados = {};
  const verVivo = (hilo, ia) => ia === "Claude" ? claudeVivos.some((p) => p.hilo === hilo) : ia === "Cursor" ? cursorVivos.some((c) => c.hilo === hilo) : false;
  for (const [hilo, ias] of Object.entries(L.arrancando || {})) for (const [ia, v0] of Object.entries(ias || {})) {
    const v = typeof v0 === "number" ? { ini: v0, fin: 0, viejo: true } : (v0 || {});
    const hs = hilosSlack.find((x) => x.ts === hilo); if (!hs || !v.ini) continue;
    const escribio = hs.msgs.some((m) => m.quien === ia && tsMs(m.ts) > v.ini - 5e3);
    if (ia === "Coo" && !v.lanzador) {
      if (v.fin && v.rc) { if (ahora - v.fin < 10 * MIN) (terminaron[hilo] = terminaron[hilo] || []).push({ ia, fin: v.fin, rc: v.rc, que: "no se pudo avisar" }); }
      else if (!escribio && ahora - v.ini < 15 * MIN) (avisados[hilo] = avisados[hilo] || []).push({ ia, t: v.ini });
      continue;
    }
    if (v.fin) { if (ahora - v.fin < 10 * MIN) (terminaron[hilo] = terminaron[hilo] || []).push({ ia, fin: v.fin, rc: v.rc || 0 }); continue; }
    if (v.viejo ? (ahora - v.ini > 3 * MIN || escribio) : ahora - v.ini > 90 * MIN) continue;
    if (!v.viejo && ahora - v.ini > 3 * MIN && P && !verVivo(hilo, ia) && ia !== "Coo") continue;   // (no se ve: no se dice que trabaja)
    if (!(trabajando[hilo] && trabajando[hilo].has(ia))) pon(hilo, ia, v.ini);
    if (ahora - v.ini < 60e3 && !escribio && !verVivo(hilo, ia)) (arrancan[hilo] = arrancan[hilo] || []).push(ia);
  }
  const CON_ELLO = /(?:⚙️?|:gear:)\s*[*_]*\s*con ello\b/i, HECHO_T = /\[\s*hecho\b[^\]]*\]/i;
  const porSenal = {}, sinSenal = {};   // hilo -> { IA: última señal } · hilo -> [{ ia, desde, ult }]
  for (const hs of hilosSlack) for (const ia of ["Charla", "Gus"]) {
    let ini = 0, ult = 0, fin = 0;
    for (const m of hs.msgs) {
      if (m.quien !== ia) continue;
      const t = tsMs(m.ts), tx = textoPlano(m.texto || "");
      if (HECHO_T.test(tx)) { if (ini) fin = t; ini = 0; }
      else if (CON_ELLO.test(tx)) { if (!ini) ini = t; ult = t; fin = 0; }
      else if (ini) ult = t;
    }
    if (ini && ahora - ult <= 20 * MIN) { pon(hs.ts, ia, ini); (porSenal[hs.ts] = porSenal[hs.ts] || {})[ia] = ult; }
    else if (ini && ahora - ult <= 2 * 3600e3) (sinSenal[hs.ts] = sinSenal[hs.ts] || []).push({ ia, desde: ini, ult });
    else if (fin && ahora - fin < 10 * MIN) (terminaron[hs.ts] = terminaron[hs.ts] || []).push({ ia, fin, rc: 0 });
  }
  // Coo: despertado por webhook y todavía sin contestar en ese hilo (máx. 15 min)
  const ultimoDe = (h, ia) => { const m = h.msgs.filter((x) => x.quien === ia).pop(); return m ? tsMs(m.ts) : 0; };
  const hilos = [];
  const timbre = [];
  const relanzar = [];   // v174: [lo hace: X] sin señal de que X arrancara (lo relanza la oficina con turno: relanzaPendientes)
  const ultHumanoGlobal = Math.max(0, ...hilosSlack.flatMap((h) => h.msgs.filter((m) => m.quien === "Humano").map((m) => tsMs(m.ts))));
  const temaDeHilo = (h) => { const r = h.msgs[0] || {}; return objetivoDe(r.texto) ? limpiaTitulo(tituloHilo(r.texto)) : temaDe(tituloHilo(r.texto || ""), textoPlano(r.texto || "").slice(0, 400)); };
  const ultHumanoTema = {};
  const ultHumanoTemaDonde = {};
  for (const h of hilosSlack) { const k = temaDeHilo(h); for (const m of h.msgs) if (m.quien === "Humano" && tsMs(m.ts) > (ultHumanoTema[k] || 0)) {
    ultHumanoTema[k] = tsMs(m.ts); ultHumanoTemaDonde[k] = { ts: h.ts, titulo: limpiaTitulo(tituloHilo(((h.msgs || [])[0] || {}).texto || "")).slice(0, 60), texto: textoPlano(m.texto || "").replace(/\s+/g, " ").slice(0, 60) }; } }
  const normP = (s) => sinTildes(s).replace(/[^a-z0-9]+/g, " ").trim();
  const parteDe = (tt) => { const m = String(tt).match(/^(.*?)\s*[·\-–—|,]?\s*\(?\s*parte\s*(\d+)\s*\)?\s*$/i); return m ? { base: normP(m[1]), n: +m[2] } : { base: normP(tt), n: 1 }; };
  const partes = hilosSlack.map((h) => ({ ts: h.ts, ...parteDe(tituloHilo((h.msgs[0] || {}).texto || "")) }));
  const sigueEn = {};
  for (const p of partes) {
    const nueva = partes.filter((q) => q.base === p.base && q.base.length >= 8 && q.n > p.n).sort((a, b) => b.n - a.n)[0];
    if (nueva) sigueEn[p.ts] = nueva;
  }
  const fechaTitulo = (raiz) => {
    const fm = tituloHilo(raiz.texto).match(/\b(\d{1,2})\/(\d{1,2})\b/); if (!fm || +fm[2] < 1 || +fm[2] > 12) return null;
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    let f = new Date(hoy.getFullYear(), +fm[2] - 1, +fm[1]);
    if (f < hoy && hoy - f > 180 * 86400e3) f = new Date(hoy.getFullYear() + 1, +fm[2] - 1, +fm[1]);   // dic → ene
    return { f, hoy, txt: `${fm[1]}/${fm[2]}` };
  };
  const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
  const fechaEnTexto = (t) => {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0); const st = sinTildes(String(t));
    const fm = st.match(/\b(\d{1,2})\/(\d{1,2})\b/);
    if (fm && +fm[2] >= 1 && +fm[2] <= 12) {
      let f = new Date(hoy.getFullYear(), +fm[2] - 1, +fm[1]);
      if (f < hoy && hoy - f > 180 * 86400e3) f = new Date(hoy.getFullYear() + 1, +fm[2] - 1, +fm[1]);
      const dm = st.match(/\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\s+(\d{1,2})\/(\d{1,2})\b/);
      return { f, hoy, txt: dm && dm[2] === fm[1] && dm[3] === fm[2] ? `${dm[1]} ${fm[1]}/${fm[2]}` : `${fm[1]}/${fm[2]}` };
    }
    const dm = st.match(/\b(?:el|este|el proximo)\s+(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/);
    if (!dm) return null;
    const f = new Date(hoy); let n = (DIAS.indexOf(dm[1]) - hoy.getDay() + 7) % 7; if (!n) n = 7; f.setDate(f.getDate() + n);
    return { f, hoy, txt: `${dm[1]} ${f.getDate()}/${f.getMonth() + 1}` };
  };
  const eraPara = (raiz) => { const f = fechaTitulo(raiz); return f && f.f < f.hoy ? ` (era para el ${f.txt})` : ""; };
  const relevadoA = {};
  for (const h of hilosSlack) {
    const r = (h.msgs[0] || {}).texto || "", viejo = vieneDe(r);
    if (viejo && viejo !== h.ts) relevadoA[viejo] = { titulo: limpiaTitulo(tituloHilo(r)), t: tsMs(h.ts) };
  }
  const NO_TITULO = /^(CANAL|OFICINA|RELEASE|LOGS|UAT|QA|PROD|JIRA|SLACK|SAP|MULE|NUBE|DATOS)$/;
  const normT = (s) => " " + sinTildes(s).replace(/[^a-z0-9]+/g, " ").trim() + " ";
  const ligadosA = {};
  const citaA = new Map();
  const menciones = {};
  // (el timbre, también por su título: cada equipo puede tener apuntado un hilo de timbre distinto en timbre-hilo.txt)
  const esTim = (h) => h.ts === L.timbreHilo || /^(🔔|:bell:)|timbre del canal/i.test(tituloHilo(((h.msgs || [])[0] || {}).texto || ""));
  // (v540: los hilos viejos, de 36 h a 14 días, no se quedan bloques del canal: ni aquí, ni por cita, parecido o proyecto, abajo)
  for (const h of hilosSlack) if (!esTim(h) && !h.viejo) for (const m of h.msgs || []) for (const x of String(m.texto || "").matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)) {
    const l = (menciones[x[0]] = menciones[x[0]] || {}); l[h.ts] = Math.max(l[h.ts] || 0, tsMs(m.ts)); }
  const duenoClave = (b) => { let mejor = "", tm = 0;
    for (const k of new Set([...(b.etiquetas || []), ...String(b.tit || "").toUpperCase().matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)].map((x) => (typeof x === "string" ? x : x[0])))) {
      for (const [ts, t] of Object.entries(menciones[k] || {})) if (t <= b.t + 5 * MIN && t > tm) { tm = t; mejor = ts; } }
    return mejor; };
  for (const h of hilosSlack) {
    if (h.viejo) continue;
    const sin = h.ts.replace(".", "");
    const ttH = normT(tituloHilo((h.msgs[0] || {}).texto || "")).trim();
    const citaTitulo = (b) => ttH.length >= 12 && [...`${b.tit || ""}\n${b.respondeA || ""}`.matchAll(/«([^«»]{12,})»?/g)]
      .some((m) => { const q = normT(m[1].replace(/…$/, "")).trim(); return q.length >= 12 && (ttH.startsWith(q) || q.startsWith(ttH)); });
    let ref = bloquesGit.filter((b) => b.t && (`${b.tit}\n${b.cuerpo || ""}`.includes(h.ts) || `${b.cuerpo || ""}`.includes("/p" + sin) || citaTitulo(b)));
    for (const b of ref) { if (!citaA.has(b)) citaA.set(b, new Set()); citaA.get(b).add(h.ts); }
    {
      const tt = normT(tituloHilo((h.msgs[0] || {}).texto || ""));
      const VAGAS = /^(parte|tema|canal|oficina|release|prueba|pruebas|datos|nube|logs|jira|slack|mule|humano|claude|cursor)$/;
      const porParte = (e) => !/\d/.test(e) && normT(e).trim().split(" ").some((p) => p.length >= 4 && !VAGAS.test(p) && tt.includes(" " + p + " "));
      ref = [...new Set([...ref, ...bloquesGit.filter((b) => b.t && b.t >= tsMs(h.ts) - 60 * MIN
        && (b.etiquetas || []).some((e) => e.length >= 5 && !NO_TITULO.test(e) && (tt.includes(normT(e)) || porParte(e))))])];
    }
    const extra = esTim(h) ? [] : bloquesGit.filter((b) => b.t && b.t >= tsMs(h.ts) - 60 * MIN && duenoClave(b) === h.ts);
    if (!ref.length && !extra.length) continue;
    const tags = ref.flatMap((b) => b.etiquetas || []);
    const t0 = ref.length ? Math.min(...ref.map((b) => b.t)) - 60 * MIN : 0;
    ligadosA[h.ts] = bloquesGit.filter((b) => b.t && (ref.includes(b) || extra.includes(b) || (ref.length && canal.comparten(b.etiquetas || [], tags) && b.t >= t0))).sort((a, b) => a.t - b.t);
  }
  for (const k of Object.keys(ligadosA)) {
    const set = ligadosA[k]; if (!set.length) continue;
    const t0 = Math.min(...set.map((b) => b.t));
    for (let vuelta = 0; vuelta < 6; vuelta++) {
      const nuevos = bloquesGit.filter((b) => b.t && b.t >= t0 && !set.includes(b) && b.respondeA && set.some((s) => s.id && canal.citaId(b.respondeA, s.id)));
      if (!nuevos.length) break;
      set.push(...nuevos);
    }
    set.sort((a, b) => a.t - b.t);
  }
  const NO_FICHA = /^(?:Humano|Claude|Cursor|Coo|Grok|Gus|Charla|Slack|Jira|Hilo|Tema|Parte|Reunión|Chat|Correo|OCA|Acuse|Timbre|Voto|Hecho|Estado)$/i;
  const fichasB = (txt) => new Set([...String(txt || "").replace(/[*_`]/g, "").matchAll(/\b[A-Z][A-Z0-9]+-\d+\b|#\d{4,5}\b|\b[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{3,}\b/g)]
    .map((x) => x[0]).filter((w) => !NO_FICHA.test(w)));
  const duenoLig = new Map();
  {
    const enVarios = new Map();
    for (const [k, bs] of Object.entries(ligadosA)) for (const b of bs) { if (!enVarios.has(b)) enVarios.set(b, []); enVarios.get(b).push(k); }
    for (const [b, ks] of enVarios) {
      if (ks.length < 2) continue;
      const fb = fichasB(`${b.tit || ""}\n${b.decision || ""}\n${String(b.cuerpo || "").slice(0, 600)}`);
      const nota = ks.map((k) => { const hs = hilosSlack.find((x) => x.ts === k) || { msgs: [] }, ms = hs.msgs || [];
        return { k, cita: citaA.has(b) && citaA.get(b).has(k) ? 1 : 0, nombra: [...fichasB(tituloHilo((ms[0] || {}).texto || ""))].filter((w) => fb.has(w)).length,
          mov: Math.max(0, ...ms.map((m) => tsMs(m.ts))) }; });
      nota.sort((x, y) => (y.cita - x.cita) || (y.nombra - x.nombra) || (y.mov - x.mov));
      duenoLig.set(b, nota[0].k);
    }
  }
  const esDeAqui = (b, ts) => !duenoLig.has(b) || duenoLig.get(b) === ts;
  const deOtroHilo = new Set(Object.values(ligadosA).flat());
  const VACIAS = new Set(["humano", "claude", "cursor", "canal", "bloque", "sobre", "desde", "hasta", "entre", "porque", "tambien",
    "cuando", "donde", "todos", "todas", "antes", "despues", "slack", "coordinacion", "encargo", "estado", "respuesta"]);
  const palabras = (s) => new Set(normT(s).trim().split(" ").filter((w) => w.length >= 5 && !VACIAS.has(w)));
  const fuertes = (s) => new Set([...String(s || "").matchAll(/#\d{3,5}\b|\b[A-Z][A-Z0-9]+-\d+\b/g)].map((m) => m[0].toUpperCase()));
  const titHilo = hilosSlack.filter((h) => !h.viejo).map((h) => { const r = (h.msgs || [])[0] || {}; const tt = tituloHilo(r.texto || "");
    return { ts: h.ts, pal: palabras(tt), fu: fuertes(tt), proy: proyectoDe(tt + "\n" + textoPlano(r.texto || "").slice(0, 400)) }; });
  const duenosDe = new Map();
  for (const b of bloquesGit) {
    if (deOtroHilo.has(b) || !b.proyecto) continue;
    const pb = palabras(`${b.tit || ""}\n${String(b.cuerpo || "").slice(0, 600)}`), fb = fuertes(`${b.tit || ""}\n${String(b.cuerpo || "").slice(0, 600)}`);
    let max = 0, mejores = [];
    for (const x of titHilo) {
      if (x.proy !== b.proyecto) continue;
      let n = 0; for (const w of x.pal) if (pb.has(w)) n++;
      for (const w of x.fu) if (fb.has(w)) n += 3;
      if (n > max) { max = n; mejores = [x.ts]; } else if (n === max && n > 0) mejores.push(x.ts);
    }
    if (max >= 2) duenosDe.set(b, new Set(mejores));
  }
  const contestadoB = new Map();
  for (const [k, bs] of Object.entries(ligadosA)) {
    const hs = hilosSlack.find((x) => x.ts === k), tJ = hs ? Math.max(0, ...hs.msgs.filter((m) => m.quien === "Humano").map((m) => tsMs(m.ts))) : 0;
    for (const b of bs) if (tJ > b.t && (!contestadoB.has(b) || contestadoB.get(b).t < tJ)) contestadoB.set(b, { t: tJ, ts: k });
  }
  // v148: Cursor que no arranca por API (último intento fallido y sin uno bueno después)
  const arrC = L.arranquesCursor || [];
  const ultArr = arrC[arrC.length - 1];
  const cursorNoArranca = ultArr && !ultArr.ok && ahora - ultArr.t < 2 * 3600e3 ? ultArr : null;
  for (const h of hilosSlack.filter((x) => esTim(x))) {
    for (const m of h.msgs) {
      const tx = textoPlano(m.texto), ok = tx.match(/decisi[oó]n tuya:\s*(.+)/i);
      const humanoDespues = h.msgs.some((x) => x.quien === "Humano" && tsMs(x.ts) > tsMs(m.ts));
      if (!(ok && !humanoDespues && tsMs(m.ts) > ultHumanoGlobal && ahora - tsMs(m.ts) < 3 * 3600e3)) continue;
      const sm = tx.match(/canal (\w+) \(sha ([0-9a-f]{7,})\)/);
      const bloque = sm ? bloquesGit.find((b) => b.canal === sm[1] && b.sha && b.sha.startsWith(sm[2].slice(0, 10))) : null;
      const hiloB = bloque ? duenoLig.get(bloque) || Object.keys(ligadosA).find((k) => ligadosA[k].includes(bloque)) || [...(duenosDe.get(bloque) || [])][0] || "" : "";
      if (bloque && (bloque.retenido || (bloque.enPreparacion && !pideJ(bloque)))) continue;
      timbre.push({ ts: m.ts, texto: ok[1].replace(/\*\*/g, "").slice(0, 200), url: enlace(m.ts, h.ts), t: tsMs(m.ts), hilo: hiloB, bloque });
    }
  }
  for (const h of hilosSlack) {
    if (esTim(h)) continue;   // v397: también por título
    const raiz = h.msgs[0];
    if (raiz.quien === "Sistema" && h.msgs.length === 1) continue;  // avisos sueltos del sistema
    // v99: si lo que despertó a Coo fue solo un agradecimiento (antes de este arreglo), no cuenta como trabajo
    const porCortesia = (t) => { const m = h.msgs.filter((x) => x.quien === "Humano" && tsMs(x.ts) <= t + 5e3 && tsMs(x.ts) > t - 60e3).pop(); return !!(m && esCortesia(m.texto)); };
    for (const a of L.avisosCoo) if (a.hilo === h.ts && ahora - a.t < 15 * MIN && ultimoDe(h, "Coo") < a.t && !porCortesia(a.t)
      && !(a.de && !/^Humano$/i.test(a.de) && bloquesGit.some((b) => b.de === "Coo" && b.t > a.t))) pon(h.ts, "Coo", a.t);
    const conv = h.msgs.filter((m) => m.quien !== "Sistema");
    const ult = conv[conv.length - 1] || raiz;
    const tUlt = tsMs(ult.ts);
    const despertadoTras = (t0) => (L.traspasos || []).some((x) => /^(LANZO|RELANZO)$/.test(x.tipo) && x.t > t0 && x.t <= ahora
      && String(x.clave || "").startsWith(`slack:${h.ts}:`) && !/:proceso:/.test(String(x.clave || "")));
    const vence = (t0, lim, reloj) => { const ht = horasTrabajo(t0, ahora); return ht > 24 * 3600e3 || (!despertadoTras(t0) && (reloj ? ahora - t0 : ht) > lim); };
    const enMarcha = [...(trabajando[h.ts] || [])];
    const frenos = L.frenos.filter((f) => f.hilo === h.ts && f.t > tUlt - 60e3);
    const plano = textoPlano(ult.texto);
    const tJx = Math.max(0, ...conv.filter((m) => m.quien === "Humano").map((m) => tsMs(m.ts)));
    const esTimbre = /^(🔔|:bell:)|timbre del canal/i.test(tituloHilo(raiz.texto));
    const planoIA = esTimbre ? plano : (conv.filter((m) => tsMs(m.ts) > tJx && tsMs(m.ts) >= tUlt - 30 * MIN && IAS.includes(m.quien)).map((m) => textoPlano(m.texto)).join("\n") || plano);
    let estado, espera = [], motivo = "";
    const relevoPersona = (() => { for (let i = conv.length - 1; i >= 0 && ["Charla", "Gus"].includes(conv[i].quien); i--)
      if (RELEVO_PERSONA.test(textoPlano(conv[i].texto).trim())) return conv[i]; return null; })();
    const preguntaPrevia = () => conv.filter((m) => tsMs(m.ts) > tJx && IAS.includes(m.quien) && !/contestó por privado/.test(m.texto || ""))
      .flatMap((m) => textoPlano(m.texto).replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).map((s) => ({ s, q: m.quien })))
      .filter((x) => PIDE_HUMANO.test(x.s) || ESPERA_TU.test(x.s) || /¿[^?¿]{3,200}\?/.test(x.s)).pop();
    const SIG = /siguiente:?\s*[*_]*\s*(Claude|Cursor|Coo)\b|le toca a (Claude|Cursor|Coo)\b|(?:^|[\s(*_])@(claude|cursor|coo)\b/gi;
    const enTexto = [...String(plano).matchAll(SIG)].map((m) => { const n = (m[1] || m[2] || m[3]).toLowerCase(); return n[0].toUpperCase() + n.slice(1); });
    const otras = [...new Set([...ult.menc, ...enTexto])].filter((x) => x !== ult.quien && x !== "Humano" && IAS.includes(x));
    const sigFrase = ((plano.replace(/\s+/g, " ").match(/siguiente:?\s*[*_]*\s*(?:Claude|Cursor|Coo)\b[^.\n]{0,120}/i) || [])[0] || "").trim();
    if (enMarcha.length) { estado = "marcha"; motivo = enMarcha.join(" y ") + " trabajando"; }
    else if (ult.privJ) {
      if (ahora - tUlt > 24 * 3600e3) { estado = "cerrado"; motivo = `↩ contestaste a ${ult.privJ} por privado (hace más de 24 h)`; }
      else { estado = "espera_ia"; motivo = `↩ contestaste a ${ult.privJ} por privado: su respuesta llegará aquí`; }
    }
    else if (ult.quien === "Humano" && !otras.length && !/@(coo|claude|cursor)\b/i.test(plano)
             && /\b(queda|est[aá]|lo doy por)\s+cerrado\b|\b(cerramos|cierro)\s+(el\s+|este\s+)?(tema|hilo)\b|\b(tema|hilo)\s+cerrado\b/i.test(plano)) {
      estado = "cerrado"; motivo = "✔ lo cerraste tú en el hilo";
    }
    else if (ult.quien === "Humano") {
      espera = otras.length ? otras : ["Coo"];
      const mins = (ahora - tUlt) / MIN;
      const dondeJ = ultHumanoTemaDonde[temaDeHilo(h)], seguidoEn = dondeJ && dondeJ.ts !== h.ts && (ultHumanoTema[temaDeHilo(h)] || 0) > tUlt ? dondeJ : null;
      const atendido = (L.lanzHilo[h.ts] || 0) > tUlt - 5e3;
      const clJ = `slack:${h.ts}:${ult.ts}`;
      const relJ = relanzadoEn(L, clJ);
      const paraClaude = ((ult.menc || []).includes("Claude") || /\bclaude\b/i.test(plano)) && !/(^|\s)@grok\b/i.test(plano);
      if (paraClaude && !ult.ofi && !atendido && !frenos.length && !relJ && !esOkHumano(ult.texto) && mins > 6 && mins < 120
        && !(L.traspasos || []).some((x) => x.tipo === "RELANZO" && String(x.clave || "").startsWith(clJ + ":despierta:")))   // (v474: si ya se la despertó por él, no otra vez)
        relanzar.push({ hilo: h.ts, ts: ult.ts, ia: "Claude", quien: "Humano", que: "Claude: tu mensaje (la escucha no lo recogió)", texto: String(ult.texto || "").slice(0, 3000), clave: clJ, oficina: true });
      if (frenos.length) { estado = "frenado"; motivo = `freno anti ping-pong (${[...new Set(frenos.map((f) => f.ia))].join(", ")})`; }
      else if (atendido) { estado = "pausa"; espera = []; motivo = "Claude lo ha atendido (su respuesta está en el canal git)"; }
      else if (relJ && ahora - relJ > 20 * MIN) { estado = "parado"; motivo = `⚠️ la escucha no recogió tu mensaje a Claude; se relanzó a las ${hhmm(relJ)} y tampoco consta: mira la escucha`; }
      else if (relJ) { estado = "espera_ia"; motivo = `➡️ Claude: relanzado a las ${hhmm(relJ)} (la escucha no había recogido tu mensaje)`; }
      else if (mins > 30 && seguidoEn && !/\?/.test(plano)) { estado = "cerrado"; espera = []; motivo = `↪ Lo seguiste en «${seguidoEn.titulo}» (${hhmm(ultHumanoTema[temaDeHilo(h)])}): aquí ya no se espera nada`; }
      else if (vence(tUlt, 3 * 3600e3)) { estado = "olvidado"; motivo = `nadie contestó en 3 h (era para ${espera.join(" y ")})`; }
      else if (mins > 30) { estado = "parado"; motivo = `nadie contesta a Humano: mete presión a ${espera.join(" y ")}`; }
      else { estado = "espera_ia"; motivo = `esperando a ${espera.join(" y ")}`; }
    } else if (relevoPersona) {
      const txtR = textoPlano(relevoPersona.texto).trim(), quienR = (txtR.match(RELEVO_PERSONA) || [])[1] || "alguien";
      estado = "humano"; espera = []; motivo = `💬 ${quienR} te ha escrito (lo trae ${relevoPersona.quien})${/\?/.test(txtR) ? " (con preguntas)" : ""}`;
      const previa = preguntaPrevia();   // (si una IA te había dejado una pregunta, se sigue viendo, como con los privados)
      if (previa) motivo = `${previa.q} espera tu respuesta: «${previa.s.trim().slice(0, 110)}» · y ${motivo}`;
    } else if (/^💬\s*\*?[^*\n]+?\*?\s+contestó por privado/.test(String(ult.texto || "").trim())) {
      const quienP = (String(ult.texto).trim().match(/^💬\s*\*?([^*\n]+?)\*?\s+contestó/) || [])[1] || "alguien";
      const hm = String(ult.texto).match(/contestó por privado \((\d{1,2}):(\d{2})\)/);
      let tP = tUlt; if (hm) { const d = new Date(tUlt); d.setHours(+hm[1], +hm[2], 0, 0); if (d.getTime() > tUlt + 60e3) d.setDate(d.getDate() - 1); tP = d.getTime(); }
      const pila = (s) => sinTildes(s).split(/\s+/)[0];
      const yaResp = hilosSlack.some((x) => x.msgs.some((m) => m.privJ && tsMs(m.ts) > tP && pila(m.privJ) === pila(quienP)));
      estado = "humano"; motivo = `💬 ${quienP} te contestó por privado${/\?/.test(plano) ? " (con preguntas)" : ""}`;
      if (yaResp) { estado = "espera_ia"; espera = []; motivo = `↩ ya le contestaste a ${quienP} por privado`; }
      const previa = preguntaPrevia();
      if (previa) { estado = "humano"; motivo = `${previa.q} espera tu respuesta: «${previa.s.trim().slice(0, 110)}» · y ${motivo.replace(/^💬 /, "💬 ")}`; }
    } else if (PIDE_HUMANO.test(sinFut(plano)) || (IAS.includes(ult.quien) && (PIDE_HUMANO.test(sinFut(planoIA)) || ESPERA_TU.test(sinFut(planoIA))))
               || (ult.menc.includes("Humano") && IAS.includes(ult.quien) && /\?|d[ií]me(lo)?\b|si prefieres|av[ií]same|tu (decisi[oó]n|respuesta)|qu[eé] prefieres/i.test(sinFut(plano)))) {
      const fr = (planoIA.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).find((s) => PIDE_HUMANO.test(sinFut(s)) || ESPERA_TU.test(sinFut(s))) || "").trim().slice(0, 120);
      const q = fr ? "" : ((plano.replace(/«[^»]*»/g, "").match(/¿[^?¿]{3,200}\?/g) || []).pop() || "");
      estado = "humano"; motivo = fr ? `${ult.quien} espera tu respuesta: «${fr}»` : q ? `${ult.quien} te pregunta: ${q.slice(0, 140)}` : `${ult.quien} espera tu respuesta`;
    } else if (frenos.length) {
      estado = "frenado"; motivo = `freno anti ping-pong (${[...new Set(frenos.map((f) => f.ia))].join(", ")})`;
      espera = [...new Set(frenos.map((f) => f.ia))];
    } else if (otras.length) {
      espera = otras;
      const mins = (ahora - tUlt) / MIN;
      // v153: si a esa IA ya se la despertó para este hilo después del mensaje, está atendido (Claude contesta en el canal git)
      const atendidoIA = otras.some((ia) => despertada(L, h.ts, ia, tUlt - 5e3));
      const que = sigFrase ? `«${sigFrase}»` : `${ult.quien} pidió algo a ${otras.join(" y ")}`;
      if (atendidoIA) { estado = "pausa"; espera = []; motivo = `${otras.join(" y ")} ya está con ello: ${que}`; }
      else if (vence(tUlt, 3 * 3600e3)) { estado = "olvidado"; motivo = `${que} hace más de 3 h y nadie lo ha cogido`; }
      else if (mins > 20) { estado = "parado"; motivo = `${que} y no se ha despertado a ${otras.join(" y ")}: mete presión a ${otras.join(" y ")}`; }
      else { estado = "espera_ia"; motivo = sigFrase ? `➡️ ${que}` : `esperando a ${otras.join(" y ")}`; }
    } else if (IAS.includes(ult.quien) && !otras.length && /¿[^?¿]{3,200}\?/.test(planoIA.replace(/«[^»]*»|"[^"]*"|“[^”]*”/g, ""))) {
      const q = (planoIA.replace(/«[^»]*»|"[^"]*"|“[^”]*”/g, "").match(/¿[^?¿]{3,200}\?/g) || []).pop() || "";
      estado = "humano"; motivo = `${ult.quien} te pregunta: ${q.slice(0, 120)}`;
    } else if (IAS.includes(ult.quien) && A_LA_ESPERA.test(plano.replace(/\s+/g, " "))) {
      const frase = (plano.replace(/\s+/g, " ").match(A_LA_ESPERA) || [""])[0].slice(0, 140);
      estado = "espera_ia"; espera = []; motivo = `⏳ a la espera: «${frase}…»`;
      const ft = fechaTitulo(raiz);
      if (ahora - tUlt > 24 * 3600e3 && !(ft && ft.f >= ft.hoy)) { estado = "olvidado"; motivo = `⏳ a la espera desde hace más de 24 h, sin novedades: «${frase}…»`; }
    } else if (IAS.includes(ult.quien) && plano.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).some((s) => PROMETE.test(s) && !OFRECE.test(s))) {
      const frase = (plano.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/).find((s) => PROMETE.test(s) && !OFRECE.test(s)) || "").trim().slice(0, 140);
      espera = [ult.quien];
      if (vence(tUlt, 24 * 3600e3, true)) { estado = "olvidado"; motivo = `${ult.quien} se comprometió y no ha vuelto en más de 24 h: «${frase}»`; }
      else { estado = "espera_ia"; motivo = `${ult.quien} se ha comprometido: «${frase}»`; }
    } else if (ahora - tUlt < 30 * MIN) { estado = "pausa"; motivo = `${ult.quien} acaba de contestar`; }
    else { estado = "cerrado"; motivo = "sin nada pendiente a la vista"; }
    const mEtq = conv.filter((m) => m.quien !== "Humano" && tsMs(m.ts) > tJx && etiquetaDe(m)).pop();
    const etq = etiquetaDe(mEtq);
    let pideOk = null, propio = null;
    const mEsp = conv.filter((m) => m.quien !== "Humano" && etiquetaDe(m)).pop();
    const eEsp = etiquetaDe(mEsp);
    let esperaA = null;
    const SIGO = /^\s*sigo esperando\b/i;
    const acuseDe = (m) => { const e = mEsp && etiquetaDe(mEsp), q = (String(m.texto || "").match(/^\s*💬\s*\*?([^*\n]+?)\*?\s+contestó por privado/) || [])[1];
      return q && e && e.espera && sinTildes(q).split(/\s+/)[0].startsWith(sinTildes(e.espera.quien || "").split(/\s+/)[0].slice(0, 4)) && esAcuse(m.texto) ? m : null; };
    const soloOkDespues = mEsp && conv.filter((m) => tsMs(m.ts) > tsMs(mEsp.ts)).every((m) => (m.quien === "Humano" && (esOkHumano(m.texto) || esCortesia(m.texto) || SIGO.test(textoPlano(m.texto)))) || acuseDe(m));
    const acuseP = mEsp && conv.filter((m) => tsMs(m.ts) > tsMs(mEsp.ts)).map(acuseDe).filter(Boolean).pop();
    const vigilaQue = eEsp && !eEsp.espera && !eEsp.toca && eEsp.hace && IAS.includes(eEsp.hace.ia) && !enMarcha.includes(eEsp.hace.ia)
      && /^(vigilar|esperar a que|estar atent[oa]|mirar (cuando|si))\b|\bcuando (cierre|termine|acabe)\b|\bhasta que (cierre|termine|acabe)\b/i.test(eEsp.hace.que || "") ? eEsp.hace.que : "";
    const vigilaA = vigilaQue && esperaTercero(vigilaQue);
    const vigila = !!vigilaQue && !vigilaA && /\b(simulacro|simulaci[oó]n|deploy|despliegue|batch|proceso|job|carga|migraci[oó]n|validate|check ?only|build|pipeline|ejecuci[oó]n|backup|archiv|import|export|sincroniz|release|test(s)? de|compilaci[oó]n)/i.test(vigilaQue);
    if (eEsp && (eEsp.espera || vigila || vigilaA) && !eEsp.toca && !enMarcha.length && soloOkDespues) {
      esperaA = vigila ? { quien: (vigilaQue.match(/(?:vigilar|esperar a que (?:termine|acabe|cierre))\s+(?:el |la |los |las )?(.{3,60}?)(?:\s+y\s|[,;.]|$)/i) || [])[1] || "un proceso", que: vigilaQue, proceso: true }
        : vigilaA ? { ...vigilaA } : { ...eEsp.espera };
      Object.assign(esperaA, { t: tsMs(mEsp.ts), ts: mEsp.ts, de: mEsp.quien, ia: (vigila && eEsp.hace.ia) || (IAS.includes(mEsp.quien) ? mEsp.quien : "Claude") });
      estado = "espera_otro"; espera = [];
      motivo = esperaA.proceso ? "" : `⏸ Esperando a ${esperaA.quien} desde ${desdeCuando(esperaA.t, ahora)}${esperaA.que ? ": " + esperaA.que : ""}`;
      if (acuseP && !esperaA.proceso) { esperaA.acuse = { t: tsMs(acuseP.ts), texto: cuerpoPrivado(acuseP.texto) }; motivo += ` · contestó (${hhmm(tsMs(acuseP.ts))}): «${esperaA.acuse.texto.slice(0, 120)}»`; }
    }
    if (!esperaA && !enMarcha.length) {
      const mF = [...conv].reverse().find((m) => m.quien !== "Humano");
      const okTras = mF && conv.filter((m) => tsMs(m.ts) > tsMs(mF.ts)).every((m) => m.quien === "Humano" && (esOkHumano(m.texto) || esCortesia(m.texto) || SIGO.test(textoPlano(m.texto))));
      const etF = mF && etiquetaDe(mF), soloHecho = !!etF && !!etF.hecho && !etF.toca && !etF.hace && !etF.espera;
      const eF = mF && IAS.includes(mF.quien) && okTras && (!etF || soloHecho) ? esperaDeFrase(textoPlano(mF.texto)) : null;
      if (eF) {
        esperaA = { ...eF, t: tsMs(mF.ts), ts: mF.ts, de: mF.quien, ia: mF.quien };
        estado = "espera_otro"; espera = [];
        motivo = `⏸ Esperando a ${esperaA.quien} desde ${desdeCuando(esperaA.t, ahora)}${esperaA.que ? ": " + esperaA.que : ""}`;
      }
      if (!esperaA && mF && IAS.includes(mF.quien) && okTras && soloHecho && typeof prEstado === "object") {
        const TRAS = /\b(?:en cuanto|cuando)\s+(?:entre|est[eé]\s+(?:en|dentro)\b[^,.;]{0,20}|se\s+mergee|la\s+mergeen|suba|la\s+suban)\b[^.;:]{0,40}?,\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñü]{2,})\s+((?:[a-záéíóúñü]+\s+){0,1}[a-záéíóúñü]+(?:[^.;\n]{0,80}))/;
        for (const m of [...conv].reverse()) {
          if (m.quien === "Humano" || !IAS.includes(m.quien)) continue;
          const t = textoPlano(m.texto).replace(/\s+/g, " "), x = t.match(TRAS);
          if (!x || NO_PERSONA.test(x[1]) || IAS.includes(x[1])) continue;
          const n = [...t.matchAll(/(?:#|pull-requests\/)(\d{3,5})\b/g)].map((y) => y[1]).find((k) => prEstado[k] && prEstado[k].state === "MERGED" && prEstado[k].t > tsMs(m.ts) - 6 * 3600e3);
          if (!n || conv.some((y) => tsMs(y.ts) > prEstado[n].t)) continue;
          esperaA = { quien: x[1], que: `«${x[0].trim().slice(0, 140)}» (la #${n} entró en ${prEstado[n].dest || "su rama"} ${desdeCuando(prEstado[n].t, ahora)})`, t: prEstado[n].t, ts: m.ts, de: m.quien, ia: m.quien };
          estado = "espera_otro"; espera = [];
          motivo = `⏸ Esperando a ${esperaA.quien} desde ${desdeCuando(esperaA.t, ahora)}: ${esperaA.que}`;
          break;
        }
      }
    }
    if (esperaA && esperaA.proceso) motivo = `⏸ Esperando al proceso «${esperaA.quien}» desde ${desdeCuando(esperaA.t, ahora)}`;   // (el vigilante, abajo: v402)
    if (etq && !enMarcha.length && !esperaA) {
      const mins = (ahora - tUlt) / MIN;
      if (etq.toca) {
        estado = "humano"; espera = []; motivo = `🙋 ${etq.toca}${etq.hace ? ` (lo hará ${etq.hace.ia})` : ""}`;
        const deOk = (etq.hace && etq.hace.ia) || (IAS.includes(mEtq.quien) ? mEtq.quien : "Coo");
        const candB = [mEtq, ...conv.filter((m) => m.quien !== "Humano" && tsMs(m.ts) > tJx).reverse()].filter((m) => chatDe(textoPlano(m.texto)));
        const mBorr = candB.find((m) => m.quien === deOk) || candB[0];
        const bo = (mBorr && chatDe(textoPlano(mBorr.texto))) || borradorDe(textoPlano(mEtq.texto)) || borradorCitado(etq.toca);
        pideOk = { pregunta: etq.toca, de: deOk, para: bo ? bo.para : "", canal: bo ? bo.canal : "", borrador: bo ? bo.borrador : "", t: tsMs(mEtq.ts),
          fuente: textoPlano(mEtq.texto), hace: etq.hace, quien: mEtq.quien };   // v163: de aquí salen las opciones A/B (abajo)
      }
      else if (etq.hace) {
        const ia = etq.hace.ia; espera = [ia];
        const tTag = tsMs(mEtq.ts);
        const palabras = (t) => new Set((sinTildes(t).match(/[a-zñ0-9]{3,}/g) || []).filter((w) => !/^(con|del|los|las|que|para|por|una|uno|todo|toda|este|esta|como|claude|cursor|coo|grok|humano|sobre|desde|hasta|cuando|antes|tras)$/.test(w)));
        const enCanal = (x) => {
          if (h.viejo) return null;
          if (ligadosA[h.ts]) return ligadosA[h.ts].filter((b) => b.de === x && b.t > tTag && esDeAqui(b, h.ts)).pop() || null;
          const proy = proyectoDe(tituloHilo(raiz.texto) + "\n" + textoPlano(raiz.texto).slice(0, 400)); if (proy === "Canal e IAs") return null;
          const pq = palabras(`${etq.hace.que} ${tituloHilo(raiz.texto)}`);
          return bloquesGit.filter((b) => b.de === x && b.t > tTag && b.proyecto === proy && !deOtroHilo.has(b) && (!duenosDe.has(b) || duenosDe.get(b).has(h.ts))
            && [...palabras(`${b.tit || ""} ${String(b.cuerpo || "").slice(0, 300)}`)].filter((w) => pq.has(w)).length >= 2).sort((a, b) => a.t - b.t).pop() || null;
        };
        const bHecho = mEtq.quien !== ia ? enCanal(ia) : null;
        const atend = despertada(L, h.ts, ia, tUlt - 5e3)
          || conv.some((m) => m.quien === ia && tsMs(m.ts) > tTag);   // v174: o ya ha contestado en el hilo (p. ej. Cursor con su app)
        const que = `${ia}${etq.hace.que ? ": " + etq.hace.que : ""}`;
        const clR = `slack:${h.ts}:${mEtq.ts}`;
        const relT = relanzadoEn(L, clR);
        const frenado = (L.frenos || []).some((f) => f.hilo === h.ts && f.t > tTag - 60e3);
        const claveDe = (x) => (x === ia ? clR : `${clR}:${x}`);
        const v174de = new Set();
        for (const x of (etq.hace.ias || [ia])) {
          if (x === mEtq.quien || !IAS.includes(mEtq.quien)) continue;
          const atX = despertada(L, h.ts, x, tUlt - 5e3) || conv.some((m) => m.quien === x && tsMs(m.ts) > tTag) || !!enCanal(x);   // (v563)
          if (atX || relanzadoEn(L, claveDe(x)) || frenado || ahora - tTag <= 8 * MIN || ahora - tTag >= 2 * 3600e3) continue;
          relanzar.push({ hilo: h.ts, ts: mEtq.ts, ia: x, quien: mEtq.quien, que: x === ia ? que : `${x}${etq.hace.que ? ": " + etq.hace.que : ""}`, texto: String(mEtq.texto || "").slice(0, 3000), clave: claveDe(x) });
          v174de.add(x);
        }
        const mNuevo = conv.filter((m) => IAS.includes(m.quien) && tsMs(m.ts) > tTag).pop();
        if (mNuevo && !frenado) for (const x of (etq.hace.ias || [ia])) {
          const tN = tsMs(mNuevo.ts), clN = `slack:${h.ts}:${mNuevo.ts}`;
          if (x === mNuevo.quien || relanzadoEn(L, clN) || v174de.has(x)) continue;   // (si ya va el de v174, no dos)
          const yaAntes = despertada(L, h.ts, x, tTag - 5e3) || relanzadoEn(L, claveDe(x)) || conv.some((m) => m.quien === x && tsMs(m.ts) > tTag && tsMs(m.ts) < tN);
          const yaDespues = despertada(L, h.ts, x, tN - 5e3) || conv.some((m) => m.quien === x && tsMs(m.ts) > tN);
          if (yaAntes && !yaDespues && ahora - tN > 3 * MIN && ahora - tN < 2 * 3600e3)
            relanzar.push({ hilo: h.ts, ts: mNuevo.ts, ia: x, quien: mNuevo.quien, que: `${x}: seguir con lo que ha publicado ${mNuevo.quien}`, texto: String(mNuevo.texto || "").slice(0, 3000), clave: clN });
        }
        if (mEtq.quien === ia) { estado = "espera_ia"; motivo = `⚙️ ${que} (se lo ha quedado ${ia})`; propio = { ia, t: tsMs(mEtq.ts), que }; }
        else if (bHecho) { estado = "pausa"; espera = []; motivo = `✔ ${ia} ya lo dejó en el canal git a las ${hhmm(bHecho.t)}${etq.hace.que ? ` (${etq.hace.que})` : ""}`; }   // v563
        else if (atend) {
          const tD = despertadaEn(L, h.ts, ia), escribio = conv.some((m) => m.quien === ia && tsMs(m.ts) > tTag);
          if (!escribio && tD && ahora - tD > 45 * MIN) { estado = "parado"; espera = [ia]; motivo = `⚠️ ${que} — ${ia} arrancó a las ${hhmm(tD)} y no ha dejado nada en el hilo`; }
          else { estado = "pausa"; espera = []; motivo = `⚙️ ${que} (ya está con ello)`; }
        }
        else if (relT && ahora - relT > 20 * MIN) { estado = "parado"; motivo = `⚠️ ${que} — no arrancó: se le relanzó a las ${hhmm(relT)} y tampoco consta; mira la escucha`; }
        else if (relT) { estado = "espera_ia"; motivo = `➡️ ${que} (relanzado a las ${hhmm(relT)}: no constaba que arrancara)`; }
        else if (vence(tUlt, 3 * 3600e3)) { estado = "olvidado"; motivo = `➡️ ${que} — nadie lo ha cogido en 3 h`; }
        else if (mins > 20) { estado = "parado"; motivo = `➡️ ${que} — no se ha despertado a ${ia}: mete presión`; }
        else { estado = "espera_ia"; motivo = `➡️ ${que}`; }
      } else if (etq.hecho) { estado = "cerrado"; espera = []; motivo = `✔ cerrado en el hilo (hecho${etq.hecho !== true ? ": " + etq.hecho : ""})`; }
    }
    // un mensaje de Coo (también el «Coo:» que publica su conector con la cuenta de Humano) no deja el tema esperando a Coo
    if (ult.quien === "Coo" && espera.includes("Coo") && !enMarcha.length) {
      espera = espera.filter((x) => x !== "Coo");
      if (propio && propio.ia === "Coo") propio = null;
      if (!espera.length && ["espera_ia", "parado", "olvidado"].includes(estado)) estado = "pausa";
    }
    if (!enMarcha.length && typeof prEstado === "object") {
      const iaMsgs = conv.filter((m) => m.quien !== "Humano" && ahora - tsMs(m.ts) < 48 * 3600e3);
      const conPlan = (m) => /(cuando|tras|despu[eé]s de|en cuanto)[^.]{0,80}#\d{3,5}[^.]{0,200}\b\w+(ar|er|ir)[eé]\b/i.test(textoPlano(m.texto).replace(/\[[^\]]*\]/g, ""));
      const orden = [...iaMsgs].reverse(); orden.sort((a, b) => conPlan(b) - conPlan(a));
      for (const m of orden) {
        const t = textoPlano(m.texto).replace(/\[\s*(te toca|lo hace|hecho)\b[^\]]*\]/gi, "");
        const fraseDe = (n) => (t.replace(/\s+/g, " ").match(new RegExp(`[^.;\\n]*(?:#|pull-requests\\/)${n}\\b[^.;\\n]*`)) || [""])[0];
        const ESPERA_PR = /\b(falta|pendiente|cuando|espera|esperando|a que|que (la )?suba|tras|despu[eé]s de|en cuanto)\b/i;
        const nums = [...t.matchAll(/(?:#|pull-requests\/)(\d{3,5})\b/g)].map((x) => x[1])
          .filter((n) => prEstado[n] && prEstado[n].state === "MERGED" && prEstado[n].t > tsMs(m.ts) - 6 * 3600e3 && ESPERA_PR.test(fraseDe(n)));
        if (!nums.length) continue;
        const n = nums[0], pr = prEstado[n];
        const dicho = conv.some((x) => tsMs(x.ts) > pr.t && new RegExp(`#${n}\\b[^.\\n]{0,60}(mergead|subid|ya est[aá]|en QA|merged)|(mergead|subid|ya est[aá])[^.\\n]{0,60}#${n}\\b`, "i").test(textoPlano(x.texto)));
        if (dicho) break;
        const plan = (t.replace(/\s+/g, " ").match(new RegExp(`[^.]*(cuando|tras|despu[eé]s de|en cuanto)[^.]*#${n}[^.]*\\.?`, "i")) || [])[0] || "";
        const hace = IAS.find((ia) => new RegExp(`\\b${ia}\\b`).test(plan)) || (/pasar[eé]|asignar[eé]|a[nñ]adir[eé]|crear[eé]/i.test(plan) ? m.quien : "Claude");
        estado = "humano"; espera = [];
        motivo = `✅ La #${n} ya está en ${pr.dest || "su rama"} (mergeada ${hhmm(pr.t)}): siguiente paso`;
        pideOk = { pregunta: `La #${n} ya está en ${pr.dest || "su rama"}. ¿OK a ${hace} para seguir?`, de: hace, para: "", canal: "", borrador: "", detalle: plan.trim().slice(0, 300), t: pr.t };
        break;
      }
    }
    const proyecto = proyectoDe(tituloHilo(raiz.texto) + "\n" + textoPlano(raiz.texto).slice(0, 400));
    const ligados = ligadosA[h.ts];
    const porProyecto = () => {
      const bs = bloquesGit.filter((b) => b.proyecto === proyecto && proyecto !== "Canal e IAs" && !deOtroHilo.has(b)
        && (!duenosDe.has(b) || duenosDe.get(b).has(h.ts)));
      const pal = (t) => new Set(sinTildes(t).match(/[a-zñ0-9]{3,}/g) || []), pt = pal(tituloHilo(raiz.texto));
      const suya = (b) => [...pal(b.tag || "")].some((w) => pt.has(w));
      return bs.some((b) => b.tag && suya(b)) ? bs.filter((b) => !b.tag || suya(b)) : bs;
    };
    const delTema = h.viejo ? [] : ligados || porProyecto();
    const enGit = delTema.filter((b) => b.t > tUlt - 2 * MIN).sort((a, b) => a.t - b.t);
    const cadena = (bs) => bs.slice(-5).map((b) => `${b.de || (String(b.id || "").match(/^[A-Za-zÁÉÍÓÚÑáéíóúñ]+(?:-[A-Za-z]+)?(?=-\d|$)/) || [])[0] || "?"} ${hhmm(b.t)}`).join(" · ");
    let ultTexto = plano, ultQuien = ult.quien, ultT = tUlt;
    if (pideOk && estado === "humano") { ultTexto = pideOk.pregunta + (pideOk.para ? ` → mensaje para ${pideOk.para}` : ""); ultQuien = pideOk.de; ultT = pideOk.t; }   // v158
    const tJTema = Math.max(tJx, ultHumanoTema[temaDeHilo(h)] || 0);   // v141: tu último mensaje en cualquier hilo del tema
    // v495: el bloque más nuevo de este tema que ya contestaste en OTRO hilo ligado a él; lo que se pedía hasta él, contestado
    const contB = delTema.filter((b) => { const c = contestadoB.get(b); return c && c.ts !== h.ts && b.t > tJTema; }).sort((a, b) => a.t - b.t).pop();
    const tPide = Math.max(tJTema, contB ? contB.t : 0);
    const mandaToca = !!pideOk && estado === "humano" && !enGit.some((b) => (b.faltan || []).length && b.t > pideOk.t);
    if (mandaToca && enGit.length) motivo += ` · en el canal git: ${cadena(enGit)}`;
    else if (enGit.length && !enMarcha.length && !["frenado", "cerrado", "olvidado"].includes(estado)) {
      const ub = enGit[enGit.length - 1];
      const pide = enGit.filter((b) => pideJ(b) && b.t > tPide && esDeAqui(b, h.ts)).pop();
      const ids = enGit.map((b) => b.id || (b.hora ? "de las " + b.hora : "")).filter(Boolean);
      const rango = ids.length > 1 ? `bloques ${ids[0]}–${ids[ids.length - 1]}` : `bloque ${ids[0] || "?"}`;
      const faltaB = enGit.filter((b) => (b.faltan || []).length).pop();
      if (faltaB && (!pide || faltaB.t >= pide.t)) {
        const ias = faltaB.faltan, ref = /^\d+$/.test(faltaB.id) ? faltaB.id : `de ${faltaB.de || "?"} ${hhmm(faltaB.t)}`;
        const tr = (L.traspasos || []).filter((x) => x.clave === faltaB.clave && ias.includes(x.ia));
        const sinResp = [...new Set(tr.filter((x) => x.tipo === "SIN_RESPUESTA").map((x) => x.ia))];
        const lanz = tr.filter((x) => /^(LANZO|RELANZO)$/.test(x.tipo)), despiertas = [...new Set(lanz.map((x) => x.ia))];
        const dormidas = ias.filter((ia) => !despiertas.includes(ia));
        espera = ias; ultTexto = faltaB.tit; ultQuien = faltaB.de || "canal"; ultT = faltaB.t;
        if (sinResp.length) { estado = "parado"; motivo = `⚠️ ${sinResp.join(" y ")} no contestó en el canal git al bloque ${ref} (despertado ${lanz.map((x) => hhmm(x.t)).join(" y ")}): míralo`; }
        else if (dormidas.length && ahora - faltaB.t > 20 * MIN) { estado = "parado"; motivo = `🔁 ${faltaB.de || "el canal"} pidió algo a ${dormidas.join(" y ")} en el canal git (bloque ${ref}) y nadie lo ha despertado`; }
        else if (!dormidas.length) { estado = "pausa"; motivo = `⚙️ ${ias.join(" y ")} ya está con ello en el canal git (bloque ${ref}; despertado ${hhmm(lanz[lanz.length - 1].t)})`; }
        else { estado = "espera_ia"; motivo = `🔁 en el canal git: ${cadena(enGit)} · falta ${ias.join(" y ")} (bloque ${ref})`; }
      } else if (pide) {
        estado = "humano"; espera = []; motivo = `cruzado en el canal git (${cadena(enGit) || rango}): queda tu decisión`;
        ultTexto = pide.decision || pide.tit; ultQuien = pide.de || "canal"; ultT = pide.t;
      } else if (ahora - ub.t < 12 * 3600e3 && (() => {
        if (!esDeAqui(ub, h.ts)) return false;
        const lb = String(ub.loHace || "").match(/\[lo hace:\s*([^\]]+)\]/gi); if (!lb) return false;
        const txt = lb[lb.length - 1].replace(/^\[lo hace:\s*/i, "").replace(/\]$/, ""), quien = txt.split(/\s+[—–-]\s+/)[0];
        const ias = IAS.filter((ia) => new RegExp(`\\b${ia}\\b`, "i").test(quien) && ia !== ub.de);
        if (!ias.length) return false;
        estado = "espera_ia"; espera = ias; motivo = `🔁 en el canal git: ${cadena(enGit)} · ahora le toca a ${ias.join(" y ")}: ${txt.split(/\s+[—–-]\s+/).slice(1).join(" — ").slice(0, 120) || "su parte"}`;
        ultTexto = ub.tit; ultQuien = ub.de || "canal"; ultT = ub.t; return true; })()) {
        /* (v560: encargo a una IA en el último bloque, arriba) */
      } else if (ahora - ub.t < 30 * MIN) {
        // v148: se ve quién ha trabajado y cuándo, y el título del último bloque dice qué falta
        estado = "pausa"; motivo = `🔁 trabajando en el canal git: ${cadena(enGit)}`;
        ultTexto = ub.tit; ultQuien = ub.de || "canal"; ultT = ub.t;
      } else motivo += ` · en el canal git: ${cadena(enGit)} (el último hace ${Math.round((ahora - ub.t) / MIN)} min)`;
    }
    const ubE = enGit.length ? enGit[enGit.length - 1] : null, cabE = ubE && ubE.estadoCab;
    if (cabE && (cabE.tocaA || cabE.esperaA) && !(ubE.faltan || []).length && !pideJ(ubE) && !enMarcha.length && !["humano", "frenado", "olvidado"].includes(estado)
      && (estado !== "cerrado" || motivo === "sin nada pendiente a la vista") && (!!ligados || (duenosDe.get(ubE) || new Set()).has(h.ts))) {
      esperaA = { quien: cabE.esperaA || cabE.tocaA, que: String(ubE.tit || "").replace(/\s+/g, " ").slice(0, 140), t: ubE.t, de: ubE.de || "canal" };
      estado = "espera_otro"; espera = [];
      motivo = `⏸ Esperando a ${esperaA.quien} desde ${desdeCuando(esperaA.t, ahora)} (lo preguntó ${esperaA.de} en el canal git)`;
    }
    let refDia = 0;
    if (propio && estado === "espera_ia" && !enMarcha.length) {
      const vida = Math.max(propio.t, tUlt, ...delTema.filter((b) => b.t > propio.t).map((b) => b.t),
        ...(L.traspasos || []).filter((x) => delTema.some((b) => b.clave === x.clave) && x.t > propio.t).map((x) => x.t));
      const ftP = fechaTitulo(raiz);
      const hoyToca = ftP && +ftP.f === +ftP.hoy, desdeP = ftP && +ftP.f <= +ftP.hoy ? Math.max(vida, +ftP.f) : vida;
      if (hoyToca) { const d = new Date(ahora); d.setHours(10, 0, 0, 0); refDia = d.getTime(); }   // v466 (abajo, el despertar)
      if (ftP && ftP.f > ftP.hoy) motivo = `⏳ ${propio.que} (para el ${ftP.txt})`;
      else if (hoyToca && new Date(ahora).getHours() < 10) motivo = `⏳ hoy toca: ${propio.que}`;
      else if (vence(desdeP, 24 * 3600e3, true)) { estado = "olvidado"; motivo = `⚙️ ${propio.que}: sin movimiento en 24 h`; }
      else if (ahora - desdeP > 45 * MIN) { estado = "parado"; motivo = `⚙️ ${propio.que}: sin movimiento ${vida >= desdeP ? "desde las " + hhmm(vida) : "hoy"} (ni en el hilo ni en el canal git): mete presión a ${propio.ia}`; }
    }
    const decideAqui = (b) => (!!ligados && esDeAqui(b, h.ts)) || (duenosDe.get(b) || new Set()).size === 1;
    const pideCanal = delTema.filter((b) => b.t > tPide && pideJ(b) && decideAqui(b)).sort((a, b) => a.t - b.t).pop();
    const donde = ultHumanoTemaDonde[temaDeHilo(h)];
    const yaContestado = !pideCanal && donde && donde.ts !== h.ts
      && delTema.filter((b) => b.t > tJx && b.t <= tJTema && pideJ(b) && decideAqui(b)).sort((a, b) => a.t - b.t).pop();
    if (yaContestado && !["humano", "cerrado", "marcha"].includes(estado))
      motivo = `↩ Lo que pedía el canal (${yaContestado.de || "?"} ${hhmm(yaContestado.t)}) ya lo contestaste en «${donde.titulo}» a las ${hhmm(tJTema)} («${donde.texto}») · ${motivo}`;
    // v495: lo mismo si lo contestaste en otro hilo que tiene ligado el mismo bloque
    else if (!pideCanal && contB && pideJ(contB) && !["humano", "cerrado", "marcha"].includes(estado)) {
      const c = contestadoB.get(contB), hc = hilosSlack.find((x) => x.ts === c.ts), mj = hc && hc.msgs.filter((m) => m.quien === "Humano").pop();
      motivo = `↩ Lo que pedía el canal (${contB.de || "?"} ${hhmm(contB.t)}) ya lo contestaste en «${hc ? limpiaTitulo(tituloHilo((hc.msgs[0] || {}).texto || "")).slice(0, 60) : "otro hilo"}» a las ${hhmm(c.t)}`
        + `${mj ? ` («${textoPlano(mj.texto || "").replace(/\s+/g, " ").slice(0, 60)}»)` : ""} · ${motivo}`;
      if (estado === "parado" && tUlt <= contB.t) { estado = "pausa"; espera = []; }
    }
    if (pideCanal && pideOk && estado === "humano" && !enMarcha.length && pideCanal.t > pideOk.t) {
      pideOk = pideOkDeBloque(pideCanal);
      motivo = `🙋 ${pideOk.pregunta.slice(0, 160)} (en el canal git: ${pideCanal.de || "?"} ${hhmm(pideCanal.t)})`;
      ultTexto = pideOk.pregunta; ultQuien = pideOk.de; ultT = pideCanal.t;
    }
    else if (pideCanal && !enMarcha.length && !["frenado"].includes(estado) && !/en el canal git te piden|queda tu decisión|falta (Claude|Cursor|Coo)/.test(motivo)) {
      const que = (pideCanal.decision || pideCanal.tit || "").replace(/\s+/g, " ").slice(0, 140);
      if (estado === "humano") { if (!pideOk || pideCanal.t > pideOk.t) motivo += ` · y en el canal git: «${que}»`; }
      else { estado = "humano"; espera = []; motivo = `📋 en el canal git te piden: «${que}»`; ultTexto = que; ultQuien = pideCanal.de || "canal"; ultT = pideCanal.t; }
    }
    const prepB = !pideCanal && estado !== "humano" && delTema.filter((b) => b.t > tJTema && b.enPreparacion && !b.retenido && !pideJ(b) && decideAqui(b)).sort((a, b) => a.t - b.t).pop();
    if (prepB && estado !== "frenado" && !enMarcha.length) {
      const p = prepB.enPreparacion, hecho = bloquesGit.find((y) => y.id && y.id === p.id);
      if (["cerrado", "olvidado"].includes(estado)) { estado = "espera_ia"; espera = p.faltan.slice(); ultTexto = (hecho && hecho.tit) || ultTexto; ultQuien = (hecho && hecho.de) || ultQuien; ultT = (hecho && hecho.t) || ultT; }
      const que = /borrador/i.test(p.accion || (hecho && hecho.tit) || "") ? "el borrador" : /cruce/i.test(p.accion || "") ? "el cruce" : "su parte";
      const tocaP = String((prepB.estadoCab && prepB.estadoCab.toca) || prepB.decision || "").replace(/^\s*(?:tras|despu[eé]s de)\s+(?:el\s+)?(?:3\/3|cruce)\s*,?\s*/i, "").replace(/\s+/g, " ").slice(0, 140);
      motivo = `🛠 En preparación (aún no te toca): ${p.de || "una IA"} hizo ${que}${hecho ? ` (${hhmm(hecho.t)})` : ""}, falta ${p.faltan.join(" y ")}`
        + (tocaP ? `. Luego te tocará: «${tocaP}»` : "") + ` · ${motivo}`;
    }
    const delTimbre = timbre.filter((x) => x.hilo === h.ts && x.t > tJTema);
    if (delTimbre.length && !enMarcha.length && estado !== "frenado") {
      const x = delTimbre[delTimbre.length - 1];
      if (estado !== "humano") { estado = "humano"; espera = []; motivo = `📋 en el canal git te piden: «${x.texto.slice(0, 140)}»`; ultTexto = x.texto; ultQuien = (x.bloque && x.bloque.de) || "canal"; ultT = x.t; }
      if (!pideOk && x.bloque) pideOk = { ...pideOkDeBloque(x.bloque), pregunta: x.texto };
      delTimbre.forEach((y) => { y.unido = true; });
    }
    // v163: si te toca por el canal git (sin [te toca] en el hilo), la misma caja: pregunta, opciones y botones
    if (estado === "humano" && !pideOk && /canal git/.test(motivo)) {
      const b = delTema.filter((b) => b.t > tJTema && pideJ(b) && esDeAqui(b, h.ts)).sort((a, b) => a.t - b.t).pop();
      if (b) pideOk = pideOkDeBloque(b);
    }
    let tuyo = null;
    if (estado === "humano" && /canal git/.test(motivo)) {
      const dec = delTema.filter((b) => b.t > tJTema && b.decJ && esDeAqui(b, h.ts)).sort((a, b) => a.t - b.t).pop();
      if (dec) {
        const ultB = delTema.filter((b) => b.t > tJTema).sort((a, b) => a.t - b.t).pop();
        const falta = ((ultB && ultB.tit.match(/falta (?:el CONFORME de )?(Claude|Cursor|Coo|Grok)/i)) || [])[1] || "";
        const borr = delTema.filter((b) => b.t > tJTema && b.borrador).sort((a, b) => a.t - b.t).pop();   // v152
        tuyo = { id: dec.decJ.id, ops: dec.decJ.ops, voto: dec.decJ.voto, falta, de: dec.de, borrador: borr ? borr.borrador : "" };
        ultTexto = `Elige${dec.decJ.id ? " (" + dec.decJ.id + ")" : ""}: ` + dec.decJ.ops.map((o) => `(${o.l}) ${o.t.slice(0, 70)}`).join(" · ")
          + (dec.decJ.voto ? ` — las IAs votan (${dec.decJ.voto})` : "") + (falta ? ` · falta el CONFORME de ${falta}` : "");
        ultQuien = dec.de === "Grok" ? "Coo" : (dec.de || "Coo"); ultT = dec.t;
      }
    }
    const obj0 = objetivoDe(raiz.texto);
    const origen0 = (((raiz.texto || "").match(/(?:(?:📥|:inbox_tray:)\s*|^[ \t>*_]*)Origen:\**\s*([^\n·*]+)/m) || [])[1] || "").trim();
    if ((/^Relevo/i.test(origen0) || /Viene de:\s*<?https?:/i.test(raiz.texto || "")) && conv.length === 1 && !enMarcha.length && !/canal git/.test(motivo)) {
      const pr = textoPlano(raiz.texto);
      let pend = ((pr.match(/Pendiente:?\s*\**\s*\n?\s*(?:[•\-*]\s*)?([^\n•]{5,160})/i) || [])[1] || "").replace(/\s+/g, " ").trim();
      const tuyoP = /^[\s,;:]*(tuyo|tuya|de humano)\s*:/i.test(pend);
      pend = pend.replace(/^[\s,;:]*(?:(?:tuyo|tuya|de humano)\s*:\s*)?/i, "");
      const quienPend = IAS.filter((ia) => new RegExp(`\\(${ia}\\)|\\b${ia}\\b`).test(pr.slice(pr.search(/Pendiente/i)))).slice(0, 2);
      espera = tuyoP ? [] : quienPend;
      if (tuyoP) { estado = "humano"; motivo = `🧵 del relevo, te toca: ${pend.slice(0, 120)}`; }
      else if (ahora - tUlt > 24 * 3600e3) { estado = "cerrado"; motivo = "🧵 hilo del relevo sin novedades en 24 h"; }
      else { estado = "espera_ia"; motivo = `🧵 sigue del relevo${pend ? `; pendiente: ${pend.slice(0, 120)}` : ""}`; }
    }
    let pendExterno = false;
    if (obj0 && conv.length === 1 && !(raiz.menc || []).some((x) => IAS.includes(x)) && !/@(claude|cursor|coo)\b/i.test(raiz.texto || "")) {
      estado = "espera_ia"; espera = []; motivo = "📌 tema abierto, sin IA asignada";
      const alTanto = (obj0.match(/\b(?:estar al tanto|estar atent[oa]|esperar)\s+(?:a\s+)?(?:de\s+)?(?:la\s+)?(?:respuesta|que\s+(?:conteste|responda))\s+(?:de\s+)?([A-ZÁÉÍÓÚÑ][\p{L}]+)/u) || [])[1];
      if (/^(Jira|Correo|Chat|Reuni)/i.test(origen0) && alTanto) {
        esperaA = { quien: alTanto, que: obj0.slice(0, 140), t: tsMs(raiz.ts), ts: raiz.ts, de: raiz.quien, ia: IAS.includes(raiz.quien) ? raiz.quien : "Coo" };
        estado = "espera_otro"; espera = []; motivo = `⏸ Esperando a ${alTanto} desde ${desdeCuando(esperaA.t, ahora)}: ${obj0.slice(0, 140)}`;
      } else if (/^(Jira|Correo|Chat|Reuni)/i.test(origen0)) {
        estado = "humano"; pendExterno = true;
        motivo = `📥 nuevo de ${origen0.split(/\s/)[0]}: ${obj0}${eraPara(raiz)}`;
        if (eraPara(raiz) && /^(Chat|Reuni)/i.test(origen0) && /\b(reuni[oó]n|llamada|hoy|esta (tarde|mañana)|ma[ñn]eva)\b/i.test(obj0)) {
          estado = "olvidado"; pendExterno = false;
          motivo = `⌛ Caducado: ${obj0}${eraPara(raiz)}; si aún hace falta, díselo a una IA`;
        }
      }
    }
    if (ult.quien === "Humano" && !enMarcha.length && esCortesia(ult.texto) && !(esperaA && estado === "espera_otro")) { estado = "pausa"; espera = []; motivo = "🙂 le diste las gracias: nada pendiente"; }
    const tJ0 = tJx;
    const PIDE_GROK = /🔐|:closed_lock_with_key:|permiso en grok|tarjeta en su chat|ok tuyo directo|antes de pulsar enviar|apru[eé]balo en grok|esperando tu ok en (grok|pluma)|(borrador|correo|mensaje)\s+(en|de)\s+(grok|pluma)\b[^.\n]{0,40}(listo|preparad)|listo para enviar en (grok|pluma)/i;
    // …y deja de esperar en cuanto alguien dice que ya salió
    const YA_SALIO = /\b(enviado|ha salido|sali[oó]|ya est[aá] enviado)\b/i;
    const cand = conv.filter((m) => tsMs(m.ts) > tJ0 && m.quien !== "Humano" && PIDE_GROK.test(m.texto || "")).pop();
    let permisoGrok = false, correoGrok = null;
    const saleYa = (x) => { const s = textoPlano(x || "").replace(/\*?enviado usando\*?[^\n]*/gi, "");
      return YA_SALIO.test(s) && !/\b(no|a[uú]n no|todav[ií]a no)\s+(se\s+)?(ha\s+)?(salido|enviado)/i.test(s); };
    const yaSalio = cand && conv.some((m) => tsMs(m.ts) > tsMs(cand.ts) && m.quien !== "Humano" && !/Asunto:/i.test(m.texto || "")
      && (saleYa(m.texto) || (m.quien === cand.quien && (etiquetaDe(m) || {}).hecho)));
    if (cand && !yaSalio && ahora - tsMs(cand.ts) < 24 * 3600e3) {
      permisoGrok = true; estado = "humano"; espera = [];
      const tx = textoPlano(cand.texto).replace(/\s+/g, " ").trim();
      motivo = "🔐 te pide permiso en Grok"; ultTexto = tx; ultQuien = cand.quien; ultT = tsMs(cand.ts);
      const mc = conv.filter((m) => m.quien !== "Humano" && /Asunto:/i.test(m.texto || "") && tsMs(cand.ts) - tsMs(m.ts) < 24 * 3600e3).pop();
      if (mc) correoGrok = textoPlano(mc.texto).slice(0, 5000);
    }
    if (estado === "cerrado" && /^(Jira|Correo|Chat|Reuni)/i.test(origen0) && !/^✔ cerrado en el hilo/.test(motivo)) {
      const clave = claveJira(tituloHilo(raiz.texto));
      const contestado = clave && ((typeof jiraContestados === "object" && jiraContestados && jiraContestados[clave]) || 0) > tsMs(h.ts);
      const CIERRA_J = /\b(cerramos|cierra|cerrad|cierro)\s+(el\s+|este\s+)?(tema|hilo)\b|\bda(lo)?\s+por\s+(cerrado|hecho|resuelto)\b|\b(este\s+)?(tema|hilo)\s+cerrado\b|\b(queda|est[aá]|lo doy por)\s+cerrado\b/i;
      const CIERRA_IA = /\btema\s+cerrado\b|\bqueda\s+cerrado\b|\bdoy\s+(el\s+tema\s+)?por\s+cerrado\b/i;
      const tJu = tJx;   // v192
      const cerradoDicho = conv.some((m) => m.quien === "Humano" && CIERRA_J.test(textoPlano(m.texto)))
        || conv.some((m) => m.quien !== "Humano" && tsMs(m.ts) >= tJu && CIERRA_IA.test(textoPlano(m.texto)));
      const nombre0 = ((((raiz.texto || "").match(/Origen:\s*[^\n·*]+·\s*([^\n*·]+)/) || [])[1] || "").trim().split(/\s+/)[0] || "").replace(/[^\p{L}]/gu, "");
      const persona0 = sinTildes(nombre0);
      const enviado = persona0.length >= 3 && conv.find((m) => m.quien !== "Humano" && tsMs(m.ts) >= tJu && saleYa(m.texto)
        && new RegExp(`\\benviad[oa]\\s+(a|para)\\s+${persona0}\\b`).test(sinTildes(textoPlano(m.texto))));
      if (contestado) motivo = "contestado en Jira";
      else if (cerradoDicho) motivo = "✔ cerrado en el hilo";
      else if (enviado) {
        const bo = conv.filter((m) => m.quien !== "Humano" && tsMs(m.ts) <= tsMs(enviado.ts)).map((m) => borradorDe(textoPlano(m.texto))).filter((b) => b && (!b.para || sinTildes(b.para).includes(persona0))).pop();
        const pq = bo && (bo.borrador.replace(/«[^»]*»/g, " ").replace(/\s+/g, " ").match(/¿[^?¿]{3,200}\?|[^.!?¿]{3,200}\?/) || [])[0];
        if (pq) {
          esperaA = { quien: nombre0, que: `le preguntamos «${pq.trim().slice(0, 140)}»`, t: tsMs(enviado.ts), ts: enviado.ts, de: enviado.quien, ia: IAS.includes(enviado.quien) ? enviado.quien : "Coo" };
          estado = "espera_otro"; espera = []; motivo = `⏸ Esperando a ${nombre0} desde ${desdeCuando(esperaA.t, ahora)}: ${esperaA.que}`;
        } else motivo = `✔ enviado a ${nombre0} (${hhmm(tsMs(enviado.ts))})`;
      }
      else {
        estado = "humano"; espera = []; pendExterno = true;
        motivo = `📥 falta: ${obj0 || "contestar a quien lo pidió"}${eraPara(raiz)}`;
        ultTexto = `Las IAs ya lo han mirado. Falta lo tuyo: ${obj0 || "contestar a quien lo pidió"}${clave ? ` (se cierra solo cuando comentes en ${clave})` : ""}.`;
        ultQuien = origen0.split(/\s/)[0]; ultT = tUlt;
      }
    }
    if (estado === "cerrado" && !/cerrado en el hilo|lo cerraste tú|contestado en Jira/.test(motivo)) {
      const ft = fechaTitulo(raiz);   // v192: la misma fecha que el resto de reglas (antes, su propia copia)
      if (ft && ft.f > ft.hoy && ft.f - ft.hoy <= 30 * 86400e3) {
        const dd = Math.round((ft.f - ft.hoy) / 86400e3);
        estado = "espera_ia"; espera = []; motivo = `⏳ próximo paso: ${ft.txt} (en ${dd} día${dd > 1 ? "s" : ""})`;
      }
    }
    // v148: si a Cursor se le pidió algo en este hilo y no arrancó por API (y no ha arrancado después), se dice en el tema
    const arrH = arrC.filter((a) => a.hilo === h.ts && a.t > tJx - 2 * MIN), falloC = arrH.length && !arrH[arrH.length - 1].ok ? arrH[arrH.length - 1] : null;
    const cursorLuego = falloC && (arrC.some((a) => a.ok && a.t > falloC.t) || enGit.some((b) => b.de === "Cursor" && b.t > falloC.t));
    if (falloC && !cursorLuego && !enMarcha.includes("Cursor") && estado !== "cerrado")
      motivo += ` · ⚠️ Cursor no arrancó (${hhmm(falloC.t)}: ${/usage_limit_exceeded|sin saldo de API/i.test(falloC.info) ? "sin saldo de API, recarga en tu facturación de Cursor"
        : (falloC.info.match(/http \S+/) || ["la API no respondió"])[0].replace(/http 000\S*/, "la API no respondió")})`;
    const rel = relevadoA[h.ts];
    const tReal = Math.max(0, ...conv.filter((m) => !m.privJ && !/^\s*💬\s*\*?[^*\n]+?\*?\s+contestó por privado/.test(String(m.texto || ""))).map((m) => tsMs(m.ts)));
    const privSinLeer = /^\s*💬\s*\*?[^*\n]+?\*?\s+contestó por privado/.test(String(ult.texto || ""));
    if (rel && privSinLeer && estado === "humano") motivo += ` · (este hilo ya se relevó a «${rel.titulo.slice(0, 60)}»)`;
    if (rel && tReal <= rel.t + 60e3 && !enMarcha.length && (!privSinLeer || estado !== "humano")) {
      estado = "cerrado"; espera = []; pendExterno = false; permisoGrok = false;
      motivo = `✔ cerrado en el hilo: sigue en «${rel.titulo.slice(0, 60)}»`; ultTexto = plano; ultQuien = ult.quien; ultT = tUlt;
    }
    const tJ = tJx;   // v192
    const cruzado =[...new Set(conv.filter((m) => tsMs(m.ts) > tJ && IAS.includes(m.quien)).map((m) => m.quien))];
    let pideOkFuera = null;
    if (pideOk && estado === "humano" && !tuyo) {
      const cerca = delTema.filter((b) => b.t > tJx - 5 * MIN && Math.abs(b.t - (pideOk.t || ahora)) < 30 * MIN && !b.retenido).sort((a, b) => b.t - a.t);
      const preguntan = (b) => b.pideHumanoTexto || !!b.decJ;   // v398: solo los que preguntan a Humano ponen las opciones
      const opc = opcionesDe([pideOk.fuente || pideOk.pregunta, pideOk.pregunta, ...cerca.filter(preguntan).map((b) => b.cuerpo)],
        cerca.filter((b) => !preguntan(b)).map((b) => b.cuerpo));
      const { fuente, hace, quien, ...resto } = pideOk;
      pideOkFuera = { ...resto, opciones: opc ? botonesDe(opc, hace, quien || pideOk.de) : [], recomendada: opc ? opc.voto : "", porque: opc ? opc.porque : "" };
      const man = tareaManual(pideOk.pregunta, fuente, tituloHilo(raiz.texto), hace, enlace(ult.ts, h.ts));
      if (man) { pideOkFuera.manual = man; pideOkFuera.opciones = []; }
    }
    if (sigueEn[h.ts] && !enMarcha.length) {
      estado = "cerrado"; espera = []; pideOk = null; motivo = `➡️ sigue en la parte ${sigueEn[h.ts].n}`;
      for (let i = relanzar.length - 1; i >= 0; i--) if (relanzar[i].hilo === h.ts) relanzar.splice(i, 1);
    }
    const tRefD = Math.max(tUlt, ultT || 0);
    const diaA = refDia > tRefD, tRefA = diaA ? refDia : tRefD, desdeD = diaA ? refDia - 2 * 3600e3 : tRefD;
    const despiertaTras = (ia) => despertada(L, h.ts, ia, desdeD - 5e3) || relanzar.some((r) => r.hilo === h.ts && r.ia === ia)
      || (L.traspasos || []).some((x) => /^(LANZO|RELANZO)$/.test(x.tipo) && x.ia === ia && x.t > desdeD - 5e3
        && (String(x.clave || "").startsWith(`slack:${h.ts}:`) || delTema.some((b) => b.clave === x.clave)));
    const iasEspera = [...new Set(espera)].filter((x) => IAS.includes(x));
    const margenD = iasEspera.length === 1 && iasEspera[0] === ult.quien ? 45 * MIN : 3 * MIN;
    const despertar = iasEspera.length && !enMarcha.length && ["espera_ia", "parado"].includes(estado) && !(propio && estado === "espera_ia")
      && ahora - tRefD > margenD && !iasEspera.some(despiertaTras) ? iasEspera : [];
    if (["espera_ia", "parado"].includes(estado) && !enMarcha.length && !/^(📌|⏳|↩)/.test(motivo)) {
      const lh = String((ult && ult.texto) || "").match(/\[lo hace:\s*([^\]]+)\]/i), fe = lh && fechaEnTexto(lh[1]);
      if (fe && fe.f > fe.hoy && fe.f - fe.hoy <= 30 * 86400e3) {
        motivo = `⏳ ${lh[1].trim().slice(0, 140)} (para el ${fe.txt})`; estado = "espera_ia";
        for (let i = relanzar.length - 1; i >= 0; i--) if (relanzar[i].hilo === h.ts) relanzar.splice(i, 1);
      }
    }
    const iasE = [...new Set([...espera, ...(propio ? [propio.ia] : [])])].filter((x) => IAS.includes(x));
    const iaParada = !h.viejo && !enMarcha.length && ["espera_ia", "parado"].includes(estado) && iasE.length && !frenos.length && !(esperaA && estado === "espera_otro")
      && !/^(📌|⏳|↩)/.test(motivo);
    const desdeW = Math.max(tJTema || 0, ahora - 12 * 3600e3);
    const wakes = (L.traspasos || []).filter((x) => /^(LANZO|RELANZO)$/.test(x.tipo) && x.t > desdeW && x.t <= ahora && iasE.includes(x.ia) && !/:proceso:/.test(String(x.clave || ""))
      && (String(x.clave || "").startsWith(`slack:${h.ts}:`) || delTema.some((b) => b.clave === x.clave)));
    const ultW = wakes.length ? Math.max(...wakes.map((x) => x.t)) : 0;
    const respondio = !!ultW && (conv.some((m) => iasE.includes(m.quien) && tsMs(m.ts) > ultW) || delTema.some((b) => iasE.includes(b.de) && b.t > ultW));
    let atascado = null, despierta = null;
    const nadaC = iaParada && iasE[0] === "Claude" && ((L.nadaHilo || {})[h.ts] || 0) > Math.max(ultW, tJTema || 0) ? (L.nadaHilo || {})[h.ts] : 0;
    if (nadaC) {
      estado = "espera_otro"; espera = [];
      motivo = `✔ Claude dice que lo suyo ya está hecho o no toca aún (${hhmm(nadaC)}); no queda nada suyo pendiente${enGit.length ? ` · en el canal git: ${cadena(enGit)}` : ""}`;
      for (let i = relanzar.length - 1; i >= 0; i--) if (relanzar[i].hilo === h.ts && relanzar[i].ia === "Claude") relanzar.splice(i, 1);
    }
    if (iaParada && !nadaC) {
      const ia0 = iasE[0];
      if (ultW && !respondio) {
        if (ahora - ultW < 15 * MIN) despierta = { ia: ia0, t: ultW, ya: true };
        else atascado = { ia: ia0, desde: ultW, n: wakes.length };
      } else if (wakes.length >= 2) atascado = { ia: ia0, desde: ultW, n: wakes.length };
      else if (!enHorario(ahora)) despierta = null;
      else if (relanzar.some((r) => r.hilo === h.ts)) despierta = { ia: relanzar.filter((r) => r.hilo === h.ts).map((r) => r.ia).join(" y "), t: ahora, ya: false };
      else if ((ult.quien === "Humano" && ahora - tRefD < 3 * MIN) || (ult.quien !== "Humano" && !diaA && ahora - tRefD < 10 * MIN) || (diaA && ahora - refDia < 10 * MIN))
        despierta = { ia: ia0, t: tRefD, ya: false, margen: true };
      else {
        despierta = { ia: ia0, t: ahora, ya: false };
        if (!relanzar.some((r) => r.hilo === h.ts && r.ia === ia0)) {
          const quien = ult.quien === "Humano" ? "Humano" : IAS.includes(ult.quien) && ult.quien !== ia0 ? ult.quien : ia0 === "Coo" ? "la oficina" : "Coo";
          const mins = Math.round((ahora - tRefD) / MIN);
          relanzar.push({ hilo: h.ts, ts: ult.ts, ia: ia0, quien, oficina: true, clave: `slack:${h.ts}:${ult.ts}:despierta:${ia0}:${wakes.length + 1}`,
            que: diaA ? `${ia0}: despertado por la oficina (hoy toca: ${propio.que})` : `${ia0}: despertado por la oficina (${mins} min sin moverse)`,
            texto: `${String(ult.texto || "").slice(0, 2500)}\n\n` + (diaA ? `(La oficina te despierta: hoy toca lo que dejaste dicho, «${propio.que}», y nadie lo ha empezado. Sigue con ello; si aún no se puede, di por qué y cuándo.)`
              : `(La oficina te despierta: este tema espera a ${ia0} y nadie lo está haciendo. Sigue con lo tuyo; si no puedes avanzar, di qué falta y a quién.)`) });
        }
      }
    }
    if (atascado) {
      const otra = atascado.ia === "Claude" ? "Coo" : "Claude", tt0 = limpiaTitulo(tituloHilo(raiz.texto || "")), tt = tt0.length > 70 ? tt0.slice(0, 69).replace(/[\s,;:·]+\S*$/, "") + "…" : tt0;
      estado = "humano"; espera = [];
      motivo = `⚠ ${atascado.ia} se ha atascado en «${tt}»: ¿la vuelvo a lanzar, se lo paso a otra IA o lo dejas? (despertada ${atascado.n > 1 ? atascado.n + " veces; la última, " : ""}a las ${hhmm(atascado.desde)}, sin respuesta)`;
      ultTexto = motivo; ultQuien = "la oficina"; ultT = atascado.desde || ahora;
      pideOk = pideOkFuera = { pregunta: `${atascado.ia} se ha atascado en «${tt}». ¿La vuelvo a lanzar, se lo paso a ${otra} o lo dejas?`, de: atascado.ia, para: "", canal: "", borrador: "", t: ultT,
        fuente: "", atascado: true, opciones: [
          { l: "A", t: `vuelve a lanzar a ${atascado.ia}`, a: atascado.ia, escritura: false, recomendada: true, texto: `@${atascado.ia} sigue con este tema: te habías quedado parado.` },
          { l: "B", t: `pásaselo a ${otra}`, a: otra, escritura: false, recomendada: false, texto: `@${otra} encárgate tú de este tema: ${atascado.ia} se ha atascado.` }] };
    }
    if (esperaA && !esperaA.proceso && estado === "espera_otro" && !enMarcha.length) {
      const tSigo = Math.max(0, ...conv.filter((m) => m.quien === "Humano" && tsMs(m.ts) > esperaA.t && SIGO.test(textoPlano(m.texto))).map((m) => tsMs(m.ts)));
      const desdeI = Math.max(esperaA.t, tSigo);
      if (horasTrabajo(desdeI, ahora) >= 12 * 3600e3) {
        const qn = esperaA.quien, iaI = IAS.includes(esperaA.ia) ? esperaA.ia : "Claude", queI = esperaA.que ? ` (${String(esperaA.que).slice(0, 120)})` : "";
        const varias = /\s(?:y|e)\s|,/.test(qn), contesta = varias ? "contestan" : "contesta", le = varias ? "les" : "le", Le = varias ? "Les" : "Le";
        estado = "humano"; espera = [];
        motivo = `⏳ ${qn} no ${contesta} desde ${desdeCuando(esperaA.t, ahora)}${queI}: ¿${le} insisto?`;
        ultTexto = motivo; ultQuien = "la oficina"; ultT = desdeI;
        // v499 (Diseño): lo que se espera de esa persona, aparte (la página lo sacaba del paréntesis del motivo; esperaA ya va a null)
        pideOk = pideOkFuera = { pregunta: `${qn} no ${contesta} desde ${desdeCuando(esperaA.t, ahora)}. ¿${Le} insisto?`, de: iaI, para: "", canal: "", borrador: "", t: desdeI,
          que: esperaA.que ? String(esperaA.que).slice(0, 120) : "", persona: qn, desde: esperaA.t,
          fuente: "", insistir: true, opciones: [
            { l: "A", t: `sí, que ${iaI} ${le} prepare un recordatorio`, a: iaI, escritura: false, recomendada: true,
              texto: `@${iaI} prepára${le} a ${qn} un recordatorio${queI}. No lo envíes: tráemelo aquí con el texto para mi OK.` },
            { l: "B", t: "sigo esperando", a: "", escritura: false, recomendada: false, texto: `Sigo esperando a ${qn} otro día.` }] };
      }
    }
    if (esperaA && esperaA.proceso && estado === "espera_otro" && !enMarcha.length && !delTema.some((b) => b.t > esperaA.t && b.de === esperaA.ia)) {
      const pasado = horasTrabajo(esperaA.t, ahora), H2 = 2 * 3600e3, H12 = 12 * 3600e3;
      const cada = pasado < H2 ? 30 * MIN : 120 * MIN, cadaTxt = cada < 60 * MIN ? `${cada / MIN} min` : `${cada / 3600e3} h`;
      const pref = `slack:${h.ts}:${esperaA.ts}:proceso:`, miradas = (L.traspasos || []).filter((x) => String(x.clave || "").startsWith(pref) && /^(LANZO|RELANZO)$/.test(x.tipo));
      const ultM = miradas.length ? Math.max(...miradas.map((x) => x.t)) : 0;
      const en = enHorario(ahora), d8 = new Date(ahora); d8.setHours(8, 0, 0, 0);
      const trasNoche = en && (ultM || esperaA.t) < d8.getTime() && ahora - d8.getTime() >= 5 * MIN;
      if (pasado <= H12) esperaA.proxima = !en ? proximo805(ahora) : trasNoche ? ahora
        : Math.max(ahora, sumaHorasTrabajo(ultM || esperaA.t, ultM ? cada - MIN : 30 * MIN));
      if (pasado > H12) {
        motivo = `⚠️ El proceso «${esperaA.quien}» lleva más de 12 h de horario y la oficina ha dejado de mirarlo: míralo tú o pide a ${esperaA.ia} que lo revise`;
        const pq = esperaA.quien, iaP = esperaA.ia;
        estado = "humano"; espera = []; ultTexto = motivo; ultQuien = "la oficina"; ultT = ahora;
        pideOk = pideOkFuera = { pregunta: `El proceso «${pq}» lleva más de 12 h de horario sin terminar. ¿Lo revisa ${iaP} o lo miras tú?`, de: iaP, para: "", canal: "", borrador: "", t: esperaA.t,
          fuente: "", opciones: [
            { l: "A", t: `que ${iaP} lo revise`, a: iaP, escritura: false, recomendada: true, texto: `@${iaP} revisa en solo lectura cómo va el proceso «${pq}»: si ha terminado, sigue con lo que tocaba; si sigue igual o ha fallado, dime qué ves.` },
            { l: "B", t: "lo miro yo", a: "", escritura: false, recomendada: false, texto: `Lo miro yo: no hace falta que nadie revise el proceso «${pq}».` }] };
      }
      else {
        motivo = en ? `⏸ Esperando al proceso «${esperaA.quien}» desde ${desdeCuando(esperaA.t, ahora)} · lo vigila la oficina (${esperaA.ia} lo mira cada ${cadaTxt}${ultM ? `; última vez ${hhmm(ultM)}` : ""}): vuelve solo cuando termine`
          : `⏸ Esperando al proceso «${esperaA.quien}» desde ${desdeCuando(esperaA.t, ahora)} · lo vigila la oficina de lunes a viernes de 8 a 20 (vuelve a mirar a las 08:05${ultM ? `; última vez ${hhmm(ultM)}` : ""})`;
        const clave = pref + Math.floor((ahora - esperaA.t) / (5 * MIN));
        if (en && (trasNoche || (pasado >= 30 * MIN && horasTrabajo(ultM || esperaA.t, ahora) >= cada - MIN)) && !(L.frenos || []).some((f) => f.hilo === h.ts && ahora - f.t < 15 * MIN)) {
          const cabV = `(Vigilante de la oficina, ${hhmm(ahora)}) Este tema espera a que termine el proceso «${esperaA.quien}»${esperaA.que ? `. Cómo se mira / qué se espera: ${esperaA.que}` : ""}.\n`;
          const dichoV = `\n\nLo que dejaste dicho:\n${String((mEsp && mEsp.texto) || "").slice(0, 1500)}`;
          relanzar.push({ hilo: h.ts, ts: esperaA.ts, ia: esperaA.ia, quien: esperaA.ia === "Coo" ? "la oficina" : "Coo", oficina: true, proceso: true, clave,
            que: `${esperaA.ia}: mirar el proceso «${esperaA.quien}» (vigilante de la oficina)`,
            texto: cabV
              + `Míralo SOLO EN LECTURA. Si sigue igual, NO publiques nada (ni en Slack ni en el canal git): escribe exactamente NADA en el fichero de respuesta; la oficina volverá a mirar en ${cadaTxt}. `
              + `Si ha terminado o ha fallado, sigue con lo que tocaba después (sin escrituras en orgs sin el OK de Humano) y publícalo como siempre; si lo siguiente necesita a Humano, una pregunta en llano.${dichoV}`,
            textoMirada: cabV
              + `SOLO MIRA, EN LECTURA, y no sigas con nada más: si ha terminado, lo que toca después lo hace enseguida el modelo de siempre. `
              + `En el fichero de respuesta escribe una de estas tres cosas y nada más: NADA si sigue igual; «TERMINADO: <lo que ves, con el dato>» si ha terminado; `
              + `«FALLADO: <lo que ves>» si ha fallado. No publiques nada (ni en Slack ni en el canal git).${dichoV}` });
        }
      }
    }
    let llevar = null;
    const eC = (pideCanal && pideCanal.estadoCab) || {};
    if (estado === "humano" && pideCanal && pideCanal.pideHumano && !pideCanal.retenido && ultT === pideCanal.t && !enMarcha.length
      && !(eC.hace || []).length && !/^\s*(?:tras|despu[eé]s de)\s+(?:el\s+|la\s+)?(?:3\/3|cruce|alineaci[oó]n)/i.test(eC.toca || "")
      && !/(?:^|[\s(,;])tras\s+(?:el\s+)?3\/3\b/i.test(eC.toca || "")
      && !/\b(?:ya|hecha)\s+(?:est[aá]\s+)?en\s+Slack|pregunta\s+en\s+Slack/i.test(eC.toca || "")
      && ahora - pideCanal.t >= 10 * MIN && ahora - pideCanal.t < 14 * 3600e3) {
      const orig = (pideCanal.tocaDe && bloquesGit.find((x) => x.id && x.id === pideCanal.tocaDe && x.pideHumanoTexto)) || pideCanal;
      const desdeP = Math.max(tJTema, Math.min(orig.t || pideCanal.t, pideCanal.t) - 30 * MIN);
      const yaPreguntado = conv.some((m) => tsMs(m.ts) > desdeP && m.quien !== "Humano" && m.quien !== "Sistema"
        && ((etiquetaDe(m) || {}).toca || new RegExp("<@" + HUMANO + ">|@humano\\b|" + NOMBRE_RE + "\\?", "i").test(textoPlano(m.texto || ""))));
      if (!yaPreguntado) llevar = llevarDe(orig, h.ts);
    }
    const bJ = estado === "humano" ? delTema.filter((b) => b.t > tJTema && pideJ(b) && decideAqui(b)).sort((a, b) => a.t - b.t).pop() : null;
    const d8 = new Date(proximo805(ahora));
    let caja, cajaPor;
    if (estado === "humano") { caja = "toca"; cajaPor = atascado ? `${atascado.ia} se ha atascado` : "depende de ti"; }
    else if (enMarcha.length) { caja = "trabajando"; cajaPor = `${enMarcha.join(" y ")} trabajando`; }
    else if (despierta) { caja = "trabajando"; cajaPor = despierta.ya ? `despertado ${despierta.ia} a las ${hhmm(despierta.t)}; si en 15 min no dice nada, te lo traigo` : despierta.margen ? (diaA ? `hoy toca; si a las 10:10 no ha empezado, despierto a ${despierta.ia}` : ult.quien === "Humano" ? `avisando a ${despierta.ia}` : `${ultT > tUlt && ultQuien ? ultQuien : ult.quien} escribió a las ${hhmm(tRefD)}; si en 10 min no se mueve nadie, despierto a ${despierta.ia}`) : `despertando a ${despierta.ia} ahora`; }
    else if (estado === "espera_otro") { caja = "esperando"; cajaPor = esperaA ? (esperaA.proceso ? `al proceso «${esperaA.quien}» desde ${desdeCuando(esperaA.t, ahora)}` : `a ${esperaA.quien} desde ${desdeCuando(esperaA.t, ahora)}`)
      : (String(motivo || "").replace(/^[^\p{L}\p{N}]+/u, "").split(" · ")[0].slice(0, 140) || "nada pendiente"); }
    else if (estado === "frenado") { caja = "esperando"; cajaPor = "freno anti ping-pong: se vuelve a intentar en 15 min"; }
    else if (iaParada) { caja = "esperando"; cajaPor = `${[0, 6].includes(new Date(ahora).getDay()) ? "el fin de semana" : "de noche"} no se despierta a nadie: a ${iasE[0]}, el ${d8.toLocaleDateString("es-ES", { weekday: "long" })} a las 08:05`; }
    else if (estado === "olvidado" && !/^⌛ Caducado/.test(motivo)) { caja = "esperando"; cajaPor = ult.quien === "Humano" && /^nadie contestó/.test(motivo)
      ? `⚠ nadie te ha contestado desde ${desdeCuando(tUlt, ahora)}: «${plano.replace(/\s+/g, " ").trim().slice(0, 100)}» (era para ${espera.join(" y ") || "las IAs"})`   // v545
      : `quieto desde ${desdeCuando(tUlt, ahora)}: ${String(motivo).replace(/^[⏳⚙️➡️\s]+/u, "")}`; }
    else if (["cerrado", "olvidado"].includes(estado)) { caja = "cerrado"; cajaPor = motivo; }
    else if (h.viejo && ["espera_ia", "parado"].includes(estado) && !/^📌/.test(motivo)) { caja = "esperando"; cajaPor = `quieto desde ${desdeCuando(tUlt, ahora)}: ${motivo}`; }
    else if (estado === "pausa" && /^🔁 trabajando en el canal git/.test(motivo) && !enMarcha.length) { caja = "esperando"; cajaPor = motivo.replace(/^🔁 trabajando en el canal git: /, "movido hace poco en el canal de las IAs (") + "); ahora nadie trabaja en ello"; }
    else if (estado === "pausa" && /^(?:⚙️|🔁 trabajando en el canal git)/.test(motivo)) { caja = "trabajando"; cajaPor = motivo.replace(/^(?:⚙️|🔁)\s*/, ""); }
    else if (estado === "espera_ia" && /^📌/.test(motivo)) { caja = "radar"; cajaPor = "aparcado: sin IA ni prisa"; }
    else if (/^⏳/.test(motivo)) { caja = "esperando"; cajaPor = motivo.replace(/^⏳\s*/, ""); }   // (próximo paso, otro día, hoy toca, a la espera)
    else if (/^↩ contestaste a|^⏳ a la espera/.test(motivo)) { caja = "esperando"; cajaPor = motivo.replace(/^[↩⏳]\s*/, ""); }
    else { caja = "cerrado"; cajaPor = "nada pendiente a la vista"; }
    hilos.push({
      caja, cajaPor, atascado,
      ...(h.viejo ? { viejo: true } : {}),
      llevar,
      asuntoJ: bJ ? [...new Set([...`${(bJ.etiquetas || []).join(" ")} ${bJ.tit || ""}`.matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)].map((m) => "j:" + m[0]))] : [],
      tSlack: tUlt,
      esperaA: estado === "espera_otro" ? esperaA : null,
      despertar, nadieHace: despertar.length > 0 && estado === "espera_ia" && !despierta,
      cruzado: estado === "humano" ? [...new Set([...cruzado, ...enGit.map((b) => b.de),
        ...delTema.filter((b) => b.t > tJ && !b.retenido).map((b) => b.de)].map((d) => (d === "Grok" ? "Coo" : d)).filter((d) => IAS.includes(d)))] : cruzado,
      opciones: estado === "humano" && tuyo ? tuyo.ops.map((o) => `(${o.l}) ${o.t.split(/\s+/).slice(0, 5).join(" ")}`).slice(0, 5)
        : pideOkFuera && pideOkFuera.opciones.length ? pideOkFuera.opciones.map((o) => `(${o.l}) ${o.t.split(/\s+/).slice(0, 5).join(" ")}`)
        : estado === "humano" && !permisoGrok && !pendExterno && !/te contestó por privado/.test(motivo) ? opciones((pideOkFuera && pideOkFuera.pregunta) || ultTexto) : [], permisoGrok, pendExterno, correoGrok,   // v487 (Diseño, tanda 7): con pregunta, sus botones salen de la pregunta
      ahora: estado === "humano" ? tuyo : null,
      pideOk: pideOkFuera,
      git: enGit.slice(-6).map((b) => ({ id: b.id, de: b.de, t: b.t, canal: b.canal, tit: b.tit, cuerpo: b.cuerpo })),
      proyecto, tema: objetivoDe(raiz.texto) ? limpiaTitulo(tituloHilo(raiz.texto)) : temaDe(tituloHilo(raiz.texto), textoPlano(raiz.texto).slice(0, 400)),
      // quién ha pasado por la sala del tema en las últimas 3 h (para la vista por temas)
      participan: [...new Set(conv.filter((m) => ahora - tsMs(m.ts) < 3 * 3600e3 && IAS.includes(m.quien)).map((m) => m.quien))],
      ts: h.ts, titulo: limpiaTitulo(tituloHilo(raiz.texto)), url: enlace(ult.ts, h.ts), estado, motivo, espera, enMarcha,
      trabajan: enMarcha.map((ia) => ({ ia, desde: (desdeT[h.ts] || {})[ia] || 0, arrancando: (arrancan[h.ts] || []).includes(ia),
        ...((porSenal[h.ts] || {})[ia] ? { senal: true, ult: porSenal[h.ts][ia] } : {}) })),
      sinSenal: sinSenal[h.ts] || [],
      terminaron: terminaron[h.ts] || [], avisados: avisados[h.ts] || [],
      objetivo: objetivoDe(raiz.texto), origen: origen0,
      trae: ["Charla", "Gus"].includes(raiz.quien) ? raiz.quien : null, creado: tsMs(h.ts),
      ult: { quien: ultQuien, t: ultT, texto: String(ultTexto).slice(0, 260) }, n: conv.length,
      msgs: conv.slice(-8).map((m) => ({ quien: m.quien, t: tsMs(m.ts), texto: textoPlano(m.texto).slice(0, 4000) })),
      // "desde": desde cuándo está en este estado = último mensaje (o el arranque del trabajo)
      desde: ultT,
    });
  }
  const etqDe = Object.fromEntries(Object.entries(ligadosA).map(([k, bs]) => [k, [...new Set(bs.flatMap((b) => b.etiquetas || []))].filter((e) => e.length >= 5 && !NO_TITULO.test(e))]));
  const deAhora = new Map(hilosSlack.filter((h) => !esTim(h)).map((h) => [h.ts, (h.msgs[0] || {}).texto || ""]));
  const temaIni = temasDesde([...[...deAhora].map(([ts, texto]) => ({ ts, texto })), ...(previos || raicesSemana).filter((r) => !deAhora.has(r.ts))], etqDe, typeof jiraCreadas === "object" ? jiraCreadas : {});
  for (const h of hilos) {
    h.temaDesde = Math.min(temaIni[h.ts] || h.creado, h.creado);
    h.relevo = !!vieneDe(deAhora.get(h.ts)) || /\bparte\s*[2-9]\b/i.test(h.titulo);
  }
  const orden = { humano: 0, parado: 1, frenado: 2, marcha: 3, espera_ia: 4, pausa: 5, cerrado: 6, olvidado: 7 };
  hilos.sort((a, b) => orden[a.estado] - orden[b.estado] || b.desde - a.desde);

  // monigotes
  const monis = [];
  const ultMsg = (ia) => Math.max(0, ...hilosSlack.flatMap((h) => h.msgs.filter((m) => m.quien === ia).map((m) => tsMs(m.ts))));
  const urlDe = (ts) => { const h = hilos.find((x) => x.ts === ts); return h ? h.url : null; };
  const tituloDe = (ts) => { const h = hilos.find((x) => x.ts === ts); return h ? h.titulo : ts ? "hilo " + ts : "canal git"; };
  const frenadoIA = (ia) => L.frenos.some((f) => f.ia === ia && ahora - f.t < 15 * MIN);
  const cooTs = Object.entries(trabajando).filter(([, s]) => s.has("Coo")).map(([h]) => h);
  const cooHilos = cooTs.map(tituloDe);
  const timbreTs = (hilosSlack.find((x) => esTim(x)) || {}).ts || L.timbreHilo || "";
  const cooTimbre = (L.avisosCoo || []).filter((a) => timbreTs && a.hilo === timbreTs && ahora - a.t < 15 * MIN
    && !bloquesGit.some((b) => b.de === "Coo" && b.t > a.t)).pop();
  if (cooTimbre) cooHilos.push(`canal git (lo despertó el timbre a las ${hhmm(cooTimbre.t)})`);
  monis.push({ id: "coo", nombre: "Coo", rol: "coordinador jefe", ia: "Coo",
    estado: cooHilos.length ? "trabaja" : frenadoIA("Coo") ? "frenado" : "libre",
    tarea: cooHilos.length ? cooHilos.join(" · ") : frenadoIA("Coo") ? "frenado en algún hilo" : "esperando recados", ult: ultMsg("Coo"), url: cooTs[0] ? urlDe(cooTs[0]) : null });
  monis.push({ id: "claude-portero", nombre: "Claude", rol: "escucha de Slack", ia: "Claude",
    estado: P ? (P.escucha ? (L.avisoClaude && /No lanzo a nadie/.test(L.avisoClaude.aviso) ? "frenado" : claudeVivos.length ? "trabaja" : "libre") : "caido") : "?",
    tarea: P && !P.escucha ? "¡la escucha de Slack está CAÍDA!" : L.avisoClaude ? `⚠️ ${L.avisoClaude.aviso} (${hhmm(L.avisoClaude.t)})` : claudeVivos.length ? `${claudeVivos.length} Claude en hilos` : "de guardia, oyendo Slack", ult: ultMsg("Claude") });
  claudeVivos.forEach((p, i) => monis.push({ id: "claude-" + p.pid, nombre: "Claude #" + (i + 1), rol: "Claude de hilo", ia: "Claude",
    estado: p.activo === false ? "pensando" : "trabaja", tarea: tituloDe(p.hilo), desde: p.ini, url: urlDe(p.hilo) }));
  const cursorAg = (agentes || []).filter((a) => /RUNNING|CREATING|PENDING/i.test(a.run || ""));
  monis.push({ id: "cursor", nombre: "Cursor", rol: "revisor", ia: "Cursor",
    estado: cursorAg.length || cursorVivos.length ? "trabaja" : cursorNoArranca ? "frenado" : frenadoIA("Cursor") ? "frenado" : "libre",
    tarea: cursorAg.length ? `${cursorAg.length} agente(s) en la nube` : cursorNoArranca ? `⚠️ no arranca por API desde las ${hhmm(cursorNoArranca.t)}` : frenadoIA("Cursor") ? "frenado en algún hilo" : "esperando recados", ult: ultMsg("Cursor") });
  cursorAg.forEach((a, i) => {
    const cs = L.cursorSlack.find((c) => c.agente === a.id);
    monis.push({ id: a.id, nombre: "Cursor #" + (i + 1), rol: /^slack/.test(a.nombre) ? "Cursor de hilo" : "Cursor del canal git", ia: "Cursor",
      estado: "trabaja", tarea: cs ? tituloDe(cs.hilo) : a.nombre, desde: a.creado, url: (cs && urlDe(cs.hilo)) || a.url });
  });
  if (process.env.OFICINA_ESCRITORIO === "1") (P ? P.escritorio : []).forEach((p, i) => monis.push({ id: "esc-" + p.pid, nombre: "Claude escritorio " + (i + 1), rol: "sesión del Code tab", ia: "Claude",
    estado: p.activo ? "trabaja" : "libre", tarea: p.activo ? "trabajando en el escritorio" : "abierta, quieta", desde: p.ini }));

  const vistasT = new Set();
  const sueltas0 = timbre.filter((x) => !x.unido && !x.hilo && !(x.bloque && vistasT.has(x.bloque.clave)) && (!x.bloque || vistasT.add(x.bloque.clave)));
  const sueltas = [];
  for (const x of [...sueltas0].sort((a, b) => b.t - a.t)) {
    const px = palabras(x.texto);
    if (sueltas.some((y) => y.t - x.t < 30 * MIN && [...palabras(y.texto)].filter((w) => px.has(w)).length >= 3)) continue;
    sueltas.push(x);
  }
  const prsDe = (h) => new Set([...`${h.titulo || ""} ${h.objetivo || ""} ${h.estado === "humano" ? (h.pideOk && h.pideOk.pregunta) || (h.ult && h.ult.texto) || "" : ""}`
    .matchAll(/(?:\bPR\s*#?\s*|#)(\d{4,5})\b/gi)].map((m) => m[1]));
  const retiradaPR = {};
  for (const b of bloquesGit) {
    if (!b.t) continue;
    for (const fr of textoPlano(`${b.tit || ""}\n${b.cuerpo || ""}`).replace(/[*_`]/g, "").split(/\n|(?<=[.;])\s/)) {
      if (!/\b(retirad[oa]s?|cerrad[oa]s?|retenid[oa]s?|anulad[oa]s?|sin efecto|no vuelve a .{0,3}te toca)\b/i.test(fr) || !/tarjeta|te toca|«\s*¿|pregunta/i.test(fr)) continue;
      for (const m of fr.matchAll(/(?:\bPR\s*#?\s*|#)(\d{4,5})\b/gi))
        if (!retiradaPR[m[1]] || retiradaPR[m[1]].t < b.t) retiradaPR[m[1]] = { t: b.t, de: b.de || "canal", frase: fr.replace(/\s+/g, " ").trim().slice(0, 160) };
    }
  }
  for (const h of hilos.filter((x) => x.estado === "humano")) {
    const tP = (h.pideOk && h.pideOk.t) || (h.ult && h.ult.t) || 0;
    const pr = [...prsDe(h)].find((k) => retiradaPR[k] && retiradaPR[k].t > tP); if (!pr) continue;
    const r = retiradaPR[pr];
    h.estado = "cerrado"; h.pideOk = null; h.opciones = []; h.despertar = []; h.nadieHace = false;
    h.motivo = `✔ Lo de la #${pr} se retiró en el canal git (${r.de} ${hhmm(r.t)}): ya no te toca`;
  }
  {
    const jun = L.juntados || { si: [], no: [] };
    const raizDe = (h) => ((hilosSlack.find((x) => x.ts === h.ts) || { msgs: [] }).msgs[0] || {}).texto || "";
    const personaDe = (h) => { const r = raizDe(h);
      const o = (textoPlano(r).match(/Origen:\s*[^\n·]*·\s*([A-ZÁÉÍÓÚÑ][\wáéíóúñü]+)/) || [])[1];
      const t = (String(h.titulo || "").match(/^([A-ZÁÉÍÓÚÑ][\wáéíóúñü]+)\s*·/) || [])[1];
      return [o, t].filter(Boolean).map((x) => sinTildes(x)); };
    const esDe = (h, quien) => { const ps = personaDe(h); return String(quien || "").split(/\s*(?:,|\/|&|\by\b|\be\b)\s*/i).map(sinTildes).filter((n) => n.length >= 3)
      .some((n) => ps.some((p) => p === n || p.startsWith(n) || n.startsWith(p))); };
    const claves = (h) => fuertes(String(h.titulo || ""));
    const abiertos = hilos.filter((h) => !h.viejo || h.caja !== "cerrado");
    const une = (o, n, por, auto) => {
      if (auto) {
        o.sigueEn = { ts: n.ts, titulo: n.titulo, por, t: tsMs(n.ts) };
        o.estado = "cerrado"; o.esperaA = null; o.espera = []; o.pideOk = null; o.opciones = []; o.despertar = []; o.nadieHace = false; o.llevar = null;
        o.motivo = `↪ Sigue en «${n.titulo}» (${hhmm(tsMs(n.ts))}, ${por}): lo nuevo está allí`;
        o.caja = "cerrado"; o.cajaPor = o.motivo;
        (n.vieneDe = n.vieneDe || []).push({ ts: o.ts, titulo: o.titulo, por });
      } else if (!n.proponJuntar && !n.vieneDe) n.proponJuntar = { ts: o.ts, titulo: o.titulo, por };
    };
    const usados = new Set();
    for (const [a, b] of jun.si) { const o = hilos.find((h) => h.ts === a), n = hilos.find((h) => h.ts === b);
      if (o && n && o !== n) { une(o, n, "lo juntaste tú", true); usados.add(a); usados.add(b); } }
    {
      const soloTuya = (h) => { const ms = (hilosSlack.find((x) => x.ts === h.ts) || { msgs: [] }).msgs.filter((m) => m.quien !== "Sistema"); return ms.length === 1 && ms[0].quien === "Humano"; };
      const sinMenciones = (h) => textoPlano(raizDe(h)).replace(/<@[A-Z0-9]+>|@[\wáéíóúñü]+/gi, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
      const solos = abiertos.filter((h) => !usados.has(h.ts) && h.caja !== "cerrado" && !h.sigueEn && !(h.enMarcha || []).length && soloTuya(h)).sort((x, y) => tsMs(x.ts) - tsMs(y.ts));
      const nuevas = hilos.filter((h) => !usados.has(h.ts) && !h.sigueEn).sort((x, y) => tsMs(x.ts) - tsMs(y.ts));
      solos.forEach((o) => {
        const q = sinMenciones(o); if (q.length < 12 || o.estado !== "olvidado") return;
        const n = nuevas.filter((x) => tsMs(x.ts) > tsMs(o.ts) && tsMs(x.ts) - tsMs(o.ts) <= 15 * MIN && sinMenciones(x) === q && !jun.no.some(([a, b]) => a === o.ts && b === x.ts)).pop();
        if (n) { une(o, n, "la misma pregunta, repetida", true); usados.add(o.ts); }
      });
      const libres = hilos.filter((h) => !usados.has(h.ts) && !h.sigueEn).sort((x, y) => tsMs(x.ts) - tsMs(y.ts));
      libres.forEach((a, i) => {
        const q = sinMenciones(a); if (q.length < 12 || a.sigueEn) return;
        const b = libres.slice(i + 1).find((x) => !x.sigueEn && tsMs(x.ts) - tsMs(a.ts) <= 15 * MIN && sinMenciones(x) === q
          && (a.caja === "cerrado") !== (x.caja === "cerrado") && !jun.no.some(([p, r]) => (p === a.ts && r === x.ts) || (p === x.ts && r === a.ts)));
        if (!b) return;
        const [c, v] = a.caja === "cerrado" ? [a, b] : [b, a];
        // (solo si en el vivo ya ha contestado alguien: una pregunta tuya aún sin respuesta, a otra IA para comparar, sigue aparte: v555)
        if (!(hilosSlack.find((x) => x.ts === v.ts) || { msgs: [] }).msgs.some((mm) => mm.quien !== "Humano" && mm.quien !== "Sistema")) return;
        une(c, v, "la misma pregunta, repetida", true); usados.add(c.ts);
      });
    }
    const viejos = abiertos.filter((o) => !usados.has(o.ts) && o.caja !== "cerrado" && !o.sigueEn).sort((x, y) => tsMs(x.ts) - tsMs(y.ts));
    for (const o of viejos) {
      if (o.sigueEn) continue;
      const ko = claves(o), e = o.esperaA && !o.esperaA.proceso && !IAS.includes(o.esperaA.quien) ? o.esperaA : null;
      const nuevos = abiertos.filter((n) => n !== o && !n.viejo && !usados.has(n.ts) && !n.sigueEn && tsMs(n.ts) > tsMs(o.ts)
        && !jun.no.some(([a, b]) => a === o.ts && b === n.ts)).sort((x, y) => tsMs(y.ts) - tsMs(x.ts));
      for (const n of nuevos) {
        const kn = claves(n), comun = [...kn].filter((k) => ko.has(k)), otras = [...kn].filter((k) => !ko.has(k));
        const dePersona = !!e && tsMs(n.ts) > (e.t || 0) && esDe(n, e.quien);
        if (comun.length && !otras.length && dePersona) { une(o, n, `${e.quien} contestó en un hilo nuevo; ${comun.join(", ")}`, true); usados.add(n.ts); break; }
        if (comun.length && !otras.length && ko.size) { une(o, n, `mismo ${comun.join(", ")}`, false); continue; }
        if (dePersona && !kn.size) {
          const pa = palabras(o.titulo || ""), comunes = [...palabras(n.titulo || "")].filter((w) => pa.has(w));
          if (comunes.length >= 2) une(o, n, `${e.quien}, que esperaba este tema; «${comunes.slice(0, 3).join(", ")}»`, false);
        }
      }
    }
  }
  // v550: la persona a la que espera el tema te escribió por privado de Slack DESPUÉS de empezar la espera (y tú no has escrito en
  // el hilo desde entonces): te toca, con lo que dijo
  for (const h of hilos) {
    const r = (L.respEsperas || {})[h.ts], e = h.esperaA;
    if (!r || !e || h.estado === "cerrado" || h.estado === "humano" || !(r.t > (e.t || 0))) continue;
    const hs = hilosSlack.find((x) => x.ts === h.ts), tJ = hs ? Math.max(0, ...hs.msgs.filter((m) => m.quien === "Humano").map((m) => tsMs(m.ts))) : 0;
    if (tJ >= r.t) continue;
    if (esAcuse(r.texto)) { e.acuse = { t: r.t, texto: String(r.texto).replace(/\s+/g, " ").slice(0, 200), por: "Slack" };
      h.motivo = `⏸ Esperando a ${e.quien}: contestó por Slack (${hhmm(r.t)}) «${e.acuse.texto.slice(0, 120)}», aún sin hacer · se esperaba: ${String(e.que || "").slice(0, 120)}`;
      if (h.caja === "esperando") h.cajaPor = `a ${e.quien}: contestó «${e.acuse.texto.slice(0, 60)}» (${hhmm(r.t)})`; continue; }
    h.respuestaDe = { quien: r.nombre, t: r.t, texto: r.texto, por: "Slack", dm: r.dm || "" };
    h.estado = "humano"; h.pideOk = null; h.opciones = []; h.despertar = []; h.nadieHace = false;
    h.motivo = `💬 ${r.nombre} te ha escrito por Slack (${hhmm(r.t)}): «${String(r.texto).replace(/\s+/g, " ").slice(0, 200)}» · se esperaba: ${String(e.que || "").slice(0, 120)}`;
    h.caja = "toca"; h.cajaPor = `${r.nombre} ha contestado`;
    h.ult = { ...(h.ult || {}), quien: r.nombre, texto: r.texto, t: r.t };
    h.esperaRespondida = e; h.esperaA = null;
  }
  for (const h of hilos) {
    if (h.estado !== "humano" || !/^💬 .+? te contestó por privado/.test(h.motivo || "") || /espera tu respuesta/.test(h.motivo || "")) continue;
    const P = sinTildes(h.motivo.match(/^💬 (.+?) te contestó por privado/)[1]).split(/\s+/)[0], tE = (h.ult && h.ult.t) || 0;
    const o = hilos.find((x) => x !== h && x.estado !== "cerrado" && (x.esperaA || x.esperaRespondida) && (L.respEsperas || {})[x.ts]
      && sinTildes((L.respEsperas[x.ts].nombre || "")).split(/\s+/)[0] === P && Math.abs(L.respEsperas[x.ts].t - tE) < 30 * MIN);
    if (!o) continue;
    h.estado = "cerrado"; h.caja = "cerrado"; h.opciones = []; h.pideOk = null; h.despertar = []; h.nadieHace = false;
    h.motivo = h.cajaPor = `💬 lo que te escribió ${L.respEsperas[o.ts].nombre} por privado va en «${o.titulo}»`; h.privadoEn = { ts: o.ts, titulo: o.titulo };
    { const hs = hilosSlack.find((x) => x.ts === h.ts), pr = (hs ? hs.msgs : []).filter((m) => m.quien !== "Sistema" && !/por privado/.test(m.texto || "")).pop();
      if (pr) h.ultPropio = { quien: pr.quien, texto: textoPlano(pr.texto || "").replace(/\s+/g, " ").slice(0, 300), t: tsMs(pr.ts) }; }
  }
  const apJ = L.apuntes ? apuntesLimpios({ ajustes: L.apuntes }).ajustes : L.resueltos ? apuntesLimpios({ ajustes: { cerrados: L.resueltos } }).ajustes : PRUEBAS ? {} : ((leeApuntes() || {}).ajustes || {});
  const marcaJ = (h) => {
    const k = h.tema || h.titulo, nuevo = Math.max(0, ...(h.msgs || []).map((m) => m.t || 0)), t = (v) => (v && typeof v === "object" ? +v.t || 0 : +v || 0);
    const c = t((apJ.cerrados || {})[k]), q = t((apJ.quitados || {})[k]), p = (apJ.pausas || {})[k];
    if (c && nuevo <= c + 60e3) return "resuelto";
    if (q && nuevo <= q + 60e3) return "quitado";
    if (p && (!p.hasta || +p.hasta > ahora)) return "pausa";
    return "";
  };
  const deleg = { ...(L.delegados || {}) };
  { const cfgSF = L.sfAuto !== undefined ? L.sfAuto : PRUEBAS || !COORD.haySF() ? null : COORD.leeAuto(DELEGADOS);
    Object.assign(deleg, COORD.autoSalesforce(hilos, (h) => ((hilosSlack.find((x) => x.ts === h.ts) || { msgs: [] }).msgs[0] || {}).texto || "", deleg, cfgSF, marcaJ)); }
  for (const h of hilos) {
    const d = deleg[h.ts]; if (!d || h.estado === "cerrado") continue;
    // El «antes» de un delegado dice desde cuándo no hay movimiento (fecha fija del último mensaje: estable entre vueltas, porque
    // va a la huella de para-coord-salesforce); el «3 h» de «nadie lo ha cogido» es el umbral, no el tiempo real.
    let antes = h.motivo || "";
    if (d.auto && h.estado === "olvidado" && h.ult && h.ult.t && /nadie lo ha cogido/.test(antes)) {
      const f = new Date(h.ult.t);
      const cuando = `${String(f.getDate()).padStart(2, "0")}/${String(f.getMonth() + 1).padStart(2, "0")} ${hhmm(h.ult.t)}`;
      antes = antes.replace(/\s*(—\s*nadie lo ha cogido en 3 h|hace más de 3 h y nadie lo ha cogido)\s*$/, ` — sin movimiento desde el ${cuando}`);
    }
    h.delegado = d.auto ? { quien: d.quien, nota: d.nota, auto: true, por: d.por, antes } : { quien: d.quien, nota: d.nota };
    h.estado = "pausa"; h.pideOk = null; h.opciones = []; h.despertar = []; h.nadieHace = false; h.llevar = null;
    h.motivo = d.auto ? `⚙️ Lo lleva ${d.quien} (se lo ha pasado la oficina: ${d.nota}): no te toca a ti desde aquí` : `⚙️ Lo lleva ${d.quien}${d.nota ? ` (${d.nota})` : ""}: no te toca a ti desde aquí`;
    if (d.auto) { h.caja = "esperando"; h.cajaPor = `lo lleva ${d.quien} (se lo ha pasado la oficina: ${d.nota})`; }
    else { h.caja = "trabajando"; h.cajaPor = `lo lleva ${d.quien}`; }
  }
  // lo que la persona dio por resuelto y sin nada escrito después es un tema CERRADO también en el servidor: sin caja viva, sin
  // pregunta, sin despertar ni relanzar a nadie. Si alguien escribe después, marcaJ ya no lo da por resuelto y vuelve solo.
  for (const h of hilos) {
    if (h.delegado || h.sigueEn || h.estado === "cerrado" || (h.enMarcha || []).length || marcaJ(h) !== "resuelto") continue;
    const v = (apJ.cerrados || {})[h.tema || h.titulo], t = v && typeof v === "object" ? +v.t || 0 : +v || 0;
    h.estado = "cerrado"; h.caja = "cerrado"; h.motivo = h.cajaPor = "✔ Lo diste por resuelto tú"; h.resueltoJ = t; h.desde = t;
    h.pideOk = null; h.opciones = []; h.despertar = []; h.nadieHace = false; h.llevar = null; h.esperaA = null; h.atascado = null; h.espera = [];
    for (let i = relanzar.length - 1; i >= 0; i--) if (relanzar[i].hilo === h.ts) relanzar.splice(i, 1);
  }
  { const ocupados = hilos.filter((x) => (x.enMarcha || []).some((e) => (e.quien || e) === "Claude")).map((x) => x.titulo);
    for (const h of hilos) {
      const c = (L.colaHilo || {})[h.ts]; if (!c || ["cerrado", "olvidado", "frenado"].includes(h.estado) || (h.enMarcha || []).some((e) => (e.quien || e) === "Claude")) continue;
      h.enCola = { t: c.t, por: c.por, ocupados };
      h.cajaPor = c.por === "hueco"
        ? `en cola desde las ${hhmm(c.t)}: Claude se pone en cuanto acabe uno de los que trabajan${ocupados.length ? ` (${ocupados.slice(0, 2).map((t) => `«${String(t).slice(0, 40)}»`).join(", ")})` : ""}`
        : `en cola desde las ${hhmm(c.t)}: Claude ya está en este hilo y lo coge en cuanto termine lo anterior`;
      if (h.caja !== "toca") h.motivo = `⏳ ${h.cajaPor[0].toUpperCase()}${h.cajaPor.slice(1)}`;
    }
  }
  // (v555: tampoco en lo que sigue en otro hilo: la pregunta repetida se atiende en el hilo nuevo)
  const siguen = new Set(hilos.filter((h) => h.sigueEn).map((h) => h.ts));
  for (let i = relanzar.length - 1; i >= 0; i--) if (deleg[relanzar[i].hilo] || siguen.has(relanzar[i].hilo)) relanzar.splice(i, 1);
  const vivosA = hilos.filter((h) => !["cerrado", "olvidado", "frenado"].includes(h.estado));
  const candA = hilos.filter((h) => !["olvidado", "frenado"].includes(h.estado));
  const asuntos = (h) => new Set([...prsDe(h), ...(h.estado === "humano" ? h.asuntoJ || [] : [])]);
  const nombreA = (k) => (k.startsWith("j:") ? `Lo de ${k.slice(2)}` : `La #${k}`);
  const masNuevo = (o, h) => { const a = (o.ult && o.ult.t) || 0, b = (h.ult && h.ult.t) || 0; return a > b || (a === b && (o.tSlack || 0) > (h.tSlack || 0)); };
  for (const h of vivosA.filter((x) => x.estado === "humano")) {
    const ks = asuntos(h); if (!ks.size) continue;
    const otro = candA.filter((o) => o !== h && masNuevo(o, h) && [...asuntos(o)].some((k) => ks.has(k)))
      .sort((a, b) => (masNuevo(a, b) ? -1 : masNuevo(b, a) ? 1 : 0))[0];
    if (!otro) continue;
    const pr = nombreA([...ks].find((k) => asuntos(otro).has(k)));
    if (otro.estado === "cerrado") {
      h.estado = "cerrado"; h.pideOk = null; h.opciones = []; h.despertar = []; h.nadieHace = false; h.mismoAsunto = { ts: otro.ts, titulo: otro.titulo };
      h.motivo = `✔ ${pr} ya se resolvió en «${otro.titulo}» (${hhmm(otro.ult.t)}): lo que se preguntaba aquí ya no hace falta`;
      continue;
    }
    h.estado = "pausa"; h.pideOk = null; h.opciones = []; h.despertar = []; h.nadieHace = false; h.mismoAsunto = { ts: otro.ts, titulo: otro.titulo };
    h.motivo = `↪ ${pr} sigue en «${otro.titulo}» (${hhmm(otro.ult.t)}), que es lo más nuevo: ${String(otro.motivo || "").slice(0, 160)}`;
    (otro.tambienEn = otro.tambienEn || []).push({ ts: h.ts, titulo: h.titulo });
    if (otro.estado === "humano") otro.motivo += ` · (lo mismo te preguntaban en «${h.titulo}»)`;
  }
  for (const h of hilos) {
    if (h.estado === "humano") { if (h.caja !== "toca") { h.caja = "toca"; h.cajaPor = h.cajaPor || "depende de ti"; } }
    else if (h.caja === "toca") { h.caja = "cerrado"; h.cajaPor = h.motivo; }
  }
  // Un tema que te tocaba y tienes en pausa (apuntes.ajustes.pausas) no cuenta como «toca» ni en deTi ni en los contadores: caja y
  // estado «pausa», con los de antes en h.cajaReal / h.estadoReal (la página los usa para su línea «Está en pausa y te toca»).
  // Vuelve solo al vencer la pausa (marcaJ mira p.hasta en cada cálculo). Un mensaje nuevo no levanta la pausa.
  for (const h of hilos) {
    if (h.estado !== "humano" || h.caja !== "toca" || marcaJ(h) !== "pausa") continue;
    const p = (apJ.pausas || {})[h.tema || h.titulo];
    h.cajaReal = h.caja; h.estadoReal = h.estado; h.estado = "pausa"; h.caja = "pausa";
    h.cajaPor = h.motivo = `⏸ Lo pausaste tú${p && p.hasta ? ` hasta las ${hhmm(+p.hasta)}` : ""}`;
    h.pideOk = null; h.opciones = []; h.despertar = []; h.nadieHace = false; h.llevar = null; h.atascado = null;
    for (let i = relanzar.length - 1; i >= 0; i--) if (relanzar[i].hilo === h.ts) relanzar.splice(i, 1);
  }
  const huellaL = (t) => { const s = textoPlano(String(t || "")).replace(/\s+/g, " "), a = s.match(/En el canal de las IAs \(([^,()]+), (\d{1,2}:\d{2})\)/i), q = s.match(/\[te toca:\s*([^\]]+)\]/i);
    return a && q ? sinTildes(`${a[1]} ${a[2]} ${q[1]}`).replace(/[^a-z0-9]+/g, " ").trim() : ""; };
  const yaLlevadoS = new Set();
  for (const hs of hilosSlack) for (const m of hs.msgs) if (ahora - tsMs(m.ts) < 14 * 3600e3 && /En el canal de las IAs/i.test(m.texto || "")) { const k = huellaL(m.texto); if (k) yaLlevadoS.add(k); }
  const porBloque = new Map();
  for (const h of hilos) {
    if (!h.llevar) continue;
    if (h.estado !== "humano" || yaLlevadoS.has(huellaL(h.llevar.texto))) { h.llevar = null; continue; }
    const k = String(h.llevar.clave || "").replace(/^llevar:[^:]+:/, "");
    if (!porBloque.has(k)) porBloque.set(k, []); porBloque.get(k).push(h);
  }
  const NO_NOMBRE = /^(?:Humano|Claude|Cursor|Coo|Grok|Slack|Jira|Hilo|Tema|Parte|Reunión|Chat|Correo|OCA)$/i;
  const fichas = (txt) => new Set([...String(txt || "").replace(/[*_`]/g, "").matchAll(/\b[A-Z][A-Z0-9]+-\d+\b|#\d{4,5}\b|\b[A-ZÁÉÍÓÚÑ][a-záéíóúñü]{3,}\b/g)]
    .map((x) => x[0]).filter((w) => !NO_NOMBRE.test(w)));
  for (const hs of porBloque.values()) {
    if (hs.length < 2) continue;
    const enPreg = fichas(hs[0].llevar.texto.split("\n").slice(1).join(" "));
    const nombra = (h) => [...fichas(h.titulo)].filter((w) => enPreg.has(w)).length;
    const gana = hs.slice().sort((a, b) => (nombra(b) - nombra(a)) || ((b.tSlack || 0) - (a.tSlack || 0)))[0];
    for (const h of hs) if (h !== gana) h.llevar = null;
  }
  // v540: de los hilos viejos (36 h a 14 días) solo se enseña lo que sigue abierto
  for (let i = hilos.length - 1; i >= 0; i--) if (hilos[i].viejo && hilos[i].caja === "cerrado") hilos.splice(i, 1);
  for (const h of hilos) {
    if (h.estado !== "humano") continue;
    const mot = String(h.motivo || ""), ult = h.ult || {};
    let x = null;
    if (h.respuestaDe && h.respuestaDe.dm) x = { posible: true, canal: "slack", a: h.respuestaDe.quien, de: h.respuestaDe.t, dm: h.respuestaDe.dm };
    else if (/^💬 .+? te contestó por privado/.test(mot)) { const a = mot.match(/^💬 (.+?) te contestó por privado/)[1]; x = { posible: true, canal: "slack", a, de: ult.t || 0, persona: a }; }
    else { const r = mot.match(/^💬 (.+?) te ha escrito \(lo trae (Charla|Gus)\)/);
      if (r) x = { posible: false, canal: r[2] === "Gus" ? "correo" : "google-chat", a: r[1], de: ult.t || 0,
        motivo: `La oficina no puede escribir por ${r[2] === "Gus" ? "correo" : "Google Chat"}: ${r[2]} solo envía cuando Coo se lo pide. Copia el texto y mándaselo tú.` }; }
    if (!x) continue;
    const ya = (L.estoyEnEllo || {})[`${h.ts}|${sinTildes(x.a)}|${x.de}`];
    h.estoyEnEllo = { ...x, texto: TEXTO_EN_ELLO, yaEnviado: ya ? { t: ya.t } : null };
  }
  const resueltos = apJ.cerrados || {};
  const deTi = hilos.filter((h) => h.estado === "humano" && !(resueltos[h.tema || h.titulo] && ((h.ult && h.ult.t) || 0) <= resueltos[h.tema || h.titulo] + 60e3)).map((h) => ({ tipo: "hilo", hilo: h.ts, titulo: h.titulo, quien: h.ult.quien, texto: h.ult.texto, url: h.url, t: h.desde, cruzado: h.cruzado, opciones: h.opciones, pideOk: h.pideOk }))
    .concat(sueltas.map((x) => ({ tipo: "timbre", titulo: "Decisión del canal git (sin tema: ábrela)", quien: "canal", texto: x.texto, url: x.url, t: x.t, cruzado: [], opciones: [] })));
  // un mensaje de Coo nunca relanza a Coo (avisar-coo.sh); un [lo hace: Claude|Cursor] suyo sí despierta a esa IA
  const deCoo = new Set(hilosSlack.flatMap((h) => h.msgs.filter((m) => m.quien === "Coo").map((m) => m.ts)));
  return { hilos, monis, deTi, frenosHora: L.lanz.length, relanzar: relanzar.filter((r) => !(r.ia === "Coo" && deCoo.has(r.ts))) };
}

// ---------- historial de la semana (v30): temas nuevos y mensajes por persona, los últimos 7 días ----------
// Solo lectura de #canal-humano; va por libre cada 30 min y reutiliza la caché de respuestas de los hilos.
let semana = null, semanaEnCurso = false, semanaT = 0;
const diaDe = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
async function leerSemana() {
  // v56: 14 días (esta semana y la anterior, para comparar)
  const ini = new Date(); ini.setHours(0, 0, 0, 0); ini.setDate(ini.getDate() - 13);
  const dias = {};
  for (let i = 0; i < 14; i++) { const d = new Date(ini); d.setDate(ini.getDate() + i); dias[diaDe(d)] = { temas: 0, msgs: { Humano: 0, Coo: 0, Claude: 0, Cursor: 0 } }; }
  let cursor = "", raices = [];
  for (let pag = 0; pag < 5; pag++) {
    const h = await slack("conversations.history", { channel: CH, limit: 200, oldest: (ini.getTime() / 1000).toFixed(6), ...(cursor ? { cursor } : {}) });
    raices.push(...(h.messages || []).filter(esRaiz));
    cursor = h.response_metadata && h.response_metadata.next_cursor; if (!cursor) break;
  }
  // v169: las raíces de los 14 días, para saber desde cuándo dura cada tema (hilos[].temaDesde)
  raicesSemana = raices.map((r) => ({ ts: r.ts, texto: String(r.text || "").slice(0, 600) }));
  for (const d of Object.values(dias)) { d.horas = Array(24).fill(0); d.porTema = {}; d.jIni = null; d.jFin = null; }
  const temaDeHilo = {};
  for (const r of raices) {
    const tit = tituloHilo(r.text || ""), tema = temaDe(tit, textoPlano(r.text || ""));
    temaDeHilo[r.ts] = tema;
    const dr = dias[diaDe(tsMs(r.ts))]; if (dr) dr.temas++;
    let msgs = [r];
    if (r.reply_count) {
      const c = cacheReplies.get(r.ts);
      if (c && c.latest === r.latest_reply) msgs = c.msgs;
      else {
        await new Promise((ok) => setTimeout(ok, 250));   // v63: sin prisas, para no chocar con el límite de Slack
        const rep = await repliesTodas(r.ts);
        msgs = (rep.messages || []).filter((m) => !m.subtype || m.subtype === "bot_message" || m.subtype === "thread_broadcast");
        cacheReplies.set(r.ts, { latest: r.latest_reply, msgs, visto: Date.now() });
      }
    }
    let antes = null, prev = null;
    for (const m of msgs) {
      const t = tsMs(m.ts), d = dias[diaDe(t)], q = quien(m);
      // v72: tiempos de respuesta (IA tras un mensaje tuyo; tú tras uno de una IA) y quién menciona a quién
      if (d && prev && prev.q !== q && t - prev.t < 12 * 3600e3) {
        const min = Math.round((t - prev.t) / 6000) / 10;
        if (prev.q === "Humano" && IAS.includes(q)) (d.respIA = d.respIA || []).length < 300 && d.respIA.push(min);
        if (IAS.includes(prev.q) && q === "Humano") (d.respTu = d.respTu || []).length < 300 && d.respTu.push(min);
      }
      if (d && (q === "Humano" || IAS.includes(q))) {
        const a = new Set([...menciones(m.text), ...[...(m.text || "").matchAll(/@(Coo|Claude|Cursor|Humano)\b/gi)].map((x) => x[1][0].toUpperCase() + x[1].slice(1).toLowerCase())]);
        for (const to of a) if (to !== q && (to === "Humano" || IAS.includes(to))) { d.menc = d.menc || {}; d.menc[q + ">" + to] = (d.menc[q + ">" + to] || 0) + 1; }
      }
      if (q === "Humano" || IAS.includes(q)) prev = { q, t };
      if (!d) { antes = q; continue; }
      if (q in d.msgs) d.msgs[q]++;
      const h = new Date(t).getHours(); d.horas[h]++;
      const pt = d.porTema[temaDeHilo[r.ts]] = d.porTema[temaDeHilo[r.ts]] || { msgs: 0, vueltas: 0, lanz: 0 };
      pt.msgs++; if (antes && antes !== q) pt.vueltas++; antes = q;
      if (q === "Humano") { const hf = h + new Date(t).getMinutes() / 60; d.jIni = d.jIni === null ? hf : Math.min(d.jIni, hf); d.jFin = d.jFin === null ? hf : Math.max(d.jFin, hf); }
    }
  }
  for (const d of Object.values(dias)) { d.lanz = {}; d.frenos = 0; }
  for (const l of lineas(path.join(HOME, ".canal-lanzamientos.log"), 20000)) {
    const [s, q, hilo] = l.split(/\s+/), t = +s * 1000, d = dias[diaDe(t)]; if (!d || !q) continue;
    d.lanz[q] = (d.lanz[q] || 0) + 1;
    const tema = temaDeHilo[hilo]; if (tema) { const pt = d.porTema[tema] = d.porTema[tema] || { msgs: 0, vueltas: 0, lanz: 0 }; pt.lanz++; }
  }
  for (const l of lineas(path.join(LOGS, "freno.log"), 5000)) { const m = l.match(/^(\S+) FRENO/); if (m) { const d = dias[diaDe(ms(m[1]))]; if (d) d.frenos++; } }
  return Object.entries(dias).map(([dia, v]) => ({ dia, ...v }));
}
// ---------- historial (v42): un resumen por día que se guarda y crece (para rachas y logros) ----------
const HISTORIAL = path.join(HOME, ".oficina", "historial.json");
// v63: si el fichero existe pero no se puede leer, se guarda una copia y NO se sobrescribe (se perdería la historia)
let historialRoto = false;
let historial = (() => {
  if (!fs.existsSync(HISTORIAL)) return {};
  try { return JSON.parse(fs.readFileSync(HISTORIAL, "utf8")); }
  catch (e) { historialRoto = true; try { fs.copyFileSync(HISTORIAL, HISTORIAL + ".roto-" + Date.now()); } catch (e2) {} errores.historial = "historial.json ilegible: no se sobrescribe (copia .roto guardada)"; return {}; }
})();
function guardaHistorial() {
  if (historialRoto) return;
  try {
    const dias = Object.keys(historial).sort(); for (const d of dias.slice(0, Math.max(0, dias.length - 400))) delete historial[d];
    fs.mkdirSync(path.dirname(HISTORIAL), { recursive: true }); fs.writeFileSync(HISTORIAL + ".tmp", JSON.stringify(historial)); fs.renameSync(HISTORIAL + ".tmp", HISTORIAL);
  } catch (e) { errores.historial = limpiaErr(e.message); }
}
function historialDeSemana(sem) {
  for (const d of sem) historial[d.dia] = { ...(historial[d.dia] || {}), temas: d.temas, msgs: d.msgs, horas: d.horas, porTema: d.porTema, lanz: d.lanz, frenos: d.frenos, jIni: d.jIni, jFin: d.jFin,
    respIA: d.respIA || [], respTu: d.respTu || [], menc: d.menc || {} };
  guardaHistorial();
}
// lo de hoy que solo se ve en directo: cuántos temas se cerraron y cuántas cosas te esperaban al final del día
let ultHoyGuardado = 0;
function historialDeHoy(a) {
  const hoy = diaDe(Date.now()), ini = new Date(); ini.setHours(0, 0, 0, 0);
  const h = historial[hoy] = historial[hoy] || {};
  h.cerrados = a.hilos.filter((x) => x.estado === "cerrado" && x.desde >= ini.getTime()).length;
  h.esperaFin = a.hilos.filter((x) => x.estado === "humano").length + a.deTi.filter((d) => d.tipo !== "hilo").length;
  h.esperaMax = Math.max(h.esperaMax || 0, h.esperaFin);
  if (Date.now() - ultHoyGuardado > 5 * MIN) { ultHoyGuardado = Date.now(); guardaHistorial(); }
}
function quizaSemana() {
  if (semanaEnCurso || Date.now() - semanaT < 30 * MIN) return;
  semanaEnCurso = true;
  leerSemana().then((x) => { semana = x; semanaT = Date.now(); delete errores.semana; historialDeSemana(x); if (estado.listo) { estado.semana = semana; estado.historial = historial; } })
    .catch((e) => { errores.semana = limpiaErr(e.message); semanaT = Date.now() - 25 * MIN; })   // reintenta en 5 min
    .finally(() => { semanaEnCurso = false; });
}

const CONSUMO_F = path.join(HOME, ".oficina", "consumo.json");
let consumo = (() => { try { return JSON.parse(fs.readFileSync(CONSUMO_F, "utf8")); } catch (e) { return { archivos: {}, dias: {} }; } })();
if (!consumo.v || consumo.v < 4) consumo = { v: 4, archivos: {}, dias: {}, ses: {} };
let consumoEnCurso = false, consumoT = 0, vistosMsg = new Set();
const esCanal = (dir) => /oca-salesforce|wt-canal|wt-[\w-]+-claude$|Oca-Global/i.test(dir);
const esTrabajo = (dir) => /oca-salesforce|Oca-Global|^[A-Z]--oca-sf$|--claude-relevo(--claude-worktrees-[\w-]+)?$|wt-canal|wt-[\w-]+-claude$/i.test(dir) || dir.toLowerCase().startsWith(CONF.edificio.proyectoClaude.toLowerCase());
async function leerConsumo({ base = path.join(HOME, ".claude", "projects"), fichero = CONSUMO_F } = {}) {
  const limite = Date.now() - 9 * 86400e3;
  let dirs = []; try { dirs = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && esTrabajo(d.name)).map((d) => d.name); } catch (e) { return; }
  for (const dir of dirs) {
    let fs_ = []; try { fs_ = fs.readdirSync(path.join(base, dir)).filter((f) => f.endsWith(".jsonl")); } catch (e) { continue; }
    for (const f of fs_) {
      const ruta = path.join(base, dir, f); let st; try { st = fs.statSync(ruta); } catch (e) { continue; }
      if (st.mtimeMs < limite) continue;
      const prev = consumo.archivos[ruta] || { off: 0 }; let off = st.size < prev.off ? 0 : prev.off;
      if (st.size === off) continue;
      // se lee por trozos desde la última posición; la línea a medias se deja para la próxima vez
      const fd = fs.openSync(ruta, "r"); let resto = "";
      try {
        const buf = Buffer.alloc(4 * 1024 * 1024);
        while (off < st.size) {
          const n = fs.readSync(fd, buf, 0, Math.min(buf.length, st.size - off), off); if (!n) break;
          const txt = resto + buf.toString("utf8", 0, n); const corte = txt.lastIndexOf("\n");
          const lineas = corte >= 0 ? txt.slice(0, corte).split("\n") : []; resto = corte >= 0 ? txt.slice(corte + 1) : txt;
          off += n;
          for (const l of lineas) {
            if (l.indexOf('"usage"') < 0) continue;
            let j; try { j = JSON.parse(l); } catch (e) { continue; }
            const m = j.message; if (!m || !m.usage || !m.id || vistosMsg.has(m.id)) continue;
            vistosMsg.add(m.id); if (vistosMsg.size > 50000) vistosMsg = new Set();
            const t = Date.parse(j.timestamp || ""); if (!t || t < limite) continue;
            const u = m.usage, d = consumo.dias[diaDe(t)] = consumo.dias[diaDe(t)] || { canal: { nuevos: 0, cache: 0, msgs: 0 }, tu: { nuevos: 0, cache: 0, msgs: 0 } };
            const lado = esCanal(dir) ? d.canal : d.tu;
            lado.nuevos += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
            lado.cache += u.cache_read_input_tokens || 0; lado.msgs++;
            // v91: desglose por sesión (el nombre del fichero es el id de la sesión)
            const sid = f.slice(0, -6), dk = diaDe(t), sd = (consumo.ses[dk] = consumo.ses[dk] || {});
            const x = (sd[sid] = sd[sid] || { dir, inp: 0, cw: 0, cr: 0, out: 0, n: 0, ini: t, fin: t, mod: "" });
            x.inp += u.input_tokens || 0; x.cw += u.cache_creation_input_tokens || 0; x.cr += u.cache_read_input_tokens || 0;
            x.out += u.output_tokens || 0; x.n++; if (t < x.ini) x.ini = t; if (t > x.fin) x.fin = t;
            if (m.model && m.model !== "<synthetic>") x.mod = m.model;
            if (j.entrypoint) x.ep = j.entrypoint;
          }
          await new Promise((ok) => setImmediate(ok));   // no bloquear el servidor con ficheros grandes
        }
        off -= Buffer.byteLength(resto, "utf8");
      } finally { fs.closeSync(fd); }
      consumo.archivos[ruta] = { off };
    }
  }
  // limpieza: fuera días de más de 30 días y ficheros que ya no existen
  for (const k of Object.keys(consumo.dias)) if (Date.parse(k) < Date.now() - 30 * 86400e3) delete consumo.dias[k];
  for (const k of Object.keys(consumo.ses || {})) if (Date.parse(k) < Date.now() - 8 * 86400e3) delete consumo.ses[k];
  for (const k of Object.keys(consumo.archivos)) if (!fs.existsSync(k)) delete consumo.archivos[k];
  try { fs.mkdirSync(path.dirname(fichero), { recursive: true }); fs.writeFileSync(fichero + ".tmp", JSON.stringify(consumo)); fs.renameSync(fichero + ".tmp", fichero); } catch (e) {}
}
let gastoCache = { t: 0, v: null };
function gastoSesionesCada(ahora = Date.now(), calcula = gastoSesiones) {
  if (!gastoCache.v || ahora - gastoCache.t > 5 * MIN) gastoCache = { t: ahora, v: calcula() };
  return gastoCache.v;
}
// v514: un canal git solo se da por caído si lleva más de 5 min sin leerse bien (o, sin ninguna lectura buena, 5 min desde arrancar)
const gitBienT = {};
const avisoGit = (bienT, ahora = Date.now(), desde = 0) => ahora - (bienT || desde || 0) > 5 * MIN;
function gastoSesiones(logs = LOGS) {
  const mapa = {}; const SD = path.join(logs, "sesiones-slack");
  try { for (const f of fs.readdirSync(SD)) { try { const sid = fs.readFileSync(path.join(SD, f), "utf8").trim(); const m = f.match(/^([A-Z0-9]+)-(\d+\.\d+)$/); if (sid && m) mapa[sid] = { canal: m[1], hilo: m[2] }; } catch (e) {} } } catch (e) {}
  for (const l of lineas(path.join(logs, "sesiones-slack.log"), 5000)) {
    const m = l.match(/hilo ([\d.]+) .*?(?:--session-id|--resume|vieja=)\s*([0-9a-f-]{36})/); if (m && !mapa[m[2]]) mapa[m[2]] = { canal: CH, hilo: m[1] };
  }
  const equiv = (x) => x.inp + 1.25 * x.cw + 0.1 * x.cr + 5 * x.out;
  const hoyK = diaDe(Date.now()), dias = Object.keys(consumo.ses || {}).filter((k) => Date.parse(k) >= Date.now() - 7 * 86400e3);
  const junta = (ks) => { const r = {};
    for (const k of ks) for (const [sid, x] of Object.entries((consumo.ses || {})[k] || {})) {
      if (!esTrabajo(x.dir || "")) continue;   // v166: por si acaso, nada de fuera de la lista blanca
      const y = (r[sid] = r[sid] || { sid, dir: x.dir, inp: 0, cw: 0, cr: 0, out: 0, n: 0, ini: x.ini, fin: x.fin, mod: x.mod, ep: x.ep });
      y.inp += x.inp; y.cw += x.cw; y.cr += x.cr; y.out += x.out; y.n += x.n; y.ini = Math.min(y.ini, x.ini); y.fin = Math.max(y.fin, x.fin); if (x.mod) y.mod = x.mod; }
    const lista = Object.values(r).map((y) => { const sl = mapa[y.sid];
      return { ...y, equiv: Math.round(equiv(y)), ctx: y.n ? Math.round((y.inp + y.cw + y.cr) / y.n) : 0,
        tipo: sl ? "slack" : esCanal(y.dir) && y.ep !== "claude-desktop" ? "canal" : "tu", hilo: sl ? sl.hilo : null,
        nombre: y.dir.replace(/^C--Users-[^-]+-/, "").replace(/^AppData-Local-Claude-Data-.*scratch-.*$/, "chat sin carpeta").replace(/^[A-Z]--/, "").replace(/-/g, " ") }; });
    const total = lista.reduce((a, b) => a + b.equiv, 0), porTipo = { slack: 0, canal: 0, tu: 0 };
    for (const y of lista) porTipo[y.tipo] += y.equiv;
    return { total, porTipo, top: lista.sort((a, b) => b.equiv - a.equiv).slice(0, 12) }; };
  return { hoy: junta([hoyK]), semana: junta(dias) };
}
function quizaConsumo() {
  if (consumoEnCurso || Date.now() - consumoT < 5 * MIN) return;
  consumoEnCurso = true;
  leerConsumo().then(() => { consumoT = Date.now(); delete errores.consumo; if (estado.listo) estado.consumo = consumo.dias; })
    .catch((e) => { errores.consumo = limpiaErr(e.message); consumoT = Date.now(); }).finally(() => { consumoEnCurso = false; });
}

// ---------- bucle ----------
let estado = { listo: false };
let ultimo = { slack: [], cursor: null, git: [], procesos: null };
let vuelta = 0, gitEnCurso = false;
let gitListo = false; const arranque = Date.now();
const tArranque = {};
const canalDia = { dia: "", shas: "", cuenta: null, entre: null, enCurso: false };
const IAS_C = ["Coo", "Claude", "Cursor"];
const iaDe = (s) => { const m = String(s || "").match(/\b(Coo|Claude|Cursor)\b/i); return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : ""; };
async function cuentaCanalDia(ejecuta = run, repo = REPO, canales = CANALES, ahora = Date.now()) {
  const d = new Date(ahora); d.setHours(0, 0, 0, 0);
  const r = {}, bloques = [];
  for (const c of canales) {
    const g = await ejecuta("git", ["-C", repo, "log", "--reverse", "--since=" + d.toISOString(), "-p", "--format=@@C %H %ct", "refs/remotes/origin/" + c.rama, "--", c.fichero], { timeout: 60e3 });
    if (!g.ok) return null;
    for (const parte of String(g.out).split(/^@@C /m).slice(1)) {
      const [sha, ct] = parte.split("\n")[0].split(" ");
      const add = parte.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).map((l) => l.slice(1)).join("\n");
      for (const b of canal.leer(add)) {
        const de = IAS_C.includes(b.de) ? b.de : iaDe(b.tit);
        if (!IAS_C.includes(de)) continue;
        r[de] = (r[de] || 0) + 1;
        bloques.push({ canal: c.nombre, sha: String(sha || "").slice(0, 10), t: +ct * 1000, de, id: b.id || "", tit: String(b.tit || "").slice(0, 160),
          pide: [...new Set((b.pideIA || []).map((x) => iaDe(typeof x === "string" ? x : x.ia || x.quien || "")))].filter((x) => x && x !== de),
          etiquetas: b.etiquetas || [], txt: [b.tit, String(b.cuerpo || "").slice(0, 2000), b.respondeA].join("\n"),
          respondeA: String(b.respondeA || ""), ...(b.retenido ? { retenido: true } : {}) });   // v401
      }
    }
  }
  const actuales = [];
  for (const c of canales) {
    const cur = await ejecuta("git", ["-C", repo, "show", `refs/remotes/origin/${c.rama}:${c.fichero}`], { timeout: 60e3 });
    if (!cur || !cur.ok) continue;
    actuales.push({ canal: c.nombre, todos: canal.leerLista(canal.partir(String(cur.out || "").replace(/\r/g, "")).slice(-150))
      .map((x) => ({ id: x.id, tit: String(x.tit || "").slice(0, 160), faltan: x.faltan, retenido: x.retenido || null })) });
  }
  return { cuenta: r, entre: vivasEntre(entreIAs(bloques, ahora), actuales) };
}
const NO_TEMA = /^(COO|CLAUDE|CURSOR|GROK|CRIBA|OCA|SLACK|CANAL|CRUCE|ACUSE|COORD|COORDINACION|RESPUESTA|ENCARGO|VOTO|VOTOS|FINAL|START|NOTA|HUMANO|INFO|PARA|FASE|PARTE|\d+)$/;
function temasDe(b) {
  const s = new Set(), pon = (p) => { p = String(p || "").toUpperCase(); if (p.length >= 4 && !NO_TEMA.test(p)) s.add(p); };
  for (const e of b.etiquetas || []) { pon(e); String(e).split(/[^A-Za-z0-9-]+/).forEach(pon); }
  for (const m of String(b.tit + " " + b.id).matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)) pon(m[0]);
  String(b.id || "").split("-").forEach(pon);
  for (const m of String(b.tit || "").matchAll(/\[([^\]]+)\]/g)) m[1].split(/[^A-Za-z0-9-]+/).forEach(pon);
  return s;
}
function vivasEntre(entre, git) {
  if (!entre || !Array.isArray(entre.pendientes)) return entre;
  const todos = (git || []).flatMap((g) => (g.todos || []).map((b) => ({ ...b, canal: g.canal })));
  const pendientes = entre.pendientes.filter((p) => {
    const b = todos.find((x) => x.canal === p.canal && ((p.id && x.id === p.id) || x.tit === p.tit));
    return !b || (!b.retenido && (b.faltan || []).includes(p.a));   // (si es más viejo que los que lee la oficina, como antes)
  });
  return { ...entre, pendientes };
}
function entreIAs(bloques, ahora = Date.now()) {
  const dir = {}, pend = [];
  bloques.sort((a, b) => a.t - b.t);
  for (const b of bloques) b.temas = temasDe(b);
  for (const [i, b] of bloques.entries()) for (const a of b.pide) {
    const k = `${b.de}>${a}`; const x = (dir[k] = dir[k] || { de: b.de, a, n: 0, ok: 0, lat: [] }); x.n++;
    const r = bloques.slice(i + 1).find((y) => y.de === a && y.t - b.t < 4 * 3600e3 && (
      [...b.temas].some((t) => y.temas.has(t) || String(y.tit).toUpperCase().includes(t))
      || (b.id.length > 2 && y.txt.includes(b.id)) || (b.sha && y.txt.includes(b.sha))
      || String(b.respondeA || "").split(/\s*[,;]\s*/).filter((k) => k.length >= 4).some((k) => canal.citaId(y.respondeA || "", k))   // v401: misma cadena
      || (y.t - b.t < 30 * MIN && new RegExp(`respuesta a ${b.de}\\b`, "i").test(y.tit))));
    if (r) { x.ok++; x.lat.push(r.t - b.t); }
    else if (ahora - b.t < 2 * 3600e3 && !b.retenido) pend.push({ de: b.de, a, tit: b.tit, t: b.t, canal: b.canal, id: b.id });
  }
  const matriz = Object.values(dir).map(({ lat, ...x }) => { lat.sort((p, q) => p - q); return { ...x, mediana: lat.length ? Math.round(lat[Math.floor(lat.length / 2)] / MIN) : null }; })
    .sort((p, q) => q.n - p.n);
  return { matriz, pendientes: pend.sort((p, q) => p.t - q.t), t: ahora };
}
const canalHoy = (g, ahora = Date.now()) => { const d = new Date(ahora); d.setHours(0, 0, 0, 0); const r = {};
  for (const c of g || []) for (const b of c.todos || c.bloques || []) if (b.t >= d.getTime() && ["Coo", "Claude", "Cursor"].includes(b.de)) r[b.de] = (r[b.de] || 0) + 1;
  return r; };
const sinTodos = (g) => (g || []).map(({ todos, ...r }) => ({ ...r, bloques: r.bloques.map(({ cuerpo, ...b }) => b) }));
async function refrescar() {
  await null;
  vuelta++;
  // v565: cada fuente, de una en una y con su tope de espera (leeFuente); al arrancar (sin datos de antes) se espera lo que tarde
  const tope = (n) => (estado.listo && !estado.heredado ? ESPERA_FUENTE[n] : 0);   // (v566: con el estado heredado de un estreno, como al arrancar)
  const tareas = [
    leeFuente("slack", leerSlack, (x) => { ultimo.slack = x; delete errores.slack; tArranque.slack = tArranque.slack || Date.now(); }, (e) => { errores.slack = limpiaErr(e.message); }, tope("slack")),
  ];
  // v63: si una fuente falla, no se sigue enseñando su último dato como si fuera de ahora
  // v244: los procesos solo cuando hacen falta (ver hacenFaltaProcesos)
  if (hacenFaltaProcesos(Date.now() - ultimaVista < 3 * MIN, conTurno(), (estado.relanzar || []).length > 0, Date.now() - procesosT))
    tareas.push(leeFuente("procesos", leerProcesos, (x) => { ultimo.procesos = x; procesosT = Date.now(); delete errores.procesos; }, (e) => { errores.procesos = limpiaErr(e.message); ultimo.procesos = null; }, tope("procesos")));
  // con cursor-apagado ni se lee, ni se apunta como lectura (rendimiento.fuentes), ni cuenta como fallo
  if (vuelta % 2 === 1 && !cursorApagado()) tareas.push(leeFuente("cursor", leerCursor, (x) => trasCursor(x, null), (e) => trasCursor(null, e), tope("cursor")));
  if ((vuelta % 4 === 1 || gitYa || enMovimiento()) && !gitEnCurso) {
    gitYa = false; gitEnCurso = true;
    leerGit().then((x) => { ultimo.git = x; gitListo = true; delete errores.git; tArranque.git = tArranque.git || Date.now(); if (estado.listo && !estado.heredado) estado.git = sinTodos(x); else setTimeout(() => { tic(true).catch(() => {}); }, 0); }).catch((e) => { errores.git = limpiaErr(e.message); })
      .finally(() => { gitEnCurso = false; });
  }
  rend.fase = "leer Slack y procesos";   // v503
  await Promise.all(tareas);
  rend.fase = "semana y consumo"; quizaSemana(); quizaConsumo();
  if (!gitListo && Date.now() - arranque < 90e3) return;
  if (!gitListo && !errores.git) errores.git = "aún sin leer (el equipo va lento): lo de las IAs puede no estar al día y no despierto a nadie hasta leerlo";
  rend.fase = "precargar logs"; await precargaLogs().catch(() => {});   // v515: sin bloquear
  rend.fase = "logs y avisos";
  const L = leerLogs(); L.arrancando = arrancando;   // v506
  L.respEsperas = respEsperas;   // v550: lo que te escribió por privado de Slack la persona a la que se espera
  // v202: el token de Claude, en los avisos de la oficina (con lo que hay que hacer) en cuanto el último Claude no pudo entrar
  const au = authClaude();
  if (au) errores.claude = `Claude no puede entrar desde las ${hhmm(au.t)} (token no válido): genera uno nuevo con «claude setup-token» y cámbialo en ~/.config/canal-slack.env (CLAUDE_CODE_OAUTH_TOKEN)`;
  else delete errores.claude;
  // v204: la escucha viva pero DESCONECTADA de Slack (solo importa en el equipo con el turno: en el otro debe estar en espera)
  if (L.conexion && L.conexion.estado === "caida" && conTurno())
    errores.escucha = `La escucha de Slack está viva pero desconectada desde las ${hhmm(L.conexion.desde)} («${L.conexion.linea}»): tus mensajes no despiertan a nadie. ` +
      (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRE|ETIMEDOUT|network|timeout/i.test(L.conexion.linea || "")   // v254: sin red no es el token
        ? "Parece la red: mira la conexión o la VPN de este equipo (vuelve sola al volver la red)"
        : "Reinicia la tarea «Canal IAs - escucha Slack»; si sigue, mira SLACK_APP_TOKEN en canal-slack.env");
  else delete errores.escucha;
  // v210: la escucha muerta del todo se vuelve a arrancar (tope 3 por hora; luego, aviso)
  const ve = vigilaEscucha(vigilaEsc.pid ? L.escLineas : lineas(path.join(LOGS, "escucha-slack.log"), 3000), vigilaEsc, {   // v226: las 200 de leerLogs
    arrancar: (pid) => run("schtasks", ["/run", "/tn", TAREA_ESCUCHA], { timeout: 30e3 })
      .then((r) => anota(`la escucha no vivía (pid ${pid}): arranco su tarea → ${r.ok ? "ok" : limpiaErr(r.err).trim().slice(0, 120)}`)) });
  if (ve.que === "tope") errores.escuchaParada = `La escucha de Slack se ha parado ${ve.n} veces en la última hora y no se queda en marcha: tus mensajes no despiertan a nadie. Mira el final de ~/.canal-logs/escucha-slack.log`;
  else if (ve.que === "viva") delete errores.escuchaParada;
  // v393: el conteo del día en el canal git (todos los bloques de hoy), cuando cambia algún canal o cambia el día
  { const shasHoy = Object.values(gitCache.sha || {}).join(","), diaHoy = new Date().toDateString();
    if (gitListo && !canalDia.enCurso && (canalDia.shas !== shasHoy || canalDia.dia !== diaHoy)) { canalDia.enCurso = true;
      cuentaCanalDia().then((r) => { if (r) Object.assign(canalDia, { cuenta: r.cuenta, entre: r.entre, shas: shasHoy, dia: diaHoy }); }).catch(() => {}).finally(() => { canalDia.enCurso = false; }); } }
  const arrEsc = (() => { for (let i = (L.escLineas || []).length - 1; i >= 0; i--) { const m = L.escLineas[i].match(/^(\S+) arranco \(pid/); if (m) return ms(m[1]); } return 0; })();
  upd.arrEsc = arrEsc;
  if (Date.now() - codigo.comprobado > 3 * MIN && !codigo.enCurso) { codigo.comprobado = Date.now(); codigo.enCurso = true;
    repasaCodigo().catch(() => {}).finally(() => { codigo.enCurso = false; }); }
  const ac = upd.cfg.actualizar === "manual" || (upd.mem.malo && upd.mem.malo.sha && upd.mem.malo.sha === codigo.remotoSha) ? null : avisoCodigo(codigo, Date.now(), [{ que: "la oficina", cambio: cambioOficina(arranque), arranque }, { que: "la escucha", cambio: Math.max(...DEP_ESCUCHA.map(mtimeDe)), arranque: arrEsc }])
  if (ac) errores.codigo = ac; else delete errores.codigo;
  // v278: Claudes de hilo que llevan 90 min sin avanzar
  const colg = claudesColgados(ultimo.procesos, L.sesionHilo);
  if (colg.length) { const c = colg[0]; errores.colgado = `Un Claude lleva más de 90 min sin avanzar en el hilo ${c.hilo || "?"} (pid ${c.pid}; lo último que escribió, a las ${hhmm(c.ult)}): puede estar colgado esperando algo. Si no esperas nada de él, ciérralo (Stop-Process -Id ${c.pid}) y escribe «sigue» en el hilo${colg.length > 1 ? ` (y ${colg.length - 1} más)` : ""}`; }
  else delete errores.colgado;
  // v274: respuestas para ti que no salieron a Slack (responder-slack.sh las apunta tras 3 intentos)
  const nos = noEnviadas(lineas(path.join(LOGS, "slack-no-enviado.log"), 50));
  if (nos.length) errores.respuesta = `${nos.length === 1 ? "Una respuesta" : nos.length + " respuestas"} de Claude para ti no ${nos.length === 1 ? "se pudo" : "se pudieron"} publicar en Slack (la última a las ${hhmm(nos[nos.length - 1].t)}, hilo ${nos[nos.length - 1].hilo}: «${nos[nos.length - 1].err}»). El texto está en ${nos[nos.length - 1].f}; escribe «sigue» en el hilo para que lo intente otra vez`;
  else delete errores.respuesta;
  // v258: worktrees del canal con cambios a medias (cada 10 min)
  if (Date.now() - suciosT > 10 * MIN) { suciosT = Date.now(); miraWorktrees().catch(() => {}); }
  const sz = avisoSucio(sucios); if (sz) errores.canal = sz; else delete errores.canal;
  // v230: ¿quién vigila al vigía? La oficina: si su latido (vigia-canal.ultimo, cada 15 min a cualquier hora) tiene más de 45 min,
  // aviso y una pasada a mano (como mucho una por hora). Sin el fichero (equipo sin vigía), nada.
  const vp = vigiaParado(leer(path.join(LOGS, "vigia-canal.ultimo")));
  if (vp) {
    errores.vigia = `El vigía no pasa desde las ${hhmm(vp)}: nadie despierta a quien piden en el canal git ni vigila la oficina. Mira la tarea «${TAREA_VIGIA}» en el Programador de tareas (debe repetirse cada 15 min)`;
    if (Date.now() - vigiaRun > 60 * MIN) { vigiaRun = Date.now(); run("schtasks", ["/run", "/tn", TAREA_VIGIA], { timeout: 30e3 }).then((r) => anota(`el vigía no pasaba desde las ${hhmm(vp)}: lanzo una pasada → ${r.ok ? "ok" : limpiaErr(r.err).trim().slice(0, 120)}`)); }
  } else delete errores.vigia;
  // v208: el equipo con el turno late mientras su escucha no esté caída; si no late, en el otro equipo se avisa
  escuchaCaida = !!(L.conexion && L.conexion.estado === "caida");
  const hu = turnoHuerfano(turno);
  if (hu) errores.turno = `«${hu.de}» tiene el turno pero no da señales desde las ${hhmm(hu.desde)} (apagado, sin red o con la escucha caída): nadie atiende Slack y tus mensajes no despiertan a nadie. Si ese equipo no está en marcha, haz doble clic en «Atender desde aquí.cmd» en este equipo`;
  else delete errores.turno;
  try {
    rend.fase = "analizar";
    const a = analizar([...(ultimo.slack || []), ...slackViejos.map((h) => ({ ...h, viejo: true }))], L, ultimo.procesos, ultimo.cursor, ultimo.git);   // v540
    rend.fase = "después de analizar";
    // v174: [lo hace: X] sin señal de arranque → se relanza una vez (solo con turno; necesita también los procesos leídos,
    // para no relanzar a un Claude que ya trabaja en el hilo)
    // v212: un mensaje de Humano solo si llegó con este equipo ya atendiendo (desde que arrancó y con el turno): si lo escribió
    // cuando el turno era del otro, lo atendió su escucha y aquí no consta (sus logs son de allí)
    // v222: TODO relanzo (los [lo hace: X] de v174 y tus mensajes de v212), solo de lo escrito con este equipo ya atendiendo
    // (con turno; sin turno configurado, todo). Lo de antes lo atendió la escucha del otro equipo y aquí no consta: se duplicaba.
    const desdeAqui = turno.equipo ? (turno.desde || Date.now()) : 0;
    const rel = (a.relanzar || []).filter((r) => r.proceso || tsMs(r.ts) > desdeAqui);   // v402: el vigilante de un proceso, también si la espera se dejó antes del turno
    // (v244: y con los procesos leídos hace menos de 90 s: si no, la vuelta siguiente los lee, porque hay algo que relanzar)
    if (gitListo && conTurno() && ultimo.procesos && Date.now() - procesosT < 90e3 && rel.length) relanzaPendientes(rel);   // (v469: con el canal leído)
    if (gitListo) try { llevaASlack(a.hilos); } catch (e) { anota(`pedido 13: ${limpiaErr(e.message)}`); }   // v500 (v469: con el canal leído)
    try { escribeRelacionados(a.hilos); } catch (e) {}   // v512: los otros hilos del mismo tema, para las IAs
    historialDeHoy(a);
    // v56: la línea de tiempo de hoy: cada mensaje con su hora, quién, de qué tema y el principio del texto
    const ini = new Date(); ini.setHours(0, 0, 0, 0);
    a.linea = [];
    for (const h of ultimo.slack || []) {
      const raiz = h.msgs[0] || {}, tit = tituloHilo(raiz.texto || ""), tema = temaDe(tit, textoPlano(raiz.texto || ""));
      for (const m of h.msgs) { const t = tsMs(m.ts); if (t >= ini.getTime() && m.quien !== "Sistema") a.linea.push({ t, quien: m.quien, tema, hilo: h.ts, texto: textoPlano(m.texto).replace(/\s+/g, " ").slice(0, 90) }); }
    }
    a.linea.sort((x, y) => x.t - y.t); a.linea = a.linea.slice(-600);
    if (!estado.listo || estado.heredado) { const s = (t) => t ? Math.round((t - arranque) / 100) / 10 + " s" : "—";   // v280: cuánto tarda en arrancar (v566: o en dejar de enseñar lo heredado)
      anota(`arranque: lista en ${s(Date.now())} (Slack a los ${s(tArranque.slack)}, canal git a los ${s(tArranque.git)}, vuelta ${vuelta})`); }
    delete errores.analisis;   // v565: analizado bien: fuera el aviso (antes, un fallo suelto de analizar se quedaba pintado hasta reiniciar)
    if (DIARIO) DIARIO.errores(errores);
    estado = { listo: true, t: Date.now(), ...a, git: sinTodos(ultimo.git), errores: { ...errores }, alDia: codigo.alDia || null,
      canalHoy: canalDia.cuenta || canalHoy(ultimo.git), entreIAs: vivasEntre(canalDia.entre, ultimo.git),
      escucha: { viva: ultimo.procesos ? ultimo.procesos.escucha : null, ultLog: L.ultEsc, conexion: L.conexion },
      freno: { ultimaHora: L.lanz.length, max: 40,
        proximo: L.lanz.length ? Math.max(0, Math.min(...L.lanz.map((x) => x.t)) + 60 * MIN - Date.now()) : 0,
        porQuien: L.lanz.reduce((a, x) => { a[x.quien] = (a[x.quien] || 0) + 1; return a; }, {}) },
      envio: { directo: !!tokenHumano(), k: CLAVE }, turno: { ...turno }, semana, historial, consumo: consumo.dias, gastoSes: gastoSesionesCada(),
      cursorApagado: cursorApagado(),   // true = herramientas/cursor-apagado puesto: la oficina no llama a la API de Cursor
      coordinadores: coordinadores(),
      diarioOtro: diarioOtro(),
      coordinacion: COORD.coordinacion(),
      reuniones: typeof reuniones === "undefined" ? null : reuniones, casa: HOME,
      version: (() => { try { return fs.statSync(path.join(__dirname, "public", "index.html")).mtimeMs; } catch (e) { return 0; } })(),
      update: estadoUpdate(),
      rendimiento: resumenRendimiento(rend) };
    if (!paraCoord.enCurso && COORD.haySF()) { paraCoord.enCurso = true;
      COORD.quizaParaCoord(estado.hilos, CH, paraCoord, { listo: gitListo && Date.now() - arranque >= 60e3, anotar: anota }).catch(() => {}).finally(() => { paraCoord.enCurso = false; }); }
    avisaOyentes(estado.t);   // v506: la página se entera ya
  } catch (e) { errores.analisis = limpiaErr(e.stack || e.message); estado.errores = { ...errores }; if (DIARIO) DIARIO.errores(errores); }
  rend.fase = ""; sueltaPrecarga();   // v515
}
const rend = { lags: [], cpu: [], vueltas: [], fase: "", avisado: 0, lentos: [], avisoLento: 0, pasos: [], avisoSuelta: 0 };
// v565: lo que tardó cada lectura de una fuente (leeFuente) y si la vuelta tuvo que soltarla; una suelta se apunta en el log (como
// mucho cada 30 min) con su nombre
function notaPaso(paso, ms, suelta, r = rend, ahora = Date.now()) {
  r.pasos = r.pasos || []; r.pasos.push({ t: ahora, paso, ms, ...(suelta ? { suelta: true } : {}) }); if (r.pasos.length > 300) r.pasos.splice(0, r.pasos.length - 300);
  if (suelta && ahora - (r.avisoSuelta || 0) > 30 * MIN) { r.avisoSuelta = ahora; anota(`rendimiento: leer ${paso} tardó ${(ms / 1000).toFixed(1)} s: la vuelta siguió sin esperarlo, con lo último leído`); }
}
// de los últimos 5 min, por fuente: { slack: { n, mediana, max, sueltas }, … } (null sin lecturas)
function resumenFuentes(r, desde) {
  const o = {};
  for (const x of r.pasos || []) { if (!(x.t > desde)) continue; (o[x.paso] = o[x.paso] || []).push(x); }
  for (const k of Object.keys(o)) { const v = o[k].map((x) => x.ms).sort((a, b) => a - b); o[k] = { n: v.length, mediana: v[Math.floor(v.length / 2)], max: v[v.length - 1], sueltas: o[k].filter((x) => x.suelta).length }; }
  return Object.keys(o).length ? o : null;
}
function resumenRendimiento(r, ahora = Date.now()) {
  const desde = ahora - 5 * MIN;
  const lags = r.lags.filter((x) => x.t > desde), cpu = r.cpu.filter((x) => x.t > desde);
  const v = r.vueltas.slice(-20).map((x) => x.ms).sort((a, b) => a - b);
  const peor = lags.reduce((a, x) => (!a || x.ms > a.ms ? x : a), null);
  const lento = (r.lentos || []).filter((x) => x.t > desde).reduce((a, x) => (!a || x.ms > a.ms ? x : a), null);   // v517
  return { cpu: cpu.length ? Math.round(cpu.reduce((s, x) => s + x.pct, 0) / cpu.length) : null,
    bloqueoMax: peor ? peor.ms : 0, bloqueoFase: peor ? peor.fase || "fuera de la vuelta" : "", bloqueos: lags.filter((x) => x.ms >= 1000).length,
    vuelta: v.length ? { mediana: v[Math.floor(v.length / 2)], max: v[v.length - 1] } : null, lento: lento ? { que: lento.que, ms: lento.ms } : null,
    fuentes: resumenFuentes(r, desde) };   // v565
}
function notaLento(que, ms, r = rend, ahora = Date.now()) {
  if (!(ms > 300)) return false;
  r.lentos.push({ t: ahora, que, ms }); if (r.lentos.length > 100) r.lentos.splice(0, r.lentos.length - 100);
  if (ms > 2000 && ahora - r.avisoLento > 30 * MIN) { r.avisoLento = ahora; anota(`rendimiento: ${que} tardó ${(ms / 1000).toFixed(1)} s (y mientras, la oficina no contesta)`); }
  return true;
}
const FS_SINCRONO = ["readFileSync", "writeFileSync", "appendFileSync", "statSync", "readdirSync", "openSync", "readSync", "existsSync", "renameSync", "unlinkSync", "mkdirSync"];
function vigilaFsSync(obj = fs, nota = notaLento, nombres = FS_SINCRONO, reloj = Date.now) {
  const hechos = [];
  for (const k of nombres) {
    const orig = obj[k]; if (typeof orig !== "function" || orig.__vigilado) continue;
    const envuelto = function (...a) { const t0 = reloj(); try { return orig.apply(this, a); } finally { const ms = reloj() - t0; if (ms > 300) try { nota(`disco: ${k} ${path.basename(String(typeof a[0] === "number" ? "(fichero abierto)" : a[0] || ""))}`, ms); } catch (e) {} } };
    envuelto.__vigilado = true; obj[k] = envuelto; hechos.push(k);
  }
  return hechos;
}
if (!PRUEBAS) vigilaFsSync();
function anotaRetraso(r, ahora, tarde) {
  if (tarde <= 200) return false;
  // (v517: si en ese rato se arrancó un proceso lento, el bloqueo dice cuál)
  const lento = r.fase ? null : (r.lentos || []).filter((x) => x.t >= ahora - tarde - 200 && x.t <= ahora).sort((a, b) => b.ms - a.ms)[0];
  r.lags.push({ t: ahora, ms: tarde, fase: r.fase || (lento ? `fuera de la vuelta: ${lento.que}` : "") }); if (r.lags.length > 200) r.lags.splice(0, r.lags.length - 200);
  if (tarde > 3000 && ahora - r.avisado > 30 * MIN) { r.avisado = ahora; anota(`rendimiento: la oficina se ha quedado bloqueada ${(tarde / 1000).toFixed(1)} s (${r.lags[r.lags.length - 1].fase || "fuera de la vuelta"})`); }
  return true;
}
alAbrir(() => {
  let esperado = Date.now() + 500;
  setInterval(() => { const ahora = Date.now(); anotaRetraso(rend, ahora, ahora - esperado); esperado = ahora + 500; }, 500).unref();
  let cpu0 = process.cpuUsage(), t0 = Date.now();
  setInterval(() => { const c = process.cpuUsage(cpu0), dt = Date.now() - t0; cpu0 = process.cpuUsage(); t0 = Date.now();
    rend.cpu.push({ t: t0, pct: Math.round((c.user + c.system) / 10 / dt) }); if (rend.cpu.length > 30) rend.cpu.shift(); }, MIN).unref();
});
const ACTIVIDAD = path.join(LOGS, "actividad.json");
const arrancando = (() => { if (PRUEBAS) return {}; try { const x = JSON.parse(fs.readFileSync(ACTIVIDAD, "utf8")); const t = Date.now();
  for (const h of Object.keys(x)) for (const ia of Object.keys(x[h])) if (!x[h][ia] || t - (x[h][ia].fin || x[h][ia].ini || 0) > 2 * 3600e3) delete x[h][ia];
  return x; } catch (e) { return {}; } })();
const guardaActividad = () => { if (PRUEBAS) return; try { fs.writeFileSync(ACTIVIDAD + ".tmp", JSON.stringify(arrancando)); fs.renameSync(ACTIVIDAD + ".tmp", ACTIVIDAD); } catch (e) {} };
function limpiaActividad(t) {
  for (const h of Object.keys(arrancando)) { for (const x of Object.keys(arrancando[h])) { const v = arrancando[h][x]; if (t - (typeof v === "number" ? v : (v.fin || v.ini || 0)) > 2 * 3600e3) delete arrancando[h][x]; }
    if (!Object.keys(arrancando[h]).length) delete arrancando[h]; }
}
function marcaArranque(hilo, ia, t = Date.now(), lanzador = ia !== "Coo") {
  if (!hilo || !["Claude", "Cursor", "Coo"].includes(ia)) return false;
  (arrancando[hilo] = arrancando[hilo] || {})[ia] = { ini: t, fin: 0, rc: 0, lanzador };
  limpiaActividad(t); guardaActividad(); return true;
}
function marcaFin(hilo, ia, rc, t = Date.now()) {
  if (!hilo || !["Claude", "Cursor", "Coo"].includes(ia)) return false;
  const v = ((arrancando[hilo] = arrancando[hilo] || {})[ia]) || { ini: t, lanzador: ia !== "Coo" };
  arrancando[hilo][ia] = { ...(typeof v === "number" ? { ini: v, lanzador: true } : v), fin: t, rc: Number.isFinite(+rc) ? +rc : -1 };
  limpiaActividad(t); guardaActividad(); return true;
}
let ultToque = 0, toqueEnCola = null, otraVuelta = false, gitYa = false;   // v510: gitYa = leer el canal git en la vuelta que viene
function enMovimiento(ahora = Date.now(), act = arrancando) {
  return Object.values(act).some((ias) => Object.values(ias || {}).some((v) => v && typeof v === "object" &&
    ((!v.fin && ahora - v.ini < 30 * MIN) || (v.fin && ahora - v.fin < 2 * MIN) || (!v.lanzador && ahora - v.ini < 15 * MIN))));
}
function pideRefresco(ahora = Date.now(), programa = setTimeout) {
  if (toqueEnCola) return "en cola";
  const espera = Math.max(0, 2000 - (ahora - ultToque));
  toqueEnCola = programa(() => { toqueEnCola = null; ultToque = Date.now(); tic(true).catch(() => {}); }, espera);
  return espera ? "en cola" : "ya";
}
function toque(req, res) {
  const origen = req.headers.origin || "";
  if (!HOSTS.has(req.headers.host || "") || (origen && !HOSTS.has(origen.replace(/^https?:\/\//, "")))) { res.writeHead(403); return res.end(); }
  let cuerpo = ""; req.on("data", (d) => { cuerpo += d; if (cuerpo.length > 2000) req.destroy(); });
  req.on("end", () => {
    let j = {}; try { j = JSON.parse(cuerpo || "{}"); } catch (e) {}
    if (j && j.git) gitYa = true;
    if (j && j.hilo && j.ia) { const h = String(j.hilo).slice(0, 30), ia = String(j.ia);
      if (j.fin) marcaFin(h, ia, j.rc); else marcaArranque(h, ia, Date.now(), ia !== "Coo" || !!j.lanzador); }
    pideRefresco(); res.writeHead(204); res.end();
  });
}
const oyentes = new Set();
function eventos(req, res) {
  if (!HOSTS.has(req.headers.host || "")) { res.writeHead(403); return res.end(); }
  if (oyentes.size >= 20) { res.writeHead(503); return res.end(); }
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
  res.write("retry: 5000\n\n"); if (estado.listo) res.write(`event: estado\ndata: ${JSON.stringify({ t: estado.t })}\n\n`);
  oyentes.add(res); ultimaVista = Date.now();
  req.on("close", () => oyentes.delete(res));
}
function avisaOyentes(t) { const m = `event: estado\ndata: ${JSON.stringify({ t })}\n\n`; for (const r of oyentes) { try { r.write(m); } catch (e) { oyentes.delete(r); } } return oyentes.size; }
alAbrir(() => setInterval(() => { for (const r of oyentes) { try { r.write(": latido\n\n"); } catch (e) { oyentes.delete(r); } } if (oyentes.size) ultimaVista = Date.now(); }, 25e3).unref());
const INFORME = path.join(HOME, ".oficina", "informe-trabajo.json");
let informeEnCurso = false;
function rehazInforme(motivo) {
  if (informeEnCurso) return false; informeEnCurso = true;
  run(process.execPath, [path.join(__dirname, "..", "herramientas", "informe-trabajo.js")], { timeout: 10 * MIN })
    .then((r) => anota(`informe «Mi trabajo» (${motivo}): ${r.ok ? r.out.trim().slice(0, 200) : "no salió: " + limpiaErr(r.err).slice(0, 160)}`))
    .finally(() => { informeEnCurso = false; avisaOyentes(estado.t || Date.now()); });
  return true;
}
function informeHttp(req, res, f = INFORME) {
  if (!HOSTS.has(req.headers.host || "")) { res.writeHead(403); return res.end(); }
  const json = (code, o) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(o)); };
  if (req.method === "POST") { if (!postLocal(req)) return json(403, { ok: false, error: "origen no permitido" }); const ok = rehazInforme("a mano"); return json(202, { ok: true, haciendo: true, yaEnCurso: !ok }); }
  let txt = null; try { txt = fs.readFileSync(f, "utf8"); } catch (e) {}
  if (!txt) return json(404, { ok: false, haciendo: informeEnCurso, error: "Aún no hay informe: pulsa «Rehacer» (tarda uno o dos minutos)." });
  try { const j = JSON.parse(txt); if (Array.isArray(j.temas)) { for (const t of j.temas) if (t && t.titulo) t.titulo = limpiaTitulo(t.titulo); txt = JSON.stringify(j); } } catch (e) {}
  const gz = /\bgzip\b/i.test(req.headers["accept-encoding"] || "");
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Informe-Haciendo": informeEnCurso ? "1" : "0", ...(gz ? { "Content-Encoding": "gzip", Vary: "Accept-Encoding" } : {}) });
  return res.end(gz ? require("zlib").gzipSync(txt, { level: 1 }) : txt);
}
function quizaInforme(ahora = new Date(), turnoMio = conTurno(), f = INFORME, rehacer = rehazInforme, mirando = false) {
  if (!turnoMio || ahora.getHours() < 7) return false;
  let hecho = -Infinity; try { hecho = fs.statSync(f).mtimeMs; } catch (e) {}
  const edad = ahora.getTime() - hecho, las6 = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate(), 6).getTime();
  if (edad > 20 * 3600e3 || hecho < las6) return rehacer("cada mañana");
  return mirando && edad > 3 * 3600e3 ? rehacer("oficina abierta") : false;
}
let informeIntento = 0;   // si no sale (sin red), no se reintenta hasta pasados 30 min
const miraInforme = () => { try { if (Date.now() - informeIntento < 30 * MIN) return;
  if (quizaInforme(new Date(), conTurno(), INFORME, rehazInforme, Date.now() - ultimaVista < 3 * MIN)) informeIntento = Date.now(); } catch (e) {} };
alAbrir(() => { setTimeout(miraInforme, MIN).unref(); setInterval(miraInforme, 10 * MIN).unref(); });
let corriendo = false, vueltaRotaT = 0, refrescarDe = null;   // (refrescarDe: solo para las pruebas)
let ultimaVista = Date.now(), ultimoRefresco = 0;
const ritmoDe = (mirando, turnoMio) => (mirando ? 15e3 : turnoMio ? 45e3 : 10 * MIN);
const ritmo = () => (Date.now() - ultimaVista < 3 * MIN ? ritmoDe(true) : ritmoDe(false, conTurno()));
async function tic(forzado) {
  if (saliendo) return;   // (v566: cediendo el puerto a la oficina nueva)
  // v194: si una vuelta lleva más de 3 min (algo colgado que no tenía tope), se suelta y la oficina sigue viva
  if (corriendo && Date.now() - ultimoRefresco > 3 * MIN) { anota("refresco colgado más de 3 min: lo suelto"); corriendo = false; }
  if (corriendo) { if (forzado) otraVuelta = true; return; } if (!forzado && Date.now() - ultimoRefresco < ritmo() - 1e3) return;   // v506
  corriendo = true; ultimoRefresco = Date.now();
  try { await (refrescarDe || refrescar)(); if (/^la vuelta de refresco ha fallado/.test(errores.analisis || "")) { delete errores.analisis; if (estado && estado.errores) delete estado.errores.analisis; } }
  catch (e) { rend.fase = ""; errores.analisis = `la vuelta de refresco ha fallado (lo de la página puede no estar al día): ${limpiaErr(e && (e.message || e))}`;
    if (estado && estado.errores) estado.errores = { ...errores };
    if (Date.now() - vueltaRotaT > 30 * MIN) { vueltaRotaT = Date.now(); anota(`error en la vuelta de refresco: ${limpiaErr(e && (e.stack || e.message || e))}`); } }
  finally { corriendo = false; rend.vueltas.push({ t: Date.now(), ms: Date.now() - ultimoRefresco }); if (rend.vueltas.length > 40) rend.vueltas.shift();   // v503
    if (otraVuelta) { otraVuelta = false; setTimeout(() => { tic(true).catch(() => {}); }, 300); } }   // v506: lo que llegó durante la vuelta
}
alAbrir(() => { tic(); setInterval(tic, 15e3); });
// v186: rotación de logs al minuto de arrancar y cada 24 h (en cualquier equipo: los logs son de cada uno)
alAbrir(() => { const rota = () => { const r = rotaLogs(); if (r.borrados || r.recortados.length) anota(`logs: ${r.borrados} de lanzamientos viejos fuera${r.recortados.length ? "; recortados " + r.recortados.join(", ") : ""}`); };
  setTimeout(rota, 60e3); setInterval(rota, 24 * 3600e3); });

const EQUIPO = (() => { try { return fs.readFileSync(path.join(HOME, ".config", "oficina-equipo.txt"), "utf8").trim().toLowerCase(); } catch (e) { return ""; } })();
let turno = { equipo: EQUIPO, de: "", mio: !EQUIPO, sabido: !EQUIPO };
// v563: el diario solo existe con nombre de equipo (sin él no hay turno ni nada que viaje) y nunca en las pruebas
if (!PRUEBAS && EQUIPO && /^[\w-]{1,40}$/.test(EQUIPO)) DIARIO = require("./diario.js").abre(path.join(HOME, ".oficina", `diario--${EQUIPO}.json`), EQUIPO);
const conTurno = () => turno.mio;
const sinTurno = () => `Este equipo («${EQUIPO}») no tiene el turno${turno.de ? ` (lo tiene «${turno.de}»)` : turno.sabido ? "" : " (aún no lo he podido leer)"}: aquí la oficina es solo de lectura. Para contestar desde este equipo, «Atender desde aquí.cmd».`;
const ESTADO_JS = path.join(__dirname, "..", "herramientas", "estado-oficina.js");
const estadoOficina = (orden) => run(process.execPath, [ESTADO_JS, orden], { timeout: 120e3 })
  .then((r) => { anota(`estado ${orden}: ${(r.out || r.err || "").trim().split("\n").pop().slice(0, 160)}`); return r; });
async function leerTurno({ ejecuta = run, baja = () => estadoOficina("baja"), equipo = EQUIPO, anotar = anota } = {}) {
  if (!equipo) return;
  const r = await ejecuta("git", ["-C", path.join(__dirname, ".."), "ls-remote", "origin", "refs/tags/turno-*", "refs/latido/*"], { timeout: 30e3 });
  if (!r.ok) return;
  const de = ((r.out.match(/refs\/tags\/turno-([\w-]+)/) || [])[1] || "").toLowerCase();
  if (de === equipo && !turno.mio) await baja();   // primero lo que dejó el otro equipo; luego ya se escribe
  const lat = latidosDe(r.out);
  turno = { equipo, de, mio: de === equipo, sabido: true, latidos: lat, desde: desdeTurno(turno, de, equipo, lat), leido: Date.now() };
  if (estado.listo) estado.turno = { ...turno };
  if (turno.mio) latir(r.out, ejecuta, equipo, anotar).catch(() => {});
  else if (errores.repo) { delete errores.repo; notaLatido(fallosLatido, true); }   // v218: sin turno no se sube latido: fuera el aviso
}

const LATIDO_MIN = 10, HUERFANO_MIN = 30;
let latidoT = 0, latiendo = false, escuchaCaida = false;
function latidosDe(out) {
  const r = {};
  for (const m of String(out || "").matchAll(/refs\/latido\/([\w-]+?)-(\d{9,})\s*$/gm)) { const e = m[1].toLowerCase(); r[e] = Math.max(r[e] || 0, +m[2] * 1000); }
  return r;
}
// el push del latido: la ref nueva y fuera las viejas de ESTE equipo (las del otro, no se tocan)
function ordenLatido(equipo, out, ahora = Date.now()) {
  const sha = (String(out || "").match(new RegExp(`^([0-9a-f]{40})\\s+refs/tags/turno-${equipo}\\s*$`, "m")) || [])[1];
  if (!equipo || !sha) return null;
  const viejas = [...String(out).matchAll(/refs\/latido\/([\w-]+?)-(\d{9,})\s*$/gm)].filter((m) => m[1].toLowerCase() === equipo).map((m) => `:refs/latido/${m[1]}-${m[2]}`);
  return ["push", "-q", "origin", `${sha}:refs/latido/${equipo}-${Math.floor(ahora / 1000)}`, ...viejas];
}
// v222: desde cuándo vale el turno que se acaba de leer. Si no cambia, lo de antes; si es la PRIMERA lectura tras arrancar la
// oficina y es de este equipo con su latido reciente (< 15 min), ya lo tenía antes del reinicio: desde siempre (1); si no, ahora.
function desdeTurno(prev, de, equipo, lat, ahora = Date.now()) {
  if (prev && prev.sabido && de === prev.de && prev.desde) return prev.desde;
  if (!(prev && prev.sabido) && de && de === equipo && ahora - ((lat || {})[equipo] || 0) < 15 * MIN) return 1;
  return ahora;
}
function turnoHuerfano(t, ahora = Date.now()) {
  if (!t || !t.equipo || t.mio || !t.de) return null;
  if (t.leido && ahora - t.leido > 5 * MIN) return null;
  const l = (t.latidos || {})[t.de];
  if (!l || ahora - l <= HUERFANO_MIN * MIN || (t.desde && ahora - t.desde <= HUERFANO_MIN * MIN)) return null;
  return { de: t.de, desde: l };
}
// v218: si el latido no sube dos veces seguidas (credenciales de git caducadas, GitHub caído…), se dice AQUÍ: el otro equipo
// creerá que este está apagado y el estado compartido tampoco viaja. Se quita en cuanto vuelve a subir.
const fallosLatido = { n: 0, desde: 0, err: "" };
function notaLatido(f, ok, err, ahora = Date.now()) {
  if (ok) { f.n = 0; f.desde = 0; f.err = ""; return null; }
  if (!f.n++) f.desde = ahora; f.err = String(err || "").replace(/\s+/g, " ").trim().slice(0, 120);
  // v254: sin red no es cosa de las credenciales
  const red = /could not resolve host|unable to access|failed to connect|connection (timed out|refused|reset)|network is unreachable|timed out|SSL/i.test(f.err);
  return f.n >= 2 ? (red
    ? `Sin conexión con GitHub desde las ${hhmm(f.desde)} («${f.err}»): el latido no sube, así que el otro equipo creerá que este está apagado. Mira la red o la VPN de este equipo`
    : `No puedo subir al repo del Edificio desde las ${hhmm(f.desde)} («${f.err}»): el otro equipo creerá que este está apagado y el estado compartido no viaja. Mira las credenciales de git (un «git push» en ~/.claude/relevo)`) : null;
}
async function latir(out, ejecuta = run, equipo = EQUIPO, anotar = anota) {
  if (!equipo || !turno.mio || latiendo || escuchaCaida || Date.now() - latidoT < LATIDO_MIN * MIN) return;
  const orden = ordenLatido(equipo, out); if (!orden) return;
  latiendo = true; latidoT = Date.now();
  try {
    const p = await ejecuta("git", ["-C", path.join(__dirname, ".."), ...orden], { timeout: 60e3 });
    if (!p.ok) anotar("latido: no he podido subirlo: " + limpiaErr(p.err || p.out).trim().slice(0, 160));
    const aviso = notaLatido(fallosLatido, p.ok, limpiaErr(p.err || p.out));
    if (aviso) errores.repo = aviso; else if (p.ok) delete errores.repo;
  } finally { latiendo = false; }
}
let subeT = 0, subeEnCurso = false, subePend = false;
const FICH_ESTADO = ["apuntes.json", "jira-vistos.json", "privados.json"];
// v555: y lo de ~/.canal-logs que también viaja (delegados/, juntados.txt, estoy-en-ello.json: la lista la da estado-oficina.js)
const huellaEstado = (dir = path.join(HOME, ".oficina"), logs = dir === path.join(HOME, ".oficina") ? LOGS : null) =>
  FICH_ESTADO.map((f) => ({ nombre: f, ruta: path.join(dir, f) })).concat(logs ? require(ESTADO_JS).deLogs(logs) : [])
    .concat(require("./diario.js").enCarpeta(dir))   // v563: y el diario de errores (solo si existe: sin él, la huella de siempre)
    .map(({ nombre, ruta }) => { try { return nombre + ":" + require("crypto").createHash("sha1").update(fs.readFileSync(ruta)).digest("hex"); } catch (e) { return nombre + ":-"; } }).join("|");   // por contenido: dos escrituras seguidas pueden tener la misma hora
const subeSobra = (huella, ult, ahora = Date.now()) => !!ult.huella && huella === ult.huella && ahora - ult.t < 60 * MIN;
const ultSube = { huella: "", t: 0 };
function quizaSubirEstado(ya) {
  if (!EQUIPO || !turno.mio) return;
  if (subeEnCurso) { if (ya) subePend = true; return; }
  if (!ya && Date.now() - subeT < 10 * MIN) return;
  const h = huellaEstado();
  subeT = Date.now(); if (!ya && subeSobra(h, ultSube)) return;
  subeEnCurso = true;
  estadoOficina("sube").then((r) => { if (r && r.ok && /^(subido|sin cambios)/m.test(r.out || "")) Object.assign(ultSube, { huella: h, t: Date.now() }); })
    .finally(() => { subeEnCurso = false; if (subePend) { subePend = false; setTimeout(() => quizaSubirEstado(true), 2000); } });
}
let turnoEnCurso = false;
const tocaTurno = () => { if (turnoEnCurso) return; turnoEnCurso = true; leerTurno().catch(() => {}).finally(() => { turnoEnCurso = false; }); };
alAbrir(() => { tocaTurno(); setInterval(tocaTurno, MIN); setInterval(() => quizaSubirEstado(false), MIN); });

let tokenCache = { t: 0, v: null };
function tokenHumano() {
  if (!PRUEBAS && tokenCache.t) return tokenCache.v;   // v519/v520: de memoria (refrescaConfig lo pone al día en asíncrono)
  let v = null;
  try {
    const m = fs.readFileSync(path.join(HOME, ".config", "oficina-slack.env"), "utf8").match(/^SLACK_USER_TOKEN=\s*["']?(xoxp-[^"'\s]+)/m);
    v = m ? m[1] : null;
  } catch (e) { v = null; }
  if (!PRUEBAS) tokenCache = { t: Date.now(), v };
  return v;
}
async function refrescaConfig(home = HOME) {
  const P = fs.promises;
  try { const txt = await P.readFile(path.join(home, ".config", "canal-slack.env"), "utf8"); cfgCache = { t: Date.now(), v: cfg(txt) }; } catch (e) {}
  try { const t = await P.readFile(path.join(home, ".config", "oficina-slack.env"), "utf8"); const m = t.match(/^SLACK_USER_TOKEN=\s*["']?(xoxp-[^"'\s]+)/m); tokenCache = { t: Date.now(), v: m ? m[1] : null }; }
  catch (e) { tokenCache = { t: Date.now(), v: null }; }
  return { cfg: cfgCache.v, token: !!tokenCache.v };
}
alAbrir(() => setInterval(() => { refrescaConfig().catch(() => {}); }, CFG_MEMORIA_MS).unref());
const CLAVE = require("crypto").randomBytes(24).toString("hex");
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const MENC = { coo: CONF.slack.ias.coo, claude: CONF.slack.ias.claude, cursor: CONF.slack.ias.cursor };
// @coo pasa a mención solo si hay un id real (el de ejemplo no es de nadie: el texto se queda con «@coo»)
function textoConMenciones(texto, menc = MENC) {
  const ejemplo = require("../herramientas/config.js").EJEMPLO.slack.ias.coo;
  return String(texto).replace(/(^|[\s(])@(coo)\b/gi, (m, a, n) => (menc.coo && menc.coo !== ejemplo ? `${a}<@${menc.coo}>` : m));
}
// v63: escribir en el log de envíos nunca debe tumbar el servidor
// v320: en las pruebas, lo que se anota se queda en memoria (anotados): antes iba al oficina-envios.log de verdad.
const anotados = [];
function anota(l) { if (PRUEBAS) { anotados.push(l); return; } if (DIARIO) DIARIO.linea(limpiaErr(l)); try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, "oficina-envios.log"), `${new Date().toISOString()} ${l}\n`); } catch (e) {} }
let relanzados = [];
// Cursor sin saldo de API (usage_limit_exceeded) en este hilo y sin un SI después: ya se avisó una vez; no se le relanza (ver
// herramientas/cursor-sin-saldo.js). En las pruebas no se mira el cursor-arranques.log de verdad (setSinSaldo pone uno falso).
// Con el CLI de Cursor (cursor-cli.ps1 + cursor-agent) no se bloquea: el «sin saldo» solo vale para el respaldo por API.
let cursorSinSaldo = (hilo) => { if (PRUEBAS) return null;
  try { const CS = require(path.join(__dirname, "..", "herramientas", "cursor-sin-saldo.js")); if (CS.hayCli()) return null; return CS.bloqueoLog({ hilo }, LOGS); } catch (e) { return null; } };
const sinSaldoAnotado = new Set();
const AVISO_SIN_SALDO = "Cursor sigue sin saldo de API (ya avisado en el hilo): no lo relanzo; lánzalo a mano en su app.";
function relanzaPendientes(lista, lanzar = lanzaScript, logf = path.join(LOGS, "traspasos.log"), anotar = anota, barato) {
  relanzados = relanzados.filter((t) => Date.now() - t < 30 * MIN);
  // v491: el vigilante barato (mirada con un modelo pequeño), solo con VIGILANTE_BARATO=1 y solo para Claude (atender-slack.sh)
  if (barato === undefined) barato = String(cfg().VIGILANTE_BARATO || "").trim() === "1";
  const H = path.join(HOME, ".claude", "relevo", "herramientas"), hechos = [];
  const orden = [...(lista || []).filter((r) => !r.proceso), ...(lista || []).filter((r) => r.proceso)];
  for (const r of orden) {
    const sinSaldo = r.ia === "Cursor" && cursorSinSaldo(r.hilo);
    if (sinSaldo) {   // ni API ni otro aviso en Slack: se espera (una sola nota por fallo, no en cada vuelta)
      const k = `${r.hilo}|${sinSaldo.t}`;
      if (!sinSaldoAnotado.has(k)) { sinSaldoAnotado.add(k); anotar(`hilo ${r.hilo} no relanzo a Cursor: sin saldo de API (ya avisado a las ${hhmm(sinSaldo.t)}); se espera`); }
      continue;
    }
    if (r.proceso && relanzados.length >= 2) continue;
    if (relanzados.length >= 3) { anotar(`relanzo: tope de 3 cada 30 min; no relanzo a ${r.ia} en el hilo ${r.hilo}`); break; }
    let ok = false, mira = false;
    if (r.ia === "Coo") ok = lanzar([path.join(H, "avisar-coo.sh"), CH, r.hilo, r.quien, r.ts], `hilo ${r.hilo} relanzo a Coo`, { hilo: r.hilo, ia: "Coo" });
    else {
      const f = path.join(os.tmpdir(), `slack-relanzo-${Date.now()}-${r.ia}.json`);
      mira = !!(barato && r.proceso && r.oficina && r.textoMirada && r.ia !== "Cursor");
      try { fs.writeFileSync(f, JSON.stringify({ text: mira ? r.textoMirada : r.texto, channel: CH, ts: r.ts, thread_ts: r.hilo, quien: r.quien, ...(r.oficina ? { oficina: true } : {}),
        ...(mira ? { mirada: true, normal: r.texto } : {}) })); ok = true; } catch (e) {}
      ok = ok && lanzar([path.join(H, r.ia === "Cursor" ? "atender-cursor-slack.sh" : "atender-slack.sh"), f], `hilo ${r.hilo} relanzo a ${r.ia}`, { hilo: r.hilo, ia: r.ia });
    }
    if (ok) marcaArranque(r.hilo, r.ia);   // v506
    relanzados.push(Date.now());
    const l = [new Date().toISOString(), ok ? "RELANZO" : "FALLO", r.ia, "slack", r.clave, (String(r.que || "") + (mira ? " · mirada barata" : "")).replace(/\s+/g, " ").slice(0, 140)].join("\t");
    try { fs.mkdirSync(path.dirname(logf), { recursive: true }); fs.appendFileSync(logf, l + "\n"); } catch (e) {}
    hechos.push(l);
  }
  return hechos;
}
const LLEVAR_LOG = path.join(HOME, ".canal-logs", "llevar-a-slack.log");
let llevados = null;
let llevadoT = 0; const LLEVAR_CADA = 2 * 60e3;
let llevadosB = new Map();
const bloqueLlevar = (c) => String(c || "").replace(/^llevar:[^:]+:/, "");
function llevaASlack(hilos, o = {}) {
  const ahoraT = o.ahora || Date.now(), d = new Date(ahoraT), log = o.log || LLEVAR_LOG;
  if (!llevados || o.log) { llevados = new Set(); llevadosB = new Map();
    try { for (const l of fs.readFileSync(log, "utf8").split("\n")) { const c = l.split("\t"), m = c[1]; if (m) { llevados.add(m); llevadosB.set(bloqueLlevar(m), Date.parse(c[0]) || 0); } } } catch (e) {} }
  const activo = "activo" in o ? !!o.activo : String(cfg().LLEVAR_A_SLACK || "").trim() === "1";
  const pausas = o.pausas || (((leeApuntes() || {}).ajustes || {}).pausas) || {};
  const horario = d.getDay() >= 1 && d.getDay() <= 5 && d.getHours() >= 8 && d.getHours() < 20;
  const turnoMio = "turno" in o ? !!o.turno : conTurno();
  // v496: el turno se relee cada minuto en cada equipo: justo al cambiar, el que lo pierde aún puede estar publicando (hasta ~1 min
  // en enterarse, más lo que tarde responder-slack.sh). El que lo acaba de coger espera 3 min; después ya ve en Slack lo que llevó
  // el otro (analizar no lo vuelve a llevar). (desde = 1: lo tenía antes de arrancar, sin espera)
  const desdeT = "turno" in o ? o.turnoDesde || 0 : (turno && turno.desde) || 0;
  const recien = desdeT > 1 && ahoraT >= desdeT && ahoraT - desdeT < 3 * MIN;
  const hechos = [];
  for (const h of hilos || []) {
    const x = h.llevar; if (!x || (h.estado && h.estado !== "humano")) continue;   // (v492: solo un tema que te toca)
    const p = pausas[h.tema || h.titulo]; if (p && (!p.hasta || p.hasta > ahoraT)) continue;
    const modo = !activo ? "PROPUESTA" : turnoMio && horario && !recien ? "PUBLICO" : null;
    if (!modo) continue;
    const clave = x.clave + (modo === "PROPUESTA" ? ":propuesta" : "");
    if (llevados.has(clave)) continue;
    const kB = bloqueLlevar(clave), yaB = llevadosB.get(kB);
    if (yaB !== undefined && ahoraT - yaB < 14 * 3600e3 && ahoraT >= yaB) continue;   // v492: ese bloque ya se llevó a otro hilo
    const ultL = "llevadoT" in o ? o.llevadoT : llevadoT;
    if (modo === "PUBLICO" && ahoraT >= ultL && ahoraT - ultL < LLEVAR_CADA) continue;   // v486: una cada 2 min
    if (modo === "PUBLICO") { llevadoT = ahoraT; if ("llevadoT" in o) o.llevadoT = ahoraT; }
    llevados.add(clave); llevadosB.set(kB, ahoraT);
    const linea = (r) => [new Date(ahoraT).toISOString(), clave, r, String(h.titulo || "").slice(0, 80), x.texto.replace(/\n/g, " ⏎ ")].join("\t");
    const apunta = (r) => { try { fs.mkdirSync(path.dirname(log), { recursive: true }); fs.appendFileSync(log, linea(r) + "\n"); } catch (e) {} hechos.push(linea(r)); };
    if (modo === "PROPUESTA") { apunta("PROPUESTA (sin publicar: falta el OK de Humano, LLEVAR_A_SLACK=1)"); continue; }
    const publica = o.publica || ((hilo, texto) => {
      const f = path.join(os.tmpdir(), `oficina-llevar-${process.pid}-${Date.now()}.txt`); fs.writeFileSync(f, texto);
      const BASH = require("../herramientas/git-bash.js").gitBash() || "bash";
      return run1(BASH, [path.join(__dirname, "..", "herramientas", "responder-slack.sh"), CH, hilo, f], { timeout: 90e3 })
        .then((r) => { try { fs.unlinkSync(f); } catch (e) {} return r; });
    });
    Promise.resolve(publica(h.ts, x.texto)).then((r) => { apunta(r && r.ok ? "PUBLICADO" : `FALLO ${limpiaErr((r && r.err) || "").replace(/\s+/g, " ").slice(0, 120)}`);
      anota(`pedido 13: ${r && r.ok ? "llevo al hilo" : "NO he podido llevar al hilo"} «${String(h.titulo || "").slice(0, 60)}» lo que pide el canal git`); });
  }
  return hechos;
}
function lanzaScript(args, etiqueta, al) {
  // v276: Git Bash donde esté (también %ProgramFiles%\Git, como acepta el instalador)
  const BASH = require("../herramientas/git-bash.js").gitBash() || "bash";   // v356: la misma búsqueda que la escucha
  try {
    const t0 = Date.now(); const p = require("child_process").spawn(BASH, args, { detached: true, stdio: "ignore", windowsHide: true });
    notaLento(`arrancar «${path.basename(String(args[0] || "bash"))}»`, Date.now() - t0);   // v517
    p.on("error", (e) => { anota(`${etiqueta}: no se pudo lanzar (${limpiaErr(e.message)})`); errores.lanzar = `${etiqueta}: ${limpiaErr(e.message)}`; if (al) { marcaFin(al.hilo, al.ia, -1); pideRefresco(); } });
    // v508: al acabar su lanzador, la IA ha terminado (o no pudo): se apunta y se refresca ya (la respuesta acaba de salir)
    p.on("exit", (c) => { anota(`${etiqueta} rc=${c}`); if (al) { marcaFin(al.hilo, al.ia, c); pideRefresco(); } });
    p.unref(); return true;
  } catch (e) { anota(`${etiqueta}: no se pudo lanzar (${limpiaErr(e.message)})`); return false; }
}
// v63: los POST solo valen si vienen de la propia página de la oficina (Origin local y Sec-Fetch-Site same-origin,
// que el navegador pone y una web de fuera no puede falsificar). No para a un programa del propio PC decidido a
// falsificar cabeceras (podría igualmente leer el token del disco), pero sí cualquier uso accidental.
function postLocal(req) {
  const origen = req.headers.origin || "", sfs = req.headers["sec-fetch-site"] || "";
  return HOSTS.has(req.headers.host || "") && origen && HOSTS.has(origen.replace(/^https?:\/\//, "")) && sfs === "same-origin";
}
// Lanza atender-slack.sh igual que lo haría escucha-slack.js con un mensaje escrito a mano por Humano.
function lanzarClaudeComoHumano(texto, ts, hilo, extra) {
  const f = path.join(os.tmpdir(), `slack-mencion-${Date.now()}-oficina.json`);
  const x = { ...(extra || {}) }; const escritura = x.escritura === true; delete x.escritura;
  try { fs.writeFileSync(f, JSON.stringify({ text: texto, channel: CH, ts, thread_ts: hilo, quien: "Humano", oficina: true, escritura, ...x })); } catch (e) { anota(`hilo ${hilo} no se pudo preparar el lanzamiento de Claude`); return; }
  const sc = path.join(HOME, ".claude", "relevo", "herramientas", "atender-slack.sh");
  anota(`hilo ${hilo} lanzo Claude como Humano (mensaje ${ts})`);
  if (lanzaScript([sc, f], `hilo ${hilo} Claude lanzado como Humano`, { hilo, ia: "Claude" })) marcaArranque(hilo, "Claude");   // v506/v508
}
// v155: la etiqueta de estado con la que acaba cada mensaje de una IA para Humano (pauta, punto 0)
//   [te toca: ¿OK a X?]   [lo hace: Claude — X]   [hecho]
function etiquetaDe(m) {
  if (!m) return null; const t = textoPlano(m.texto || ""); let toca = "", hace = null, hecho = false, hay = false, espera = null;
  for (const x of t.matchAll(/\[\s*(te toca|lo hace|hecho|espera)\s*:?\s*([^\]]*)\]/gi)) {
    if (!x[2].trim() && x[1].toLowerCase() !== "hecho" && /\p{L}/u.test(t.slice(x.index + x[0].length).replace(/\[\s*(te toca|lo hace|hecho|espera)\b[^\]]*\]/gi, ""))) continue;
    hay = true; const k = x[1].toLowerCase(), v = x[2].trim();
    if (k === "espera") { const mm = v.match(/^([^—–:-]+?)\s*(?:[—–:-]\s*([\s\S]*))?$/); espera = { quien: ((mm && mm[1]) || v).trim().slice(0, 60), que: ((mm && mm[2]) || "").trim().slice(0, 240) };
      if (/^proceso\b/i.test(espera.quien)) espera = { quien: espera.quien.replace(/^proceso\s*/i, "").trim() || "un proceso", que: espera.que, proceso: true }; }
    else if (k === "te toca" && esperaTercero(v)) espera = esperaTercero(v);
    else if (k === "te toca") toca = v || "te toca a ti";
    else if (k === "lo hace") { const ia = (v.match(/^(Claude|Cursor|Coo)\b/i) || [])[1]; const cap = (s) => s[0].toUpperCase() + s.slice(1).toLowerCase();
      const lista = (v.match(/^(?:(?:Claude|Cursor|Coo)\s*(?:,|\by\b|\be\b|\+|&|\/)?\s*)+/i) || [""])[0];
      const ias = [...new Set([...lista.matchAll(/Claude|Cursor|Coo/gi)].map((x) => cap(x[0])))];
      if (ia) hace = { ia: cap(ia), ias, que: v.replace(/^(?:(?:Claude|Cursor|Coo)\s*(?:,|\by\b|\be\b|\+|&|\/)?\s*)+[—–:-]?\s*/i, "").slice(0, 140) }; }
    else hecho = v || true;
  }
  return hay ? { toca: toca.slice(0, 160), hace, hecho, espera } : null;
}
const NO_PERSONA = /^(Humano|Claude|Cursor|Coo|Grok|Gus|Charla|Slack|Chat|QA|PROD|UAT|OK|Te|Tu|Su|El|La|Lo|Los|Las|Un|Una|Aqu[ií]|Cuando|Av[ií]same|Dime)$/;
function esperaTercero(v) {
  const s = String(v || "");
  if (!/\b(av[ií]s[ae]me|av[ií]sanos|dime|dinos|cu[eé]ntame|reenv[ií]ame|p[aá]same)\b[^.?!]{0,40}\bcuando\b|\bcuando\b[^.?!]{0,40}\b(conteste|responda|diga|escriba|confirme|mande|env[ií]e|devuelva|pruebe|lo pruebe|revise|apruebe|suba)\b|^\s*esperando (a|la respuesta de)\b/i.test(s)) return null;   // v402: + pruebe, revise, apruebe, suba
  const nombres = [...s.matchAll(/(?:^|[^\p{L}])(\p{Lu}[\p{Ll}]{2,14})(?![\p{L}])/gu)].map((x) => x[1]).filter((n) => !NO_PERSONA.test(n));
  return nombres.length ? { quien: nombres[0], que: s.replace(/\s+/g, " ").trim().slice(0, 140) } : null;
}
const ESCRITURA = /escritura|\bDML\b|\bdeploy\b|\bdespleg|\binsert\b|en el org\b|crea(r|rlo|rla)? en (QA|PROD|UAT)\b/i;
const sinNegadas = (d) => String(d).replace(/\b(sin|ni|nada de)\s+(\S+\s+){0,2}?(escritura|DML|deploy|tocar|escribir)[^,.;)]*/gi, "");
function sinEncargos(t) {
  const out = []; let dentro = false;
  for (const l of String(t).replace(/\s+(?=\d{1,2}[.)]\s+Encargos?\s+(?:a|para)\s)/gi, "\n").split("\n")) {
    if (/^\s*(?:\d{1,2}[.)]\s*|[-•]\s*)?(?:#+\s*)?Encargos?\s+(?:a|para)\s+(?:Claude|Cursor|Coo|Grok|Criba)\b/i.test(l)) { dentro = true; continue; }
    if (dentro && (/^\s*\d{1,2}[.)]\s/.test(l) || /^\s*#/.test(l) || /^\s*(?:Para|Decisi[oó]n(?: de)?|Pregunta (?:a|para)) Humano\b/i.test(l))) dentro = false;
    if (!dentro) out.push(l);
  }
  return out.join("\n");
}
function leeOps(raw) {
  const t = sinEncargos(textoPlano(raw || "").replace(/[*_`]/g, "")).replace(/\s+(?=\d{1,2}\.\s+(?:[Oo]pci[oó]n\s+)?[A-E](?:\s*\(|\s*[.:)—–]))/g, "\n");
  const por = new Map();
  const add = (l, d) => { l = l.toUpperCase(); d = String(d).replace(/\[\s*(te toca|lo hace|hecho)\b[^\]]*\]/gi, "").replace(/\s+/g, " ").trim(); if (d.length >= 3 && !por.has(l)) por.set(l, d.slice(0, 240)); };
  for (const m of t.matchAll(/(?:^|[¿\s,;:])([A-E])\s*\(/g)) {
    const i = m.index + m[0].length; let d = 1, j = i;
    for (; j < t.length && d; j++) { if (t[j] === "(") d++; else if (t[j] === ")") d--; }
    if (!d && !/^\s*:/.test(t.slice(j))) add(m[1], t.slice(i, j - 1));
  }
  if (por.size < 2) for (const l of t.split("\n")) {                // en líneas
    const m = l.match(/^\s*(?:\d+\.\s*|[-•]\s*)?(?:[Oo]pci[oó]n\s+)?(?:\(([A-Ea-e])\)|([A-E])(?:\s*\([^)]*\))?\s*[.:)—–])\s*(.{3,})$/);
    if (m) add(m[1] || m[2], m[3]);
  }
  const ops = []; for (const l of "ABCDE") { if (!por.has(l)) break; ops.push({ l, t: por.get(l) }); }
  if (ops.length === 2 && /¿[^?¿]*\b(las dos|ambas)\b[^?¿]*\?/i.test(t)) ops.push({ l: "A+B", t: `las dos: A (${ops[0].t.slice(0, 80)}) y B (${ops[1].t.slice(0, 80)})` });
  const v = t.match(/\b[Vv]oto\b[^\n:]{0,30}?:?\s*(?:\(([A-Ea-e])\)|([A-E])(?![\p{L}]))([^\n.;]*)/u) || t.match(/\b([A-E])\s*\(voto\b/)
    || t.match(/\b([A-E])\s*\([^)]*\brecomiend[^)]*\)/i);
  return { ops, voto: v ? (v[1] || v[2] || "").toUpperCase() : "", porque: v && v[3] ? v[3].trim() : "" };
}
function opcionesDe(textos, extras = []) {
  let base = null, voto = "", porque = ""; const todas = {};
  for (const [i, raw] of [...textos, ...extras].entries()) {
    const r = leeOps(raw);
    if (!base && i < textos.length && r.ops.length >= 2) base = r.ops;
    for (const o of r.ops) (todas[o.l] = todas[o.l] || []).push(o.t);
    if (!voto && r.voto) { voto = r.voto; porque = r.porque; }
  }
  if (!base) return null;
  const esc = (l) => (l === "A+B" ? [...(todas.A || []), ...(todas.B || [])] : (todas[l] || [])).some((d) => ESCRITURA.test(sinNegadas(d)));   // v395
  return { ops: base.map((o) => ({ l: o.l, t: o.t, escritura: esc(o.l) })),
    voto: base.some((o) => o.l === voto) ? voto : "", porque: base.some((o) => o.l === voto) ? porque.slice(0, 160) : "" };
}
function botonesDe(opc, hace, quien) {
  return opc.ops.map((o) => {
    const ia = (o.t.match(/\b(Claude|Cursor|Coo)\b/) || [])[1]
      || (hace && (new RegExp(`\\b${o.l}\\b`).test(hace.que || "") || !/\b[A-E]\b/.test(hace.que || "")) ? hace.ia : "")
      || (IAS.includes(quien) ? quien : "Coo");
    return { l: o.l, t: o.t, escritura: o.escritura, recomendada: o.l === opc.voto, a: ia, texto: `@${ia} ${o.escritura ? "ok, " : ""}opción ${o.l}: ${o.t}`.slice(0, 400) };
  });
}
function pideOkDeBloque(b) {
  const e = b.estadoCab || null, hace = e && e.hace && e.hace.length ? { ia: e.hace[0], que: e.que || "" } : e && e.luego && e.luego.length ? { ...(e.luego.find((x) => /\bOK\b|visto bueno|aprobaci/i.test(x.que)) || e.luego[0]) } : null;
  const quien = !IAS.includes(b.de) ? "Coo" : b.de;
  const preg = (e && e.toca) || String(b.decision || b.tit || "").replace(/^(PARA HUMANO|Tu OK|DECISI[OÓ]N HUMANO|(?:Falta|Pendiente) de Humano)\s*:\s*/i, "");
  const bo = b.borrador ? null : borradorDe(b.cuerpo);
  return { pregunta: preg.replace(/\s+/g, " ").slice(0, String(b.decision || "").length > 300 ? 480 : 300), de: (hace && hace.ia) || quien,
    fuente: b.cuerpo || "", hace, quien, bloque: /^\d+$/.test(b.id) ? b.id : (b.hora || "") };
}
const RE_CHAT_B = /(?:💬\s*|(?:^|\n|[ \t]{2,})(?=Para\s))Para\s+([^\n:]+?)\s+por\s+([^\n:()]{2,30}?(?:\s*\([^\n()]{1,60}\))?):[ \t]*\n?([\s\S]*?)(?=\s*\[\s*(?:te toca|lo hace|hecho)\b|$)/i;
const CANAL_CHAT = /^(?:Slack|Google\s*Chat|Chat|WhatsApp|Teams|correo|e-?mail|Gmail|privado|DM|SMS|mensaje)\b/i;
function chatDe(t) {
  for (const c of String(t || "").replace(/\r/g, "").matchAll(new RegExp(RE_CHAT_B.source, "gi")))
    if (c[3].trim() && c[1].trim().length <= 60 && CANAL_CHAT.test(c[2].trim())) return { para: c[1].trim(), canal: c[2].trim(), borrador: c[3].trim().slice(0, 2000) };
  return null;
}
function borradorDe(t) {
  const s = String(t || "").replace(/\r/g, "");
  const c = chatDe(s); if (c) return c;
  for (const m of s.matchAll(/(?:^|\n|[ \t]{2,}|[*_]\s?)De:\s/g)) {
    const ini = m.index + m[0].indexOf("De:"), cola = s.slice(ini, ini + 700);
    const iP = cola.search(/\bPara:\s/), iA = cola.search(/\bAsunto:\s/);
    if (iP < 0 || iA < iP) continue;
    if (!/humano|juan\.?apell|apell/i.test(cola.slice(0, iP))) continue;
    let txt = s.slice(ini).replace(/\s*\[\s*(?:te toca|lo hace|hecho)\b[\s\S]*$/i, "");
    const corte = txt.search(/\n[ \t]*(?:-{3,}[ \t]*(?:\n|$)|#{1,6}\s|\||\*\*|—\s)/); if (corte > 0) txt = txt.slice(0, corte);
    if (!/\n/.test(txt.trim()))   // (Grok, en una línea: los huecos dobles eran saltos de línea)
      txt = txt.replace(/[ \t]{2,}/g, "\n").replace(/[ \t]+(Para:|Asunto:)/g, "\n$1").replace(/[ \t]+·[ \t]+(En respuesta a:)/g, "\n$1")
        .replace(/^(Asunto:[^\n]*)\n(?!\n)/m, "$1\n\n");
    txt = txt.replace(/[*_]+(?=\s*$)/gm, "").trim();
    const para = (txt.match(/\bPara:\s*([^\n]*?)(?=\s+·\s|\s+CC:|\n|$)/) || [])[1] || "";
    if (txt.length > 40) return { para: para.replace(/[*_]/g, "").trim().slice(0, 120), canal: "correo", borrador: txt.slice(0, 3000) };
  }
  const hd = s.match(/(?:^|\n)#{2,4}[ \t]*(?:Mensaje|Texto|Borrador|Correo)\b([^\n]*\bpara\b[^\n]*)\n([\s\S]*?)(?=\n[ \t]*(?:\d+\.\s|#{1,6}\s|-{3,}|—\s)|$)/i);
  if (hd) {
    const cuerpo = hd[2].split("\n").filter((l) => !/^\s*\*\*[^*]+\*\*\s*$/.test(l)).join("\n").trim();
    const pm = hd[1].match(/\s(?:a|para)\s+(?!(?:Slack|Google|Chat|correo|Gmail|WhatsApp)\b)([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:\s+y\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)?)/);
    const cm = hd[1].match(/\bpara\s+(Slack|Google Chat|correo|Gmail|WhatsApp)\b/i);
    if (cuerpo.length > 20) return { para: pm ? pm[1] : "", canal: cm ? cm[1] : "", borrador: cuerpo.slice(0, 3000) };
  }
  return null;
}
let orgsAqui = new Set();
async function leeOrgs() { try { const j = JSON.parse(await fs.promises.readFile(path.join(HOME, ".sfdx", "alias.json"), "utf8")); orgsAqui = new Set(Object.keys(j.orgs || j).map((x) => String(x).toLowerCase())); } catch (e) {} }
alAbrir(() => { leeOrgs(); setInterval(leeOrgs, 10 * MIN); });
const ORGS_NOMBRE = [[/\buat[-\s]?prod\b|\buat\s?full\b/i, "UAT-PROD", ["uat-prod", "uatprod", "uatfull"]], [/\buat\b/i, "UAT", ["uat"]],
  [/\bqa\b/i, "QA", ["qa", "ocaqa"]], [/\bprod(?:oca)?\b|\bproducci[oó]n\b/i, "PROD", ["prodoca", "ocaprod", "prod"]], [/\bsgag\b/i, "SGAG", ["sgag"]]];
const TAREA_A_MANO = /\b(?:abr(?:e|ir|as)|lanza(?:r|s)?|ejecuta(?:r|s)?|arranca(?:r|s)?|corre(?:r)?|inicia(?:r)?|entra(?:r)?(?:\s+en)?|log(?:u[eé]a(?:r|te)?|in))\b[^.?¿]{0,50}\b(?:sesi[oó]n|terminal|PowerShell|consola|CLI|cmd|navegador|Anypoint)\b|\bsf\s+org\s+login\b|\biniciar?\s+sesi[oó]n\b/i;
const FALTA_ORG = /\b(?:no\s+tiene|sin|necesita(?:s)?|hace\s+falta|requiere)\b[^.]{0,30}\bacceso\s+(?:al?\s+|a\s+la\s+)?(?:org|sandbox|humano\s?dev|QA|UAT|PROD)\b/i;
function tareaManual(pregunta, fuente, titulo, hace, url, aqui0) {
  const p = llanoS(String(pregunta || "")).replace(/\s+/g, " ").trim();
  if (!p || /[¿?]/.test(p)) return null;
  const f = textoPlano(String(fuente || "")).replace(/\s+/g, " ");
  if (!TAREA_A_MANO.test(p) && !FALTA_ORG.test(p) && !(FALTA_ORG.test(f) && /\b(?:abr|lanz|ejecut|arranc|inici|entr|sesi[oó]n|PowerShell|terminal)/i.test(p))) return null;
  const web = /\b(?:navegador|Anypoint|web)\b/i.test(p) && !/\b(?:PowerShell|terminal|consola|CLI|org)\b/i.test(p + " " + f);
  const que = p.slice(0, 160), hq = hace && hace.que ? llanoS(hace.que).replace(/\s+/g, " ").trim().slice(0, 140) : "";
  if (web) return { que, titulo: p.charAt(0).toUpperCase() + p.slice(1, 160), tipo: "otro", org: "", aqui: false, como: "Esto es tuyo: si es entrar en una web para las IAs, doble clic en «Navegador de las IAs.cmd» (el perfil de las IAs), entra una vez y ciérralo.", encargo: "", boton: "" };
  let o = null; for (const s of [p, hq, f, titulo || ""]) { o = ORGS_NOMBRE.find(([re]) => re.test(s)); if (o) break; }   // (v546: lo que dice la tarea, antes que el título del hilo)
  const org = o ? o[1] : "";
  const dadoDeAlta = !!o && o[2].some((a) => orgsAqui.has(a)), aqui = aqui0 !== undefined ? !!aqui0 : dadoDeAlta && conTurno();
  const paraF = (f.match(/\bpara\s+([^.;:¿?]{8,120}?)\s+(?:hace\s+falta|se\s+necesita|necesit[oa]s?|tienes\s+que)\b/i) || [])[1] || "";
  const sinSesion = que.replace(/^(?:abr(?:e|ir|as)|lanza(?:r)?|inicia(?:r)?|arranca(?:r)?)\s+(?:la\s+|una\s+)?(?:sesi[oó]n|terminal|consola|PowerShell)(?:\s+de\s+\S+)?(?:\s+en\s+(?:PowerShell|la\s+terminal|una\s+terminal))?\s*[:,.-]?\s*/i, "")
    .replace(/^y\s+/i, "").replace(/\s+(?:en|desde)\s+PowerShell\b/i, "").trim();
  const tarea = (paraF || hq || sinSesion || que).replace(/\s+/g, " ").trim();
  const enOrg = org && !new RegExp(`\\b${org.replace(/-/g, "\\W?")}\\b`, "i").test(tarea) ? ` en ${org}` : "";
  const tituloT = (tarea.charAt(0).toUpperCase() + tarea.slice(1) + enOrg).slice(0, 160);
  if (aqui) return { que, titulo: tituloT, tipo: "org", org, aqui: true,
    como: `No hace falta que abras nada: el Claude de la oficina trabaja en este equipo con PowerShell y la CLI de Salesforce, y ${org} está dado de alta aquí. Con tu OK lo hace él: «${tarea}».`,
    encargo: `@Claude ok: hazlo tú desde aquí, con la CLI de este equipo: ${tarea}${enOrg}.`, boton: "OK, que lo haga Claude aquí" };
  return { que, titulo: tituloT, tipo: "org", org, aqui: false,
    como: `Necesita un Claude con acceso a ${org || "ese org"}${!o ? "" : !dadoDeAlta ? ", y en este equipo no está dado de alta" : " en el equipo que tiene el turno"}. Pásale el encargo a una sesión de Claude Code que lo tenga (en este PC, cualquiera con la CLI de Salesforce). Nada con escritura sin tu OK.`,
    encargo: `Encargo de la oficina (hilo «${String(titulo || "").slice(0, 80)}»${url ? `, ${url}` : ""}): ${tarea}${enOrg}. Lee el hilo antes de empezar; en el org, solo lectura hasta que Humano dé el OK a lo que propongas.`,
    boton: "Copiar el encargo" };
}
function borradorCitado(preg) {
  const m = String(preg || "").match(/\b(?:mando|mandamos|env[ií]o|enviamos|escribo|escribirle|digo|decirle|contesto|respondo|paso|pongo)\s+(?:a|al|en)\s+([^«»?¿:]{2,60}?)\s*:?\s*«([^«»]{3,600})»/i);
  return m ? { para: m[1].trim(), canal: "", borrador: m[2].trim() } : null;
}
function llanoS(t) { return require(path.join(__dirname, "..", "herramientas", "llano.js")).llano(t); }
const ID_BLOQUE = /`?\b[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-(?:(?=[0-9a-f]*\d)[0-9a-f]{6,12}|20\d{6})\b`?/g;
const QUE_VACIO = /^(?:(?:acuse|aviso|avisos|voto|votos|timbre|nota|cruce|respuesta|coordinaci[oó]n|correcci[oó]n|cierre|resumen|estado)(?:\s+(?:de|del|sobre|a|al|para|en))?\s*)+$/i;
function quePasaDe(tit) {
  let s = String(tit || ""); const i = s.lastIndexOf("]"); if (i >= 0) s = s.slice(i + 1);
  s = s.replace(ID_BLOQUE, " ");
  s = s.replace(/^(?:[\s·—–-]*(?:#+\s*)?(?:\d+\s*·\s*)?(?:Claude|Cursor|Coo|Grok|OCA|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}:\d{2}(?:\s*UTC)?)\b)+/i, "");
  s = s.replace(/^[\s·:—–-]*(?:acuse|cruce|borrador|nota|correcci[oó]n|coordinaci[oó]n)\s*[:·—–-]\s+(?=\S)/i, "")
    .replace(/[\s;,.·—–-]*(?:y\s+)?(?:pido|pide|piden|pedimos)\s+(?:el\s+|tu\s+)?OK\s+(?:a|de)\s+Humano\b[^;·]*$/i, "");
  const r = llanoS(s).replace(/^[\s·:—–-]+|[\s·:—–-]+$/g, "").slice(0, 140);
  const nucleo = r.replace(/\([^()]*\)/g, " ").replace(/[\s·:—–\-/`]+/g, " ").trim();
  return nucleo.length < 4 || QUE_VACIO.test(nucleo) ? "" : r;
}
function llevarDe(b, hilo) {
  const p = pideOkDeBloque(b);
  let preg = llanoS(p.pregunta).replace(/^\s*te toca\s*:?\s*/i, "").replace(/\s+(?:en|por)\s+Slack\s*\.?$/i, "").replace(/[[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 220);
  if (preg.length < 4) return null;
  const letras = preg.length < 80 ? [...new Set(preg.match(/\b[A-E]\b(?!\s*\()/g) || [])] : [];
  if (letras.length === 1) {
    const d = String(p.fuente || "").replace(/[*_`]/g, "").match(new RegExp(`\\b${letras[0]}\\b\\s*\\(([^()\\n]{5,140})\\)`));
    if (d) preg = preg.replace(new RegExp(`\\b${letras[0]}\\b(?!\\s*\\()`), `${letras[0]} (${llanoS(d[1]).replace(/\s+/g, " ").trim()})`).slice(0, 260);
  }
  const opc = opcionesDe([p.fuente, p.pregunta]);
  const rec = opc && opc.voto ? opc.ops.find((o) => o.l === opc.voto) : null;
  const deId = (String(b.id || "").match(/^(claude|cursor|coo)\b/i) || String(b.tit || "").match(/^(claude|cursor|coo)\b/i) || [])[1];
  const de = b.de && b.de !== "Grok" ? b.de : !b.de && deId ? deId[0].toUpperCase() + deId.slice(1).toLowerCase() : "Coo", qp = quePasaDe(b.tit);
  const l1 = `📋 <@${HUMANO}> En el canal de las IAs (${de}, ${hhmm(b.t)})${qp ? `: «${qp}»` : ""}. Nadie te lo había preguntado aquí.`
    + (rec ? ` Recomendada: ${rec.l}, ${llanoS(rec.t).replace(/[.\s]+$/, "").slice(0, 140)}${opc.porque ? ` (${llanoS(opc.porque).replace(/[.\s]+$/, "").slice(0, 120)})` : ""}.` : "");
  const hace = IAS.includes(p.de) ? p.de : "Coo";
  return { clave: `llevar:${hilo}:${b.id || b.t}`, texto: `${l1}\n[te toca: ${preg}] [lo hace: ${hace} — seguir con lo que decidas]`, de, hace, t: b.t };
}
function okParaClaude(m) {
  if (!m) return false; const e = etiquetaDe(m); if (e) return !!(e.hace && e.hace.ia === "Claude");
  const t = textoPlano(m.texto || ""); return /\b(ok|okey)\b/i.test(t) && /\?/.test(t) && /\bclaude\b/i.test(t);
}
function esOkHumano(t) { return require(path.join(__dirname, "..", "herramientas", "regla-ok.js")).esOk(t); }
const CORTESIA = new Set(["gracias", "muchas", "mil", "perfecto", "perfect", "genial", "vale", "ok", "okey", "okay", "guay", "top", "crack", "maquina", "máquina",
  "de", "lujo", "estupendo", "buen", "buenisimo", "buenísimo", "trabajo", "bien", "hecho", "a", "todos", "chicos", "equipo", "thanks", "thank", "you", "merci", "tío", "tio", "y", "muy"]);
function esCortesia(t) {
  const limpio = String(t || "").replace(/<@[A-Z0-9]+>|@\w+/g, " ").toLowerCase();
  if (/\?/.test(limpio) || limpio.length > 80) return false;
  const pal = limpio.normalize("NFC").split(/[^a-záéíóúüñ+]+/i).filter(Boolean);
  return pal.some((w) => /^(gracias|thanks|thank|merci)$/.test(w)) && pal.every((w) => CORTESIA.has(w));
}
function lanzarCursorComoHumano(texto, ts, hilo, lanzar = lanzaScript) {
  const sinSaldo = cursorSinSaldo(hilo);
  if (sinSaldo) { anota(`hilo ${hilo} no lanzo Cursor (mensaje ${ts}): sin saldo de API (ya avisado a las ${hhmm(sinSaldo.t)}); se espera a que lo lances a mano o vuelva el saldo`); return "sin saldo"; }
  const f = path.join(os.tmpdir(), `slack-cursor-${Date.now()}-oficina.json`);
  try { fs.writeFileSync(f, JSON.stringify({ text: texto, channel: CH, ts, thread_ts: hilo, quien: "Humano" })); } catch (e) { anota(`hilo ${hilo} no se pudo preparar el lanzamiento de Cursor`); return; }
  const sc = path.join(HOME, ".claude", "relevo", "herramientas", "atender-cursor-slack.sh");
  anota(`hilo ${hilo} lanzo Cursor por CLI como Humano (mensaje ${ts})`);
  if (lanzar([sc, f], `hilo ${hilo} Cursor lanzado como Humano`, { hilo, ia: "Cursor" })) { marcaArranque(hilo, "Cursor"); return true; }   // v506/v508
  return false;
}
// ---------- apuntes de Humano (v39): notas por tema y recordatorios ----------
// Fichero propio (~/.oficina/apuntes.json), fuera de ~/.config y ~/.canal-logs, que leen las IAs.
const APUNTES = path.join(HOME, ".oficina", "apuntes.json");
function leeApuntes(f = APUNTES) { try { return apuntesLimpios(JSON.parse(fs.readFileSync(f, "utf8"))); } catch (e) { return { notas: {}, recordatorios: [] }; } }   // v556: claves limpias
function apuntes(req, res) {
  const fin = (code, o) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(o)); };
  const origen = req.headers.origin || "";
  if (!HOSTS.has(req.headers.host || "") || (origen && !HOSTS.has(origen.replace(/^https?:\/\//, ""))))
    return fin(403, { ok: false, error: "origen no permitido" });
  if (req.method === "GET") return fin(200, { ok: true, ver: 0, ...leeApuntes() });
  if (!postLocal(req)) return fin(403, { ok: false, error: "origen no permitido" });
  // v167: sin turno, solo lectura (pausas, notas y fijados son del equipo que atiende; viajan con el turno)
  if (!conTurno()) return fin(423, { ok: false, error: sinTurno(), turno: { ...turno }, ...leeApuntes() });
  if (!/application\/json/.test(req.headers["content-type"] || "")) return fin(415, { ok: false, error: "json" });
  let cuerpo = "";
  req.on("data", (d) => { cuerpo += d; if (cuerpo.length > 1500000) req.destroy(); });
  req.on("end", () => { try {
    let j; try { j = JSON.parse(cuerpo); } catch (e) { return fin(400, { ok: false, error: "json roto" }); }
    if (!j || typeof j !== "object") return fin(400, { ok: false, error: "json roto" });
    if (j.k !== CLAVE) return fin(403, { ok: false, error: "clave" });
    const a = leeApuntes();
    // v63: versión: si otra pestaña guardó entre medias, no se pisa; se devuelven los datos buenos
    if (j.ver !== undefined && +j.ver !== +(a.ver || 0)) return fin(409, { ok: false, error: "cambiado en otra pestaña", ...a });
    a.ver = (+a.ver || 0) + 1;
    if (j.notas && typeof j.notas === "object") a.notas = Object.fromEntries(Object.entries(j.notas).filter(([k, v]) => typeof v === "string" && v.trim()).map(([k, v]) => [String(k).slice(0, 200), v.slice(0, 20000)]));
    if (j.ajustes && typeof j.ajustes === "object") {
      if (JSON.stringify(j.ajustes).length > 400000) return fin(413, { ok: false, error: "ajustes demasiado grandes" });
      a.ajustes = j.ajustes;
    }
    // v63: sin nulos; fuera los ya avisados de hace más de 7 días; se quedan los 200 más NUEVOS
    if (Array.isArray(j.recordatorios)) a.recordatorios = j.recordatorios.filter((r) => r && typeof r === "object")
      .filter((r) => !(r.hecho && Date.now() - (+r.t || 0) > 7 * 86400e3)).slice(-200)
      .map((r) => ({ id: String(r.id || ""), t: +r.t || 0, texto: String(r.texto || "").slice(0, 300), hilo: String(r.hilo || ""), hecho: !!r.hecho }));
    try { fs.mkdirSync(path.dirname(APUNTES), { recursive: true }); fs.writeFileSync(APUNTES + ".tmp", JSON.stringify(a, null, 1)); fs.renameSync(APUNTES + ".tmp", APUNTES); }
    catch (e) { return fin(500, { ok: false, error: "no se pudo guardar" }); }
    fin(200, { ok: true, ...a });
    quizaSubirEstado(true);   // v167: la pausa o la nota viaja enseguida al estado compartido
  } catch (e) { fin(500, { ok: false, error: "error guardando" }); } });
}

function enviar(req, res) {
  const fin = (code, o) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)); };
  if (!postLocal(req)) return fin(403, { ok: false, error: "origen no permitido" });
  if (!conTurno()) return fin(423, { ok: false, error: sinTurno(), turno: { ...turno } });   // v167
  if (!/application\/json/.test(req.headers["content-type"] || "")) return fin(415, { ok: false, error: "json" });
  let cuerpo = "";
  req.on("data", (d) => { cuerpo += d; if (cuerpo.length > 20000) req.destroy(); });
  req.on("end", async () => {
    let j; try { j = JSON.parse(cuerpo); } catch (e) { return fin(400, { ok: false, error: "json roto" }); }
    if (!j || typeof j !== "object") return fin(400, { ok: false, error: "json roto" });
    if (j.k !== CLAVE) return fin(403, { ok: false, error: "clave" });
    const hilo = String(j.hilo || ""), texto = String(j.texto || "").trim();
    if (!texto || texto.length > 3000) return fin(400, { ok: false, error: "texto vacío o demasiado largo" });
    if (!(estado.hilos || []).some((h) => h.ts === hilo)) return fin(400, { ok: false, error: "hilo desconocido" });
    const tok = tokenHumano();
    if (!tok) return fin(409, { ok: false, error: "falta el token en ~/.config/oficina-slack.env" });
    const t = textoConMenciones(texto);
    try {
      const k = await slackPost({ channel: CH, thread_ts: hilo, text: t }, tok);
      anota(`hilo ${hilo} ${k.ok ? "ok " + k.ts : "error " + k.error} (${texto.length} car.)`);
      if (!k.ok) return fin(502, { ok: false, error: "Slack: " + k.error });
      cacheReplies.delete(hilo); setTimeout(tic, 1500);
      let despierta = [];
      if (esCortesia(texto)) {   // v99: solo un agradecimiento: se publica, pero no se despierta a nadie
        fin(200, { ok: true, url: enlace(k.ts, hilo), despierta: [], aviso: "Era un agradecimiento: no he despertado a nadie." });
        [1500, 11000].forEach((ms) => setTimeout(() => { tic(true).catch(() => {}); }, ms));
        return;
      }
      if (/@coo\b/i.test(texto)) {
        const sc = path.join(HOME, ".claude", "relevo", "herramientas", "avisar-coo.sh");
        if (lanzaScript([sc, CH, hilo, "Humano", k.ts, /@(claude|cursor)\b/i.test(texto) ? "varias" : ""], `hilo ${hilo} aviso a Coo`, { hilo, ia: "Coo" })) { despierta.push("Coo"); marcaArranque(hilo, "Coo"); }
      }
      let aviso = "";
      if (!/@claude\b/i.test(texto) && esOkHumano(texto)) {
        const hh = (estado.hilos || []).find((x) => x.ts === hilo), ultIA = hh && (hh.msgs || []).filter((m) => m.quien !== "Humano").pop();
        if (okParaClaude(ultIA)) {
          lanzarClaudeComoHumano(`${texto}\n(Es el OK de Humano a lo que propuso ${ultIA.quien} en este hilo: «${String(ultIA.texto).replace(/\s+/g, " ").slice(0, 400)}». Lo haces tú, Claude.)`, k.ts, hilo, { escritura: true });
          despierta.push("Claude"); anota(`hilo ${hilo} OK de Humano a Coo pasado a Claude ${k.ts}`);
          aviso = "✍️ Tu OK le llega también a Claude, que es quien lo hace.";
        }
      }
      if (/@(claude|cursor)\b/i.test(texto)) {
        const PRIV = /\bcont[eé]sta(le)?\b|\bresp[oó]nde(le)?\b|\bd[ií]le (a|que)\b|por privado|por dm|\bescr[ií]bele\b/i;
        const esOk = esOkHumano(texto) || j.ok_escritura === true;
        const pideCodigo = /\b(rama|fix|arregl\w*|aplica\w*|implementa\w*|commits?|s[uú]bel[ao]s?|programa\w*)\b/i.test(texto);
        if (esOk && /@claude\b/i.test(texto) && /(^|[^a-z])PRs?([^a-z]|$)|pull ?request/i.test(texto) && !pideCodigo) {
          lanzarClaudeComoHumano(texto, k.ts, hilo, { solo_pr: true }); despierta.push("Claude");
          aviso = "OK para abrir la PR: Claude la abre.";
        }
        // v135: lo mismo para que Claude conteste por privado (solo responder-privado.sh, nada de orgs)
        else if (esOk && /@claude\b/i.test(texto) && PRIV.test(texto)) {
          lanzarClaudeComoHumano(texto, k.ts, hilo, { solo_priv: true }); despierta.push("Claude");
          aviso = "OK para contestar por privado: Claude lo envía.";
        }
        else if (esOk && /@claude\b/i.test(texto)) {
          lanzarClaudeComoHumano(texto, k.ts, hilo, { escritura: true }); despierta.push("Claude");
          anota(`hilo ${hilo} OK de Humano desde la oficina ${k.ts}`);
          aviso = "✍️ OK enviado: Claude hace lo que propuso.";
          if (/@cursor\b/i.test(texto)) { if (lanzarCursorComoHumano(texto, k.ts, hilo) === "sin saldo") aviso += " " + AVISO_SIN_SALDO; else despierta.push("Cursor"); }
        }
        else {
          if (/@claude\b/i.test(texto)) { lanzarClaudeComoHumano(texto, k.ts, hilo); despierta.push("Claude"); }
          if (/@cursor\b/i.test(texto)) { if (lanzarCursorComoHumano(texto, k.ts, hilo) === "sin saldo") aviso = [aviso, AVISO_SIN_SALDO].filter(Boolean).join(" "); else despierta.push("Cursor"); }
        }
      }
      fin(200, { ok: true, url: enlace(k.ts, hilo), despierta, aviso });
      // v92: releer Slack enseguida (y cuando suele llegar la respuesta) para que el panel lo vea sin esperar 15-30 s
      [1500, 11000, 22000].forEach((ms) => setTimeout(() => { tic(true).catch(() => {}); }, ms));
    } catch (e) { fin(502, { ok: false, error: limpiaErr(e.message) }); }
  });
}

function crearTema(req, res) {
  const fin = (code, o) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)); };
  if (!postLocal(req)) return fin(403, { ok: false, error: "origen no permitido" });
  if (!conTurno()) return fin(423, { ok: false, error: sinTurno(), turno: { ...turno } });   // v167
  if (!/application\/json/.test(req.headers["content-type"] || "")) return fin(415, { ok: false, error: "json" });
  let cuerpo = "";
  req.on("data", (d) => { cuerpo += d; if (cuerpo.length > 20000) req.destroy(); });
  req.on("end", async () => {
    let j; try { j = JSON.parse(cuerpo); } catch (e) { return fin(400, { ok: false, error: "json roto" }); }
    if (!j || typeof j !== "object" || j.k !== CLAVE) return fin(403, { ok: false, error: "clave" });
    const limpia = (x, n) => String(x || "").replace(/[\r]/g, "").replace(/[<>]/g, "").trim().slice(0, n);
    const titulo = limpia(j.titulo, 90).replace(/\n/g, " "), objetivo = limpia(j.objetivo, 220).replace(/\n/g, " ");
    const origen = limpia(j.origen, 40), quien = limpia(j.quien, 60), detalle = limpia(j.detalle, 2500);
    const desp = Array.isArray(j.despierta) ? j.despierta.filter((x) => ["Claude", "Coo", "Cursor"].includes(x)) : [];
    if (!titulo) return fin(400, { ok: false, error: "falta el título" });
    const lineas = [`*Hilo: ${titulo}*`];
    if (objetivo) lineas.push(`🎯 Objetivo: ${objetivo}`);
    if (origen || quien) lineas.push(`📥 Origen: ${[origen, quien].filter(Boolean).join(" · ")}`);
    if (detalle) lineas.push("", detalle);
    if (desp.length) lineas.push("", desp.map((d) => "@" + d).join(" ") + " tema nuevo: mirad el objetivo y decidme cómo lo atacamos.");
    const texto = lineas.join("\n");
    if (j.prueba) return fin(200, { ok: true, prueba: true, texto });
    const tok = tokenHumano();
    if (!tok) return fin(409, { ok: false, error: "falta el token en ~/.config/oficina-slack.env" });
    const t = textoConMenciones(texto);
    try {
      const k = await slackPost({ channel: CH, text: t }, tok);
      anota(`tema nuevo «${titulo}» ${k.ok ? "ok " + k.ts : "error " + k.error}`);
      if (!k.ok) return fin(502, { ok: false, error: "Slack: " + k.error });
      const despierta = [];
      if (desp.includes("Coo")) { const sc = path.join(HOME, ".claude", "relevo", "herramientas", "avisar-coo.sh");
        if (lanzaScript([sc, CH, k.ts, "Humano", k.ts], `tema ${k.ts} aviso a Coo`, { hilo: k.ts, ia: "Coo" })) { despierta.push("Coo"); marcaArranque(k.ts, "Coo"); } }
      if (desp.includes("Claude")) { lanzarClaudeComoHumano(texto, k.ts, k.ts); despierta.push("Claude"); }
      if (desp.includes("Cursor") && lanzarCursorComoHumano(texto, k.ts, k.ts) !== "sin saldo") despierta.push("Cursor");
      fin(200, { ok: true, ts: k.ts, url: enlace(k.ts, k.ts), despierta });
      [1500, 11000, 22000].forEach((ms) => setTimeout(() => { tic(true).catch(() => {}); }, ms));
    } catch (e) { fin(502, { ok: false, error: limpiaErr(e.message) }); }
  });
}

const JIRA_SITE = process.env.JIRA_SITE || CONF.jira.sitio;
const JIRA_F_REAL = path.join(HOME, ".oficina", "jira-vistos.json");
let jiraT = 0, jiraEnCurso = false;
// v116: clave de Jira -> cuándo comentaste tú en ella (o pasó a terminada). Lo usa analizar() para no cerrar el tema antes.
var jiraContestados = (() => { try { return JSON.parse(fs.readFileSync(JIRA_F_REAL, "utf8")).contestados || {}; } catch (e) { return {}; } })();
// v169: cuándo se creó cada incidencia vista (para fechar los temas con clave de Jira); viaja con el turno en jira-vistos.json
var jiraCreadas = (() => { try { return JSON.parse(fs.readFileSync(JIRA_F_REAL, "utf8")).creadas || {}; } catch (e) { return {}; } })();
// v322: con cfg() (antes, otra copia del lector de canal-slack.env)
function jiraCred(o = cfg()) {
  return o.JIRA_EMAIL && o.JIRA_API_TOKEN ? "Basic " + Buffer.from(o.JIRA_EMAIL + ":" + o.JIRA_API_TOKEN).toString("base64") : null;
}
// texto plano de un documento ADF de Jira (las menciones salen como @Nombre)
function adfTexto(n) {
  if (!n) return ""; if (typeof n === "string") return n;
  if (n.type === "text") return n.text || ""; if (n.type === "mention") return (n.attrs && n.attrs.text) || "@?";
  if (n.type === "hardBreak") return "\n"; if (n.type === "inlineCard") return (n.attrs && n.attrs.url) || "";
  const hijos = (n.content || []).map(adfTexto).join("");
  return /^(paragraph|heading|listItem|codeBlock|blockquote)$/.test(n.type) ? hijos + "\n" : hijos;
}
const adfMenciona = (n, id) => JSON.stringify(n || "").includes(id);
async function jiraVigia({ JIRA_F = JIRA_F_REAL, auth = jiraCred() } = {}) {
  if (!auth) return;
  const api = async (u, b) => { const r = await fetch(JIRA_SITE + u, { method: b ? "POST" : "GET", headers: { Authorization: auth, Accept: "application/json", ...(b ? { "Content-Type": "application/json" } : {}) }, body: b ? JSON.stringify(b) : undefined });
    if (!r.ok) throw new Error("Jira " + r.status); return r.json(); };
  let v; try { v = JSON.parse(fs.readFileSync(JIRA_F, "utf8")); } catch (e) { v = { desde: Date.now() - 3 * 3600e3, vistos: {}, asignadas: {} }; }
  if (!v.yo) v.yo = (await api("/rest/api/3/myself")).accountId;
  const yo = v.yo, desde = v.desde, ahora = Date.now();
  const r = await api("/rest/api/3/search/jql", { jql: `(assignee = currentUser() OR text ~ "${yo}") AND updated >= -1d ORDER BY updated DESC`, maxResults: 40,
    fields: ["summary", "status", "assignee", "reporter", "creator", "created", "description", "comment", "issuetype"] });
  const nuevos = [];
  for (const i of r.issues || []) {
    const f = i.fields, url = `${JIRA_SITE}/browse/${i.key}`, sum = f.summary || "";
    const tit = `${i.key} · ${sum.length > 72 ? sum.slice(0, 72).replace(/\s+\S*$/, "") + "…" : sum}`;
    const creada = Date.parse(f.created), creador = (f.creator || f.reporter || {});
    if (creada) (v.creadas = v.creadas || {})[i.key] = creada;   // v169: inicio real de los temas con su clave (temaDesde)
    // (a) mención en la descripción de una incidencia nueva que no es tuya
    if (creada > desde && creador.accountId !== yo && adfMenciona(f.description, yo) && !v.vistos[i.key + "#d"])
      nuevos.push({ id: i.key + "#d", tit, quien: creador.displayName, texto: adfTexto(f.description), url, tipo: "te menciona" });
    // (a) menciones en comentarios nuevos de otras personas
    for (const c of (f.comment && f.comment.comments) || []) {
      const cid = i.key + "#c" + c.id;
      if (Date.parse(c.created) > desde && c.author && c.author.accountId !== yo && adfMenciona(c.body, yo) && !v.vistos[cid])
        nuevos.push({ id: cid, tit, quien: c.author.displayName, texto: adfTexto(c.body), url: `${url}?focusedCommentId=${c.id}`, tipo: "te menciona en un comentario" });
    }
    // (b) asignada a ti ahora y antes no (y no la creaste tú)
    const mia = f.assignee && f.assignee.accountId === yo;
    if (mia && v.base && !v.asignadas[i.key] && creador.accountId !== yo && Date.parse(f.updated || f.created || 0) > desde)
      nuevos.push({ id: i.key + "#a" + ahora, tit, quien: creador.displayName, texto: adfTexto(f.description).slice(0, 600), url, tipo: "te la han asignado", estado: f.status && f.status.name });
    if (mia) v.asignadas[i.key] = v.asignadas[i.key] || ahora; else delete v.asignadas[i.key];
  }
  for (const n of nuevos.slice(0, 5)) {   // como mucho 5 temas por vuelta (si algo se tuerce, no inunda el canal)
    const limpio = (x) => String(x || "").replace(/[<>]/g, "").replace(/\bclaude\b/gi, (m) => m.slice(0, 2) + "​" + m.slice(2)).trim();
    const lineas = [`*Hilo: ${limpio(n.tit)}*`, `🎯 Objetivo: contestar o atender lo que pide ${limpio(n.quien)} en Jira (${n.tipo})`,
      `📥 Origen: Jira · ${limpio(n.quien)}`, "", limpio(n.texto).slice(0, 1800), "", `🔗 ${n.url}${n.estado ? " · estado: " + n.estado : ""}`];
    const texto = lineas.join("\n").replace(/\n{3,}/g, "\n\n");
    if (process.env.JIRA_PRUEBA) { anota(`JIRA (prueba, no publico) ${n.id}:\n${texto}`); v.vistos[n.id] = ahora; continue; }
    const tok = tokenHumano(); if (!tok) { anota("JIRA: falta el token de la oficina; no publico"); break; }
    const k = await slackPost({ channel: CH, text: texto }, tok);
    anota(`JIRA tema «${n.tit}» (${n.tipo}) ${k.ok ? "ok " + k.ts : "error " + k.error}`);
    if (k.ok) v.vistos[n.id] = ahora;
  }
  for (const n of nuevos.slice(5)) v.vistos[n.id] = ahora;
  const claves = [...new Set(((estado && estado.hilos) || []).filter((x) => /en Jira/.test(x.objetivo || "") || /^Jira\b/i.test(x.origen || ""))
    .map((x) => claveJira(x.titulo)).filter(Boolean))].slice(0, 40);
  v.contestados = v.contestados || {};
  if (claves.length) {
    const rc = await api("/rest/api/3/search/jql", { jql: `key in (${claves.join(",")})`, maxResults: 50, fields: ["comment", "status"] });
    for (const i of rc.issues || []) {
      const mios = ((i.fields.comment && i.fields.comment.comments) || []).filter((c) => c.author && c.author.accountId === yo).map((c) => Date.parse(c.created));
      const fin = i.fields.status && i.fields.status.statusCategory && i.fields.status.statusCategory.key === "done";
      const t = Math.max(0, ...mios, fin ? ahora : 0);
      if (t) v.contestados[i.key] = Math.max(v.contestados[i.key] || 0, fin ? Math.min(t, v.contestados[i.key] || t) : t);
    }
  }
  jiraContestados = v.contestados;
  // v170: la fecha de creación de las incidencias que dan título a un tema y que la consulta no ha traído (solo lectura,
  // como mucho 5 por vuelta; si no existe o no se puede leer, se apunta -1 y no se vuelve a pedir)
  const sinFecha = [...new Set((estado.hilos || []).flatMap((h) => String(h.titulo || "").match(/\b[A-Z][A-Z0-9]{1,9}-\d{1,6}\b/g) || []))].filter((k) => !(v.creadas || {})[k]).slice(0, 5);
  for (const k of sinFecha) {
    let t = -1; try { const r = await api(`/rest/api/3/issue/${encodeURIComponent(k)}?fields=created`); t = Date.parse(r && r.fields && r.fields.created) || -1; } catch (e) {}
    (v.creadas = v.creadas || {})[k] = t;
  }
  jiraCreadas = v.creadas || {};   // v169
  { const ks = Object.keys(v.creadas || {}); if (ks.length > 400) for (const k2 of ks.slice(0, ks.length - 400)) delete v.creadas[k2]; }   // no crece sin fin
  for (const [k2, t] of Object.entries(v.vistos)) if (t < ahora - 14 * 86400e3) delete v.vistos[k2];
  v.base = true;
  v.desde = Math.max(desde, Math.floor((ahora - 2 * 86400e3) / 3600e3) * 3600e3);
  const json = JSON.stringify(v);
  if (json !== leer(JIRA_F)) { fs.mkdirSync(path.dirname(JIRA_F), { recursive: true }); fs.writeFileSync(JIRA_F + ".tmp", json); fs.renameSync(JIRA_F + ".tmp", JIRA_F); }
  if (nuevos.length && !PRUEBAS) setTimeout(() => { tic(true).catch(() => {}); }, 1500);   // v320: en las pruebas, sin refresco de verdad
  return nuevos.length;
}
function quizaJira() {
  if (!conTurno()) return;   // v167: solo el equipo con el turno abre temas de Jira (si no, salen duplicados)
  if (jiraEnCurso || Date.now() - jiraT < 5 * MIN) return;
  jiraEnCurso = true; jiraT = Date.now();
  jiraVigia().then(() => { delete errores.jira; }).catch((e) => { errores.jira = limpiaErr(e.message); }).finally(() => { jiraEnCurso = false; });
}
alAbrir(() => { setInterval(quizaJira, MIN); setTimeout(quizaJira, 20e3); });

// ---------- v113: reuniones del calendario (sin bot: la dirección secreta iCal, ver calendario.js) ----------
const calendario = require("./calendario.js");
var reuniones = null, calT = 0, calEnCurso = false;
const CAL_TOPE = 45e3;
function quizaCalendario({ leer = calendario.leerReuniones, tope = CAL_TOPE, ahora = Date.now() } = {}) {
  if (calEnCurso || ahora - calT < 10 * MIN) return null;
  calEnCurso = true; calT = ahora;
  let reloj;
  const corte = new Promise((_, no) => { reloj = setTimeout(() => no(new Error(`la agenda no contesta (más de ${Math.round(tope / 1000)} s): se reintenta en 2 min`)), tope); });
  return Promise.race([Promise.resolve().then(leer), corte]).then((r) => { reuniones = r; delete errores.calendario; if (estado.listo) estado.reuniones = r;
      if (r && r.vieja) errores.calendario = "la agenda lleva más de 7 h sin llegar a #agenda-humano (¿se paró el Apps Script?)"; })
    .catch((e) => { errores.calendario = limpiaErr(String(e.message).replace(/https?:\/\/\S+/g, "[enlace]")); calT = ahora - 8 * MIN; })
    .finally(() => { clearTimeout(reloj); calEnCurso = false; if (estado.listo) estado.errores = { ...errores }; });
}
alAbrir(() => { setInterval(() => quizaCalendario(), MIN); setTimeout(() => quizaCalendario(), 3e3); });

var prEstado = {};
let prT = 0, prEnCurso = false;
async function prVigia({ c = cfg(), hilos = estado.hilos || [], ahora = Date.now() } = {}) {
  if (!c.BITBUCKET_EMAIL || !c.BITBUCKET_API_TOKEN) return;
  const auth = "Basic " + Buffer.from(c.BITBUCKET_EMAIL + ":" + c.BITBUCKET_API_TOKEN).toString("base64");
  const nums = new Set();
  const TRAS_PR = /\b(?:en cuanto|cuando)\s+(?:entre|est[eé]\s+(?:en|dentro)|se\s+mergee|la\s+mergeen|suba|la\s+suban)\b/i;
  for (const h of hilos) {
    const cerrado = ["cerrado", "olvidado"].includes(h.estado);
    for (const m of (h.msgs || []).slice(-12)) if (!cerrado || TRAS_PR.test(String(m.texto || ""))) for (const x of String(m.texto || "").matchAll(/(?:#|pull-requests\/)(\d{3,5})\b/g)) nums.add(x[1]);
  }
  for (const n of [...nums].slice(0, 15)) {
    const p = prEstado[n]; if (p && /MERGED|DECLINED|SUPERSEDED/.test(p.state)) continue;   // las cerradas no cambian
    if (p && p.state === "NO_EXISTE" && ahora - p.visto < 6 * 3600e3) continue;
    const r = await fetch(`https://api.bitbucket.org/2.0/repositories/${process.env.BB_REPO || CONF.canalGit.bitbucket}/pullrequests/${n}`, { headers: { Authorization: auth, Accept: "application/json" } });
    if (r.status === 404) { prEstado[n] = { state: "NO_EXISTE", visto: ahora }; continue; }
    if (!r.ok) continue; const j = await r.json();
    prEstado[n] = { state: j.state, dest: (j.destination && j.destination.branch && j.destination.branch.name) || "", t: Date.parse(j.updated_on) || 0, tit: String(j.title || "").slice(0, 120) };
  }
}
// v324: cada 3 min mientras alguien mira la oficina; si no, cada 15 (antes, cada 3 siempre: hasta 15 peticiones a Bitbucket cada
// vez, toda la noche). Al volver a mirar, en menos de 1 min se pone al día.
const prCada = (mirando) => (mirando ? 3 : 15) * MIN;
function quizaPRs() {
  if (prEnCurso || Date.now() - prT < prCada(Date.now() - ultimaVista < 3 * MIN) || !estado.listo || estado.heredado) return;
  prEnCurso = true; prT = Date.now();
  prVigia().then(() => { delete errores.prs; }).catch((e) => { errores.prs = limpiaErr(e.message); }).finally(() => { prEnCurso = false; });
}
alAbrir(() => { setInterval(quizaPRs, MIN); setTimeout(quizaPRs, 25e3); });

// ---------- v134: respuestas a los privados que mandan las IAs (ver privados.js) ----------
const privados = require("./privados.js");
let privT = 0, privEnCurso = false;
function quizaPrivados() {
  if (!conTurno()) return;   // v167: solo el equipo con el turno trae las respuestas de los privados al hilo
  if (privEnCurso || Date.now() - privT < 2 * MIN || !ultimo.slack || !ultimo.slack.length) return;
  privEnCurso = true; privT = Date.now();
  privados.vigila(ultimo.slack, { tokUser: tokenHumano(), tokBot: cfg().SLACK_BOT_TOKEN, CH, HUMANO, IAS, anota,
    enviados: Object.entries(leeEnEllo()).map(([k, x]) => ({ hilo: k.split("|")[0], t: x.t })) })
    .then(() => { delete errores.privados; })
    .catch((e) => { errores.privados = /missing_scope|falta el permiso/.test(e.message) ? "privados: al token de la oficina le faltan los permisos im:history, im:read y users:read" : limpiaErr(e.message); })
    .finally(() => { privEnCurso = false; });
}
alAbrir(() => setInterval(quizaPrivados, 30e3));
let respEsperas = {}, esperasEnCurso = false;
function quizaEsperas() {
  if (esperasEnCurso || !estado.listo || estado.heredado) return;
  const esp = (h) => h.esperaA || h.esperaRespondida;
  const lista = (estado.hilos || []).filter((h) => esp(h) && esp(h).quien && !esp(h).proceso && !IAS.includes(esp(h).quien) && h.estado !== "cerrado")
    .map((h) => ({ hilo: h.ts, quien: esp(h).quien, desde: esp(h).t || 0 }));
  for (const k of Object.keys(respEsperas)) if (!lista.some((e) => e.hilo === k)) delete respEsperas[k];
  if (!lista.length) return;
  esperasEnCurso = true;
  privados.esperas(lista, { tokUser: tokenHumano(), HUMANO })
    .then((r) => {
      delete errores.esperas;
      let nuevo = false;
      for (const [k, x] of Object.entries(r)) { if (!respEsperas[k] || respEsperas[k].t !== x.t) nuevo = true; respEsperas[k] = x; }
      if (nuevo) { anota(`esperas: contestaron por privado de Slack: ${Object.values(r).map((x) => `${x.nombre} ${hhmm(x.t)}`).join(", ")}`); tic(true).catch(() => {}); }
    })
    .catch((e) => { errores.esperas = /missing_scope|falta el permiso/.test(e.message) ? "esperas: al token de la oficina le faltan los permisos im:history, im:read y users:read" : limpiaErr(e.message); })
    .finally(() => { esperasEnCurso = false; });
}
alAbrir(() => { setInterval(quizaEsperas, 30e3); setTimeout(quizaEsperas, 20e3); });

function responderPrivado(req, res) {
  const fin = (code, o) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)); };
  if (!postLocal(req)) return fin(403, { ok: false, error: "origen no permitido" });
  if (!conTurno()) return fin(423, { ok: false, error: sinTurno(), turno: { ...turno } });   // v167
  let cuerpo = ""; req.on("data", (d) => { cuerpo += d; if (cuerpo.length > 12000) req.destroy(); });
  req.on("end", async () => {
    let j; try { j = JSON.parse(cuerpo); } catch (e) { return fin(400, { ok: false, error: "json roto" }); }
    if (!j || j.k !== CLAVE) return fin(403, { ok: false, error: "clave" });
    const texto = String(j.texto || "").replace(/\r/g, "").trim().slice(0, 3000), hilo = String(j.hilo || "");
    if (!texto || !hilo) return fin(400, { ok: false, error: "falta el texto" });
    let v = {}; try { v = JSON.parse(fs.readFileSync(path.join(HOME, ".oficina", "privados.json"), "utf8")); } catch (e) {}
    const persona = String(j.persona || "").trim();
    const cands = Object.values(v.avisos || {}).filter((x) => x.hilo === hilo && x.dm && (!persona || x.persona === persona));
    if (new Set(cands.map((x) => x.dm)).size > 1 && !persona) return fin(409, { ok: false, error: "hay varios privados en este hilo: no sé a quién" });
    const a = cands.sort((x, y) => parseFloat(y.avisoTs) - parseFloat(x.avisoTs))[0];
    if (!a) return fin(404, { ok: false, error: persona ? `no hay privado vigilado con ${persona} en este hilo` : "no hay privado vigilado para este hilo" });
    const tokU = tokenHumano(), tokB = cfg().SLACK_BOT_TOKEN;
    if (!tokU || !tokB) return fin(409, { ok: false, error: "falta un token" });
    const post = slackPost;
    try {
      const r = await post({ channel: a.dm, text: texto }, tokU);
      if (!r.ok) return fin(502, { ok: false, error: "Slack: " + r.error });
      const hora = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
      await post({ channel: CH, thread_ts: hilo, text: `↩ *${NOMBRE}* a *${a.persona}* por privado (${hora}):\n> ${texto.replace(/\n/g, "\n> ")}`, unfurl_links: false }, tokB);
      anota(`PRIVADO: Humano responde a ${a.persona} (hilo ${hilo})`);
      fin(200, { ok: true, persona: a.persona });
      [1500, 11000].forEach((ms) => setTimeout(() => { tic(true).catch(() => {}); }, ms));
    } catch (e) { fin(502, { ok: false, error: limpiaErr(e.message) }); }
  });
}

function abrirRuta(req, res) {
  const fin = (code, o) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)); };
  if (!postLocal(req)) return fin(403, { ok: false, error: "origen no permitido" });
  let cuerpo = ""; req.on("data", (d) => { cuerpo += d; if (cuerpo.length > 4000) req.destroy(); });
  req.on("end", () => {
    let j; try { j = JSON.parse(cuerpo); } catch (e) { return fin(400, { ok: false, error: "json roto" }); }
    if (!j || j.k !== CLAVE) return fin(403, { ok: false, error: "clave" });
    let r = String(j.ruta || "").trim().replace(/^["'`]+|["'`.,;:)»]+$/g, "");
    if (/^~[\\/]/.test(r)) r = path.join(HOME, r.slice(2));
    r = path.normalize(r.replace(/\//g, "\\"));
    if (!/^[A-Za-z]:\\/.test(r) || /[<>"|?*\0]/.test(r.slice(2))) return fin(400, { ok: false, error: "no parece una ruta de Windows" });
    let p = r; while (!fs.existsSync(p)) { const up = path.dirname(p); if (up === p) break; p = up; }
    if (!fs.existsSync(p)) return fin(404, { ok: false, error: "no existe ni la unidad" });
    const carpeta = fs.statSync(p).isDirectory();
    try {
      require("child_process").spawn("explorer.exe", [carpeta ? `"${p}"` : `/select,"${p}"`], { detached: true, stdio: "ignore", windowsVerbatimArguments: true }).unref();
    } catch (e) { return fin(500, { ok: false, error: limpiaErr(e.message) }); }
    fin(200, { ok: true, abierto: p, existe: p === r });
  });
}

function juntarRuta(req, res, f = JUNTADOS, refresca = () => tic(true).catch(() => {})) {
  const fin = (code, o) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)); };
  if (!postLocal(req)) return fin(403, { ok: false, error: "origen no permitido" });
  let cuerpo = ""; req.on("data", (d) => { cuerpo += d; if (cuerpo.length > 2000) req.destroy(); });
  req.on("end", () => {
    let j; try { j = JSON.parse(cuerpo); } catch (e) { return fin(400, { ok: false, error: "json roto" }); }
    if (!j || j.k !== CLAVE) return fin(403, { ok: false, error: "clave" });
    const ts = /^\d{9,}\.\d{6}$/;
    if (!ts.test(String(j.viejo || "")) || !ts.test(String(j.nuevo || "")) || j.viejo === j.nuevo) return fin(400, { ok: false, error: "faltan los dos hilos" });
    try { fs.mkdirSync(path.dirname(f), { recursive: true });
      const ya = leeJuntados(f)[j.si === false ? "no" : "si"].some((x) => x[0] === j.viejo && x[1] === j.nuevo);   // no se apunta dos veces
      if (!ya) fs.appendFileSync(f, `${j.si === false ? "no " : ""}${j.viejo} ${j.nuevo}\n`); }
    catch (e) { return fin(500, { ok: false, error: limpiaErr(e.message) }); }
    refresca(); if (!PRUEBAS) quizaSubirEstado(true);   // v555: lo juntado viaja con el turno
    fin(200, { ok: true });
  });
}

function delegarRuta(req, res, { dir = DELEGADOS, hilos = () => estado.hilos || [], refresca = () => { tic(true).catch(() => {}); quizaSubirEstado(true); }, conT = conTurno } = {}) {
  const fin = (code, o) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)); };
  if (!postLocal(req)) return fin(403, { ok: false, error: "origen no permitido" });
  if (!conT()) return fin(423, { ok: false, error: sinTurno(), turno: { ...turno } });
  let cuerpo = ""; req.on("data", (d) => { cuerpo += d; if (cuerpo.length > 2000) req.destroy(); });
  req.on("end", () => {
    let j; try { j = JSON.parse(cuerpo); } catch (e) { return fin(400, { ok: false, error: "json roto" }); }
    if (!j || j.k !== CLAVE) return fin(403, { ok: false, error: "clave" });
    const hilo = String(j.hilo || ""), si = j.si !== false, a = String(j.a || "").trim().toLowerCase();
    if (!/^\d{9,}\.\d{6}$/.test(hilo)) return fin(400, { ok: false, error: "falta el hilo" });
    if (si && !ES_COORD.test(a)) return fin(400, { ok: false, error: "falta a qué coordinador (coord-…)", coordinadores: coordinadores(dir) });
    const h = hilos().find((x) => x.ts === hilo);
    if (si && !h) return fin(404, { ok: false, error: "ese tema no está en la oficina" });
    if (si && h.estado === "cerrado") return fin(409, { ok: false, error: "ese tema ya está cerrado: no hay nada que delegar" });
    const eraAuto = !si && !!(h && h.delegado && h.delegado.auto);
    let r; try { r = apuntaDelegado(a, hilo, j.nota || (h && h.titulo) || "", si, dir); if (si || eraAuto) COORD.apuntaNo(hilo, (h && h.titulo) || "", eraAuto, dir, CH); } catch (e) { return fin(500, { ok: false, error: limpiaErr(e.message) }); }
    anota(si ? `DELEGADO: el hilo ${hilo} lo lleva ${a}` : `DELEGADO: el hilo ${hilo} vuelve a Humano (${r.quitados} línea(s) quitada(s)${eraAuto ? "; no se le vuelve a pasar solo a coord-salesforce" : ""})`);
    refresca(); fin(200, { ok: true, delegado: si ? { quien: a } : null, ...(si ? { ya: !!r.ya } : { quitados: r.quitados, ...(eraAuto ? { auto: true } : {}) }) });
  });
}

const enElloEnCurso = new Set();
async function mandaEnEllo(hilo, { hilos = estado.hilos || [], post = slackPost, tok = tokenHumano(), privadosV = null, f = EN_ELLO, ahora = Date.now() } = {}) {
  const h = (hilos || []).find((x) => x.ts === hilo), x = h && h.estoyEnEllo;
  if (!x) return { code: 404, body: { ok: false, error: "en este tema no te ha escrito nadie a quien avisar" } };
  if (!x.posible) return { code: 409, body: { ok: false, error: x.motivo || "por ese canal no se puede", copiar: x.texto } };
  const clave = `${hilo}|${sinTildes(x.a)}|${x.de}`, reg = leeEnEllo(f);
  if (reg[clave] || enElloEnCurso.has(clave)) return { code: 409, body: { ok: false, error: `ya se lo dijiste a ${x.a}`, yaEnviado: reg[clave] || { t: ahora } } };
  let dm = x.dm;
  if (!dm && x.persona) {
    let v = privadosV; if (!v) { try { v = JSON.parse(fs.readFileSync(path.join(HOME, ".oficina", "privados.json"), "utf8")); } catch (e) { v = {}; } }
    const a = Object.values(v.avisos || {}).filter((y) => y.hilo === hilo && y.dm && y.persona === x.persona).sort((p, q) => parseFloat(q.avisoTs) - parseFloat(p.avisoTs))[0];
    dm = a && a.dm;
  }
  if (!dm) return { code: 404, body: { ok: false, error: `no encuentro el privado con ${x.a}` } };
  if (!tok) return { code: 409, body: { ok: false, error: "falta el token de Slack de Humano" } };
  enElloEnCurso.add(clave);
  try {
    const r = await post({ channel: dm, text: x.texto }, tok);
    if (!r || !r.ok) return { code: 502, body: { ok: false, error: "Slack: " + ((r && r.error) || "sin respuesta") } };
    reg[clave] = { t: ahora, a: x.a, canal: x.canal };
    try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + ".tmp", JSON.stringify(reg)); fs.renameSync(f + ".tmp", f); } catch (e) {}
    anota(`ESTOY EN ELLO: Humano a ${x.a} por privado de Slack (hilo ${hilo})`);
    return { code: 200, body: { ok: true, a: x.a, canal: x.canal, yaEnviado: { t: ahora } } };
  } catch (e) { return { code: 502, body: { ok: false, error: limpiaErr(e.message) } }; }
  finally { enElloEnCurso.delete(clave); }
}
function enElloRuta(req, res, { mandar = (hilo) => mandaEnEllo(hilo), refresca = () => { tic(true).catch(() => {}); quizaSubirEstado(true); } } = {}) {
  const fin = (code, o) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(o)); };
  if (!postLocal(req)) return fin(403, { ok: false, error: "origen no permitido" });
  if (!conTurno()) return fin(423, { ok: false, error: sinTurno(), turno: { ...turno } });
  let cuerpo = ""; req.on("data", (d) => { cuerpo += d; if (cuerpo.length > 2000) req.destroy(); });
  req.on("end", async () => {
    let j; try { j = JSON.parse(cuerpo); } catch (e) { return fin(400, { ok: false, error: "json roto" }); }
    if (!j || j.k !== CLAVE) return fin(403, { ok: false, error: "clave" });
    const r = await mandar(String(j.hilo || ""));
    fin(r.code, r.body);
    if (r.code === 200) refresca();   // (v555: lo enviado viaja con el turno)
  });
}

const diarioOtroMemo = { clave: "", v: null };
function diarioOtro({ dir = path.join(HOME, ".oficina"), equipo = EQUIPO, ahora = Date.now(), memo = diarioOtroMemo } = {}) {
  try {
    const D = require("./diario.js"), otros = D.enCarpeta(dir).filter((x) => x.equipo !== equipo);
    const clave = otros.map((x) => { const s = fs.statSync(x.ruta); return `${x.nombre}:${s.mtimeMs}:${s.size}`; }).join("|") + "|" + Math.floor(ahora / 3600e3);
    if (memo && memo.clave === clave) return memo.v;
    const d = otros.map((x) => D.lee(x.ruta, x.equipo)).filter((x) => x.t && ahora - x.t < 3 * 24 * 3600e3).sort((a, b) => b.t - a.t)[0];
    let v = null;
    if (d) { const r = D.resumen(d), k = Object.keys(d.dias).sort().pop(), x = d.dias[k] || {};
      v = { equipo: d.equipo, t: d.t, n: Object.keys(x.errores || {}).length + (x.avisos || []).length, linea: r[0].replace(/[:.]$/, ""), detalle: r.slice(1, 13).map((l) => l.trim()) }; }
    if (memo) { memo.clave = clave; memo.v = v; }
    return v;
  } catch (e) { return null; }
}
// v563: GET /api/diario → { equipo, equipos: { <equipo>: { t, dias, resumen: [líneas del último día] } } } (solo lectura; el de
// este equipo y los bajados con el turno). Mismo cerrojo que /api/estado: solo Host local.
function diarioHttp(req, res, { dir = path.join(HOME, ".oficina"), hosts = HOSTS, equipo = EQUIPO } = {}) {
  if (req.method !== "GET" || !hosts.has(req.headers.host || "")) { res.writeHead(req.method !== "GET" ? 405 : 403); return res.end(); }
  const D = require("./diario.js"), equipos = {};
  for (const x of D.enCarpeta(dir)) { const d = D.lee(x.ruta, x.equipo); equipos[x.equipo] = { t: d.t || 0, dias: d.dias, resumen: D.resumen(d) }; }
  res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify({ ok: true, equipo, equipos }));
}

const servidor = PRUEBAS ? null : http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/api/relevo") return relevoRuta(req, res);   // v566: la oficina nueva pide el puerto
  // v566: en el relevo (la que se va) y con el estado heredado (la que llega, hasta su primera vuelta) no se envía nada: unos segundos
  if (req.method === "POST" && req.url.split("?")[0] !== "/api/apuntes") {
    if (saliendo || estado.heredado) { res.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Retry-After": "5" }); return res.end(JSON.stringify({ ok: false, error: "La oficina se está actualizando: prueba otra vez en unos segundos." })); }
    postsVivos++; let visto = false; const baja = () => { if (!visto) { visto = true; postsVivos--; } }; res.on("finish", baja); res.on("close", baja);
  }
  if (req.method === "POST" && req.url === "/api/actualizar") return actualizarRuta(req, res);   // v566
  if (req.method === "POST" && req.url === "/api/estoy-en-ello") return enElloRuta(req, res);
  if (req.method === "POST" && req.url === "/api/juntar") return juntarRuta(req, res);
  if (req.method === "POST" && req.url === "/api/delegar") return delegarRuta(req, res);
  if (req.method === "POST" && req.url === "/api/abrir") return abrirRuta(req, res);
  if (req.method === "POST" && req.url === "/api/privado") return responderPrivado(req, res);
  if (req.method === "POST" && req.url === "/api/enviar") return enviar(req, res);
  if (req.method === "POST" && req.url === "/api/tema") return crearTema(req, res);
  if (req.url.split("?")[0] === "/api/apuntes") return apuntes(req, res);
  if (req.url.startsWith("/api/eventos")) return eventos(req, res);
  if (req.url.split("?")[0] === "/api/informe") return informeHttp(req, res);
  if (req.url.split("?")[0] === "/api/diario") return diarioHttp(req, res);
  if (req.method === "POST" && req.url === "/api/toque") return toque(req, res);
  if (req.url.startsWith("/api/estado")) {
    if (!HOSTS.has(req.headers.host || "")) { res.writeHead(403); return res.end(); }
    // v186: alguien mira la oficina: vuelve al ritmo de 15 s y, si venía del ritmo lento, refresca ya
    const dormida = Date.now() - ultimaVista > 3 * MIN; ultimaVista = Date.now(); if (dormida) { tic(true).catch(() => {}); miraInforme(); }
    let ver = 0; try { ver = fs.statSync(path.join(__dirname, "public", "index.html")).mtimeMs; } catch (e) {}
    const c = cuerpoEstado(estado, ver, req.headers["accept-encoding"]);   // v505
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...(c.gzip ? { "Content-Encoding": "gzip", Vary: "Accept-Encoding" } : {}) });
    return res.end(c.buf);
  }
  const ruta = req.url.split("?")[0];
  const f = path.join(__dirname, "public", ruta === "/" ? "index.html" : path.basename(ruta));
  fs.readFile(f, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("no"); }
    const tipo = f.endsWith(".html") ? "text/html" : f.endsWith(".js") ? "text/javascript" : f.endsWith(".css") ? "text/css" : "application/octet-stream";
    // la página recibe la identidad de la config (nombre de la persona y de su canal) en window.EDIFICIO
    if (f.endsWith("index.html")) buf = Buffer.from(String(buf).replace("</head>", `<script>window.EDIFICIO=${JSON.stringify({ nombre: CONF.persona.nombre, canal: CONF.slack.canalNombre, visitantes: CONF.oficina.visitantes }).replace(/</g, "\\u003c")}</script><script src="/persona.js"></script></head>`));
    res.writeHead(200, { "Content-Type": tipo + "; charset=utf-8", "Cache-Control": "no-store" }); res.end(buf);
  });
});
// v566: con el relevo concedido, el puerto se suelta en unos milisegundos: se reintenta cada 40 ms (10 s como mucho)
let relevoDado = 0;
const abrePuerto = () => servidor.listen(PORT, "127.0.0.1");
if (servidor) servidor.on("error", (e) => {
  if (e && e.code === "EADDRINUSE" && relevoDado && Date.now() - relevoDado < 10e3) return void setTimeout(abrePuerto, 40);
  // v547: otra oficina ya contesta en el puerto (p. ej. la tarea que arranca tarde después del arranque directo del relanzador o del
  // vigía): se sale sin hacer nada y con 0, para que la tarea no lo cuente como fallo y no la reintente 5 veces
  if (e && e.code === "EADDRINUSE") { anota(`otra oficina ya contesta en el puerto ${PORT}: esta (pid ${process.pid}) sale sin hacer nada`); process.exit(0); }
  if (!puertoAbierto) { anota(`error: no puedo abrir el puerto ${PORT}: ${limpiaErr(e && e.message)}; salgo con 1`); process.exit(1); }   // (v565: explícito)
  anota(`error del servidor de la página (sigo en marcha): ${limpiaErr(e && e.message)}`);
}).once("listening", () => {
  puertoAbierto = true;
  if (relevoDado) anota(`estreno en caliente: tengo el puerto ${Date.now() - relevoDado} ms después de pedirlo${estado.heredado ? "; enseño lo último de la oficina de antes hasta mi primera vuelta" : ""}`);
  for (const f of (() => { try { return fs.readdirSync(LOGS); } catch (e) { return []; } })()) if (/^relevo-error-\d+\.log$/.test(f)) { try { fs.unlinkSync(path.join(LOGS, f)); } catch (e) {} }   // (la que está en uso no se deja borrar)
  if (upd.mem.malo && upd.mem.malo.aviso && Date.now() - upd.mem.malo.t < 7 * 24 * 3600e3) errores.update = upd.mem.malo.aviso;
  console.log(`Oficina de las IAs en http://127.0.0.1:${PORT}`);
  // v549: con el puerto ya nuestro, lo del arranque (antes no se ha tocado nada: una oficina de más no hace nada)
  for (const f of trasAbrir.splice(0)) { try { f(); } catch (e) { anota(`arranque: ${limpiaErr(e.message || String(e))}`); } }
  // v216: su pid, para que el vigía la pueda levantar si se cuelga (herramientas/vigila-oficina.js)
  try { fs.mkdirSync(LOGS, { recursive: true }); fs.writeFileSync(path.join(LOGS, "oficina.pid"), String(process.pid)); fs.writeFileSync(path.join(LOGS, "oficina.puerto"), String(PORT)); } catch (e) {}
  // v547: cómo volvió del último estreno (relanzar-oficina.log), en su log: si fue con el arranque directo, que se sepa
  fs.promises.readFile(path.join(LOGS, "relanzar-oficina.log"), "utf8").then((t) => {
    const ls = t.replace(/^﻿/, "").split(/\r?\n/).filter(Boolean), i = ls.map((l) => /estreno \(pid/.test(l)).lastIndexOf(true); if (i < 0) return;   // (PowerShell 5.1 pone BOM al crearlo)
    const ult = ls.slice(i), t0 = Date.parse(ult[0].slice(0, 19));
    if (Date.now() - t0 < 15 * MIN && ult.some((l) => /directa|NO VUELVE|otra vez/.test(l))) anota(`estreno: ${ult.map((l) => l.slice(20)).join(" → ").replace(/\s+/g, " ").slice(0, 300)}`);
  }).catch(() => {});
});

if (servidor) { if (RELEVO) pideRelevo().then((ok) => { if (ok) relevoDado = Date.now(); abrePuerto(); }); else abrePuerto(); }

// v159: para los tests de regresión (oficina/pruebas/correr.js)
if (PRUEBAS) module.exports = { textoConMenciones, limpiaErr,cuerpoRelevo, heredaRelevo, verCodigo: () => codigo, UPD, upd, relevo, estadoUpdate, motivoArranque, estrena, repasaCodigo, verEstado: () => estado, diarioOtro, diarioHttp, informeHttp, limpiaTitulo, apuntesLimpios, leeApuntes, tituloHilo, temaDe, CANALES, REPO, horasTrabajo, enHorario, sumaHorasTrabajo, proximo805, leeOps, entreIAs, vivasEntre, cuentaCanalDia, canalHoy, ponAlDia, run, esGitRed, gitRed, analizar, bloquesDeTexto, horaBloque, opcionesDe, botonesDe, esTrabajo, gastoSesiones, setConsumo: (c) => { consumo = c; }, conTurno, sinTurno, setTurno: (t) => { turno = t; }, asuntoClaves, temasDesde, leerSemana, raices: () => raicesSemana, relanzaPendientes, sinRelanzados: () => { relanzados = []; }, lanzarCursorComoHumano, setSinSaldo: (f) => { cursorSinSaldo = f; sinSaldoAnotado.clear(); }, lineas, rotaLogs, jiraVigia, cambioOficina, DEP_OFICINA, DEP_ESCUCHA, leerConsumo, verConsumo: () => consumo, anotados, prVigia, prCada, prs: () => prEstado, slackPost, cfg, jiraCred, huellaEstado, subeSobra, FICH_ESTADO, fetchConTope, authClaude, estadoEscucha, vigilaEscucha, latidosDe, ordenLatido, turnoHuerfano, notaLatido, desdeTurno, leerTurno, verTurno: () => turno, verErrores: () => ({ ...errores }), sinLatido: () => { latidoT = 0; }, vigiaParado, parseProcesos, hacenFaltaProcesos, miraWorktrees, avisoSucio, sesionesPorHilo, noEnviadas, claudesColgados, transcriptDe, miraCodigo, avisoCodigo, ritmoDe, leerLogs, leerSlack, leerGit, leerProcesos, etiquetaDe, okParaClaude, esOkHumano, esCortesia, llanoS, llevarDe, quePasaDe, borradorDe, borradorCitado, chatDe, verViejos: () => slackViejos, tareaManual, setOrgs: (xs) => { orgsAqui = new Set(xs); }, llevaASlack, resumenRendimiento, anotaRetraso, sinEstrenarAhora, cuerpoEstado, marcaArranque, marcaFin, enMovimiento, guionRelanzar, relacionadosDe, escribeRelacionados, quizaInforme, gastoSesionesCada, avisoGit, precargaLogs, sueltaPrecarga, lineasAsync, notaLento, vigilaFsSync, refrescaConfig, pideRefresco, avisaOyentes, verArrancando: () => arrancando,
  leeRed, leeFuente, ESPERA_FUENTE, notaPaso, resumenFuentes, trasExcepcion, tic, leerCursor, slack, setRefrescar: (f) => { refrescarDe = f; ultimoRefresco = 0; corriendo = false; },
  COORD, leeDelegados, leeJuntados, leeEnEllo, mandaEnEllo, enElloRuta, HOSTS, apuntaDelegado, coordinadores, delegarRuta, juntarRuta, trasCursor, cursorApagado, quizaCalendario, sinCalendario: () => { calT = 0; calEnCurso = false; reuniones = null; delete errores.calendario; }, verReuniones: () => reuniones, CLAVE, TEXTO_EN_ELLO, setPR: (o) => { prEstado = o || {}; }, setJira: (o) => { jiraContestados = o; }, setJiraCreadas: (o) => { jiraCreadas = o; } };
