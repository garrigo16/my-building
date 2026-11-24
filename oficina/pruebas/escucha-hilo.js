"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), crypto = require("crypto"), { spawn } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");
const marco = (t) => { const b = Buffer.from(t, "utf8"), n = b.length; return Buffer.concat([n < 126 ? Buffer.from([0x81, n]) : Buffer.from([0x81, 126, n >> 8, n & 255]), b]); };

module.exports = async ({ prueba, igual }) => {
  console.log("la escucha: un Claude por hilo a la vez");
  await prueba("v364: con un Claude trabajando en el hilo, otra IA no abre otro; Humano, sí (espera su turno); otro hilo, a la vez; al acabar, libre", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "hilo-")), H = path.join(T, "herr"), HOME = path.join(T, "home");
    const YO = "UCLAUDE0001", COO = "UCOO0000001", JJ = "UHUMANO02";
    for (const d of [H, path.join(HOME, ".config"), path.join(HOME, ".canal-logs")]) fs.mkdirSync(d, { recursive: true });
    for (const s of ["escucha-slack.js", "regla-ok.js", "git-bash.js"]) fs.copyFileSync(path.join(HERR, s), path.join(H, s));
    const llamadas = path.join(T, "llamadas.txt").replace(/\\/g, "/");
    fs.writeFileSync(path.join(H, "atender-slack.sh"), `#!/usr/bin/env bash\nq=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.quien+":"+j.ts)' "$1"); rm -f "$1"\necho "empieza $q" >> '${llamadas}'\nsleep 3\necho "acaba $q" >> '${llamadas}'\n`);
    for (const s of ["atender-cursor-slack.sh", "atender-grok.sh", "avisar-coo.sh"]) fs.writeFileSync(path.join(H, s), `#!/usr/bin/env bash\n[ -f "\${1:-}" ] && rm -f "$1"\necho "${s}" >> '${llamadas}'\n`);
    fs.writeFileSync(path.join(HOME, ".config", "canal-slack.env"), `SLACK_APP_TOKEN=xapp-prueba\nSLACK_HUMANO_ID=${JJ}\n`);
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
    const manda = (user, text, hilo) => { const ts = `1794960000.${String(++n).padStart(6, "0")}`, ev = { type: "message", user, text, channel: "C0PRUEBA", ts, thread_ts: hilo };
      const envia = (e) => socks[socks.length - 1].write(marco(JSON.stringify({ type: "events_api", envelope_id: "e" + n + e.type, payload: { event: e } })));
      envia(ev); if (text.includes(`<@${YO}>`)) envia({ ...ev, type: "app_mention" }); return ts; };
    const lee = () => (fs.existsSync(llamadas) ? fs.readFileSync(llamadas, "utf8") : "").trim().split(/\r?\n/).filter(Boolean);
    try {
      for (let i = 0; i < 50 && !socks.length; i++) await espera(100);
      await espera(500);
      const A = "1794950000.000100", B = "1794950000.000200";
      const hasta = async (cond, ms = 20000) => { for (let t = 0; t < ms && !cond(lee()); t += 100) await espera(100); return cond(lee()); };
      const t1 = manda(JJ, `<@${YO}> mira por qué no llega el correo`, A);
      await hasta((l) => l.includes(`empieza Humano:${t1}`));   // (Claude trabajando en A: ahora sí, el hilo ocupado)
      const t2 = manda(COO, `<@${YO}> ¿y lo de las licencias?`, A);
      const t3 = manda(JJ, `<@${YO}> ok, adelante`, A);
      const t4 = manda(COO, `<@${YO}> otro tema`, B);
      await hasta((l) => l.includes(`empieza Coo:${t4}`));
      const durante = lee();
      igual([durante.includes(`empieza Humano:${t1}`), durante.some((l) => l.includes(t2)), durante.includes(`empieza Coo:${t4}`)], [true, false, true],
        "con Claude trabajando en el hilo A: el mensaje de Coo en A no abre otro; el de Coo en otro hilo (B), sí, a la vez");
      await hasta((l) => l.includes(`acaba Humano:${t3}`), 30000);
      await espera(1500);   // (lo que tarda la escucha en ver que el proceso terminó)
      igual(lee().filter((l) => l === `empieza Humano:${t3}`).length, 1, "el «ok» de Humano en A no se pierde: se lanza (espera su turno en el hilo)");
      const t5 = manda(COO, `<@${YO}> ¿ya?`, A);
      await hasta((l) => l.includes(`empieza Coo:${t5}`));
      igual(lee().includes(`empieza Coo:${t5}`), true, "al terminar los de A, el hilo queda libre: el siguiente de Coo, sí");
      igual(lee().some((l) => l.includes(t2)), false, "y el de Coo que llegó con el hilo ocupado no se lanzó nunca (su Claude lo relee al terminar)");
      igual(lee().filter((l) => l === `empieza Humano:${t3}`).length, 1, "y el «ok» de Humano, una sola vez (Slack lo manda dos veces)");
    } finally {
      try { p.kill(); } catch (e) {} socks.forEach((s) => s.destroy()); srv.close(); await espera(3500);
      try { fs.rmSync(T, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { if (!/^(EPERM|EBUSY|ENOTEMPTY)$/.test(e.code)) throw e; }
    }
  });
};
