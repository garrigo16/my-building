// escucha-slack.js - Humano habla con Claude desde Slack: "@claude-oca <lo que sea>".
// Secretos en ~/.config/canal-slack.env: SLACK_APP_TOKEN (xapp-, Socket Mode), SLACK_HUMANO_ID.
// Arranque: node escucha-slack.js   (lo deja corriendo la tarea de inicio de Windows)
// Log: ~/.canal-logs/escucha-slack.log
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawn } = require("child_process");
if (process.env.CANAL_PRUEBAS !== "1") try { os.setPriority(0, os.constants.priority.PRIORITY_ABOVE_NORMAL); } catch (e) {}
const fetchSinTope = global.fetch;
global.fetch = (u, o) => fetchSinTope(u, o && o.signal ? o : { ...(o || {}), signal: AbortSignal.timeout(30e3) });

// node de Windows no entiende rutas /c/...: el HOME de Git Bash no vale aquí. CANAL_HOME solo para pruebas.
const HOME = process.env.CANAL_HOME || os.homedir();
const LOGS = path.join(HOME, ".canal-logs");
fs.mkdirSync(LOGS, { recursive: true });
const LOGF = path.join(LOGS, "escucha-slack.log");
const log = (m) => fs.appendFileSync(LOGF, `${new Date().toISOString()} ${m}\n`);
function toqueOficina(datos) {
  // el puerto se calcula en cada toque: la Oficina puede arrancar con otro puerto
  const puerto = require("./puerto-oficina.js").puertoOficina({ logs: LOGS, pruebas: process.env.CANAL_PRUEBAS === "1" });
  if (!puerto) return;
  try { fetchSinTope(`http://127.0.0.1:${puerto}/api/toque`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(datos || {}), signal: AbortSignal.timeout(2000) }).catch(() => {}); } catch (e) {}
}
const IA_DE_SCRIPT = { "atender-slack.sh": "Claude", "atender-cursor-slack.sh": "Cursor", "atender-grok.sh": "Coo" };

