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
      for (const s of ["atender-cursor-slack.sh", "cursor-sin-saldo.js"]) fs.copyFileSync(path.join(HERR, s), path.join(H, s));
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

      // otra mención a Cursor en el MISMO hilo (Humano, la oficina, la escucha…): ni API ni otro aviso; se espera
      fs.writeFileSync(publicado.replace(/\//g, path.sep), "");
      rc = await lanza(); txt = leer(publicado);
      igual([rc, recibidos.length, txt], [10, 1, ""], "segundo intento en el hilo: rc 10, sin llamar a la API y sin publicar otro aviso");
      casa(leer(arr), /ESPERA hilo 1\.0 sin saldo de API: ya avisado a las \d\d:\d\d, no se relanza/, "apunta que no relanza porque ya se avisó");

      // un SI posterior (Humano lo lanzó a mano o volvió el saldo): se puede volver a lanzar. Otro 400 sigue como siempre.
      await new Promise((x) => setTimeout(x, 1100));
      fs.appendFileSync(arr, `${new (global.FechaReal || Date)().toISOString()} SI hilo 9.9 agente bc-a-mano\n`);
      respuesta = JSON.stringify({ error: { code: "invalid_request", message: "bad request" } });
      rc = await lanza(); txt = leer(publicado);
      igual([rc, recibidos.length], [10, 2], "otro 400: rc 10, una llamada");
      igual([txt.includes("Cursor no ha arrancado (la API no responde, http 400, 3 intentos)"), txt.includes("sin saldo")], [true, false], "otro 400: el aviso de siempre: " + txt);
      const ls = leer(arr).trim().split("\n");
      casa(ls[ls.length - 1], /NO hilo 1\.0 http 400 \{"error":\{"code":"invalid_request"/, "otro 400: apuntado como siempre");
      igual(recibidos.every((u) => u === "/v1/agents"), true, "solo a la API falsa");
      // un 400 que no es de saldo no bloquea: el siguiente intento vuelve a llamar
      rc = await lanza();
      igual([rc, recibidos.length], [10, 3], "otro 400 no bloquea: vuelve a llamar");
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

  await prueba("sin saldo, una vez: cursor-sin-saldo.js bloquea el hilo/canal con un NO usage_limit y sin SI después; otros 400, 5xx, otro hilo o más de 24 h, no", () => {
    const CS = require(path.join(HERR, "cursor-sin-saldo.js"));
    const t0 = Date.parse("2026-11-24T16:00:00Z"), iso = (m) => new Date(t0 + m * 60e3).toISOString();
    const log = [`${iso(0)} NO hilo 1.0 http 400 sin saldo de API (usage_limit_exceeded) {"error":{"code":"usage_limit_exceeded"}}`,
      `${iso(1)} NO canal principal aaaaaaaaaa http 400 sin saldo de API (usage_limit_exceeded) {"error":{"code":"usage_limit_exceeded"}}`,
      `${iso(2)} NO hilo 2.0 http 400 {"error":{"code":"invalid_request"}}`, `${iso(3)} NO hilo 3.0 http 503 {}`,
      `${iso(4)} ESPERA hilo 1.0 sin saldo de API: ya avisado a las 17:00, no se relanza (Humano)`].join("\n");
    const es = CS.entradas(log), b = (d, m) => !!CS.bloqueo(es, d, t0 + m * 60e3);
    igual([b({ hilo: "1.0" }, 10), b({ canal: "principal" }, 10), b({ hilo: "2.0" }, 10), b({ hilo: "3.0" }, 10), b({ hilo: "4.0" }, 10), b({ canal: "proyecto" }, 10)],
      [true, true, false, false, false, false], "solo el hilo y el canal sin saldo");
    igual(b({ hilo: "1.0" }, 25 * 60), false, "pasadas 24 h, se vuelve a probar");
    const es2 = CS.entradas(log + `\n${iso(30)} SI hilo 5.0 agente bc-1`);
    igual([!!CS.bloqueo(es2, { hilo: "1.0" }, t0 + 40 * 60e3), !!CS.bloqueo(es2, { canal: "principal" }, t0 + 40 * 60e3)], [false, false], "un SI después lo desbloquea");
  });

  await prueba("sin saldo, una vez: la oficina no relanza a Cursor (relanzo automático ni @Cursor desde la oficina) mientras siga sin saldo; con un SI después, sí", () => {
    const S = require("../server.js");
    const lanzados = [], anotado = [];
    const falso = (args) => { lanzados.push(path.basename(String(args[0]))); try { if (/\.json$/.test(args[1] || "")) fs.unlinkSync(args[1]); } catch (e) {} return true; };
    const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "csaldo-of-")), "traspasos.log");
    let bloqueado = { t: Date.parse("2026-11-24T16:36:00Z"), info: "http 400 sin saldo de API (usage_limit_exceeded)" };
    const r = (ia, hilo) => ({ hilo, ts: hilo, ia, quien: "Humano", oficina: true, clave: `slack:${hilo}:${hilo}:despierta:${ia}:1`, que: `${ia}: despertado por la oficina (20 min sin moverse)`, texto: "sigue" });
    try {
      S.setSinSaldo((h) => (h === "1.0" ? bloqueado : null)); S.sinRelanzados();
      S.relanzaPendientes([r("Cursor", "1.0"), r("Claude", "1.0"), r("Cursor", "2.0")], falso, log, (l) => anotado.push(l), false);
      igual(lanzados, ["atender-slack.sh", "atender-cursor-slack.sh"], "relanzo: Cursor sin saldo en 1.0 no se lanza; Claude en 1.0 y Cursor en otro hilo, sí");
      S.relanzaPendientes([r("Cursor", "1.0")], falso, log, (l) => anotado.push(l), false);
      igual([lanzados.length, anotado.length], [2, 1], "en la vuelta siguiente tampoco, y la nota «no relanzo» una sola vez");
      casa(anotado[0], /hilo 1\.0 no relanzo a Cursor: sin saldo de API \(ya avisado a las \d\d:\d\d\); se espera/, "lo que anota");
      igual(/RELANZO\tCursor\tslack\tslack:1\.0:/.test(fs.readFileSync(log, "utf8")), false, "ni un RELANZO de Cursor en 1.0 en traspasos.log");
      const n0 = S.anotados.length;
      igual([S.lanzarCursorComoHumano("@Cursor mira", "1.5", "1.0", falso), lanzados.length], ["sin saldo", 2], "@Cursor desde la oficina en ese hilo: no se lanza");
      casa(S.anotados.slice(n0).join("\n"), /hilo 1\.0 no lanzo Cursor \(mensaje 1\.5\): sin saldo de API/, "y lo anota");
      bloqueado = null;   // un SI después (a mano o volvió el saldo)
      igual(S.lanzarCursorComoHumano("@Cursor mira", "1.6", "1.0", falso), true, "con un SI después, @Cursor sí lo lanza");
      S.sinRelanzados(); S.relanzaPendientes([r("Cursor", "1.0")], falso, log, (l) => anotado.push(l), false);
      igual(lanzados.slice(2), ["atender-cursor-slack.sh", "atender-cursor-slack.sh"], "y el relanzo también");
    } finally { S.setSinSaldo(() => null); S.sinRelanzados(); fs.rmSync(path.dirname(log), { recursive: true, force: true }); }
  });

  await prueba("sin saldo, una vez: el vigía (canal-pendientes.js) no lanza a Cursor en un canal sin saldo; lo deja apuntado y lo lanza tras un SI", () => {
    const P = require(path.join(HERR, "canal-pendientes.js"));
    const tip = "# Canal\n\n<!-- para: Cursor | cc: JJ | id: 101 | accion: pide | estado: lo hace: Cursor — mirar el saldo -->\n### Coo · 24/11 · 10:00 · [PRUEBA] Mira el saldo\nCursor, revisa esto.\n\n— Coo\n";
    const ahora = Date.parse("2026-11-24T17:00:00Z"), no = { t: ahora - 10 * 60e3 };
    let r = P.decide({ tip, viejos: [""], estado: {}, ahora, sinSaldo: { Cursor: no } });
    igual([r.acciones.length, r.esperanSaldo.length], [0, 1], "sin saldo: ninguna acción, queda esperando");
    const llamadas = []; const ej = P.ejecuta(r, { canal: "principal", sha: "a", desde: "b", ahora, lanzar: (ia) => { llamadas.push(ia); return 0; } });
    igual(llamadas, [], "no llama a lanzar-cursor.sh");
    casa(ej.dice.join("\n"), /Cursor sin saldo de API \(ya avisado a las \d\d:\d\d\): no lo lanzo, se espera/, "lo dice");
    r = P.decide({ tip, viejos: [tip], estado: r.estado, ahora: ahora + 60 * 60e3, sinSaldo: { Cursor: no } });
    igual(r.acciones.length, 0, "una hora después, aún sin saldo: tampoco (ni RELANZO ni SIN_RESPUESTA)");
    r = P.decide({ tip, viejos: [tip], estado: r.estado, ahora: ahora + 70 * 60e3 });
    igual(r.acciones.map((a) => a.tipo + " " + a.ia), ["LANZO Cursor"], "con un SI después (sin bloqueo), lo lanza");
  });

  await prueba("sin saldo, una vez: lanzar-cursor.sh apunta el NO como sin saldo y no vuelve a llamar a la API en ese canal hasta un SI", async () => {
    const T0 = fs.mkdtempSync(path.join(os.tmpdir(), "csaldo-lc-")), H = path.join(T0, "herr"), HOME = path.join(T0, "home");
    let codigo = 400; const recibidos = [];
    const srv = http.createServer((q, r) => { q.on("data", () => {}).on("end", () => { recibidos.push(q.url); r.statusCode = codigo;
      r.end(codigo < 300 ? JSON.stringify({ agent: { id: "bc-9" } }) : JSON.stringify({ error: { code: "usage_limit_exceeded", message: "Add funds" } })); }); });
    await new Promise((x) => srv.listen(0, "127.0.0.1", x));
    try {
      for (const d of [H, path.join(HOME, ".config"), path.join(HOME, ".canal-logs")]) fs.mkdirSync(d, { recursive: true });
      for (const s of ["lanzar-cursor.sh", "validar-nota.sh", "cursor-sin-saldo.js"]) fs.copyFileSync(path.join(HERR, s), path.join(H, s));
      fs.writeFileSync(path.join(H, "freno.sh"), "#!/usr/bin/env bash\nexit 0\n");
      fs.writeFileSync(path.join(H, "esperar-cursor.sh"), "#!/usr/bin/env bash\nexit 0\n");
      fs.writeFileSync(path.join(H, "cursor-agente.js"), "process.exit(1);\n");
      fs.writeFileSync(path.join(HOME, ".config", "canal-slack.env"), "CURSOR_API_KEY=clave-de-mentira\n");
      const nota = path.join(T0, "nota.txt"); fs.writeFileSync(nota, "para: Cursor\n@cursor\nCoinciden: x\nNo coinciden: nada\nTu OK: no hace falta\nTercera lectura: no\n");
      const arr = path.join(HOME, ".canal-logs", "cursor-arranques.log"), leer = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return ""; } };
      const lanza = () => new Promise((res) => { let err = "";
        const p = spawn("bash", [path.join(H, "lanzar-cursor.sh"), "principal", nota, "a".repeat(40), "b".repeat(40)], { windowsHide: true,
          env: { ...process.env, HOME, CURSOR_API_KEY: "", CANAL_PRUEBAS: "1", CURSOR_API_URL: `http://127.0.0.1:${srv.address().port}/v1/agents` } });
        p.stderr.on("data", (x) => err += x); p.on("exit", (rc) => res({ rc, err })); });
      let r = await lanza();
      igual([r.rc, recibidos.length], [10, 1], "sin saldo: 10, una llamada");
      casa(leer(arr), /NO canal principal aaaaaaaaaa http 400 sin saldo de API \(usage_limit_exceeded\)/, "apuntado como sin saldo");
      r = await lanza();
      igual([r.rc, recibidos.length, /sin saldo de API .*se espera/.test(r.err)], [10, 1, true], "otra vez en el canal: 10 y sin llamar a la API");
      casa(leer(arr), /ESPERA canal principal aaaaaaaaaa sin saldo de API: ya avisado a las \d\d:\d\d, no se relanza/, "apunta que espera");
      await new Promise((x) => setTimeout(x, 1100));
      fs.appendFileSync(arr, `${new (global.FechaReal || Date)().toISOString()} SI hilo 9.9 agente bc-a-mano\n`);
      codigo = 201; r = await lanza();
      igual([r.rc, recibidos.length], [0, 2], "con un SI después, vuelve a lanzar");
    } finally { srv.close(); await new Promise((x) => setTimeout(x, 300)); fs.rmSync(T0, { recursive: true, force: true }); }
  });
};
