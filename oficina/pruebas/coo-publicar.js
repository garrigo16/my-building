"use strict";
// POST /api/coo/publicar (Coo publica con el bot del Edificio), quien(m) para los mensajes de ese bot y la escucha sin bucles.
// Sin red: los scopes, el chat.postMessage y el permalink van inyectados; la escucha habla con un Slack falso local.
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), crypto = require("crypto"), { spawn } = require("child_process");
const { EventEmitter } = require("events");
const S = require("../server.js");
const HERR = path.join(__dirname, "..", "..", "herramientas");
const marco = (t) => { const b = Buffer.from(t, "utf8"), n = b.length; return Buffer.concat([n < 126 ? Buffer.from([0x81, n]) : Buffer.from([0x81, 126, n >> 8, n & 255]), b]); };

function llama(cabeceras, cuerpo, dep) {
  return new Promise((ok) => {
    const req = new EventEmitter(); req.method = "POST"; req.url = "/api/coo/publicar"; req.headers = cabeceras;
    const res = { code: 0, writeHead(c) { this.code = c; }, end(b) { ok({ code: this.code, j: b ? JSON.parse(b) : null }); } };
    S.cooPublicarRuta(req, res, dep);
    setImmediate(() => { if (cuerpo !== undefined) req.emit("data", typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo)); req.emit("end"); });
  });
}
const CLAVE = "clave-de-prueba-123";
const depCon = (scopes, posts) => ({
  cfg: { COO_WEBHOOK_KEY: CLAVE, SLACK_BOT_TOKEN: "tok-falso" },
  scopes: async () => scopes,
  post: async (p) => { posts.push(p); return { ok: true, ts: "1795540999.000100", channel: p.channel }; },
  permalink: async (ch, ts) => `https://ejemplo.slack.com/archives/${ch}/p${ts.replace(".", "")}`,
});