function cfg() {  // se relee en cada conexión: si Humano cambia un token, no hace falta reiniciar
  const f = path.join(HOME, ".config", "canal-slack.env");
  const o = {};
  for (const l of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return o;
}

const AQUI = __dirname;
const BASH = require("./git-bash.js").gitBash() || "bash";
const OPEN_URL = process.env.CANAL_PRUEBAS === "1" && process.env.SLACK_OPEN_URL
  ? process.env.SLACK_OPEN_URL : "https://slack.com/api/apps.connections.open";
const vistos = new Set();
const activos = new Map();
const cursorNativo = new Map();
const cooPreguntaACursor = new Map();
setInterval(() => {
  if (vistos.size > 5000) for (const k of vistos) { vistos.delete(k); if (vistos.size <= 4000) break; }
  const viejo = Date.now() - 2 * 3600e3;
  for (const m of [cursorNativo, cooPreguntaACursor]) for (const [k, t] of m) if (t < viejo) m.delete(k);
}, 30 * 60e3).unref();

const EQUIPO = (() => { try { return fs.readFileSync(path.join(HOME, ".config", "oficina-equipo.txt"), "utf8").trim().toLowerCase(); } catch (e) { return ""; } })();
let wsActual = null;
let turnoEnVuelo = null;
function turnoActual() {
  if (turnoEnVuelo) return turnoEnVuelo;
  turnoEnVuelo = new Promise((res) => {
    const cp = require("child_process");
    let tarde = false;
    const p = cp.execFile("git", ["-C", path.join(AQUI, ".."), "ls-remote", "origin", "refs/tags/turno-*"],
      { windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" } }, (err, out) => {
        clearTimeout(t);
        if (err || tarde) return res(null);
        const m = (out || "").match(/refs\/tags\/turno-([\w-]+)/);
        res(m ? m[1].toLowerCase() : null);
      });
    const t = setTimeout(() => {
      tarde = true;
      if (process.platform === "win32" && p.pid) cp.execFile("taskkill", ["/PID", String(p.pid), "/T", "/F"], { windowsHide: true }, () => {});
      else { try { p.kill("SIGKILL"); } catch (e) {} }
    }, 30000);
  }).finally(() => { turnoEnVuelo = null; });
  return turnoEnVuelo;
}
if (EQUIPO) setInterval(async () => {
  const t = await turnoActual();
  if (t && t !== EQUIPO && wsActual) { log(`el turno es de «${t}»: dejo de escuchar`); try { wsActual.close(); } catch (e) {} }
}, 60000);

const DESPIERTA_MS = +process.env.ESCUCHA_DESPIERTA_MS || 20e3;
const REFRESCO_MAX_MS = +process.env.ESCUCHA_REFRESCO_MAX_MS || 5.25 * 3600e3;
let tictac = Date.now(), conectadoEn = 0;
setInterval(() => {
  const ahora = Date.now(), hueco = ahora - tictac; tictac = ahora;
  const w = wsActual;
  if (!w || w.readyState > 1) return;
  let por = "";
  if (hueco >= DESPIERTA_MS + 90e3) por = `el equipo ha estado dormido (${Math.round(hueco / 60e3)} min sin dar señales)`;
  else if (w.readyState === 1 && conectadoEn && ahora - conectadoEn > REFRESCO_MAX_MS)
    por = `Slack no ha renovado la conexión en ${Math.round((ahora - conectadoEn) / 60e3)} min (lo hace cada 5 h): puede haberse quedado muerta`;
  if (!por) return;
  log(`${por}: suelto la conexión y abro otra`);
  wsActual = null; w.onclose = null; w.onmessage = null; w.onerror = null; try { w.close(); } catch (e) {}
  conectar();
}, DESPIERTA_MS);

async function conectar() {
  if (EQUIPO) {
    const t = await turnoActual();
    if (t && t !== EQUIPO) { log(`turno de «${t}», no de «${EQUIPO}»: no escucho; lo vuelvo a mirar en 60 s`); return setTimeout(conectar, 60000); }
  }
  const c = cfg();
  if (!c.SLACK_APP_TOKEN || !c.SLACK_HUMANO_ID) { log("FALTA SLACK_APP_TOKEN o SLACK_HUMANO_ID; reintento en 60 s"); return setTimeout(conectar, 60000); }
  let url;
  try {
    const r = await fetch(OPEN_URL, { method: "POST", headers: { Authorization: `Bearer ${c.SLACK_APP_TOKEN}` } });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "sin url");
    url = j.url;
  } catch (e) { log(`no abre la conexión: ${e.message}; reintento en 30 s`); return setTimeout(conectar, 30000); }

  const ws = new WebSocket(url); wsActual = ws;
  ws.onopen = () => { conectadoEn = Date.now(); log("conectado"); };
  ws.onclose = (ev) => { log(`cerrado (${ev.code}); reconecto en 5 s`); setTimeout(conectar, 5000); };
  ws.onerror = (ev) => log(`error de socket: ${ev.message || "?"}`);
  ws.onmessage = (ev) => {
    let env; try { env = JSON.parse(ev.data); } catch { return; }
    if (env.envelope_id) ws.send(JSON.stringify({ envelope_id: env.envelope_id }));  // acuse en < 3 s
    if (env.type === "disconnect") { log("Slack pide reconectar"); try { ws.close(); } catch {} return; }
    if (env.type !== "events_api") return;
    const e = env.payload && env.payload.event;
    if (!e) return;
    // solo el canal de la config (SLACK_CANAL_ID): lo de otros canales ni se atiende ni lanza nada (el acuse ya se ha enviado)
    const CANAL = canalDe(c);
    if (CANAL && e.channel !== CANAL) { log(`evento ${e.type} de ${e.user || e.bot_id} en ${e.channel}: no es el canal ${CANAL}, lo ignoro`); return; }
    const YO = c.SLACK_CLAUDE_ID || "UCLAUDE0001";
    const COO = c.SLACK_COO_ID || "UCOO0000001", CURSOR = c.SLACK_CURSOR_ID || "UCURSOR0001";
    const IAS = { [COO]: "Coo", [CURSOR]: "Cursor" };
    const txt = e.text || "";
    if (e.type === "message") { log(`evento message de ${e.user || e.bot_id} (${e.subtype || "normal"}) en ${e.channel}`); toqueOficina({}); }   // v506
    const hilo = e.thread_ts || e.ts;
    if (e.user === CURSOR) cursorNativo.set(hilo, Date.now());
    const txtM = txt.replace(/[*_]*Enviado usando[*_]*\s*<@U[A-Z0-9]+>/gi, "");
    const meNombra = txtM.includes(`<@${YO}>`);
    const nombraCursor = txtM.includes(`<@${CURSOR}>`);
    const normal = e.type === "message" && (!e.subtype || e.subtype === "thread_broadcast" || e.subtype === "bot_message");
    const llamaACoo = txt.includes(`<@${COO}>`) || /(^|[\s(])@coo(-coordinador)?\b/i.test(txt);
    // el conector de Coo publica con la cuenta de Humano, sin la app de la Oficina, y empieza por «Coo:»: es Coo, no Humano.
    // No despierta a nadie salvo un [lo hace: Claude|Cursor] explícito; nunca avisar-coo.sh (aunque nombre a Coo o lleve [lo hace: Coo]).
    // Y Coo publica también con el bot del Edificio (el mismo que usa Claude): «Coo · Geoffrey» o «Coo:» delante. Igual trato.
    const cooBot = esCooBot(e);
    if ((e.user === c.SLACK_HUMANO_ID && /^\s*Coo:/.test(txt)) || cooBot) {
      let a = "";
      if (normal && haceIA(txtM, "cursor")) { lanzar(e, "atender-cursor-slack.sh", "Coo", txt); a += " Cursor"; }
      if (normal && haceIA(txtM, "claude")) { lanzar(e, "atender-slack.sh", "Coo", txt); a += " Claude"; }
      if (e.type === "message") log(`mensaje de Coo (${cooBot ? "bot del Edificio" : "prefijo «Coo:»"}) en ${e.channel} (${e.ts}): ${a ? "despierto a" + a : "no despierta a nadie"}`);
      hilosDeCoo.set(hilo, Date.now());   // Coo ha escrito en este hilo: una respuesta de Humano ahí le llega a Coo
      return;
    }
    // Humano habla a Coo: lo despierta por webhook. Antibucle: nunca por un mensaje de bot, del usuario del bot del Edificio
    // (que también publica cosas que no son de Coo) ni que empiece por «Coo:».
    const deBot = !!e.bot_id || e.user === COO || e.subtype === "bot_message" || /^\s*Coo:/.test(txt);
    if (e.type === "message" && normal && !deBot && !e.app_id && e.user === c.SLACK_HUMANO_ID && !vistos.has(`coo:h:${e.channel}:${e.ts}`)) {
      const nombra = llamaACoo || /\bgeoffrey\b/i.test(txt);
      const avisa = () => {
        if (vistos.has(`coo:h:${e.channel}:${e.ts}`)) return; vistos.add(`coo:h:${e.channel}:${e.ts}`);
        log(`Humano habla a Coo en ${e.channel} (${e.ts}): aviso a Coo por webhook`);
        spawn(BASH, [path.join(AQUI, "avisar-coo.sh"), e.channel, hilo, "Humano", e.ts], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        toqueOficina({ hilo, ia: "Coo" });
      };
      if (nombra) avisa();
      else if (e.thread_ts) {
        hiloConCoo(c, e).then((si) => { if (si) avisa(); }).catch((x) => log(`no he podido mirar el hilo ${e.thread_ts} para ver si hay Coo: ${x.message}`));
      }
    }
    if (false && (e.user === YO || e.user === CURSOR) && normal && llamaACoo
        && !txt.includes(`<@${c.SLACK_HUMANO_ID}>`) && !vistos.has(`coo:${e.ts}`)) {
      vistos.add(`coo:${e.ts}`);
      log(`${IAS[e.user] || "Claude"} menciona a Coo en ${e.channel} (${e.ts}): aviso a Coo por webhook (Humano solo si falla)`);
      spawn(BASH, [path.join(AQUI, "avisar-coo.sh"), e.channel, e.thread_ts || e.ts, e.user === YO ? "Claude" : "Cursor", e.ts],
        { detached: true, stdio: "ignore", windowsHide: true }).unref();
      toqueOficina({ hilo: e.thread_ts || e.ts, ia: "Coo" });   // v506
    }
    const esCoo = e.user === COO || (e.user === c.SLACK_HUMANO_ID && e.app_id);
    if (esCoo && nombraCursor && normal) cooPreguntaACursor.set(hilo, Date.now());
    if (false && e.user === CURSOR && normal && !llamaACoo && e.thread_ts
        && Date.now() - (cooPreguntaACursor.get(hilo) || 0) < 30 * 60000 && !vistos.has(`coo:${e.ts}`)) {
      vistos.add(`coo:${e.ts}`); cooPreguntaACursor.delete(hilo);  // una vez por pregunta de Coo
      log(`Cursor (app) contesta a Coo en el hilo ${hilo}: aviso a Coo por webhook`);
      spawn(BASH, [path.join(AQUI, "avisar-coo.sh"), e.channel, hilo, "Cursor", e.ts],
        { detached: true, stdio: "ignore", windowsHide: true }).unref();
      toqueOficina({ hilo, ia: "Coo" });   // v506
    }
    let script = null, quien = null;
    const APP_OFI = c.OFICINA_APP_ID || (() => { try { return require("./config.js").config().oficina.appId; } catch (err) { return ""; } })() || "AOFICINA001";
    const meNombraTxt = /(^|[\s(*_])@claude\b|siguiente:?\s*[*_]*\s*claude\b|le toca a claude\b|(p[ií]do|p[ií]dele|encargo)\s+a\s+claude\b|\[\s*lo hace\s*:?\s*[*_]*claude\b|(^|\n)\s*[*_>]*\s*claude\s*[:—–]|\bpara claude\b/i.test(txtM)
      && !/\[\s*te toca\b/i.test(txtM);   // si además te pide un OK, Claude espera a tu OK (te llega a él, abajo)
    const esCooMsg = e.user === COO || (e.user === c.SLACK_HUMANO_ID && e.app_id && e.app_id !== APP_OFI);
    const haceCursor = normal && esCooMsg && haceIA(txtM, "cursor");
    if (haceCursor) lanzar(e, "atender-cursor-slack.sh", "Coo", txt);
    if (normal && (e.user === YO || e.user === CURSOR) && haceIA(txtM, "coo") && !vistos.has(`coo:${e.ts}`) && !yaRelanzado(hilo, e.ts)) {
      vistos.add(`coo:${e.ts}`);
      const de = e.user === CURSOR || /^\s*[*_]*Cursor \(v[ií]a API\)/.test(txtM) ? "Cursor" : "Claude";
      log(`${de} deja [lo hace: Coo] en el hilo ${hilo}: despierto a Coo por webhook`);
      spawn(BASH, [path.join(AQUI, "avisar-coo.sh"), e.channel, hilo, de, e.ts], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      toqueOficina({ hilo, ia: "Coo" });   // v506
    }
    if (esCooMsg && ((nombraCursor && !haceCursor) || meNombra || meNombraTxt) && normal) {
      quien = "Coo"; script = "atender-slack.sh";
    } else if (e.user === YO) {
      return;
    } else if (e.user === c.SLACK_HUMANO_ID && e.app_id && e.app_id !== APP_OFI) {   // la app de la Oficina publica por Humano: cuenta como Humano (abajo)
      if (meNombra && normal) { quien = "Coo"; script = "atender-slack.sh"; }
      else { log(`mensaje con la cuenta de Humano vía app ${e.app_id}: no es Humano, lo ignoro`); return; }
    } else if (e.user === c.SLACK_HUMANO_ID) {
      // mensaje del panel que nombra a una IA o es un OK corto: la Oficina ya lo ha lanzado
      if (e.app_id && e.app_id === APP_OFI && (/(^|[\s(])@(claude|cursor|coo)\b/i.test(txtM) || meNombra || nombraCursor || txtM.includes(`<@${COO}>`) || esOkCorto(txtM))) {
        log(`mensaje del panel (${e.ts}): ya lo lanza la Oficina, no lo lanzo otra vez`);
        return;
      }
      quien = "Humano";
      if (e.type === "app_mention") script = "atender-slack.sh";
      else if (normal && /(^|\s)@grok\b/i.test(txt)) script = "atender-grok.sh";
      else if (normal && /\bclaude\b/i.test(txt)) script = "atender-slack.sh";
      else if (normal && e.thread_ts && esOkCorto(txtM)) {
        const vk = `okclaude:${e.ts}`; if (vistos.has(vk)) return; vistos.add(vk);
        okParaClaudeEnHilo(c, e).then((pre) => {
          if (!pre) return;
          log(`OK de Humano (${e.ts}) a una pregunta de ${pre.quien} que hace Claude: se lo paso a Claude`);
          lanzar(e, "atender-slack.sh", "Humano", `${txt}\n(Es el OK de Humano a lo que propuso ${pre.quien} en este hilo: «${pre.texto}». Lo haces tú, Claude.)`, { ok_reenviado: true });
        }).catch((x) => log(`no he podido mirar el hilo para el OK: ${x.message}`));
        return;
      }
    } else if (IAS[e.user] && meNombra && (e.type === "app_mention" || normal)) {
      quien = IAS[e.user]; script = "atender-slack.sh";
    }
    if (!script) { if (e.type === "app_mention") log(`mención de ${e.user} ignorada (no es Humano, Coo ni Cursor)`); return; }
    lanzar(e, script, quien, txt);
  };
  // (v155: el lanzamiento, en una función para poder usarlo también desde el OK pasado a Claude)
  function lanzar(e, script, quien, txt, extra) {
    const hilo = e.thread_ts || e.ts;
    const id = `${script}:${e.channel}:${e.ts}`;  // app_mention y message del mismo mensaje: una sola vez
    if (vistos.has(id)) return; vistos.add(id);
    if (yaRelanzado(hilo, e.ts)) { log(`la oficina ya relanzó el mensaje ${e.ts} del hilo ${hilo}: no lo lanzo otra vez`); return; }   // v224
    const clave = `${script}:${hilo}`;
    if (script === "atender-cursor-slack.sh" && Date.now() - (cursorNativo.get(hilo) || 0) < 15 * 60000) {
      log(`Cursor ya está en el hilo ${hilo} con su app: no lo lanzo por API`); return;
    }
    if (script === "atender-cursor-slack.sh") {   // sin saldo de API en este hilo (y sin un SI después): ya se avisó una vez; se espera
      let no = null; try { const CS = require("./cursor-sin-saldo.js"); if (!CS.hayCli()) no = CS.bloqueoLog({ hilo }, LOGS); } catch (x) {}   // con CLI no bloquea: solo el respaldo por API
      if (no) { log(`Cursor sin saldo de API en el hilo ${hilo} (ya avisado a las ${require("./cursor-sin-saldo.js").hhmm(no.t)}): no lo relanzo, se espera`); return; }
    }
    if (script !== "atender-grok.sh" && activos.has(clave)) {
      if (quien !== "Humano") { log(`ya hay un ${script} trabajando en el hilo ${hilo}: no abro otro (releerá el hilo al terminar)`); return; }
      log(`ya hay un ${script} trabajando en el hilo ${hilo}: el mensaje de Humano espera su turno`);
    }
    const f = path.join(os.tmpdir(), `slack-mencion-${Date.now()}-${script.slice(8, 14)}.json`);
    fs.writeFileSync(f, JSON.stringify({ text: txt, channel: e.channel, ts: e.ts, thread_ts: e.thread_ts || e.ts, quien, ...(extra || {}) }));
    log(`mensaje de ${quien} en ${e.channel} (${e.ts}) para ${script}: lo atiendo`);
    const p = spawn(BASH, [path.join(AQUI, script), f], { detached: true, stdio: "ignore", windowsHide: true });
    toqueOficina({ hilo, ia: IA_DE_SCRIPT[script], lanzador: true });
    activos.set(clave, (activos.get(clave) || 0) + 1);
    let suelto = false;
    const suelta = () => { if (suelto) return; suelto = true; const n = (activos.get(clave) || 1) - 1; if (n > 0) activos.set(clave, n); else activos.delete(clave); };
    p.once("exit", (rc) => { suelta(); toqueOficina({ hilo, ia: IA_DE_SCRIPT[script], fin: true, rc }); });   // v508: y la oficina sabe que acabó
    p.once("error", (x) => { log(`no he podido lanzar ${script} (${BASH}): ${x.message}`); suelta(); toqueOficina({ hilo, ia: IA_DE_SCRIPT[script], fin: true, rc: -1 }); });   // v276: antes, en silencio
    p.unref();
  };
}

function yaRelanzado(hilo, ts, f = path.join(LOGS, "traspasos.log")) {
  let t = ""; try { t = fs.readFileSync(f, "utf8").slice(-200000); } catch (e) { return false; }
  const clave = `slack:${hilo}:${ts}`;   // línea: <iso> RELANZO <IA> slack <clave> <qué>, separada por tabuladores
  return t.split("\n").some((l) => { const c = l.split("\t"); return c[1] === "RELANZO" && c[3] === "slack" && c[4] === clave; });
}
// el canal que se escucha: SLACK_CANAL_ID de canal-slack.env o, si no está, el slack.canalId de la config (si no es el de ejemplo)
function canalDe(c) {
  if (c.SLACK_CANAL_ID) return c.SLACK_CANAL_ID;
  try { const C = require("./config.js"), id = C.config().slack.canalId; return id && id !== C.EJEMPLO.slack.canalId ? id : ""; } catch (err) { return ""; }
}
// Coo publicado por el bot del Edificio (POST /api/coo/publicar de la Oficina): con el nombre «Coo · Geoffrey» o, sin el permiso
// chat:write.customize, con «Coo:» delante y la marca de bot/app
const NOMBRE_COO_BOT = "Coo · Geoffrey";
function esCooBot(m) {
  return !!m && (m.username === NOMBRE_COO_BOT || (m.bot_profile && m.bot_profile.name) === NOMBRE_COO_BOT
    || (!!(m.bot_id || m.app_id) && /^\s*Coo:/.test(String(m.text || ""))));
}
// ¿ha escrito Coo (esCooBot o «Coo:», nunca solo por user) en el hilo? Primero lo visto en vivo; si no, se consulta una vez y se cachea.
const hilosDeCoo = new Map(), hilosSinCoo = new Map();
async function hiloConCoo(c, e) {
  const h = e.thread_ts;
  if (hilosDeCoo.has(h)) return true;
  if (Date.now() - (hilosSinCoo.get(h) || 0) < 60000 || !c.SLACK_BOT_TOKEN) return false;
  hilosSinCoo.set(h, Date.now());
  const r = await fetch("https://slack.com/api/conversations.replies?" + new URLSearchParams({ channel: e.channel, ts: h, limit: "200" }), { headers: { Authorization: "Bearer " + c.SLACK_BOT_TOKEN } });
  const j = await r.json(); if (!j.ok) throw new Error(j.error);
  const si = (j.messages || []).some((m) => esCooBot(m) || /^\s*Coo:/.test(String(m.text || "")));
  if (si) hilosDeCoo.set(h, Date.now());
  return si;
}
function esOkCorto(t) { return require(path.join(AQUI, "regla-ok.js")).esOk(t); }
function haceIA(t, ia) {
  return new RegExp(`\\[\\s*lo hace\\s*:?\\s*[*_]*${ia}\\b`, "i").test(String(t || "")) && !/\[\s*te toca\b/i.test(String(t || ""));
}
// v155: el último mensaje de una IA antes de este en el hilo, si pide un OK para algo que hace CLAUDE → {quien, texto}
async function okParaClaudeEnHilo(c, e) {
  if (!c.SLACK_BOT_TOKEN) return null;
  const r = await fetch("https://slack.com/api/conversations.replies?" + new URLSearchParams({ channel: e.channel, ts: e.thread_ts, limit: "200" }), { headers: { Authorization: "Bearer " + c.SLACK_BOT_TOKEN } });
  const j = await r.json(); if (!j.ok) throw new Error(j.error);
  const COO = c.SLACK_COO_ID || "UCOO0000001", YO = c.SLACK_CLAUDE_ID || "UCLAUDE0001", CUR = c.SLACK_CURSOR_ID || "UCURSOR0001";
  const ant = (j.messages || []).filter((m) => parseFloat(m.ts) < parseFloat(e.ts) && !(m.user === c.SLACK_HUMANO_ID && !m.app_id)).pop();
  if (!ant) return null;
  const t = String(ant.text || "");
  const etq = /\[\s*lo hace\s*:?\s*[*_]*claude\b/i.test(t), sinEtq = !/\[\s*(te toca|lo hace|hecho|espera)\b/i.test(t);   // v399: + [espera]
  if (!(etq || (sinEtq && /\b(ok|okey)\b/i.test(t) && /\?/.test(t) && /\bclaude\b/i.test(t)))) return null;
  const quien = esCooBot(ant) || (ant.user === c.SLACK_HUMANO_ID && /^\s*Coo:/.test(t)) ? "Coo" : ant.user === YO ? "Claude" : ant.user === CUR ? "Cursor" : (ant.user === COO || ant.app_id) ? "Coo" : "una IA";
  return { quien, texto: t.replace(/<@[A-Z0-9]+>/g, "@").replace(/\s+/g, " ").slice(0, 400) };
}

process.on("uncaughtException", (e) => log(`excepción: ${e.stack || e}`));
// v565: y una promesa sin recoger (un manejador async de un evento de Slack, el minuto del turno): Node cerraba la escucha y los
// mensajes de Humano no despertaban a nadie hasta que la oficina la levantaba. Se apunta y sigue escuchando.
process.on("unhandledRejection", (e) => log(`excepción (promesa sin recoger): ${(e && e.stack) || e}`));
log(`arranco (pid ${process.pid})`);
conectar();
