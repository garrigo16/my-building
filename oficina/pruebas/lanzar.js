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
};
