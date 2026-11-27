"use strict";
// Firma real de cada IA en Slack: todo sale por UN solo bot, así que el autor lo dice la firma (username con chat:write.customize o
// cabecera «*Claude:*», «*Cursor (vía CLI):*», «Coo: …» en la primera línea). Cubre quien(m), herramientas/responder-slack.sh,
// POST /api/coo/publicar con «autor», analizar() y que la escucha no se relance con una respuesta firmada «Claude:».
// Sin red real: Slack falso local (CANAL_PRUEBAS=1 + SLACK_API_URL), HOME temporal.
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), crypto = require("crypto"), { spawn } = require("child_process");
const { EventEmitter } = require("events");
const S = require("../server.js");
const HERR = path.join(__dirname, "..", "..", "herramientas");
const marco = (t) => { const b = Buffer.from(t, "utf8"), n = b.length; return Buffer.concat([n < 126 ? Buffer.from([0x81, n]) : Buffer.from([0x81, 126, n >> 8, n & 255]), b]); };
const rmT = (d) => { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { if (!/^(EPERM|EBUSY|ENOTEMPTY)$/.test(e.code)) throw e; } };

// Slack falso para responder-slack.sh: guarda los chat.postMessage y contesta auth.test con los scopes que se le digan.
async function slackFalso(scopes) {
  const st = { posts: [], auth: [], scopes };
  const srv = http.createServer((q, r) => {
    let b = ""; q.on("data", (d) => { b += d; });
    q.on("end", () => {
      r.setHeader("content-type", "application/json");
      if (/auth\.test$/.test(q.url)) { st.auth.push(q.headers.authorization || ""); if (st.scopes !== null) r.setHeader("x-oauth-scopes", st.scopes); return r.end(JSON.stringify({ ok: true })); }
      st.posts.push({ url: q.url, auth: q.headers.authorization || "", body: JSON.parse(b || "{}") });
      r.end(JSON.stringify({ ok: true, ts: "1795540999.000100", channel: "C0PRUEBA" }));
    });
  });
  await new Promise((ok) => srv.listen(0, "127.0.0.1", ok));
  st.url = `http://127.0.0.1:${srv.address().port}`; st.cerrar = () => srv.close();
  return st;
}
// responder-slack.sh de verdad contra el Slack falso, con HOME propio (config con un token falso y la caché de scopes limpia)
function responde({ HOME, st, texto, autor, args }) {
  const TXT = path.join(HOME, "r.txt"); fs.writeFileSync(TXT, texto);
  const env = { ...process.env, HOME, CANAL_PRUEBAS: "1", SLACK_API_URL: st.url, RESPONDER_ESPERA: "0" };
  delete env.CANAL_SIN_SLACK; delete env.AUTOR; if (autor !== undefined) env.AUTOR = autor;
  return new Promise((ok) => {
    const p = spawn("bash", [path.join(HERR, "responder-slack.sh"), ...(args || ["C0PRUEBA", "1795540186.383009", TXT])], { env, windowsHide: true });
    let out = "", err = ""; p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { err += d; });
    p.on("close", (rc) => ok({ rc, out, err }));
  });
}
const TOKEN = "xoxb-token-falso-de-prueba-123456";
const casa0 = () => { const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "firma-")); fs.mkdirSync(path.join(HOME, ".config"), { recursive: true });
  fs.writeFileSync(path.join(HOME, ".config", "canal-slack.env"), `SLACK_BOT_TOKEN=${TOKEN}\n`); return HOME; };

function llama(cuerpo, dep) {
  return new Promise((ok) => {
    const req = new EventEmitter(); req.method = "POST"; req.url = "/api/coo/publicar"; req.headers = { authorization: "Bearer clave-de-prueba-123" };
    const res = { code: 0, writeHead(c) { this.code = c; }, end(b) { ok({ code: this.code, j: b ? JSON.parse(b) : null }); } };
    S.cooPublicarRuta(req, res, dep);
    setImmediate(() => { req.emit("data", JSON.stringify(cuerpo)); req.emit("end"); });
  });
}
const depCon = (scopes, posts, localF) => ({ cfg: { COO_WEBHOOK_KEY: "clave-de-prueba-123", SLACK_BOT_TOKEN: "tok-falso" }, scopes: async () => scopes,
  post: async (p) => { posts.push(p); return { ok: true, ts: "1795540999.000100", channel: p.channel }; }, permalink: async () => "https://ejemplo.slack.com/x", ...(localF ? { localF } : {}) });

