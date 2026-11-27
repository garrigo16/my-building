// lanzar.js - v294: lanzar-claude.sh (el que despierta a Claude desde el canal git) de punta a punta, AISLADO: el script de
// verdad copiado a una carpeta temporal, freno.sh de mentira, carpeta de usuario vacía y un Claude falso que guarda lo que le
// llega. Nada sale del equipo.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("lanzar-claude.sh: el Claude del canal");
  await prueba("v294: lanza a Claude con la nota, Sonnet, sin PowerShell y con un Git Bash que existe; una nota de solo confirmar no lanza a nadie", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "lanzar-")), H = path.join(T, "herr"), HOME = path.join(T, "home");
    try {
      for (const d of [H, path.join(HOME, ".canal-logs"), path.join(T, "repo")]) fs.mkdirSync(d, { recursive: true });
      fs.copyFileSync(path.join(HERR, "lanzar-claude.sh"), path.join(H, "lanzar-claude.sh"));
      fs.writeFileSync(path.join(H, "freno.sh"), "#!/usr/bin/env bash\nexit 0\n");
      const cli = path.join(T, "claude-falso.sh");
      fs.writeFileSync(cli, '#!/usr/bin/env bash\ncat > "$HOME/prompt.txt"\nprintf "%s\\n" "$@" > "$HOME/args.txt"\nprintf "%s" "$CLAUDE_CODE_GIT_BASH_PATH" > "$HOME/gitbash.txt"\n');
      const lanza = (nota) => { const n = path.join(T, "nota.txt"); fs.writeFileSync(n, nota);
        return spawnSync("bash", [path.join(H, "lanzar-claude.sh"), "principal", n, "a".repeat(40), "b".repeat(40)], { encoding: "utf8", timeout: 60e3,
          env: { ...process.env, HOME, CLAUDE_CLI: cli, CANAL_REPO: path.join(T, "repo"), CANAL_PRUEBAS: "1", CLAUDE_CODE_OAUTH_TOKEN: "" } }); };
      const r = lanza("para: Claude\nDetalle: en el canal principal te piden la SOQL de licencias (bloque 560 de Coo)\nDesde: prueba\n");
      casa(r.stdout, /CLAUDE lanzado \(principal aaaaaaaaaa\)/, "lanzado (" + (r.stderr || "").trim().slice(0, 120) + ")");
      for (let i = 0; i < 60 && !fs.existsSync(path.join(HOME, "gitbash.txt")); i++) await new Promise((x) => setTimeout(x, 250));   // va desacoplado
      const p = fs.readFileSync(path.join(HOME, "prompt.txt"), "utf8"), a = fs.readFileSync(path.join(HOME, "args.txt"), "utf8"), gb = fs.readFileSync(path.join(HOME, "gitbash.txt"), "utf8").trim();
      igual([/bloque 560 de Coo/.test(p), /LEIDO=<sha leído> NOTA=<fichero de nota> bash .*publicar-canal\.sh principal/.test(p)], [true, true], "el prompt lleva la nota y cómo publicar");
      igual([/^claude-sonnet-5-5$/m.test(a), /^Bash,Read,Grep,Glob,Edit,Write,Agent$/m.test(a), /^PowerShell$/m.test(a)], [true, true, true], "Sonnet, sin PowerShell entre sus herramientas (y PowerShell prohibido)");
      igual(fs.existsSync(gb) && /bash\.exe$/i.test(gb), true, "Git Bash para el CLI, uno que existe (" + gb + ")");
      fs.unlinkSync(path.join(HOME, "prompt.txt"));
      const r2 = lanza("para: Claude\nCoinciden: todo\nNo coinciden: nada\nTu OK: no hace falta\nTercera lectura: no\n");
      igual([r2.status, /CLAUDE lanzado/.test(r2.stdout)], [0, false], "una nota de solo confirmar no abre a Claude (sería un acuse de cortesía)");
      casa(fs.readFileSync(path.join(HOME, ".canal-logs", "freno.log"), "utf8"), /nota de confirmación \(principal aaaaaaaaaa\): no abro Claude/, "y lo apunta");
    } finally { await new Promise((x) => setTimeout(x, 300)); fs.rmSync(T, { recursive: true, force: true }); }
  });

  // montaje aislado común: el script de verdad en una carpeta temporal, freno.sh de mentira y un Claude falso
  const monta = (T, cuerpoCli) => {
    const H = path.join(T, "herr"), HOME = path.join(T, "home");
    for (const d of [H, path.join(HOME, ".canal-logs"), path.join(T, "repo")]) fs.mkdirSync(d, { recursive: true });
    fs.copyFileSync(path.join(HERR, "lanzar-claude.sh"), path.join(H, "lanzar-claude.sh"));
    fs.writeFileSync(path.join(H, "freno.sh"), "#!/usr/bin/env bash\nexit 0\n");
    const cli = path.join(T, "claude-falso.sh"); fs.writeFileSync(cli, cuerpoCli);
    const lanza = (nota, env = {}) => { const n = path.join(T, "nota.txt"); fs.writeFileSync(n, nota);
      return spawnSync("bash", [path.join(H, "lanzar-claude.sh"), "principal", n, "a".repeat(40), "b".repeat(40)], { encoding: "utf8", timeout: 60e3,
        env: { ...process.env, HOME, CLAUDE_CLI: cli, CANAL_REPO: path.join(T, "repo"), CANAL_PRUEBAS: "1", CLAUDE_CODE_OAUTH_TOKEN: "", ...env } }); };
    return { HOME, lanza };
  };
  const espera = async (f, ms = 20e3) => { for (let i = 0; i < ms / 250 && !fs.existsSync(f); i++) await new Promise((x) => setTimeout(x, 250)); return fs.existsSync(f); };

  await prueba("arreglo 3: con BLOQUES=id1,id2 el prompt los nombra y manda leerlos aunque queden fuera de DESDE..SHA; sin BLOQUES, el prompt no cambia", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "lanzar-bloques-"));
    try {
      const { HOME, lanza } = monta(T, '#!/usr/bin/env bash\ncat > "$HOME/prompt.tmp"\nmv "$HOME/prompt.tmp" "$HOME/prompt.txt"\n');   // escribe y luego renombra: si no, la prueba puede leer el fichero aún vacío
      const r = lanza("para: Claude\nDetalle: te piden algo\n", { BLOQUES: "coo-sfei1478-fix-test,Dani-1332-implementa" });
      casa(r.stdout, /CLAUDE lanzado \(principal aaaaaaaaaa\)/, "lanzado (" + (r.stderr || "").trim().slice(0, 120) + ")");
      igual(await espera(path.join(HOME, "prompt.txt")), true, "el Claude falso recibió el prompt");
      const p = fs.readFileSync(path.join(HOME, "prompt.txt"), "utf8");
      casa(p, /Bloques que originaron este despertar: coo-sfei1478-fix-test,Dani-1332-implementa\. Léelos SIEMPRE[^\n]*aunque sean más antiguos y queden fuera de git log bbbbbbbbbb\.\.aaaaaaaaaa/, "los ids y la orden de leerlos fuera del tramo");
      casa(p, /git log bbbbbbbbbb\.\.aaaaaaaaaa/, "(el tramo DESDE..SHA de siempre sigue en el punto 2)");
      for (let i = 0; i < 40 && fs.existsSync(path.join(HOME, "prompt.txt")) === false; i++) await new Promise((x) => setTimeout(x, 100));
      fs.unlinkSync(path.join(HOME, "prompt.txt"));
      lanza("para: Claude\nDetalle: te piden algo\n");
      igual(await espera(path.join(HOME, "prompt.txt")), true, "sin BLOQUES, también lanza");
      igual(/Bloques que originaron/.test(fs.readFileSync(path.join(HOME, "prompt.txt"), "utf8")), false, "y el prompt no lleva la línea de bloques");
    } finally { await new Promise((x) => setTimeout(x, 400)); fs.rmSync(T, { recursive: true, force: true }); }
  });

  await prueba("arreglo 5: un claude -p que no acaba se corta a los CLAUDE_TOPE_SEG y queda anotado en sesiones-slack.log (fecha ISO, canal y que saltó el tope)", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "lanzar-tope-"));
    try {
      const { HOME, lanza } = monta(T, '#!/usr/bin/env bash\ncat > "$HOME/prompt.txt"\necho arrancado > "$HOME/arrancado.txt"\nexec sleep 60\n');
      const t0 = Date.now(), r = lanza("para: Claude\nDetalle: se queda colgado\n", { CLAUDE_TOPE_SEG: "2" });
      casa(r.stdout, /CLAUDE lanzado/, "lanzado");
      const log = path.join(HOME, ".canal-logs", "sesiones-slack.log");
      igual(await espera(log, 30e3), true, "aparece la línea del tope (en ~2 s, no en 20 min)");
      const l = fs.readFileSync(log, "utf8");
      casa(l, /^\d{4}-\d\d-\d\dT[\d:]+[+-]\d\d:\d\d canal principal aaaaaaaaaa: saltó el tope de tiempo \(2 s\), claude -p cortado \(rc=124\)/m, "con fecha ISO, el canal y que saltó el tope");
      igual(Date.now() - t0 < 30e3, true, "y no esperó a que acabara el sleep de 60 s");
    } finally { await new Promise((x) => setTimeout(x, 400)); fs.rmSync(T, { recursive: true, force: true }); }
  });

  await prueba("arreglo 5: un claude -p que acaba a tiempo no deja ninguna línea de tope", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "lanzar-notope-"));
    try {
      const { HOME, lanza } = monta(T, '#!/usr/bin/env bash\ncat > "$HOME/prompt.txt"\nexit 0\n');
      lanza("para: Claude\nDetalle: rápido\n", { CLAUDE_TOPE_SEG: "30" });
      igual(await espera(path.join(HOME, "prompt.txt")), true, "se lanzó");
      await new Promise((x) => setTimeout(x, 1500));
      igual(fs.existsSync(path.join(HOME, ".canal-logs", "sesiones-slack.log")), false, "sin tope, sin línea");
    } finally { await new Promise((x) => setTimeout(x, 400)); fs.rmSync(T, { recursive: true, force: true }); }
  });
};