const casosServidor = async ({ prueba, igual }) => {
  console.log("Coo publica con el bot del Edificio");
  const BUENO = { channel: "C0CJ16RBL6A", thread_ts: "1795540186.383009", text: "Prueba [hecho]" };

  await prueba("coo/publicar: sin clave 401, clave mala 403, sin clave configurada 503, buena 200", async () => {
    const posts = [], dep = depCon(["chat:write"], posts);
    igual((await llama({}, BUENO, dep)).code, 401, "sin Authorization");
    igual((await llama({ authorization: "Bearer otra-clave" }, BUENO, dep)).code, 403, "clave mala");
    igual((await llama({ authorization: "Bearer " + CLAVE + "x" }, BUENO, dep)).code, 403, "clave con un carácter de más");
    igual((await llama({ authorization: "Bearer " + CLAVE }, BUENO, { ...dep, cfg: { SLACK_BOT_TOKEN: "t" } })).code, 503, "sin COO_WEBHOOK_KEY ni GROK_WEBHOOK_KEY");
    igual((await llama({ authorization: "Bearer " + CLAVE }, BUENO, { ...dep, cfg: { GROK_WEBHOOK_KEY: CLAVE, SLACK_BOT_TOKEN: "t" } })).code, 200, "vale también GROK_WEBHOOK_KEY");
    igual(posts.length, 1, "solo publica la petición buena");
    const r = await llama({ authorization: "Bearer " + CLAVE }, BUENO, dep);
    igual(r.code, 200, "clave buena");
    igual([r.j.ok, r.j.ts, r.j.channel, r.j.modo, r.j.permalink], [true, "1795540999.000100", "C0CJ16RBL6A", "prefijo", "https://ejemplo.slack.com/archives/C0CJ16RBL6A/p1795540999000100"], "respuesta");
  });

  await prueba("coo/publicar: valida text, thread_ts y channel (vacío = el del canal)", async () => {
    const posts = [], dep = depCon(["chat:write"], posts), h = { authorization: "Bearer " + CLAVE };
    igual((await llama(h, { ...BUENO, text: "  " }, dep)).code, 400, "text vacío");
    igual((await llama(h, { ...BUENO, thread_ts: "abc" }, dep)).code, 400, "thread_ts sin formato");
    igual((await llama(h, "{roto", dep)).code, 400, "json roto");
    igual(posts.length, 0, "nada publicado");
    const r = await llama(h, { channel: "", text: "sin hilo" }, dep);
    igual(r.code, 200, "sin channel ni thread_ts vale");
    igual(posts[0].channel.length > 0, true, "channel por defecto");
    igual("thread_ts" in posts[0], false, "sin thread_ts, mensaje nuevo");
  });

  await prueba("coo/publicar: con chat:write.customize firma «Coo · Geoffrey»; sin él, «Coo:» delante (una sola vez)", async () => {
    const h = { authorization: "Bearer " + CLAVE };
    let posts = [];
    const a = await llama(h, BUENO, depCon(["chat:write", "chat:write.customize"], posts));
    igual(a.j.modo, "username", "modo con customize");
    igual([posts[0].username, posts[0].text, posts[0].thread_ts], ["Coo · Geoffrey", "Prueba [hecho]", "1795540186.383009"], "payload con username");
    posts = [];
    const b = await llama(h, BUENO, depCon(["chat:write", "channels:history"], posts));
    igual(b.j.modo, "prefijo", "modo sin customize");
    igual([posts[0].username, posts[0].text], [undefined, "Coo: Prueba [hecho]"], "payload con prefijo");
    posts = [];
    await llama(h, { ...BUENO, text: "Coo: ya lo llevaba" }, depCon(["chat:write"], posts));
    igual(posts[0].text, "Coo: ya lo llevaba", "no duplica el prefijo");
  });

  await prueba("coo/publicar: los scopes salen de x-oauth-scopes de auth.test, cacheados por token", async () => {
    const real = global.fetch; let n = 0;
    global.fetch = async (u) => { n++; if (!/auth\.test/.test(u)) throw new Error("url inesperada " + u);
      return { status: 200, ok: true, headers: new Map([["x-oauth-scopes", "chat:write,chat:write.customize,channels:history"]]), json: async () => ({ ok: true }) }; };
    try {
      igual(await S.scopesBot("tok-scopes-1"), ["chat:write", "chat:write.customize", "channels:history"], "scopes");
      await S.scopesBot("tok-scopes-1");
      igual(n, 1, "la segunda vez, de la caché");
    } finally { global.fetch = real; }
  });

  await prueba("quien(m): el bot del Edificio con «Coo · Geoffrey» o «Coo:» es Coo; el mismo bot sin eso es Claude", async () => {
    const CL = "UCLAUDE0001";
    igual(S.quien({ user: CL, bot_id: "B1", app_id: "A0CJ31EK79Q", username: "Coo · Geoffrey", text: "hola" }), "Coo", "username");
    igual(S.quien({ bot_id: "B1", subtype: "bot_message", bot_profile: { name: "Coo · Geoffrey" }, text: "hola" }), "Coo", "bot_profile");
    igual(S.quien({ user: CL, bot_id: "B1", app_id: "A0CJ31EK79Q", text: "Coo: hola [hecho]" }), "Coo", "prefijo con bot");
    igual(S.quien({ user: CL, bot_id: "B1", app_id: "A0CJ31EK79Q", text: "hecho [hecho]" }), "Claude", "el bot sin marca de Coo es Claude");
    igual(S.quien({ bot_id: "B9", text: "aviso" }), "Sistema", "otro bot cualquiera");
  });
};

