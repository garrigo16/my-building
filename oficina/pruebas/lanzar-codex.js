// lanzar-codex.js - lanzar-codex.sh (el que despierta a Codex desde el canal git) de punta a punta, AISLADO: el script de verdad
// copiado a una carpeta temporal, freno.sh de mentira, carpeta de usuario vacía y un Codex falso que guarda lo que le llega.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("lanzar-codex.sh: el Codex del canal");
  await prueba("Codex: lanza con la nota por stdin, en el worktree del canal y con su modelo; una nota de solo confirmar no lanza; sin CLI, 13; sin worktree, 2", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "lanzar-codex-")), H = path.join(T, "herr"), HOME = path.join(T, "home");
    try {
      for (const d of [H, path.join(HOME, ".canal-logs"), path.join(HOME, "wt-canal-claude")]) fs.mkdirSync(d, { recursive: true });
      fs.copyFileSync(path.join(HERR, "lanzar-codex.sh"), path.join(H, "lanzar-codex.sh"));
      fs.writeFileSync(path.join(H, "freno.sh"), "#!/usr/bin/env bash\nexit 0\n");
      const cli = path.join(T, "codex-falso.sh");
      fs.writeFileSync(cli, '#!/usr/bin/env bash\ncat > "$HOME/prompt.txt"\nprintf "%s\\n" "$@" > "$HOME/args.txt"\npwd > "$HOME/donde.txt"\n');
      const lanza = (nota, canal = "principal", env = {}) => { const n = path.join(T, "nota.txt"); fs.writeFileSync(n, nota);
        return spawnSync("bash", [path.join(H, "lanzar-codex.sh"), canal, n, "a".repeat(40), "b".repeat(40)], { encoding: "utf8", timeout: 60e3,
          env: { ...process.env, HOME, CODEX_CLI: cli, CODEX_MODELO: "modelo-de-prueba", CODEX_ARGS: "", ...env } }); };
      const r = lanza("para: Codex\nDetalle: en el canal principal te piden revisar el diff (bloque 560 de Coo)\nDesde: prueba\n");
      casa(r.stdout, /CODEX lanzado \(principal aaaaaaaaaa\)/, "lanzado (" + (r.stderr || "").trim().slice(0, 120) + ")");
      for (let i = 0; i < 60 && !fs.existsSync(path.join(HOME, "donde.txt")); i++) await new Promise((x) => setTimeout(x, 250));   // va desacoplado
      const p = fs.readFileSync(path.join(HOME, "prompt.txt"), "utf8"), a = fs.readFileSync(path.join(HOME, "args.txt"), "utf8"), d = fs.readFileSync(path.join(HOME, "donde.txt"), "utf8").trim();
      igual([/bloque 560 de Coo/.test(p), /bash .*publicar-canal\.sh principal/.test(p), /Eres Codex/.test(p)], [true, true, true], "el prompt lleva la nota y cómo publicar");
      igual([/^exec$/m.test(a), /^modelo-de-prueba$/m.test(a), /^workspace-write$/m.test(a), /^-$/m.test(a)], [true, true, true, true], "codex exec, con su modelo, escritura solo en su carpeta y el prompt por stdin");
      igual(/wt-canal-claude$/.test(d), true, "trabaja en el worktree del canal (" + d + ")");
      fs.unlinkSync(path.join(HOME, "prompt.txt"));
      const r2 = lanza("para: Codex\nCoinciden: todo\nNo coinciden: nada\nTu OK: no hace falta\nTercera lectura: no\n");
      igual([r2.status, /CODEX lanzado/.test(r2.stdout)], [0, false], "una nota de solo confirmar no abre a Codex");
      igual(lanza("para: Codex\nDetalle: x\n", "principal", { CODEX_CLI: path.join(T, "no-existe") }).status, 13, "sin CLI: 13");
      igual(lanza("para: Codex\nDetalle: x\n", "otro").status, 2, "canal desconocido: 2");
    } finally { await new Promise((x) => setTimeout(x, 300)); fs.rmSync(T, { recursive: true, force: true }); }
  });
  await prueba("Codex: es una IA del canal solo si la config lo activa (codex.activo)", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "codex-cfg-"));
    try {
      const f = path.join(T, "c.json"); fs.writeFileSync(f, JSON.stringify({ codex: { activo: true } }));
      const ias = (cfg) => spawnSync(process.execPath, ["-e", `process.stdout.write(require(${JSON.stringify(path.join(HERR, "canal-bloques.js"))}).IAS.join(","))`], { encoding: "utf8", env: { ...process.env, EDIFICIO_CONFIG: cfg } }).stdout;
      igual([ias("ninguno"), ias(f)], ["Claude,Cursor,Coo", "Claude,Cursor,Coo,Codex"], "sin config, como siempre; con codex.activo, Codex entra");
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  });
};
