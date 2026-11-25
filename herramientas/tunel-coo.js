// tunel-coo.js - supervisor del túnel HTTPS de Coo (tarea «Canal IAs - tunel Coo»).
// 1) Arranca la pasarela (oficina/pasarela-coo.js) en 127.0.0.1:4392 dentro de este proceso. Si el puerto ya está cogido, otro
//    supervisor sano ya corre: este sale con 0 sin tocar nada (así relanzar la tarea nunca rompe un túnel que funciona).
// 2) Lanza cloudflared hacia la pasarela:
//    - con CLOUDFLARE_TUNNEL_TOKEN en ~/.config/canal-slack.env: túnel con nombre (URL fija), «cloudflared tunnel --no-autoupdate run»,
//      con el token por ENTORNO (TUNNEL_TOKEN), nunca en la línea de órdenes; la URL pública es COO_TUNNEL_URL.
//    - sin token: quick tunnel («--url http://127.0.0.1:4392»), y la URL https://<algo>.trycloudflare.com sale de su salida.
// 3) Deja la URL vigente (sin secretos) en ~/.canal-logs/coo-tunel.json y coo-tunel-url.txt (escritura atómica). La oficina la
//    enseña en /api/estado (tunelCoo).
// 4) Si cloudflared cae, lo relanza con espera creciente (5 s → 5 min); tras 12 caídas seguidas sin aguantar 10 min, sale con 1
//    y la tarea programada (RestartCount 5) lo vuelve a intentar.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawn, execFileSync } = require("child_process");

const PUERTO = +(process.env.COO_PASARELA_PORT || 4392);
const HOME = process.env.CANAL_HOME || os.homedir();
const LOGS = path.join(HOME, ".canal-logs");
const ESTADO_F = path.join(LOGS, "coo-tunel.json"), URL_F = path.join(LOGS, "coo-tunel-url.txt"), LOG_F = path.join(LOGS, "tunel-coo.log");
const ENV_F = path.join(HOME, ".config", "canal-slack.env");
const RUTA = "/api/coo/publicar";
const MAX_CAIDAS = 12, AGUANTA_MS = 10 * 60e3;

const extraeUrl = (txt) => { const m = String(txt).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i); return m ? m[0].toLowerCase() : ""; };
const espera = (caidas) => Math.min(5 * 60e3, 5e3 * 2 ** Math.max(0, caidas - 1));