module.exports = async (ay) => {
  await casosServidor(ay);
  const { prueba, igual } = ay;
  await prueba("escucha: Coo por el bot del Edificio no despierta a nadie salvo [lo hace: Claude|Cursor] y nunca avisar-coo.sh", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "esbot-")), H = path.join(T, "herr"), HOME = path.join(T, "home");
    const JJ = "UHUMANO02", CANAL = "C0PRUEBA", BOT = "UBOTEDIF01";
    for (const d of [H, path.join(HOME, ".config"), path.join(HOME, ".canal-logs")]) fs.mkdirSync(d, { recursive: true });
    for (const s of ["escucha-slack.js", "regla-ok.js", "git-bash.js", "puerto-oficina.js"]) fs.copyFileSync(path.join(HERR, s), path.join(H, s));
    const llamadas = path.join(T, "llamadas.txt").replace(/\\/g, "/");
    fs.writeFileSync(path.join(H, "atender-slack.sh"), `#!/usr/bin/env bash\nq=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.quien+":"+j.ts)' "$1"); rm -f "$1"\necho "empieza $q" >> '${llamadas}'\n`);
    for (const s of ["atender-cursor-slack.sh", "atender-grok.sh", "avisar-coo.sh"]) fs.writeFileSync(path.join(H, s), `#!/usr/bin/env bash\n[ -f "\${1:-}" ] && rm -f "$1"\necho "${s}" >> '${llamadas}'\n`);
    fs.writeFileSync(path.join(HOME, ".config", "canal-slack.env"), `SLACK_APP_TOKEN=xapp-prueba\nSLACK_HUMANO_ID=${JJ}\nSLACK_CANAL_ID=${CANAL}\nSLACK_CLAUDE_ID=${BOT}\n`);
    const socks = [];
    const srv = http.createServer((q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ ok: true, url: `ws://127.0.0.1:${srv.address().port}/ws` })); });
    srv.on("upgrade", (req, sock) => { socks.push(sock); sock.on("error", () => {}); sock.on("data", () => {});
      const k = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${k}\r\n\r\n`); });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const p = spawn(process.execPath, [path.join(H, "escucha-slack.js")], { stdio: "ignore", windowsHide: true,
      env: { ...process.env, CANAL_HOME: HOME, CANAL_PRUEBAS: "1", CANAL_BASH: "bash", SLACK_OPEN_URL: `http://127.0.0.1:${srv.address().port}/open` } });
    const espera = (ms) => new Promise((r) => setTimeout(r, ms));
    let n = 0;
    const manda = (extra) => { const ts = `1795540000.${String(++n).padStart(6, "0")}`, ev = { type: "message", channel: CANAL, ts, thread_ts: "1795540186.383009", ...extra };
      socks[socks.length - 1].write(marco(JSON.stringify({ type: "events_api", envelope_id: "e" + n, payload: { event: ev } }))); return ts; };
    const lee = () => (fs.existsSync(llamadas) ? fs.readFileSync(llamadas, "utf8") : "").trim().split(/\r?\n/).filter(Boolean);
    const hasta = async (cond, ms = 20000) => { for (let t = 0; t < ms && !cond(lee()); t += 100) await espera(100); return cond(lee()); };
    try {
      for (let i = 0; i < 50 && !socks.length; i++) await espera(100);
      await espera(500);
      const bot = { user: BOT, bot_id: "BEDIF01", app_id: "A0CJ31EK79Q" };
      const t1 = manda({ ...bot, subtype: "bot_message", username: "Coo · Geoffrey", text: `<@${BOT}> mira esto, claude @coo [lo hace: Coo — x]` });
      const t2 = manda({ ...bot, text: "Coo: Prueba de Coo vía bot del Edificio [hecho]" });
      const t3 = manda({ ...bot, text: `Coo: lo dejo encargado <@${BOT}> [lo hace: Claude — y]` });
      const t4 = manda({ ...bot, subtype: "bot_message", username: "Coo · Geoffrey", text: "encargo [lo hace: Cursor — z]" });
      const t5 = manda({ ...bot, text: "hecho, Coo [lo hace: Coo — revisar]" });   // testigo: es Claude (sin marca de Coo) y pide a Coo
      await hasta((l) => l.includes(`empieza Coo:${t3}`) && l.includes("atender-cursor-slack.sh") && l.includes("avisar-coo.sh"));
      await espera(1500);
      const l = lee();
      igual(l.some((x) => x.includes(t1) || x.includes(t2)), false, "Coo por el bot sin [lo hace: Claude|Cursor]: no despierta a nadie (ni aunque nombre a Claude)");
      igual(l.includes(`empieza Coo:${t3}`), true, "«Coo:» por el bot con [lo hace: Claude]: atender-slack.sh con quien=Coo");
      igual(l.filter((x) => x === "atender-cursor-slack.sh").length, 1, "«Coo · Geoffrey» con [lo hace: Cursor]: Cursor una vez");
      igual(l.filter((x) => x === "avisar-coo.sh").length, 1, "avisar-coo.sh solo por el testigo de Claude, nunca por Coo");
      igual(l.length, 3, "solo esos tres lanzamientos (t4 Cursor, t3 Claude, t5 aviso a Coo)");
      void t4; void t5;
    } finally {
      try { p.kill(); } catch (e) {} socks.forEach((s) => s.destroy()); srv.close(); await espera(1500);
      try { fs.rmSync(T, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { if (!/^(EPERM|EBUSY|ENOTEMPTY)$/.test(e.code)) throw e; }
    }
  });
};
