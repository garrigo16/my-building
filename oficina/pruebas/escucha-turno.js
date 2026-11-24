// escucha-turno.js - v352: la escucha y el TURNO, de verdad: solo escucha Slack el equipo que tiene el turno (Socket Mode reparte
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), crypto = require("crypto"), { spawn, execFileSync } = require("child_process");
const ESCUCHA = path.join(__dirname, "..", "..", "herramientas", "escucha-slack.js");

module.exports = async ({ prueba, igual }) => {
  console.log("la escucha y el turno entre equipos");
  await prueba("v352: con el turno de otro equipo, la escucha NO se conecta a Slack; con el suyo, sí; si no puede leer el turno (sin red), sigue como estaba", async () => {
    const raiz = fs.mkdtempSync(path.join(os.tmpdir(), "escucha-turno-")), sl = (p) => p.replace(/\\/g, "/");
    const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const github = (equipo) => {
      const base = path.join(raiz, "gh-" + (equipo || "nada")), rep = path.join(base, "usuario", "Edificio-de-IAs.git"), tmp = path.join(base, "tmp");
      fs.mkdirSync(tmp, { recursive: true }); git(tmp, "init", "-q"); git(tmp, "-c", "user.name=p", "-c", "user.email=p@p", "commit", "-q", "--allow-empty", "-m", "x");
      if (equipo) git(tmp, "tag", "turno-" + equipo);
      fs.mkdirSync(path.dirname(rep), { recursive: true }); git(raiz, "clone", "-q", "--bare", tmp, rep);
      return rep;
    };
    // en un clon ya hay origin y un segundo remote.origin.url no lo sustituye: se redirige la URL real al repo de prueba
    const origenReal = () => { try { return require("child_process").execFileSync("git", ["-C", path.dirname(path.dirname(ESCUCHA)), "remote", "get-url", "origin"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch (e) { return "origin"; } };
    const corre = async (rep) => {
      const d = fs.mkdtempSync(path.join(raiz, "home-")); fs.mkdirSync(path.join(d, ".config"));
      fs.writeFileSync(path.join(d, ".config", "canal-slack.env"), "SLACK_APP_TOKEN=xapp-prueba\nSLACK_HUMANO_ID=UHUMANO02\n");
      fs.writeFileSync(path.join(d, ".config", "oficina-equipo.txt"), "casa\r\n");
      let abiertas = 0, conexiones = 0; const socks = [];
      const srv = http.createServer((q, r) => { abiertas++; r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ ok: true, url: `ws://127.0.0.1:${srv.address().port}/ws` })); });
      srv.on("upgrade", (req, sock) => { conexiones++; socks.push(sock); sock.on("error", () => {});
        const k = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
        sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${k}\r\n\r\n`); });
      await new Promise((r) => srv.listen(0, "127.0.0.1", r));
      const p = spawn(process.execPath, [ESCUCHA], { stdio: "ignore", windowsHide: true, env: { ...process.env, CANAL_HOME: d, CANAL_PRUEBAS: "1", CANAL_BASH: path.join(d, "no-existe", "bash.exe"),
        SLACK_OPEN_URL: `http://127.0.0.1:${srv.address().port}/open`, GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${sl(rep)}.insteadOf`, GIT_CONFIG_VALUE_0: origenReal() } });
      await new Promise((r) => setTimeout(r, 5000));
      p.kill(); socks.forEach((s) => s.destroy()); srv.close();
      const log = (() => { try { return fs.readFileSync(path.join(d, ".canal-logs", "escucha-slack.log"), "utf8"); } catch (e) { return ""; } })();
      return { abiertas, conexiones, log };
    };
    try {
      const [otro, mio, sinRed] = await Promise.all([corre(github("portatil")), corre(github("casa")), corre(path.join(raiz, "no-existe", "repo.git"))]);
      igual([otro.abiertas, otro.conexiones, /turno de «portatil», no de «casa»: no escucho/.test(otro.log)], [0, 0, true], "turno del portátil: en casa NO se conecta (ni pide la conexión)");
      igual([mio.abiertas, mio.conexiones], [1, 1], "turno de casa: se conecta");
      igual([sinRed.abiertas, sinRed.conexiones], [1, 1], "sin poder leer el turno (sin red): sigue como estaba, escuchando");
    } finally { await new Promise((x) => setTimeout(x, 300)); fs.rmSync(raiz, { recursive: true, force: true }); }
  });
};
