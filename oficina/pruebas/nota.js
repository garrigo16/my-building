// nota.js - v302: nota-slack.sh (el aviso de un bloque ya publicado en el canal git) de punta a punta, AISLADO: el script y
// validar-nota.sh de verdad en una carpeta temporal, un curl falso delante en el PATH (no sale nada a Slack), timbre.sh de
// mentira y una carpeta de usuario de prueba.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("la nota de un bloque del canal (nota-slack.sh)");
  await prueba("v302: por defecto no publica la nota (solo el log y el timbre); con NOTA_SLACK=1, menciones reales, URL fuera del argv, y no deja salir secretos", () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "nota-")), H = path.join(T, "herr"), HOME = path.join(T, "home"), FALSOS = path.join(T, "bin");
    const sl = (p) => p.replace(/\\/g, "/");
    try {
      for (const d of [H, FALSOS, path.join(HOME, ".config"), path.join(HOME, ".canal-logs")]) fs.mkdirSync(d, { recursive: true });
      for (const s of ["nota-slack.sh", "validar-nota.sh"]) fs.copyFileSync(path.join(HERR, s), path.join(H, s));
      const timbre = sl(path.join(T, "timbre.txt"));
      const ponTimbre = (rc) => fs.writeFileSync(path.join(H, "timbre.sh"), `#!/usr/bin/env bash\nprintf '%s|%s\\n' "$1" "$3" >> '${timbre}'\nexit ${rc}\n`);
      fs.writeFileSync(path.join(FALSOS, "curl"), '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$HOME/curl-args.txt"\nfor a in "$@"; do case "$a" in @*) cp "${a#@}" "$HOME/curl-body.json";; esac; done\ncat "$HOME/curl-respuesta.txt"\n');
      const env = (extra = "") => fs.writeFileSync(path.join(HOME, ".config", "canal-slack.env"),
        `SLACK_CURSOR_ID=UCURSOR02\r\nSLACK_HUMANO_ID=UHUMANO02\r\nOTRA_CLAVE=valor-privado-de-prueba-xyz\r\n${extra}`);
      const kP = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH");
      const cu = spawnSync("bash", ["-c", "command -v curl"], { encoding: "utf8", env: { ...process.env, [kP]: FALSOS + path.delimiter + process.env[kP] } }).stdout.trim();
      igual(new RegExp(path.basename(T) + "/bin/curl$").test(cu), true, "v336: el curl falso va delante (si no, no sigue y no se lanza nada): " + cu);
      if (!new RegExp(path.basename(T) + "/bin/curl$").test(cu)) return;
      const leer = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return ""; } };
      const manda = (nota, extra = {}, respuesta = "ok") => {
        fs.writeFileSync(path.join(HOME, "curl-respuesta.txt"), respuesta); try { fs.unlinkSync(path.join(HOME, "curl-body.json")); } catch (e) {}
        const n = path.join(T, "nota.txt"); fs.writeFileSync(n, nota);
        return spawnSync("bash", [path.join(H, "nota-slack.sh"), "principal", n, "d".repeat(40), "e".repeat(40)], { encoding: "utf8", timeout: 60e3,
          env: { ...process.env, HOME, NOTA_SLACK: "", SLACK_WEBHOOK_CANAL: "", [kP]: FALSOS + path.delimiter + process.env[kP], ...extra } });
      };
      const BUENA = "para: Cursor, Claude\n@cursor\n@humano\nCoinciden: el cálculo de licencias\nNo coinciden: nada\nTu OK: aprobar el despliegue\nTercera lectura: no\n";
      env("SLACK_WEBHOOK_CANAL=https://ejemplo.invalid/webhook-de-prueba-123\r\n"); ponTimbre(0);

      let r = manda(BUENA);
      igual([r.status, leer(timbre), fs.existsSync(path.join(HOME, "curl-body.json"))], [0, "principal|" + "d".repeat(40) + "\n", false], "por defecto: solo el timbre");
      casa(leer(path.join(HOME, ".canal-logs", "notas-sin-publicar.log")), /nota NO publicada en Slack \(principal dddddddddd\):\npara: Cursor, Claude/, "y la nota queda en el log");
      ponTimbre(9); r = manda(BUENA);
      igual(r.status, 9, "si el timbre falla, error (publicar-canal.sh lo ve)");

      r = manda(BUENA, { NOTA_SLACK: "1" });
      const cuerpo = JSON.parse(leer(path.join(HOME, "curl-body.json")) || "{}").text || "";
      igual([r.status, /^NOTA SLACK enviada \(principal dddddddddd\)/.test(r.stdout)], [0, true], "con NOTA_SLACK=1: enviada (" + (r.stderr || "").trim().slice(0, 120) + ")");
      igual([/^<@UCURSOR02>$/m.test(cuerpo), /^<@UHUMANO02>$/m.test(cuerpo), /Detalle: principal sha dddddddddd\nDesde: eeeeeeeeee/.test(cuerpo), /cálculo/.test(cuerpo)], [true, true, true, true], "@cursor y @humano, menciones de verdad; el sha y las tildes, bien");
      igual(/webhook-de-prueba/.test(leer(path.join(HOME, "curl-args.txt"))), false, "la URL del webhook no va en el argv de curl (se vería en la lista de procesos)");
      r = manda(BUENA, { NOTA_SLACK: "1" }, "invalid_payload");
      igual([r.status, /rechazada: invalid_payload.*reintenta/s.test(r.stderr)], [9, true], "Slack la rechaza: error y cómo reintentar");
      r = manda(BUENA.replace("nada", "lo de valor-privado-de-prueba-xyz"), { NOTA_SLACK: "1" });
      igual([r.status, /contiene un valor de/.test(r.stderr), fs.existsSync(path.join(HOME, "curl-body.json"))], [2, true, false], "una nota con un valor de canal-slack.env no sale");
      r = manda(BUENA.replace("nada", "el xoxb-123"), { NOTA_SLACK: "1" });
      igual([r.status, /parece llevar un secreto/.test(r.stderr)], [2, true], "ni una que parece llevar un token");
      r = manda("para: Claude\nCoinciden: todo\n", { NOTA_SLACK: "1" });
      igual([r.status, /le falta la linea 'No coinciden:'/.test(r.stderr)], [2, true], "nota a medias: no sale y dice qué falta");
      env(); r = manda(BUENA, { NOTA_SLACK: "1" });
      igual([r.status, /SIN NOTA: no hay SLACK_WEBHOOK_CANAL/.test(r.stderr)], [8, true], "sin webhook configurado: código 8");
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  });
};
