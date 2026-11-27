// tope-claude.js - atender-slack.sh: tope de tiempo del claude -p (CLAUDE_TOPE_SEG, 1200 s por defecto) y BLOQUES en el prompt. El script de verdad
// copiado a una carpeta temporal, con un Claude falso que se duerme. Sin Slack (responder-slack.sh de mentira), sin red, nada fuera de temporales.
// (El mismo tope en lanzar-claude.sh y su BLOQUES se prueban en lanzar.js.)
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("atender-slack.sh: tope de 20 minutos (CLAUDE_TOPE_SEG) y BLOQUES");
  const monta = (T, cuerpoCli) => {
    const H = path.join(T, "herr"), HOME = path.join(T, "home");
    for (const d of [H, HOME, path.join(HOME, ".canal-logs"), path.join(HOME, ".config"), path.join(T, "repo")]) fs.mkdirSync(d, { recursive: true });
    fs.copyFileSync(path.join(HERR, "atender-slack.sh"), path.join(H, "atender-slack.sh"));
    fs.copyFileSync(path.join(HERR, "formato-para-humano.txt"), path.join(H, "formato-para-humano.txt"));
    for (const s of ["responder-slack.sh", "freno.sh"]) fs.writeFileSync(path.join(H, s), "#!/usr/bin/env bash\nexit 0\n");
    const cli = path.join(T, "claude-falso.sh"); fs.writeFileSync(cli, cuerpoCli);
    let k = 0;
    const lanza = (json, env = {}) => {
      const j = path.join(T, `m${k}.json`), ts = `1794950000.${String(100 + k).padStart(6, "0")}`; k++;
      fs.writeFileSync(j, JSON.stringify({ channel: "C0PRUEBA", ts, thread_ts: "1794950000.000100", quien: "Coo", text: "@Claude haz el encargo de ejemplo", oficina: true, ...json }));
      const t0 = Date.now();
      const r = spawnSync("bash", [path.join(H, "atender-slack.sh"), j], { encoding: "utf8", timeout: 90e3,
        env: { ...process.env, HOME, CLAUDE_CLI: cli, CANAL_REPO: path.join(T, "repo"), ...env } });
      return { r, seg: (Date.now() - t0) / 1000, ts };
    };
    return { HOME, lanza };
  };
  const leeLog = (HOME) => { try { return fs.readFileSync(path.join(HOME, ".canal-logs", "sesiones-slack.log"), "utf8"); } catch (e) { return ""; } };

  await prueba("un claude -p que se duerme se corta a los CLAUDE_TOPE_SEG: rc 124, línea en sesiones-slack.log (ISO, hilo y que saltó el tope) y el script termina", () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "tope-atender-"));
    try {
      const { HOME, lanza } = monta(T, '#!/usr/bin/env bash\ncat > "$HOME/prompt.txt"\nexec sleep 120\n');
      const { r, seg } = lanza({}, { CLAUDE_TOPE_SEG: "2" });
      igual(r.status !== null, true, "el script terminó (no se quedó colgado): rc=" + r.status);
      igual(seg < 60, true, "en segundos, no en minutos (" + seg + " s)");
      const l = leeLog(HOME);
      casa(l, /^\d{4}-\d\d-\d\dT[\d:]+[+-]\d\d:\d\d hilo 1794950000\.000100 saltó el tope de tiempo \(2 s\): claude -p cortado \(rc=124\)/m, "la línea del tope, con fecha ISO y el hilo");
      igual((l.match(/saltó el tope de tiempo/g) || []).length, 1, "una sola vez");
      igual(fs.existsSync(path.join(HOME, "prompt.txt")), true, "(el Claude falso sí llegó a arrancar)");
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  });

  await prueba("si Claude acaba a tiempo no hay línea de tope; y el valor por defecto es 1200 s (20 min)", () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "tope-atender-ok-"));
    try {
      const { HOME, lanza } = monta(T, '#!/usr/bin/env bash\ncat > "$HOME/prompt.txt"\nexit 0\n');
      lanza({}, { CLAUDE_TOPE_SEG: "30" });
      igual(/saltó el tope/.test(leeLog(HOME)), false, "sin tope, sin línea");
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
    const src = fs.readFileSync(path.join(HERR, "atender-slack.sh"), "utf8"), src2 = fs.readFileSync(path.join(HERR, "lanzar-claude.sh"), "utf8");
    casa(src, /timeout -k 10 "\$\{CLAUDE_TOPE_SEG:-1200\}" "\$CLI" -p/, "atender-slack.sh: 1200 s por defecto, configurable");
    casa(src2, /timeout -k 10 "\$\{CLAUDE_TOPE_SEG:-1200\}" "\$CLI" -p/, "lanzar-claude.sh: igual");
  });

  await prueba("un Humano que se queda sin respuesta por el tope recibe el aviso de siempre (código 124); a una IA no se le contesta en Slack", () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "tope-atender-h-"));
    try {
      const { HOME, lanza } = monta(T, '#!/usr/bin/env bash\ncat > /dev/null\nexec sleep 120\n');
      // responder-slack.sh de mentira que apunta lo que enviaría
      fs.writeFileSync(path.join(T, "herr", "responder-slack.sh"), '#!/usr/bin/env bash\n[ "$1" = "--reaccion" ] && exit 0\ncat "$3" >> "$HOME/enviado.txt"\nexit 0\n');
      lanza({ quien: "Humano", oficina: false }, { CLAUDE_TOPE_SEG: "2" });
      casa(fs.readFileSync(path.join(HOME, "enviado.txt"), "utf8"), /No he terminado de contestarte \(código 124\)/, "a Humano se le dice que no terminó (código 124)");
      casa(leeLog(HOME), /saltó el tope de tiempo/, "y queda anotado");
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  });

  await prueba("BLOQUES=id1,id2: el prompt de atender-slack.sh nombra los bloques y manda leerlos aunque no salgan en el último tramo del canal", () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "bloques-atender-"));
    try {
      const { HOME, lanza } = monta(T, '#!/usr/bin/env bash\nn=$(ls "$HOME"/prompt-*.txt 2>/dev/null | wc -l)\ncat > "$HOME/prompt-$n.txt"\nexit 0\n');
      lanza({}, { BLOQUES: "coo-sfei1478-fix-test,Dani-1332-implementa", CLAUDE_TOPE_SEG: "30" });
      const p = fs.readFileSync(path.join(HOME, "prompt-0.txt"), "utf8");
      casa(p, /2c\. Bloques del canal git que originaron este despertar: coo-sfei1478-fix-test,Dani-1332-implementa\. Léelos SIEMPRE[^\n]*aunque sean antiguos/, "sesión nueva: punto 2c con los ids");
      lanza({}, { CLAUDE_TOPE_SEG: "30" });   // misma sesión, sin BLOQUES: nada
      igual(/Bloques del canal git que originaron/.test(fs.readFileSync(path.join(HOME, "prompt-1.txt"), "utf8")), false, "sin BLOQUES, el prompt no cambia");
      lanza({}, { BLOQUES: "otro-bloque", CLAUDE_TOPE_SEG: "30" });   // sesión reanudada
      casa(fs.readFileSync(path.join(HOME, "prompt-2.txt"), "utf8"), /^Bloques del canal git que originaron este despertar: otro-bloque\./m, "sesión reanudada: la línea también va");
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  });
};
