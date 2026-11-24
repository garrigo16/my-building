// escucha-conexion.js - v334: la conexión de la escucha con Slack, con un Slack falso local que SÍ habla por el socket (tramas
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), crypto = require("crypto"), { spawn } = require("child_process");
const ESCUCHA = path.join(__dirname, "..", "..", "herramientas", "escucha-slack.js");

const trama = (obj) => { const p = Buffer.from(JSON.stringify(obj)); return Buffer.concat([p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.from([0x81, 126, p.length >> 8, p.length & 255]), p]); };
function leeTramas(buf) {   // lo que manda el cliente va enmascarado
  const out = []; let i = 0;
  while (i + 2 <= buf.length) {
    const op = buf[i] & 15; let len = buf[i + 1] & 127, j = i + 2;
    if (len === 126) { len = buf.readUInt16BE(j); j += 2; } else if (len === 127) { len = Number(buf.readBigUInt64BE(j)); j += 8; }
    const m = buf.slice(j, j + 4); j += 4; if (j + len > buf.length) break;
    const p = Buffer.alloc(len); for (let k = 0; k < len; k++) p[k] = buf[j + k] ^ m[k % 4];
    if (op === 1) out.push(p.toString()); if (op === 8) out.cierre = true; i = j + len;
  }
  return out;
}

module.exports = async ({ prueba, igual, casa }) => {
  console.log("la conexión de la escucha con Slack");
  await prueba("v334: corte brusco del socket → reconecta en ≈ 5 s; «disconnect» de Slack → reconecta; cada evento, con su acuse; sin red al arrancar, reintenta sin caerse", async () => {
    const corre = async (guion, { abierto = true, ms = 11000 } = {}) => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), "escucha-con-")); fs.mkdirSync(path.join(d, ".config"));
      fs.writeFileSync(path.join(d, ".config", "canal-slack.env"), "SLACK_APP_TOKEN=xapp-prueba\nSLACK_HUMANO_ID=UHUMANO02\n");
      let conexiones = 0; const socks = [], recibido = [];
      const srv = http.createServer((q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ ok: true, url: `ws://127.0.0.1:${srv.address().port}/ws` })); });
      srv.on("upgrade", (req, sock) => {
        const n = ++conexiones; socks.push(sock); sock.on("error", () => {}); let buf = Buffer.alloc(0);
        sock.on("data", (x) => { buf = Buffer.concat([buf, x]); const t = leeTramas(buf); recibido.push(...t); buf = Buffer.alloc(0);
          if (t.cierre) sock.end(Buffer.from([0x88, 0])); });   // contesta al cierre, como Slack
        const k = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
        sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${k}\r\n\r\n`);
        setTimeout(() => guion(sock, n), 600);
      });
      await new Promise((r) => srv.listen(0, "127.0.0.1", r));
      const url = abierto ? `http://127.0.0.1:${srv.address().port}/open` : "http://127.0.0.1:9/open";   // el 9: nadie escucha (sin red)
      const p = spawn(process.execPath, [ESCUCHA], { stdio: "ignore", windowsHide: true,
        env: { ...process.env, CANAL_HOME: d, CANAL_PRUEBAS: "1", CANAL_BASH: path.join(d, "no-existe", "bash.exe"), SLACK_OPEN_URL: url } });
      let murio = false; p.on("exit", () => { murio = true; });
      await new Promise((r) => setTimeout(r, ms));
      const vivo = !murio; p.kill(); socks.forEach((s) => s.destroy()); srv.close();
      const log = (() => { try { return fs.readFileSync(path.join(d, ".canal-logs", "escucha-slack.log"), "utf8"); } catch (e) { return ""; } })();
      fs.rmSync(d, { recursive: true, force: true });
      return { conexiones, log, recibido, vivo };
    };
    const [corte, disconnect, evento, sinRed] = await Promise.all([
      corre((sock, n) => { if (n === 1) sock.destroy(); }),
      corre((sock, n) => { if (n === 1) sock.write(trama({ type: "disconnect", reason: "refresh_requested" })); }),
      corre((sock, n) => { if (n === 1) sock.write(trama({ envelope_id: "sobre-1", type: "events_api",
        payload: { event: { type: "message", user: "U0OTRO", text: "hola a todos", channel: "CCANAL00001", ts: "1794960000.000900" } } })); }, { ms: 3000 }),
      corre(() => {}, { abierto: false, ms: 2500 }),
    ]);
    igual([corte.conexiones, /cerrado \(1006\); reconecto en 5 s/.test(corte.log), (corte.log.match(/ conectado$/gm) || []).length], [2, true, 2], "corte brusco (1006): vuelve a conectar sola");
    igual([disconnect.conexiones, /Slack pide reconectar/.test(disconnect.log)], [2, true], "«disconnect» de Slack (renovación): cierra y abre otra");
    igual([evento.recibido, evento.conexiones], [['{"envelope_id":"sobre-1"}'], 1], "cada evento, con su acuse (si no, Slack lo reenvía); uno de un desconocido no lanza nada");
    igual([sinRed.vivo, /no abre la conexión: .*; reintento en 30 s/.test(sinRed.log)], [true, true], "sin red al arrancar: lo apunta, reintenta y no se cae");
  });
};
