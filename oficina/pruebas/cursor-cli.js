// cursor-cli.js - atender-cursor-slack.sh lanza a Cursor por CLI con la sesión OCA (herramientas/cursor-cli.ps1), no por la API de prepago.
// AISLADO: el script de verdad en una carpeta temporal, un cursor-agent FALSO (CURSOR_CLI, un .ps1), una API de Cursor FALSA local
// (CANAL_PRUEBAS=1 + CURSOR_API_URL), responder-slack.sh de mentira y un fetch de Node sin red. Nada sale del equipo.
// Necesita Windows PowerShell (powershell.exe): en otros sistemas se salta.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), { spawn, spawnSync } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("Cursor por CLI con la sesión OCA (atender-cursor-slack.sh + cursor-cli.ps1)");
  const hayPs = process.platform === "win32" && !spawnSync("powershell.exe", ["-NoProfile", "-Command", "exit 0"], { windowsHide: true }).error;
  if (!hayPs) { console.log("  (sin powershell.exe: se salta)"); return; }

  const montar = async (agente) => {
    const T0 = fs.mkdtempSync(path.join(os.tmpdir(), "ccli-")), H = path.join(T0, "herr"), HOME = path.join(T0, "home");
    const sl = (p) => p.replace(/\\/g, "/");
    const recibidos = []; let codigoApi = 400;
    const srv = http.createServer((q, r) => { q.on("data", () => {}).on("end", () => { recibidos.push(q.url); r.statusCode = codigoApi; r.setHeader("Content-Type", "application/json");
      r.end(JSON.stringify({ error: { code: "usage_limit_exceeded", message: "Your prepaid balance is used up." } })); }); });
    await new Promise((x) => srv.listen(0, "127.0.0.1", x));
    for (const d of [H, path.join(HOME, ".config"), path.join(HOME, ".canal-logs")]) fs.mkdirSync(d, { recursive: true });
    for (const s of ["atender-cursor-slack.sh", "cursor-sin-saldo.js", "cursor-cli.ps1"]) fs.copyFileSync(path.join(HERR, s), path.join(H, s));
    const publicado = sl(path.join(T0, "slack.txt")), reacciones = sl(path.join(T0, "reacciones.txt"));
    fs.writeFileSync(path.join(H, "responder-slack.sh"), `#!/usr/bin/env bash\nif [ "$1" = --reaccion ]; then echo "$4" >> '${reacciones}'; exit 0; fi\ncat "$3" >> '${publicado}'\necho >> '${publicado}'\n`);
    fs.writeFileSync(path.join(H, "freno.sh"), "#!/usr/bin/env bash\nexit 0\n");
    fs.writeFileSync(path.join(H, "cursor-agente.js"), "process.exit(1);\n");
    const sinRed = path.join(T0, "sin-red.js");
    fs.writeFileSync(sinRed, "globalThis.fetch = async () => { throw new Error('sin red en las pruebas'); };\n");
    fs.writeFileSync(path.join(HOME, ".config", "canal-slack.env"), "CURSOR_API_KEY=clave-de-mentira\nSLACK_BOT_TOKEN=de-mentira\n");
    const cli = path.join(T0, "cursor-agent-falso.ps1"), rastro = path.join(T0, "rastro-cli.txt");
    fs.writeFileSync(cli, agente(rastro));
    const env = { ...process.env, HOME, USERPROFILE: HOME, CANAL_PRUEBAS: "1", CURSOR_CLI: cli, CURSOR_API_URL: `http://127.0.0.1:${srv.address().port}/v1/agents`,
      CURSOR_WORK_DIR: T0, NODE_OPTIONS: `--require "${sl(sinRed)}"` };
    const lanza = () => new Promise((res) => {
      const j = path.join(T0, "j.json"); fs.writeFileSync(j, JSON.stringify({ text: "@cursor mira esto", channel: "C1", ts: "1.1", thread_ts: "1.0", quien: "Humano" }));
      const p = spawn("bash", [sl(path.join(H, "atender-cursor-slack.sh")), sl(j)], { windowsHide: true, env });
      const to = setTimeout(() => p.kill(), 120000);
      p.on("exit", (rc) => { clearTimeout(to); res(rc); }); });
    const leer = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return ""; } };
    const fin = async () => { srv.close(); await new Promise((x) => setTimeout(x, 300)); fs.rmSync(T0, { recursive: true, force: true }); };
    return { lanza, leer, fin, recibidos, publicado: path.join(T0, "slack.txt"), reacciones: path.join(T0, "reacciones.txt"), rastro, arr: path.join(HOME, ".canal-logs", "cursor-arranques.log"),
      mapa: path.join(HOME, ".canal-logs", "cursor-cli-chats.json") };
  };

  await prueba("cursor-cli: el CLI con sesión OCA responde sin CURSOR_API_KEY, no llama a la API, apunta «SI … cli-login» y publica en Slack; el hilo se reanuda con --resume", async () => {
    const m = await montar((rastro) => [
      "$a = @($args)",
      `Add-Content -LiteralPath '${rastro}' -Value ('ARGS ' + ($a[0..($a.Count-2)] -join ' '))`,
      `Add-Content -LiteralPath '${rastro}' -Value ('KEY=[' + $env:CURSOR_API_KEY + ']')`,
      "if ($env:CURSOR_API_KEY) { [Console]::Error.WriteLine('la clave de API llega al CLI'); exit 3 }",
      `Write-Output '{"type":"system","subtype":"init","apiKeySource":"login","session_id":"sesion-oca-1"}'`,
      `Write-Output '{"type":"result","subtype":"success","is_error":false,"result":"Listo, <@U123> lo miro.\\n[hecho]","session_id":"sesion-oca-1"}'`, ""].join("\n"));
    try {
      let rc = await m.lanza(), txt = m.leer(m.publicado), ras = m.leer(m.rastro);
      igual([rc, m.recibidos.length], [0, 0], "rc 0 y ninguna llamada a CURSOR_API_URL");
      casa(ras, /KEY=\[\]/, "CURSOR_API_KEY llega vacía al CLI");
      casa(ras, /--disable-auto-update -p --output-format stream-json --trust --workspace /, "flags del CLI, sin --resume la primera vez");
      igual(/--resume/.test(ras), false, "primera vez: sin --resume");
      casa(m.leer(m.arr), /SI hilo 1\.0 cli-login sesion-oca-1/, "apuntado en cursor-arranques.log");
      casa(txt, /Cursor \(vía CLI\)/, "firma vía CLI: " + txt);
      casa(txt, /Listo, @U123 lo miro\./, "publica la respuesta del CLI con la mención normalizada: " + txt);
      casa(m.leer(m.reacciones), /hourglass_flowing_sand/, "reacción de «trabajando»");
      casa(m.leer(m.mapa), /"slack:1\.0"[\s\S]*sesion-oca-1/, "guarda la sesión del hilo");
      rc = await m.lanza();
      igual([rc, m.recibidos.length], [0, 0], "segunda vez: rc 0 y sin API");
      casa(m.leer(m.rastro), /--resume sesion-oca-1/, "segunda vez: --resume con la sesión del hilo");
    } finally { await m.fin(); }
  });

  await prueba("cursor-cli: si el CLI falla, respaldo por API + cursor-sin-saldo.js: rc 10, apunta «NO … sin saldo de API» y avisa una sola vez", async () => {
    const m = await montar(() => "[Console]::Error.WriteLine('Not logged in'); exit 1\n");
    try {
      let rc = await m.lanza(), txt = m.leer(m.publicado);
      igual([rc, m.recibidos.length], [10, 1], "CLI falla: rc 10 y una llamada a la API de respaldo");
      casa(m.leer(m.arr), /NO hilo 1\.0 http 400 sin saldo de API \(usage_limit_exceeded\)/, "apuntado como sin saldo de API");
      igual(m.leer(m.arr).includes("cli-login"), false, "no apunta un SI de CLI");
      casa(txt, /Cursor sin saldo de API: recarga en tu facturación de Cursor/, "avisa sin saldo: " + txt);
      fs.writeFileSync(m.publicado, "");
      rc = await m.lanza(); txt = m.leer(m.publicado);
      igual([rc, m.recibidos.length, txt], [10, 1, ""], "segundo intento: rc 10, sin API y sin otro aviso");
      casa(m.leer(m.arr), /ESPERA hilo 1\.0 sin saldo de API: ya avisado a las \d\d:\d\d, no se relanza/, "apunta ESPERA");
    } finally { await m.fin(); }
  });
};
