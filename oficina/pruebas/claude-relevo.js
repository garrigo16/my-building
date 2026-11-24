// claude-relevo.js - relevo de Claude entre la cuenta de empresa (Team) y la personal (Pro), AISLADO: lanzar-claude.sh de verdad
// y relevo-claude.js copiados a una carpeta temporal, carpeta de usuario vacía, Claude falso, avisar-humano.sh falso y el estado
// de las cuentas en un fichero falso (RELEVO_MOCK con CANAL_PRUEBAS=1). Ni red ni cuentas reales.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");
const relevo = require(path.join(HERR, "relevo-claude.js"));
const espera = (ms) => new Promise((x) => setTimeout(x, ms));

module.exports = async ({ prueba, igual, casa }) => {
  console.log("relevo-claude: de la cuenta de empresa a la personal");
  const montaje = (mock, cli) => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "relevo-")), H = path.join(T, "herr"), HOME = path.join(T, "home");
    for (const d of [H, path.join(HOME, ".canal-logs"), path.join(T, "repo")]) fs.mkdirSync(d, { recursive: true });
    for (const f of ["lanzar-claude.sh", "relevo-claude.js"]) fs.copyFileSync(path.join(HERR, f), path.join(H, f));
    fs.writeFileSync(path.join(H, "freno.sh"), "#!/usr/bin/env bash\nexit 0\n");
    fs.writeFileSync(path.join(H, "avisar-humano.sh"), '#!/usr/bin/env bash\nprintf "%s\\n" "$1" >> "$HOME/avisos.txt"\n');
    const falso = path.join(T, "claude-falso.sh");
    fs.writeFileSync(falso, cli || '#!/usr/bin/env bash\ncat > /dev/null\nprintf "%s|%s\\n" "${CLAUDE_CONFIG_DIR:-sin}" "${CLAUDE_CODE_OAUTH_TOKEN:-sin-token}" >> "$HOME/runs.txt"\n');
    const m = path.join(T, "mock.json"); fs.writeFileSync(m, JSON.stringify(mock));
    const nota = path.join(T, "nota.txt"); fs.writeFileSync(nota, "para: Claude\nDetalle: prueba del relevo\n");
    const r = spawnSync("bash", [path.join(H, "lanzar-claude.sh"), "principal", nota, "a".repeat(40), "b".repeat(40)], { encoding: "utf8", timeout: 60e3,
      env: { ...process.env, HOME, USERPROFILE: HOME, CLAUDE_CLI: falso, CANAL_REPO: path.join(T, "repo"), CANAL_PRUEBAS: "1", RELEVO_MOCK: m, CLAUDE_CODE_OAUTH_TOKEN: "tok-falso-empresa" } });
    const lee = (f) => { try { return fs.readFileSync(path.join(HOME, f), "utf8").trim().split("\n").filter(Boolean); } catch { return []; } };
    return { T, HOME, r, lee, fin: async () => { await espera(1000); try { fs.rmSync(T, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 }); } catch {} } };
  };
  const mas = (h) => new global.FechaReal(global.FechaReal.now() + h * 3600e3);
  const iso = (d) => d.toISOString();

  await prueba("relevo: ventana de 5 h agotada en empresa -> un solo relevo a la personal y aviso de 5 h", async () => {
    const r5 = mas(2), M = montaje({ empresa: { five_hour: { utilization: 100, resets_at: iso(r5) }, seven_day: { utilization: 10 } }, personal: { five_hour: { utilization: 5 } } });
    try {
      casa(M.r.stdout, /CLAUDE lanzado/, "el lanzador vuelve enseguida");
      for (let i = 0; i < 60 && !M.lee("runs.txt").length; i++) await espera(250);
      await espera(500);
      const runs = M.lee("runs.txt");
      igual(runs.length, 1, "un solo arranque");
      casa(runs[0], /[\\/]\.claude-personal\|sin-token$/, "CLAUDE_CONFIG_DIR a .claude-personal y sin el token de empresa");
      const av = M.lee("avisos.txt");
      igual(av, [`Claude de empresa (Team) ha agotado la ventana de 5 horas. Se reinicia ${relevo.cuando(r5)}. Paso a la cuenta personal (Pro).`], "el aviso de 5 h");
      casa(av[0], /\(Madrid\)\. Paso a la cuenta personal \(Pro\)\.$/, "con la etiqueta Madrid");
      casa(M.lee(".canal-logs/claude-arranques.log").join("\n"), /ventana de 5 horas/, "queda en claude-arranques.log");
      casa(M.lee(".canal-logs/claude-aviso.json").join(""), /ventana de 5 horas/, "y en claude-aviso.json para el panel");
    } finally { await M.fin(); }
  });

  await prueba("relevo: cupo semanal agotado en empresa -> un solo relevo y aviso de cupo semanal", async () => {
    const r7 = mas(24 * 4), M = montaje({ empresa: { "anthropic-ratelimit-unified-7d-status": "rejected", "anthropic-ratelimit-unified-7d-reset": String(Math.floor(r7.getTime() / 1000)) }, personal: null });
    try {
      for (let i = 0; i < 60 && !M.lee("runs.txt").length; i++) await espera(250);
      await espera(500);
      const runs = M.lee("runs.txt");
      igual(runs.length, 1, "un solo arranque");
      casa(runs[0], /[\\/]\.claude-personal\|sin-token$/, "la personal, sin token de empresa");
      const av = M.lee("avisos.txt");
      igual(av, [`Claude de empresa (Team) ha agotado el cupo semanal. Se reinicia ${relevo.cuando(r7)}. Paso a la cuenta personal (Pro).`], "el aviso del cupo semanal");
      casa(av[0], /Se reinicia el \S+ \d\d\/\d\d a las \d\d:\d\d \(Madrid\)/, "con día, fecha y hora de Madrid");
    } finally { await M.fin(); }
  });

  await prueba("relevo: las dos cuentas agotadas -> aviso con las dos horas (Madrid) y no se lanza a Claude, sin bucles", async () => {
    const e = mas(1), p = mas(24 * 3), M = montaje({ empresa: { five_hour: { utilization: 100, resets_at: iso(e) } }, personal: { seven_day: { utilization: 100, resets_at: iso(p) } } });
    try {
      for (let i = 0; i < 60 && !M.lee("avisos.txt").length; i++) await espera(250);
      await espera(1500);
      igual(M.lee("runs.txt").length, 0, "no se lanza a nadie");
      const av = M.lee("avisos.txt");
      igual(av.length, 1, "un solo aviso");
      igual(av[0], `Claude de empresa (Team) ha agotado la ventana de 5 horas (se reinicia ${relevo.cuando(e)}) y Claude personal (Pro) ha agotado el cupo semanal (se reinicia ${relevo.cuando(p)}). No lanzo a nadie.`, "texto con las dos horas");
      igual((av[0].match(/\(Madrid\)/g) || []).length, 2, "las dos horas en Madrid");
    } finally { await M.fin(); }
  });

  await prueba("relevo: si el CLI topa con la cuota en pleno arranque, un único relevo (y si la personal también topa, se para)", async () => {
    const topa = '#!/usr/bin/env bash\ncat > /dev/null\nprintf "%s|%s\\n" "${CLAUDE_CONFIG_DIR:-sin}" "${CLAUDE_CODE_OAUTH_TOKEN:-sin-token}" >> "$HOME/runs.txt"\n'
      + 'echo "You\'ve hit your 5-hour limit · resets 7:10pm (Europe/Madrid)"\nexit 1\n';
    const M = montaje({ empresa: null, personal: null }, topa);
    try {
      for (let i = 0; i < 80 && M.lee("runs.txt").length < 2; i++) await espera(250);
      await espera(2000);
      const runs = M.lee("runs.txt");
      igual(runs.length, 2, "exactamente dos arranques: empresa y un relevo, nunca un tercero");
      casa(runs[0], /^sin\|tok-falso-empresa$/, "primero la de empresa");
      casa(runs[1], /[\\/]\.claude-personal\|sin-token$/, "luego la personal");
      const av = M.lee("avisos.txt");
      casa(av[0], /^Claude de empresa \(Team\) ha agotado la ventana de 5 horas\. Se reinicia .* \(Madrid\)\. Paso a la cuenta personal \(Pro\)\.$/, "aviso del relevo");
      casa(av[av.length - 1], /Claude personal \(Pro\) ha agotado la ventana de 5 horas/, "y, al topar también la personal, el aviso de que se para");
    } finally { await M.fin(); }
  });
};
