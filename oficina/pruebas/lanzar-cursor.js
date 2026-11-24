// lanzar-cursor.js - v330: lanzar-cursor.sh (arranca un agente de Cursor en la nube para un recado del canal) de punta a punta,
// AISLADO: el script y validar-nota.sh de verdad en una carpeta temporal, una API de Cursor falsa local (CANAL_PRUEBAS=1 +
// CURSOR_API_URL), freno.sh y esperar-cursor.sh de mentira; y, para la prueba del host fijo, un curl falso que solo apunta
// adónde iría. Nada sale del equipo.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), { spawn, spawnSync } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("lanzar a Cursor por su API (lanzar-cursor.sh)");
  await prueba("v330: lanza con la nota, la rama, su modelo y sin PR; deja esperando la vuelta; sin clave (8), freno (12), nota mala (2) o rechazo (10) no lanza; el host no se cambia fuera de pruebas", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "lcursor-")), H = path.join(T, "herr"), HOME = path.join(T, "home"), FALSOS = path.join(T, "bin");
    let codigo = 201; const recibidos = [];
    const srv = http.createServer((q, r) => { let b = ""; q.on("data", (x) => b += x).on("end", () => { recibidos.push({ auth: q.headers.authorization, body: JSON.parse(b) });
      r.statusCode = codigo; r.end(codigo < 300 ? JSON.stringify({ agent: { id: "bc-123", url: "https://cursor.invalid/agents/bc-123" } }) : '{"error":"bad request"}'); }); });
    await new Promise((x) => srv.listen(0, "127.0.0.1", x));
    const sl = (p) => p.replace(/\\/g, "/");
    try {
      for (const d of [H, FALSOS, path.join(HOME, ".config"), path.join(HOME, ".canal-logs")]) fs.mkdirSync(d, { recursive: true });
      for (const s of ["lanzar-cursor.sh", "validar-nota.sh"]) fs.copyFileSync(path.join(HERR, s), path.join(H, s));
      const esp = sl(path.join(T, "esperar.txt"));
      fs.writeFileSync(path.join(H, "freno.sh"), "#!/usr/bin/env bash\nexit ${FRENO_RC:-0}\n");
      fs.writeFileSync(path.join(H, "esperar-cursor.sh"), `#!/usr/bin/env bash\necho "$1 $2 $3" >> '${esp}'\n`);
      fs.writeFileSync(path.join(FALSOS, "curl"), '#!/usr/bin/env bash\nfor a in "$@"; do u="$a"; done\necho "$u" > "$HOME/curl-url.txt"\nprintf "{}\\n401"\n');
      const nota = path.join(T, "nota.txt"), BUENA = "para: Cursor\n@cursor\nCoinciden: el cálculo\nNo coinciden: el redondeo\nTu OK: no hace falta\nTercera lectura: no\n";
      const kP = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH");
      const cu = spawnSync("bash", ["-c", "command -v curl"], { encoding: "utf8", env: { ...process.env, [kP]: FALSOS + path.delimiter + process.env[kP] } }).stdout.trim();
      igual(new RegExp(path.basename(T) + "/bin/curl$").test(cu), true, "v336: el curl falso va delante (si no, no sigue y no se lanza nada): " + cu);
      if (!new RegExp(path.basename(T) + "/bin/curl$").test(cu)) return;
      let pantalla = "";
      const lanza = (extra = {}, n = BUENA) => new Promise((res) => { fs.writeFileSync(nota, n); let out = "", err = "";
        const p = spawn("bash", [path.join(H, "lanzar-cursor.sh"), "principal", nota, "a".repeat(40), "b".repeat(40)], { windowsHide: true,
          env: { ...process.env, HOME, CURSOR_API_KEY: "", CANAL_PRUEBAS: "1", CURSOR_API_URL: `http://127.0.0.1:${srv.address().port}/v1/agents`, CURSOR_MODELO: "", FRENO_RC: "", ...extra } });
        p.stdout.on("data", (x) => out += x); p.stderr.on("data", (x) => err += x); p.on("exit", (rc) => { pantalla += out + err; res({ rc, out, err }); }); });
      const leer = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return ""; } };

      let r = await lanza();
      igual([r.rc, /SIN CURSOR: no hay CURSOR_API_KEY/.test(r.err), recibidos.length], [8, true, 0], "sin clave: 8 y ni una llamada");
      fs.writeFileSync(path.join(HOME, ".config", "canal-slack.env"), "CURSOR_API_KEY=clave-cursor-falsa\r\n");
      r = await lanza({ FRENO_RC: "12" });
      igual([r.rc, recibidos.length, /FRENO: no lanzo a Cursor para principal aaaaaaaaaa/.test(leer(path.join(HOME, ".canal-logs", "freno.log")))], [12, 0, true], "con el freno: 12, sin llamar y apuntado");
      r = await lanza({}, "para: Cursor\nCoinciden: x\n");
      igual([r.rc, recibidos.length], [2, 0], "nota a medias (validar-nota.sh): 2, sin llamar");
      r = await lanza();
      const b = (recibidos[0] || {}).body || {};
      igual([r.rc, r.out.split("\n")[0], (recibidos[0] || {}).auth], [0, "CURSOR lanzado (principal aaaaaaaaaa): bc-123 https://cursor.invalid/agents/bc-123", "Basic " + Buffer.from("clave-cursor-falsa:").toString("base64")], "lanzado, con la clave como usuario");
      igual([/^para: Cursor\n@cursor\nCoinciden: el cálculo/m.test(b.prompt.text), /git log bbbbbbbbbb\.\.aaaaaaaaaa /.test(b.prompt.text), /Prohibido: secretos/.test(b.prompt.text), /\nNOTA:\npara:/.test(b.prompt.text),
        /A Slack solo llega la NOTA del punto 6 .* va SOLO en CANAL_CLAUDE_CURSOR\.md/.test(b.prompt.text),
        b.repos[0].startingRef, b.autoCreatePR, b.model.id], [true, true, true, true, true, "canal/humano/claude-cursor", false, "composer-2.5"], "el prompt lleva la nota (con tildes), el tramo, lo prohibido, que lo técnico va solo al canal (v372) y la NOTA final; su rama, sin PR, Composer");
      for (let i = 0; i < 40 && !fs.existsSync(esp); i++) await new Promise((x) => setTimeout(x, 250));
      igual([leer(esp).trim(), /SI canal principal aaaaaaaaaa/.test(leer(path.join(HOME, ".canal-logs", "cursor-arranques.log")))], ["principal bc-123 " + "a".repeat(40), true], "deja esperando su vuelta (esperar-cursor.sh) y lo apunta");
      await lanza({ CURSOR_MODELO: "grok-4.5" });
      igual(recibidos[1].body.model.id, "grok-4.5", "CURSOR_MODELO cambia el modelo");
      codigo = 400; r = await lanza();
      igual([r.rc, /CURSOR NO lanzado: http 400/.test(r.err), /NO canal principal aaaaaaaaaa http 400/.test(leer(path.join(HOME, ".canal-logs", "cursor-arranques.log")))], [10, true, true], "la API lo rechaza (4xx, sin reintentos): 10 y apuntado");
      r = await lanza({ CANAL_PRUEBAS: "", [kP]: FALSOS + path.delimiter + process.env[kP] });
      igual([leer(path.join(HOME, "curl-url.txt")).trim(), recibidos.length], ["https://api.cursor.com/v1/agents", 3], "fuera de pruebas, una CURSOR_API_URL suelta no cambia el host (la clave no se va a otro sitio)");
      igual(/clave-cursor-falsa|Y2xhdmUtY3Vyc29y/.test(pantalla), false, "la clave no sale nunca por pantalla");
    } finally { srv.close(); await new Promise((x) => setTimeout(x, 300)); fs.rmSync(T, { recursive: true, force: true }); }
  });
};
