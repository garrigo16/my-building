"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), crypto = require("crypto"), { spawn } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");
const marco = (t) => { const b = Buffer.from(t, "utf8"), n = b.length; return Buffer.concat([n < 126 ? Buffer.from([0x81, n]) : Buffer.from([0x81, 126, n >> 8, n & 255]), b]); };

module.exports = async ({ prueba, igual }) => {
  console.log("la escucha: el prefijo «Coo:» y el filtro de canal");
  await prueba("con la cuenta de Humano y «Coo:» delante: no despierta a nadie salvo [lo hace: Claude], nunca avisar-coo.sh; otro canal, se ignora", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "escoo-")), H = path.join(T, "herr"), HOME = path.join(T, "home");
    const JJ = "UHUMANO02", CANAL = "C0PRUEBA", OTRO = "C0OTROCANAL";
    for (const d of [H, path.join(HOME, ".config"), path.join(HOME, ".canal-logs")]) fs.mkdirSync(d, { recursive: true });
    for (const s of ["escucha-slack.js", "regla-ok.js", "git-bash.js"]) fs.copyFileSync(path.join(HERR, s), path.join(H, s));
    const llamadas = path.join(T, "llamadas.txt").replace(/\\/g, "/");
    fs.writeFileSync(path.join(H, "atender-slack.sh"), `#!/usr/bin/env bash\nq=$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write(j.quien+":"+j.ts)' "$1"); rm -f "$1"\necho "empieza $q" >> '${llamadas}'\n`);
    for (const s of ["atender-cursor-slack.sh", "atender-grok.sh", "avisar-coo.sh"]) fs.writeFileSync(path.join(H, s), `#!/usr/bin/env bash\n[ -f "\${1:-}" ] && rm -f "$1"\necho "${s}" >> '${llamadas}'\n`);
    fs.writeFileSync(path.join(HOME, ".config", "canal-slack.env"), `SLACK_APP_TOKEN=xapp-prueba\nSLACK_HUMANO_ID=${JJ}\nSLACK_CANAL_ID=${CANAL}\n`);
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
    const manda = (text, channel = CANAL) => { const ts = `1794980000.${String(++n).padStart(6, "0")}`, ev = { type: "message", user: JJ, text, channel, ts };
      socks[socks.length - 1].write(marco(JSON.stringify({ type: "events_api", envelope_id: "e" + n, payload: { event: ev } }))); return ts; };
    const lee = () => (fs.existsSync(llamadas) ? fs.readFileSync(llamadas, "utf8") : "").trim().split(/\r?\n/).filter(Boolean);
    const hasta = async (cond, ms = 20000) => { for (let t = 0; t < ms && !cond(lee()); t += 100) await espera(100); return cond(lee()); };
    try {
      for (let i = 0; i < 50 && !socks.length; i++) await espera(100);
      await espera(500);
      const t1 = manda("Coo: mira esto, claude; @coo lo sigo yo [lo hace: Coo — revisar]");
      const t2 = manda("  Coo: lo dejo encargado [lo hace: Claude — x]");
      const t3 = manda("mira esto, claude", OTRO);
      const t4 = manda("Coo: <@UCOO0000001> ya está", OTRO);
      const t5 = manda("mira esto, claude");   // testigo: Humano en el canal bueno sí despierta a Claude
      await hasta((l) => l.includes(`empieza Coo:${t2}`) && l.includes(`empieza Humano:${t5}`));
      await espera(1500);
      const l = lee();
      igual(l.some((x) => x.includes(t1)), false, "«Coo:» sin [lo hace: Claude|Cursor]: no despierta a nadie (ni aunque nombre a Claude o a Coo)");
      igual(l.includes(`empieza Coo:${t2}`), true, "«Coo:» con [lo hace: Claude — x]: atender-slack.sh con quien=Coo");
      igual(l.includes("avisar-coo.sh"), false, "nunca avisar-coo.sh");
      igual(l.includes("atender-cursor-slack.sh") || l.includes("atender-grok.sh"), false, "ni Cursor ni Grok");
      igual(l.some((x) => x.includes(t3) || x.includes(t4)), false, "evento de otro canal: se ignora");
      igual(l.includes(`empieza Humano:${t5}`), true, "testigo: Humano en el canal de la config se atiende");
      igual(l.length, 2, "solo esos dos lanzamientos");
    } finally {
      try { p.kill(); } catch (e) {} socks.forEach((s) => s.destroy()); srv.close(); await espera(1500);
      try { fs.rmSync(T, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { if (!/^(EPERM|EBUSY|ENOTEMPTY)$/.test(e.code)) throw e; }
    }
  });
};