function leeEnv(f = ENV_F) {
  const o = {};
  try { for (const l of fs.readFileSync(f, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim().replace(/^["']|["']$/g, ""); } } catch (e) {}
  return o;
}

function buscaCloudflared({ env = process.env, existe = fs.existsSync, win = process.platform === "win32" } = {}) {
  const nombre = win ? "cloudflared.exe" : "cloudflared";
  for (const d of String(env.PATH || env.Path || "").split(path.delimiter).filter(Boolean)) { const f = path.join(d.replace(/^"|"$/g, ""), nombre); if (existe(f)) return f; }
  const f = path.join(env.USERPROFILE || env.HOME || os.homedir(), ".local", "bin", nombre);
  return existe(f) ? f : "";
}

// modo y orden de cloudflared; el token solo va en el entorno del hijo
function plan(c, puerto = PUERTO) {
  if (c.CLOUDFLARE_TUNNEL_TOKEN) {
    const base = String(c.COO_TUNNEL_URL || "").trim().replace(/\/+$/, "").replace(/\/api\/coo\/publicar$/, "");
    return { modo: "fijo", args: ["tunnel", "--no-autoupdate", "run"], env: { TUNNEL_TOKEN: c.CLOUDFLARE_TUNNEL_TOKEN }, baseUrl: base };
  }
  return { modo: "quick", args: ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${puerto}`], env: {}, baseUrl: "" };
}

function estadoTunel({ ok, modo, baseUrl, puerto = PUERTO, ahora = new Date() }) {
  return { ok: !!ok, modo, baseUrl: baseUrl || "", url: baseUrl ? baseUrl + RUTA : "", puertoPasarela: puerto, actualizadoEn: ahora.toISOString() };
}

function escribeAtomico(f, txt) {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, txt);
  fs.renameSync(tmp, f);
}
function guardaEstado(e, { estado = ESTADO_F, url = URL_F } = {}) {
  escribeAtomico(estado, JSON.stringify(e, null, 2));
  escribeAtomico(url, (e.url || "") + "\n");
}

// nada que parezca un secreto en el log (cloudflared no imprime el token, pero por si acaso)
const limpia = (s) => String(s).replace(/(token|key|secret|authorization)([=:\s"]+)\S+/gi, "$1$2[oculto]").replace(/\b[A-Za-z0-9_-]{60,}\b/g, "[oculto]");

function main() {
  const anota = (s) => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(LOG_F, new Date().toISOString() + " " + limpia(s) + "\n"); } catch (e) {} };
  const { arrancar } = require(path.join(__dirname, "..", "oficina", "pasarela-coo.js"));
  arrancar({ puerto: PUERTO, anota: (s) => anota("pasarela: " + s) }).then(() => {
    anota(`pasarela en 127.0.0.1:${PUERTO} (pid ${process.pid})`);
    supervisa(anota);
  }).catch((e) => {
    if (e.code === "EADDRINUSE") { anota(`el puerto ${PUERTO} ya está cogido (otro supervisor en marcha): salgo sin tocar nada`); process.exit(0); }
    anota("pasarela: no arranca: " + e.message); process.exit(1);
  });
}

function mataHuerfano(anota) {
  // un cloudflared de un supervisor anterior que murió sin llevárselo: si su pid sigue siendo un cloudflared, fuera
  let pid = 0; try { pid = +JSON.parse(fs.readFileSync(path.join(LOGS, "coo-tunel.pid.json"), "utf8")).cloudflared || 0; } catch (e) {}
  if (!pid) return;
  try {
    const out = process.platform === "win32" ? execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8", windowsHide: true }) : "";
    if (/cloudflared/i.test(out)) { process.kill(pid); anota(`cloudflared huérfano (pid ${pid}) cerrado`); }
  } catch (e) {}
}

function supervisa(anota) {
  const exe = buscaCloudflared();
  if (!exe) { anota("no encuentro cloudflared (PATH ni %USERPROFILE%\\.local\\bin): salgo con 1"); guardaEstado(estadoTunel({ ok: false, modo: "sin-cloudflared", baseUrl: "" })); process.exit(1); }
  mataHuerfano(anota);
  let caidas = 0, hijo = null, saliendo = false;
  const fuera = () => { saliendo = true; try { if (hijo) hijo.kill(); } catch (e) {} process.exit(0); };
  process.on("SIGINT", fuera); process.on("SIGTERM", fuera); process.on("exit", () => { try { if (hijo) hijo.kill(); } catch (e) {} });

  const lanza = () => {
    const p = plan(leeEnv());
    const t0 = Date.now(); let base = p.baseUrl;
    anota(`lanzo cloudflared (${p.modo}) ${exe}`);
    hijo = spawn(exe, p.args, { env: { ...process.env, ...p.env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    try { escribeAtomico(path.join(LOGS, "coo-tunel.pid.json"), JSON.stringify({ supervisor: process.pid, cloudflared: hijo.pid })); } catch (e) {}
    if (p.modo === "fijo") guardaEstado(estadoTunel({ ok: !!base, modo: "fijo", baseUrl: base }));
    let resto = "", listo = false;
    const lee = (d) => {
      resto += d.toString("utf8"); const ls = resto.split(/\r?\n/); resto = ls.pop();
      for (const l of ls) {
        if (/\b(ERR|WRN)\b|Registered tunnel connection|trycloudflare\.com/.test(l)) anota("cloudflared: " + l.trim().slice(0, 300));
        if (p.modo === "quick" && !listo) { const u = extraeUrl(l); if (u) { base = u; listo = true; guardaEstado(estadoTunel({ ok: true, modo: "quick", baseUrl: base })); anota(`URL pública: ${base}${RUTA}`); } }
        if (p.modo === "fijo" && !listo && /Registered tunnel connection/.test(l)) { listo = true; guardaEstado(estadoTunel({ ok: !!base, modo: "fijo", baseUrl: base })); }
      }
    };
    hijo.stdout.on("data", lee); hijo.stderr.on("data", lee);
    hijo.on("error", (e) => anota("cloudflared no arranca: " + e.message));
    hijo.on("exit", (code) => {
      hijo = null; if (saliendo) return;
      try { guardaEstado(estadoTunel({ ok: false, modo: p.modo, baseUrl: base })); } catch (e) {}
      caidas = Date.now() - t0 > AGUANTA_MS ? 1 : caidas + 1;
      if (caidas > MAX_CAIDAS) { anota(`cloudflared cayó ${caidas - 1} veces seguidas: salgo con 1 (la tarea lo reintenta)`); process.exit(1); }
      const ms = espera(caidas);
      anota(`cloudflared salió (código ${code}); lo relanzo en ${Math.round(ms / 1000)} s (caída ${caidas}/${MAX_CAIDAS})`);
      setTimeout(lanza, ms);
    });
  };
  lanza();
}

module.exports = { extraeUrl, espera, buscaCloudflared, plan, estadoTunel, escribeAtomico, guardaEstado, leeEnv, limpia, ESTADO_F, MAX_CAIDAS };

if (require.main === module) main();
