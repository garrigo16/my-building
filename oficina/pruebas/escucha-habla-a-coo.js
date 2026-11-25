"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), crypto = require("crypto"), { spawn } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");
const marco = (t) => { const b = Buffer.from(t, "utf8"), n = b.length; return Buffer.concat([n < 126 ? Buffer.from([0x81, n]) : Buffer.from([0x81, 126, n >> 8, n & 255]), b]); };

module.exports = async ({ prueba, igual }) => {
  console.log("la escucha: Humano habla a Coo (webhook) y el antibucle con el bot del Edificio");
  await prueba("Humano nombra a Coo, a Geoffrey o responde en un hilo de Coo: avisar-coo.sh; bots, «Coo:», otro canal y sin mención: no", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "eshac-")), H = path.join(T, "herr"), HOME = path.join(T, "home");
    const JJ = "UHUMANO02", CANAL = "C0PRUEBA", OTRO = "C0OTROCANAL", COO = "U0CJ189HZ2S";
    for (const d of [H, path.join(HOME, ".config"), path.join(HOME, ".canal-logs")]) fs.mkdirSync(d, { recursive: true });
    for (const s of ["escucha-slack.js", "regla-ok.js", "git-bash.js", "puerto-oficina.js"]) fs.copyFileSync(path.join(HERR, s), path.join(H, s));
    const llamadas = path.join(T, "llamadas.txt").replace(/\\/g, "/");
    // avisar-coo.sh deja «avisar-coo canal hilo de ts»; los atender-* solo su nombre
    fs.writeFileSync(path.join(H, "avisar-coo.sh"), `#!/usr/bin/env bash\necho "avisar-coo $1 $2 $3 $4" >> '${llamadas}'\n`);
    for (const s of ["atender-slack.sh", "atender-cursor-slack.sh", "atender-grok.sh"]) fs.writeFileSync(path.join(H, s), `#!/usr/bin/env bash\n[ -f "\${1:-}" ] && rm -f "$1"\necho "${s}" >> '${llamadas}'\n`);
    fs.writeFileSync(path.join(HOME, ".config", "canal-slack.env"), `SLACK_APP_TOKEN=xapp-prueba\nSLACK_HUMANO_ID=${JJ}\nSLACK_CANAL_ID=${CANAL}\nSLACK_COO_ID=${COO}\n`);
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
    const manda = (campos) => { const ts = `1794990000.${String(++n).padStart(6, "0")}`, ev = { type: "message", user: JJ, channel: CANAL, ts, ...campos };
      socks[socks.length - 1].write(marco(JSON.stringify({ type: "events_api", envelope_id: "e" + n, payload: { event: ev } }))); return ts; };
    const lee = () => (fs.existsSync(llamadas) ? fs.readFileSync(llamadas, "utf8") : "").trim().split(/\r?\n/).filter(Boolean);
    const hasta = async (cond, ms = 20000) => { for (let t = 0; t < ms && !cond(lee()); t += 100) await espera(100); return cond(lee()); };
    const avisos = (l) => l.filter((x) => x.startsWith("avisar-coo "));
    const aviso = (l, ts) => avisos(l).find((x) => x.endsWith(" " + ts));
    try {
      for (let i = 0; i < 50 && !socks.length; i++) await espera(100);
      await espera(500);
      // disparan
      const a1 = manda({ text: `<@${COO}> ¿puedes mirar esto?` });
      const a2 = manda({ text: "@Coo mira esto" });
      const a3 = manda({ text: "dile algo a GEOFFREY, por favor" });
      // hilo de Coo: un mensaje de Coo (bot con «Coo:») abre el hilo y Humano responde sin nombrarle
      const h1 = manda({ text: "Coo: propongo esto", user: COO, bot_id: "B0CJ541FHLZ" });
      const a4 = manda({ text: "vale, adelante", thread_ts: h1 });
      // hilo de Coo con «Coo:» desde la cuenta de Humano
      const h2 = manda({ text: "Coo: otra cosa" });
      const a5 = manda({ text: "de acuerdo", thread_ts: h2 });
      // no disparan
      const n1 = manda({ text: `<@${COO}> hola Geoffrey @Coo`, bot_id: "B0CJ541FHLZ" });
      const n2 = manda({ text: "@Coo Geoffrey", user: COO });
      const n3 = manda({ text: "Geoffrey, @Coo", subtype: "bot_message", user: undefined });
      const n4 = manda({ text: `Coo: <@${COO}> Geoffrey @Coo ya está` });
      const n5 = manda({ text: "@Coo Geoffrey", channel: OTRO });
      const n6 = manda({ text: "una cosa cualquiera, sin nadie" });
      const hb = manda({ text: "mensaje del bot que no es de Coo", user: COO, bot_id: "B0CJ541FHLZ" });
      const n7 = manda({ text: "respondo en un hilo donde Coo no ha escrito", thread_ts: hb });   // el bot del Edificio escribe, pero no es Coo
      const t5 = manda({ text: "testigo @Coo" });
      await hasta((l) => aviso(l, t5));
      await espera(1500);
      const l = lee();
      igual(!!aviso(l, a1), true, "Humano menciona <@U0CJ189HZ2S>: avisar-coo.sh");
      igual(!!aviso(l, a2), true, "Humano escribe «@Coo»: avisar-coo.sh");
      igual(!!aviso(l, a3), true, "Humano escribe «Geoffrey» (sin mayúsculas fijas): avisar-coo.sh");
      igual(!!aviso(l, a4), true, "respuesta de Humano en un hilo con un mensaje de Coo (bot): avisar-coo.sh");
      igual(!!aviso(l, a5), true, "respuesta de Humano en un hilo con «Coo:»: avisar-coo.sh");
      igual(avisos(l).find((x) => x.endsWith(" " + a4)), `avisar-coo ${CANAL} ${h1} Humano ${a4}`, "argumentos: canal, hilo, Humano, ts");
      for (const [t, q] of [[n1, "bot_id con mención"], [n2, "user = bot del Edificio"], [n3, "subtype bot_message"], [n4, "empieza por «Coo:»"], [n5, "otro canal"], [n6, "sin mención"], [n7, "hilo sin Coo (solo el bot del Edificio)"]]) {
        igual(!!aviso(l, t), false, `no avisa a Coo: ${q}`);
      }
      igual(!!aviso(l, h1) || !!aviso(l, h2) || !!aviso(l, hb), false, "los mensajes de Coo / del bot no avisan a Coo");
      igual(!!aviso(l, t5), true, "testigo: sigue funcionando después");
      igual(avisos(l).length, 6, "solo esos seis avisos");
    } finally {
      try { p.kill(); } catch (e) {} socks.forEach((s) => s.destroy()); srv.close(); await espera(1500);
      try { fs.rmSync(T, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { if (!/^(EPERM|EBUSY|ENOTEMPTY)$/.test(e.code)) throw e; }
    }
  });
};
