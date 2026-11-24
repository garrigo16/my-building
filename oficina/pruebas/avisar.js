// avisar.js - v298: avisar-coo.sh (despierta a Coo por el webhook de su routine) de punta a punta, AISLADO: el script de verdad
// copiado a una carpeta temporal, un webhook falso local, responder-slack.sh de mentira (solo apunta el aviso a Humano) y una
// carpeta de usuario de prueba. Nada sale del equipo.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), { spawn } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("avisar a Coo (avisar-coo.sh)");
  await prueba("v298: webhook bien → Coo despierto y apuntado (sin molestar a Humano); webhook mal, sin webhook o con freno → se avisa a Humano", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "avisar-")), H = path.join(T, "herr"), HOME = path.join(T, "home");
    let codigo = 200; const recibidos = [];
    const srv = http.createServer((q, r) => { let b = ""; q.on("data", (x) => b += x).on("end", () => { recibidos.push({ auth: q.headers.authorization, body: b }); r.statusCode = codigo; r.end("{}"); }); });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    try {
      for (const d of [H, path.join(HOME, ".config"), path.join(HOME, ".canal-logs")]) fs.mkdirSync(d, { recursive: true });
      for (const s of ["avisar-coo.sh", "freno.sh", "formato-para-humano.txt", "llano.js"]) fs.copyFileSync(path.join(HERR, s), path.join(H, s));
      const avisos = path.join(T, "avisos-a-humano.txt").replace(/\\/g, "/");
      fs.writeFileSync(path.join(H, "responder-slack.sh"), `#!/usr/bin/env bash\ncat "$3" >> '${avisos}'; echo >> '${avisos}'\n`);
      const env = (url) => fs.writeFileSync(path.join(HOME, ".config", "canal-slack.env"), `SLACK_HUMANO_ID=UHUMANO02\n${url ? `COO_WEBHOOK_URL=${url}\nCOO_WEBHOOK_KEY=clave-de-prueba\n` : ""}`);
      const lanza = (quien, hilo = "1794960000.000100", extra = {}) => new Promise((res) => {
        const p = spawn("bash", [path.join(H, "avisar-coo.sh"), "C0PRUEBA", hilo, quien, hilo], { windowsHide: true, env: { ...process.env, HOME, FRENO_MAX_HILO: "2", ...extra } });
        p.on("exit", (rc) => res(rc));
      });
      const log = () => { try { return fs.readFileSync(path.join(HOME, ".canal-logs", "avisar-coo.log"), "utf8"); } catch (e) { return ""; } };
      const av = () => { try { return fs.readFileSync(avisos, "utf8"); } catch (e) { return ""; } };
      env(`http://127.0.0.1:${srv.address().port}/webhook`);
      await lanza("Claude");
      igual([recibidos.length, recibidos[0].auth, /1794960000\.000100/.test(recibidos[0].body)], [1, "Bearer clave-de-prueba", true], "webhook llamado con su clave y el hilo");
      casa(log(), /webhook de Coo \(hilo 1794960000\.000100, de Claude\): http 200/, "apuntado (la oficina lo lee como «Coo despierto»)");
      igual(av(), "", "sin molestar a Humano");
      codigo = 500; await lanza("Cursor", "1794960000.000200");
      igual([/http 500/.test(log()), /no he podido despertarlo/.test(av())], [true, true], "webhook mal: se avisa a Humano");
      codigo = 200; await lanza("Claude", "1794960000.000300"); await lanza("Claude", "1794960000.000300");
      await lanza("Claude", "1794960000.000300");
      igual([/FRENO: no llamo a Coo \(hilo 1794960000\.000300\)/.test(log()), /ya se le había avisado varias veces en la última hora/.test(av())], [true, true], "tercera vez en el hilo (máx. 2): freno y aviso (v467: en llano, no «freno anti ping-pong»)");
      const antes = recibidos.length; await lanza("Humano", "1794960000.000300");
      igual(recibidos.length, antes + 1, "a un mensaje de Humano no se le frena nunca");
      env(""); await lanza("Claude", "1794960000.000400");
      casa(av(), /no hay webhook de Coo configurado/, "sin webhook configurado: se avisa a Humano");
      await lanza("el canal git (principal, sha 1e460d57c5)", "1794960000.000500");
      igual([/El canal de las IAs le ha pedido algo a Coo/.test(av()), /sha|1e460d57c5/.test(av())], [true, false], "v467: en llano, sin sha (v479: «canal de las IAs», como la página)");
    } finally { srv.close(); fs.rmSync(T, { recursive: true, force: true }); }
  });
};
