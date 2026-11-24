// cursor-sin-saldo.js - atender-cursor-slack.sh cuando Cursor no tiene saldo de API (http 400, error.code usage_limit_exceeded):
// no reintenta, sale con 10 y el aviso dice «Cursor sin saldo de API…», no «la API no responde… 3 intentos». Otro 400 sigue igual.
// AISLADO: el script de verdad en una carpeta temporal, una API de Cursor FALSA local (CANAL_PRUEBAS=1 + CURSOR_API_URL),
// responder-slack.sh de mentira (guarda el texto en un fichero) y un fetch de Node que no sale a la red (la lectura del hilo de
// Slack falla en local). Nada sale del equipo.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), { spawn } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");
const SALDO = "Cursor sin saldo de API: recarga en tu facturación de Cursor";

module.exports = async ({ prueba, igual, casa, oficina, C, T }) => {
  console.log("Cursor sin saldo de API (atender-cursor-slack.sh)");
  await prueba("sin saldo: http 400 usage_limit_exceeded no reintenta, rc 10 y avisa «Cursor sin saldo de API»; otro 400 sigue con el aviso de siempre", async () => {
    const T0 = fs.mkdtempSync(path.join(os.tmpdir(), "csaldo-")), H = path.join(T0, "herr"), HOME = path.join(T0, "home");
    const sl = (p) => p.replace(/\\/g, "/");
    let respuesta = ""; const recibidos = [];
    const srv = http.createServer((q, r) => { let b = ""; q.on("data", (x) => b += x).on("end", () => { recibidos.push(q.url);
      r.statusCode = 400; r.setHeader("Content-Type", "application/json"); r.end(respuesta); }); });
    await new Promise((x) => srv.listen(0, "127.0.0.1", x));
    try {
      for (const d of [H, path.join(HOME, ".config"), path.join(HOME, ".canal-logs")]) fs.mkdirSync(d, { recursive: true });
      fs.copyFileSync(path.join(HERR, "atender-cursor-slack.sh"), path.join(H, "atender-cursor-slack.sh"));
      const publicado = sl(path.join(T0, "slack.txt"));
      fs.writeFileSync(path.join(H, "responder-slack.sh"), `#!/usr/bin/env bash\n[ "$1" = --reaccion ] && exit 0\ncat "$3" >> '${publicado}'\necho >> '${publicado}'\n`);
      fs.writeFileSync(path.join(H, "freno.sh"), "#!/usr/bin/env bash\nexit 0\n");
      fs.writeFileSync(path.join(H, "cursor-agente.js"), "process.exit(1);\n");   // sin agente que reutilizar: va al POST
      const sinRed = path.join(T0, "sin-red.js");
      fs.writeFileSync(sinRed, "globalThis.fetch = async () => { throw new Error('sin red en las pruebas'); };\n");
      fs.writeFileSync(path.join(HOME, ".config", "canal-slack.env"), "CURSOR_API_KEY=clave-de-mentira\nSLACK_BOT_TOKEN=de-mentira\n");
      const env = { ...process.env, HOME, USERPROFILE: HOME, CANAL_PRUEBAS: "1", CURSOR_API_URL: `http://127.0.0.1:${srv.address().port}/v1/agents`,
        NODE_OPTIONS: `--require "${sl(sinRed)}"` };
      const lanza = () => new Promise((res) => {
        const j = path.join(T0, "j.json"); fs.writeFileSync(j, JSON.stringify({ text: "@cursor mira esto", channel: "C1", ts: "1.1", thread_ts: "1.0", quien: "Humano" }));
        const p = spawn("bash", [sl(path.join(H, "atender-cursor-slack.sh")), sl(j)], { windowsHide: true, env });
        const to = setTimeout(() => p.kill(), 60000);
        p.on("exit", (rc) => { clearTimeout(to); res(rc); }); });
      const leer = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return ""; } };
      const arr = path.join(HOME, ".canal-logs", "cursor-arranques.log");

      respuesta = JSON.stringify({ error: { code: "usage_limit_exceeded", message: "Your prepaid balance is used up. Add funds to continue." } });
      let rc = await lanza(), txt = leer(publicado);
      igual([rc, recibidos.length], [10, 1], "sin saldo: rc 10 y una sola llamada (sin reintentos)");
      igual([txt.includes(SALDO), /la API no responde/.test(txt), /3 intentos/.test(txt)], [true, false, false], "el aviso dice sin saldo y no «la API no responde»: " + txt);
      casa(leer(arr), /NO hilo 1\.0 http 400 sin saldo de API \(usage_limit_exceeded\) .*usage_limit_exceeded/, "apuntado en cursor-arranques.log con el code");

      fs.writeFileSync(publicado.replace(/\//g, path.sep), "");
      respuesta = JSON.stringify({ error: { code: "invalid_request", message: "bad request" } });
      rc = await lanza(); txt = leer(publicado);
      igual([rc, recibidos.length], [10, 2], "otro 400: rc 10, una llamada");
      igual([txt.includes("Cursor no ha arrancado (la API no responde, http 400, 3 intentos)"), txt.includes("sin saldo")], [true, false], "otro 400: el aviso de siempre: " + txt);
      const ls = leer(arr).trim().split("\n");
      casa(ls[ls.length - 1], /NO hilo 1\.0 http 400 \{"error":\{"code":"invalid_request"/, "otro 400: apuntado como siempre");
      igual(recibidos.every((u) => u === "/v1/agents"), true, "solo a la API falsa");
    } finally { srv.close(); await new Promise((x) => setTimeout(x, 300)); fs.rmSync(T0, { recursive: true, force: true }); }
  });

  await prueba("sin saldo: la oficina dice «sin saldo de API» en el tema, no solo «http 400»", () => {
    const R = C.m("09:00:00", "Humano", "Hilo: prueba de saldo de Cursor"), J = C.m("09:01:00", "Humano", "@Cursor mira esto");
    const fallo = (info) => ({ arranquesCursor: [{ t: T("09:01:30"), ok: false, hilo: R.ts, canal: null, info }] });
    const a = oficina("09:05", [{ ts: R.ts, msgs: [R, J] }], { L: fallo('http 400 sin saldo de API (usage_limit_exceeded) {"error":{"code":"usage_limit_exceeded"}}') });
    const b = oficina("09:05", [{ ts: R.ts, msgs: [R, J] }], { L: fallo('http 400 {"error":{"code":"invalid_request"}}') });
    const ma = a.hilos.find((x) => x.ts === R.ts).motivo, mb = b.hilos.find((x) => x.ts === R.ts).motivo;
    casa(ma, /Cursor no arrancó \(\d\d:\d\d: sin saldo de API/, "sin saldo");
    casa(mb, /Cursor no arrancó \(\d\d:\d\d: http 400\)/, "otro 400, como siempre");
  });
};
