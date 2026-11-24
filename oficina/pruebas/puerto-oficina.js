"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), crypto = require("crypto"), { spawn } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");
const marco = (t) => { const b = Buffer.from(t, "utf8"), n = b.length; return Buffer.concat([n < 126 ? Buffer.from([0x81, n]) : Buffer.from([0x81, 126, n >> 8, n & 255]), b]); };
const { puertoOficina } = require(path.join(HERR, "puerto-oficina.js"));

module.exports = async ({ prueba, igual }) => {
  console.log("el puerto de la Oficina: el que ella misma deja escrito");
  await prueba("puertoOficina: manda el entorno; si no, el fichero; con basura 4317; sin fichero y en pruebas, vacío", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "puerto-"));
    try {
      const logs = path.join(T, ".canal-logs"); fs.mkdirSync(logs);
      igual(puertoOficina({ env: {}, logs, pruebas: true }), "", "sin fichero y pruebas");
      igual(puertoOficina({ env: {}, logs }), "4317", "sin fichero");
      fs.writeFileSync(path.join(logs, "oficina.puerto"), "4391\n");
      igual(puertoOficina({ env: {}, logs }), "4391", "el fichero");
      igual(puertoOficina({ env: { OFICINA_PORT: "5000" }, logs }), "5000", "el entorno manda");
      igual(puertoOficina({ env: { CANAL_HOME: T } }), "4391", "logs por defecto: CANAL_HOME/.canal-logs");
      fs.writeFileSync(path.join(logs, "oficina.puerto"), "abc; rm -rf");
      igual(puertoOficina({ env: {}, logs }), "4317", "basura: 4317");
      igual(puertoOficina({ env: {}, logs, pruebas: true }), "", "basura y pruebas: vacío");
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  });

  await prueba("la escucha de verdad toca la Oficina en el puerto de oficina.puerto (sin OFICINA_PORT)", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "puerto-esc-")), H = path.join(T, "herr"), HOME = path.join(T, "home");
    const JJ = "UHUMANO02";
    for (const d of [H, path.join(HOME, ".config"), path.join(HOME, ".canal-logs")]) fs.mkdirSync(d, { recursive: true });
    for (const s of ["escucha-slack.js", "regla-ok.js", "git-bash.js", "puerto-oficina.js"]) fs.copyFileSync(path.join(HERR, s), path.join(H, s));
    for (const s of ["atender-slack.sh", "atender-cursor-slack.sh", "atender-grok.sh", "avisar-coo.sh"]) fs.writeFileSync(path.join(H, s), "#!/usr/bin/env bash\nexit 0\n");
    fs.writeFileSync(path.join(HOME, ".config", "canal-slack.env"), `SLACK_APP_TOKEN=xapp-prueba\nSLACK_HUMANO_ID=${JJ}\n`);
    const toques = [];
    const ofi = http.createServer((q, r) => { let b = ""; q.on("data", (x) => b += x); q.on("end", () => { toques.push(`${q.method} ${q.url}`); r.end("ok"); }); });
    await new Promise((r) => ofi.listen(0, "127.0.0.1", r));
    fs.writeFileSync(path.join(HOME, ".canal-logs", "oficina.puerto"), String(ofi.address().port));
    const socks = [];
    const srv = http.createServer((q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ ok: true, url: `ws://127.0.0.1:${srv.address().port}/ws` })); });
    srv.on("upgrade", (req, sock) => { socks.push(sock); sock.on("error", () => {}); sock.on("data", () => {});
      const k = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
      sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${k}\r\n\r\n`); });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    const env = { ...process.env, CANAL_HOME: HOME, CANAL_PRUEBAS: "1", CANAL_BASH: "bash", SLACK_OPEN_URL: `http://127.0.0.1:${srv.address().port}/open` };
    delete env.OFICINA_PORT;
    const p = spawn(process.execPath, [path.join(H, "escucha-slack.js")], { stdio: "ignore", windowsHide: true, env });
    const espera = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      for (let i = 0; i < 50 && !socks.length; i++) await espera(100);
      await espera(500);
      const ev = { type: "message", user: JJ, text: "hola", channel: "C0PRUEBA", ts: "1794990000.000001" };
      socks[socks.length - 1].write(marco(JSON.stringify({ type: "events_api", envelope_id: "e1", payload: { event: ev } })));
      for (let t = 0; t < 20000 && !toques.length; t += 100) await espera(100);
      igual(toques.includes("POST /api/toque"), true, "el servidor falso recibe POST /api/toque (recibido: " + toques.join(",") + ")");
    } finally {
      try { p.kill(); } catch (e) {} socks.forEach((s) => s.destroy()); srv.close(); ofi.close(); await espera(1500);
      try { fs.rmSync(T, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { if (!/^(EPERM|EBUSY|ENOTEMPTY)$/.test(e.code)) throw e; }
    }
  });

  await prueba("server.js escribe oficina.puerto (con PORT) en la misma línea que oficina.pid", async () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    const l = src.split(/\r?\n/).find((x) => x.includes('"oficina.pid"') && x.includes("writeFileSync"));
    igual(!!l, true, "hay una línea que escribe oficina.pid");
    igual(/writeFileSync\(path\.join\(LOGS, "oficina\.puerto"\), String\(PORT\)\)/.test(l), true, "y esa línea escribe oficina.puerto con PORT");
  });
};
