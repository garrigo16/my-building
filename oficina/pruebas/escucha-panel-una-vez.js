"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), crypto = require("crypto"), { spawn } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");
const marco = (t) => { const b = Buffer.from(t, "utf8"), n = b.length; return Buffer.concat([n < 126 ? Buffer.from([0x81, n]) : Buffer.from([0x81, 126, n >> 8, n & 255]), b]); };

module.exports = async ({ prueba, igual }) => {
  console.log("la escucha: lo que la Oficina ya lanza desde el panel no se lanza dos veces");
  await prueba("vía APP_OFI con @claude o un OK corto: no se lanza; Humano sin app o «claude» sin @ vía APP_OFI: sí", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "panel-"), "utf8"), H = path.join(T, "herr"), HOME = path.join(T, "home");
    const JJ = "UHUMANO02", APP_OFI = "APRUEBAOFI1";
    for (const d of [H, path.join(HOME, ".config"), path.join(HOME, ".canal-logs")]) fs.mkdirSync(d, { recursive: true });
    for (const s of ["escucha-slack.js", "regla-ok.js", "git-bash.js", "puerto-oficina.js"]) fs.copyFileSync(path.join(HERR, s), path.join(H, s));
    const llamadas = path.join(T, "llamadas.txt").replace(/\\/g, "/");
    fs.writeFileSync(path.join(H, "atender-slack.sh"), `#!/usr/bin/env bash\nq=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.quien+":"+j.ts)' "$1"); rm -f "$1"\necho "empieza $q" >> '${llamadas}'\n`);
    for (const s of ["atender-cursor-slack.sh", "atender-grok.sh", "avisar-coo.sh"]) fs.writeFileSync(path.join(H, s), `#!/usr/bin/env bash\n[ -f "\${1:-}" ] && rm -f "$1"\necho "${s}" >> '${llamadas}'\n`);
    fs.writeFileSync(path.join(HOME, ".config", "canal-slack.env"), `SLACK_APP_TOKEN=xapp-prueba\nSLACK_HUMANO_ID=${JJ}\nOFICINA_APP_ID=${APP_OFI}\n`);
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
    let n = 0;
    const manda = (app_id, text, thread_ts) => { const ts = `1794980000.${String(++n).padStart(6, "0")}`, ev = { type: "message", user: JJ, text, channel: "C0PRUEBA", ts };
      if (app_id) ev.app_id = app_id; if (thread_ts) ev.thread_ts = thread_ts;
      socks[socks.length - 1].write(marco(JSON.stringify({ type: "events_api", envelope_id: "e" + n, payload: { event: ev } }))); return ts; };
    const lee = () => (fs.existsSync(llamadas) ? fs.readFileSync(llamadas, "utf8") : "").trim().split(/\r?\n/).filter(Boolean);
    const hasta = async (cond, ms = 20000) => { for (let t = 0; t < ms && !cond(lee()); t += 100) await espera(100); return cond(lee()); };
    try {
      for (let i = 0; i < 50 && !socks.length; i++) await espera(100);
      await espera(500);
      const t1 = manda(APP_OFI, "PRUEBA @claude hola");
      const t2 = manda(APP_OFI, "vale", "1794980000.999999");
      const t3 = manda(null, "@claude hola");
      const t4 = manda(APP_OFI, "mira esto, claude");
      await hasta((l) => l.includes(`empieza Humano:${t3}`) && l.includes(`empieza Humano:${t4}`));
      await espera(1500);
      const l = lee();
      igual(l.some((x) => x.includes(t1)), false, "APP_OFI con @claude: no se lanza otra vez");
      igual(l.some((x) => x.includes(t2)), false, "APP_OFI con un OK corto en un hilo: no se lanza");
      igual(l.includes(`empieza Humano:${t3}`), true, "Humano sin app_id con @claude: sí");
      igual(l.includes(`empieza Humano:${t4}`), true, "«claude» sin @ vía APP_OFI: sí");
    } finally {
      try { p.kill(); } catch (e) {} socks.forEach((s) => s.destroy()); srv.close(); await espera(1500);
      try { fs.rmSync(T, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { if (!/^(EPERM|EBUSY|ENOTEMPTY)$/.test(e.code)) throw e; }
    }
  });
};