module.exports = async ({ prueba, igual, casa, C, oficina }) => {
  console.log("Firma real de cada IA (Claude / Cursor / Coo)");
  const BOT = { user: "UCOO0000001", bot_id: "B1", app_id: "A0CJ31EK79Q" };   // el bot del Edificio (en la config real, SLACK_COO_ID)
  const HUM = "UHUMANO0001";

  await prueba("quien(): firma explícita gana; sin firma el bot sigue siendo Coo; Humano, Charla y Gus no cambian", () => {
    const q = (o) => S.quien({ ...BOT, ...o });
    igual(q({ text: "hecho, ya está" }), "Coo", "bot sin marca = Coo (compatibilidad)");
    igual(q({ text: "*Claude:*\nya está" }), "Claude", "*Claude:*");
    igual(q({ text: "Claude: ya está" }), "Claude", "Claude: sin asteriscos");
    igual(q({ text: "*Cursor (vía CLI):*\nlisto" }), "Cursor", "Cursor vía CLI");
    igual(q({ text: "*Cursor (vía API):*\nlisto" }), "Cursor", "Cursor vía API");
    igual(q({ text: "*Cursor no ha arrancado (la API no responde, http 500, 3 intentos).* Si corre prisa…" }), "Cursor", "aviso de Cursor sin «:»");
    igual(q({ text: "Coo: ya está" }), "Coo", "Coo:");
    igual(q({ text: "*Claude (vía Coo):*\nya está" }), "Claude", "Claude vía Coo");
    igual(q({ text: "*Cursor (vía Coo):*\nya está" }), "Cursor", "Cursor vía Coo");
    igual(q({ text: "hola", username: "Claude" }), "Claude", "username Claude");
    igual(q({ text: "hola", username: "Cursor" }), "Cursor", "username Cursor");
    igual(q({ text: "hola", username: "Coo · Geoffrey" }), "Coo", "username Coo");
    igual(S.quien({ bot_id: "B1", subtype: "bot_message", bot_profile: { name: "Cursor" }, text: "hola" }), "Cursor", "bot_profile.name Cursor");
    igual(q({ text: "*Claude:*\nCoo: dentro del texto no cuenta" }), "Claude", "la firma es la de la primera línea");
    igual(S.quien({ bot_id: "B9", text: "aviso de otro bot" }), "Sistema", "otro bot cualquiera");
    // la cuenta de Humano
    igual(S.quien({ user: HUM, text: "Claude: lo hago yo" }), "Humano", "Humano escribiendo «Claude:» a mano sigue siendo Humano");
    igual(S.quien({ user: HUM, app_id: S.APP_OFICINA, text: "Claude: hazlo" }), "Humano", "Humano por la Oficina sigue siendo Humano");
    igual(S.quien({ user: HUM, app_id: "A0OTRA", bot_id: "B2", text: "Coo: hola" }), "Coo", "«Coo:» por la cuenta de Humano con app_id = Coo");
    igual(S.quien({ user: HUM, app_id: "A0OTRA", bot_id: "B2", text: "Coo · Geoffrey publica" }), "Coo", "conector sin firma = Coo (como hasta ahora)");
    igual(S.quien({ user: HUM, text: "Coo: hola" }), "Coo", "«Coo:» en la cuenta de Humano sin app = Coo (regla de siempre)");
    igual(S.quien({ user: HUM, text: "hola" }), "Humano", "Humano normal");
    igual(S.quien({ user: HUM, app_id: "A0CHAT", bot_id: "B3", text: "💬 Charla: Marta ha escrito" }), "Charla", "Charla");
    igual(S.quien({ user: HUM, app_id: "A0MAIL", bot_id: "B4", text: "✉️ Gus: correo de Eva" }), "Gus", "Gus");
    // el pie «Sent using @app» (ids de ejemplo de la config de pruebas)
    const cur = "UCURSOR0001", cla = "UCLAUDE0001";
    igual(S.quien({ user: HUM, app_id: "A0CUR", bot_id: "B5", text: `Mira esto\n*Sent using* <@${cur}>` }), "Cursor", "pie con el id de Cursor, sin firma");
    igual(S.quien({ user: HUM, app_id: "A0CLA", bot_id: "B6", text: `Mira esto\n*Sent using* <@${cla}>` }), "Claude", "pie con el id de Claude, sin firma");
    igual(S.quien({ user: HUM, app_id: "A0CUR", bot_id: "B5", text: `Coo: mira esto\n*Sent using* <@${cur}>` }), "Coo", "«Coo:» delante gana al pie");
    igual(S.quien({ user: HUM, app_id: "A0X", bot_id: "B7", text: "Mira esto\n*Sent using* <@UOTRA000001>" }), "Coo", "pie de otra app = Coo, como hasta ahora");
  });

  const montaSlack = async (scopes) => { const HOME = casa0(), st = await slackFalso(scopes); return { HOME, st, fin: () => { st.cerrar(); rmT(HOME); } }; };

  await prueba("responder-slack.sh sin chat:write.customize: antepone «*<Autor>:*» (Claude por defecto), no duplica, Sistema sin firma, token fuera de la salida", async () => {
    const { HOME, st, fin } = await montaSlack("chat:write,channels:history");
    try {
      let r = await responde({ HOME, st, texto: "Todo listo." });
      igual([r.rc, st.posts.length, st.posts[0].body.text, "username" in st.posts[0].body], [0, 1, "*Claude:*\nTodo listo.", false], "Claude por defecto");
      igual(st.posts[0].auth, "Bearer " + TOKEN, "el token va en la cabecera, no en el cuerpo");
      igual((r.out + r.err + JSON.stringify(st.posts[0].body)).includes(TOKEN), false, "el token no sale ni en la salida ni en el texto");
      r = await responde({ HOME, st, texto: "Listo por la API.", autor: "Cursor" });
      igual(st.posts[1].body.text, "*Cursor:*\nListo por la API.", "AUTOR=Cursor");
      r = await responde({ HOME, st, texto: "Coo avisa.", autor: "Coo" });
      igual(st.posts[2].body.text, "*Coo:*\nCoo avisa.", "AUTOR=Coo");
      for (const t of ["*Claude:* ya lo hice", "Claude: ya lo hice", "*Cursor (vía CLI):*\nya", "Cursor (vía API): el agente terminó sin respuesta.", "Coo: aviso", "*Claude (vía Coo):*\nya", "*Cursor no ha arrancado (…).* Si corre prisa…"]) {
        const n = st.posts.length; await responde({ HOME, st, texto: t });
        igual(st.posts[n].body.text, t, "ya firmado, no se duplica: " + t.slice(0, 25));
      }
      let n = st.posts.length;
      for (const a of ["Sistema", "-", "sistema", "otra-cosa"]) { await responde({ HOME, st, texto: "🚫 Freno anti ping-pong", autor: a }); }
      igual(st.posts.slice(n).map((p) => p.body.text), Array(4).fill("🚫 Freno anti ping-pong"), "Sistema, «-» o desconocido: sin firma");
      n = st.posts.length;
      r = await responde({ HOME, st, texto: "x", args: ["--reaccion", "C0PRUEBA", "1795540186.383009", "eyes"] });
      igual([r.rc, st.posts[n].url, st.posts[n].body.name, "text" in st.posts[n].body], [0, "/reactions.add", "eyes", false], "la reacción no lleva firma");
      igual(st.auth.length, 1, "auth.test una sola vez: el resultado se cachea");
    } finally { fin(); }
  });

  await prueba("responder-slack.sh con chat:write.customize: username e icon_emoji del autor y SIN cabecera", async () => {
    const { HOME, st, fin } = await montaSlack("chat:write,chat:write.customize");
    try {
      await responde({ HOME, st, texto: "Todo listo." });
      igual([st.posts[0].body.text, st.posts[0].body.username, !!st.posts[0].body.icon_emoji], ["Todo listo.", "Claude", true], "Claude");
      await responde({ HOME, st, texto: "Hecho.", autor: "Cursor" });
      igual([st.posts[1].body.text, st.posts[1].body.username], ["Hecho.", "Cursor"], "Cursor");
      await responde({ HOME, st, texto: "Aviso.", autor: "Coo" });
      igual([st.posts[2].body.text, st.posts[2].body.username], ["Aviso.", "Coo · Geoffrey"], "Coo");
      await responde({ HOME, st, texto: "🚫 Freno", autor: "Sistema" });
      igual([st.posts[3].body.text, "username" in st.posts[3].body], ["🚫 Freno", false], "Sistema: ni nombre ni cabecera");
      igual(S.quien({ ...BOT, username: st.posts[0].body.username, text: st.posts[0].body.text }), "Claude", "la Oficina lo lee como Claude");
      igual(st.auth.length, 1, "scopes cacheados");
    } finally { fin(); }
  });

  await prueba("responder-slack.sh: si auth.test no da scopes, sin customize (cabecera); el secreto en el texto sigue bloqueando; CANAL_SIN_SLACK no envía", async () => {
    const { HOME, st, fin } = await montaSlack(null);
    try {
      await responde({ HOME, st, texto: "Hecho.", autor: "Cursor" });
      igual([st.posts[0].body.text, "username" in st.posts[0].body], ["*Cursor:*\nHecho.", false], "sin cabecera x-oauth-scopes = sin customize");
      const r = await responde({ HOME, st, texto: `mi token es ${TOKEN}` });
      igual([r.rc, st.posts.length], [2, 1], "texto con un secreto: no sale (código 2)");
      const TXT = path.join(HOME, "r.txt");
      const env = { ...process.env, HOME, CANAL_PRUEBAS: "1", SLACK_API_URL: st.url, CANAL_SIN_SLACK: "1" };
      const q = await new Promise((ok) => { const p = spawn("bash", [path.join(HERR, "responder-slack.sh"), "C0PRUEBA", "1.2", TXT], { env, windowsHide: true }); p.on("close", ok); });
      igual([q, st.posts.length], [0, 1], "CANAL_SIN_SLACK=1: sale sin hacer nada");
    } finally { fin(); }
  });

  await prueba("POST /api/coo/publicar: sin autor igual que hoy; autor Claude/Cursor con cabecera «(vía Coo)» o con username; inválido = 400", async () => {
    const BASE = { channel: "C0CJ16RBL6A", thread_ts: "1795540186.383009", text: "Prueba [hecho]" };
    let posts = [];
    let r = await llama(BASE, depCon(["chat:write"], posts));
    igual([r.code, r.j.modo, r.j.autor, posts[0].text], [200, "prefijo", "Coo", "Coo: Prueba [hecho]"], "sin autor: Coo:");
    posts = []; r = await llama(BASE, depCon(["chat:write", "chat:write.customize"], posts));
    igual([r.j.modo, posts[0].username, posts[0].text], ["username", "Coo · Geoffrey", "Prueba [hecho]"], "sin autor con customize: Coo · Geoffrey");
    posts = []; r = await llama({ ...BASE, autor: "Claude" }, depCon(["chat:write"], posts));
    igual([r.code, r.j.modo, r.j.autor, posts[0].text, "username" in posts[0]], [200, "prefijo", "Claude", "*Claude (vía Coo):*\nPrueba [hecho]", false], "Claude sin customize");
    igual(S.quien({ ...BOT, text: posts[0].text }), "Claude", "y la Oficina lo ve como Claude");
    posts = []; r = await llama({ ...BASE, autor: "cursor" }, depCon(["chat:write"], posts));
    igual([r.j.autor, posts[0].text], ["Cursor", "*Cursor (vía Coo):*\nPrueba [hecho]"], "Cursor sin customize (mayúsculas indiferentes)");
    posts = []; r = await llama({ ...BASE, autor: "Claude", text: "*Claude:* ya llevaba su firma" }, depCon(["chat:write"], posts));
    igual(posts[0].text, "*Claude:* ya llevaba su firma", "no duplica una firma propia");
    posts = []; r = await llama({ ...BASE, autor: "Claude" }, depCon(["chat:write", "chat:write.customize"], posts));
    igual([r.j.modo, posts[0].username, posts[0].text, !!posts[0].icon_emoji], ["username", "Claude", "Prueba [hecho]", true], "Claude con customize");
    posts = []; r = await llama({ ...BASE, autor: "Cursor" }, depCon(["chat:write", "chat:write.customize"], posts));
    igual([posts[0].username, posts[0].text], ["Cursor", "Prueba [hecho]"], "Cursor con customize");
    posts = []; r = await llama({ ...BASE, autor: "Coo" }, depCon(["chat:write"], posts));
    igual(posts[0].text, "Coo: Prueba [hecho]", "autor Coo explícito = por defecto");
    posts = []; r = await llama({ ...BASE, autor: "Grok" }, depCon(["chat:write"], posts));
    igual([r.code, posts.length], [400, 0], "autor inválido: 400 y no publica");
    r = await llama({ ...BASE, autor: 5 }, depCon(["chat:write"], posts));
    igual(r.code, 400, "autor no textual: 400");
  });

  await prueba("POST /api/coo/publicar local con autor: el mensaje local lo enseña con ese autor", async () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "firmalocal-")), "coo-local.jsonl"), posts = [];
    let r = await llama({ local: true, text: "Aviso de Claude", autor: "Claude" }, depCon(["chat:write"], posts, f));
    igual([r.code, r.j.local], [200, true], "local ok");
    r = await llama({ local: true, text: "Aviso de Coo" }, depCon(["chat:write"], posts, f));
    igual(S.leeLocales(f).map((e) => e.quien), ["Claude", "Coo"], "quien guardado");
    igual(S.hilosLocales(S.leeLocales(f)).map((h) => h.msgs[0].quien), ["Claude", "Coo"], "y en los hilos de la oficina");
    r = await llama({ local: true, text: "x", autor: "Otro" }, depCon(["chat:write"], posts, f));
    igual([r.code, S.leeLocales(f).length, posts.length], [400, 2, 0], "autor inválido en local: 400, nada guardado, nada a Slack");
  });

  await prueba("analizar(): un mensaje firmado «Claude:» por el bot no cuenta como que Coo ha hablado", () => {
    const hilo = (texto) => { const raiz = C.m("10:00", "Humano", "@coo ¿puedes mirar la PR 12?"); const bot = S.quien({ ...BOT, text: texto });
      return { ts: raiz.ts, msgs: [raiz, C.m("10:03", bot, texto)], bot }; };
    const sinFirma = hilo("hecho, ya lo miré"), firmado = hilo("*Claude:*\nhecho, ya lo miré");
    igual([sinFirma.bot, firmado.bot], ["Coo", "Claude"], "quien de cada uno");
    const a = oficina("10:05", [sinFirma]), b = oficina("10:05", [firmado]);
    igual(a.hilos[0].ult.quien, "Coo", "sin firma: último de Coo (como hasta ahora)");
    igual(b.hilos[0].ult.quien, "Claude", "firmado: último de Claude");
    igual(b.hilos[0].msgs.some((x) => x.quien === "Coo"), false, "ningún mensaje de Coo en el hilo firmado");
  });

  await prueba("herramientas: Claude y Cursor firman sus respuestas y los avisos del sistema van sin firma (AUTOR en cada llamada)", () => {
    const lee = (f) => fs.readFileSync(path.join(HERR, f), "utf8");
    const slack = lee("atender-slack.sh"), cursor = lee("atender-cursor-slack.sh");
    casa(slack, /^export AUTOR=Claude\b/m, "atender-slack.sh exporta AUTOR=Claude");
    casa(cursor, /^export AUTOR=Cursor\b/m, "atender-cursor-slack.sh exporta AUTOR=Cursor");
    igual(cursor.indexOf("exec bash \"$AQUI/atender-slack.sh\"") < cursor.indexOf("export AUTOR=Cursor"), true, "el desvío a Claude no hereda AUTOR=Cursor");
    for (const f of ["atender-slack.sh", "atender-cursor-slack.sh"]) {
      const s = lee(f), lineas = s.split("\n").filter((l) => l.includes("responder-slack.sh") && l.includes('"$AV"'));
      igual(lineas.length > 0 && lineas.every((l) => /AUTOR=Sistema bash/.test(l)), true, f + ": los avisos (AV) con AUTOR=Sistema");
    }
    for (const f of ["atender-grok.sh", "avisar-coo.sh", "timbre.sh"]) {
      const l = lee(f).split("\n").filter((x) => /bash "\$AQUI\/responder-slack\.sh" "\$CH"/.test(x));
      igual(l.length > 0 && l.every((x) => /AUTOR=Sistema/.test(x)), true, f + ": avisos del sistema sin firma");
    }
    igual(/responder-slack\.sh \$CH \$HILO \$RESPF/.test(slack) && /firmado automáticamente/.test(slack), true, "el prompt de Claude dice que se firma solo");
  });

  await prueba("escucha: una respuesta firmada «*Claude:*» / «*Cursor (vía CLI):*» del bot no relanza a nadie (sin bucle); sin firma, lo de siempre", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "esfirma-")), H = path.join(T, "herr"), HOME = path.join(T, "home");
    const JJ = "UHUMANO02", CANAL = "C0PRUEBA", YO = "UBOTEDIF01", COO = "UCOOBOT0001";   // el usuario del bot del Edificio es SLACK_COO_ID, como en la config real
    for (const d of [H, path.join(HOME, ".config"), path.join(HOME, ".canal-logs")]) fs.mkdirSync(d, { recursive: true });
    for (const s of ["escucha-slack.js", "regla-ok.js", "git-bash.js", "puerto-oficina.js"]) fs.copyFileSync(path.join(HERR, s), path.join(H, s));
    const llamadas = path.join(T, "llamadas.txt").replace(/\\/g, "/");
    fs.writeFileSync(path.join(H, "atender-slack.sh"), `#!/usr/bin/env bash\nq=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.quien+":"+j.ts)' "$1"); rm -f "$1"\necho "claude $q" >> '${llamadas}'\n`);
    for (const s of ["atender-cursor-slack.sh", "atender-grok.sh", "avisar-coo.sh"]) fs.writeFileSync(path.join(H, s), `#!/usr/bin/env bash\n[ -f "\${1:-}" ] && rm -f "$1"\necho "${s}" >> '${llamadas}'\n`);
    fs.writeFileSync(path.join(HOME, ".config", "canal-slack.env"), `SLACK_APP_TOKEN=xapp-prueba\nSLACK_HUMANO_ID=${JJ}\nSLACK_CANAL_ID=${CANAL}\nSLACK_CLAUDE_ID=${YO}\nSLACK_COO_ID=${COO}\n`);
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
      const bot = { user: COO, bot_id: "BEDIF01", app_id: "A0CJ31EK79Q" };
      manda({ ...bot, text: "*Claude:*\nHecho, ya está." });
      manda({ ...bot, text: "*Claude:*\nListo, no hace falta nada más." });
      manda({ ...bot, text: "*Cursor (vía CLI):*\nTerminado, sin pendientes." });
      manda({ ...bot, text: "*Cursor (vía API):*\nTerminado, sin pendientes." });
      const t5 = manda({ ...bot, text: "Hecho. @claude mira esto" });   // testigo, sin firma: lo de siempre (Coo -> Claude)
      await hasta((l) => l.includes(`claude Coo:${t5}`));
      await espera(1500);
      const l = lee();
      igual(l, [`claude Coo:${t5}`], "solo el testigo sin firma lanza a Claude; las respuestas firmadas no relanzan a nadie");
    } finally { try { p.kill(); } catch (e) {} socks.forEach((s) => s.destroy()); srv.close(); await espera(1500); rmT(T); }
  });
};
