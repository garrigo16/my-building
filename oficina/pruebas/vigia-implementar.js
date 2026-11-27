// vigia-implementar.js - el vigía del canal git manda lo de IMPLEMENTAR / VALIDAR a atender-slack.sh (PowerShell, sf; escrituras en org solo con el OK de
// Humano) y lo de solo lectura a lanzar-claude.sh (sin PowerShell ni sf); y a los dos les pasa los ids de los bloques que originaron el despertar
// (BLOQUES=id1,id2). Cubre canal-pendientes.js (canal principal) y el tramo del segundo canal de vigia-canal-timbre.sh.
// Todo aislado: lanzadores de mentira en carpetas temporales, CANAL_PRUEBAS=1 (nada sale a Slack), git solo con un origin local en /tmp.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");
const P = require(path.join(HERR, "canal-pendientes.js"));
const sh = (p) => p.replace(/\\/g, "/");
const espera = async (f, ms = 20e3) => { for (let i = 0; i < ms / 200 && !fs.existsSync(f); i++) await new Promise((x) => setTimeout(x, 200)); return fs.existsSync(f); };

// lanzadores de mentira: apuntan lo que reciben en $FALSO_OUT
function lanzadoresFalsos(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "lanzar-claude.sh"), '#!/usr/bin/env bash\nmkdir -p "$FALSO_OUT"\nprintf "%s\\n" "$@" > "$FALSO_OUT/lanzar-claude.args"\nprintf "%s" "${BLOQUES:-}" > "$FALSO_OUT/lanzar-claude.bloques"\n[ -f "$2" ] && cp "$2" "$FALSO_OUT/lanzar-claude.nota"\nexit 0\n');
  fs.writeFileSync(path.join(dir, "atender-slack.sh"), '#!/usr/bin/env bash\nmkdir -p "$FALSO_OUT"\nprintf "%s" "${BLOQUES:-}" > "$FALSO_OUT/atender.bloques"\nprintf "%s" "${CANAL_SIN_SLACK:-}" > "$FALSO_OUT/atender.sinslack"\ncp "$1" "$FALSO_OUT/atender.json"\nexit 0\n');
  for (const s of ["timbre.sh", "avisar-humano.sh"]) fs.writeFileSync(path.join(dir, s), "#!/usr/bin/env bash\nexit 0\n");
}

module.exports = async ({ prueba, igual, casa }) => {
  console.log("el vigía: implementar/validar → atender-slack.sh; lectura → lanzar-claude.sh; y los ids de los bloques (BLOQUES)");

  await prueba("criterio «implementar/validar»: los casos de hoy sí (SFEI-1478 corrección de test, SFEI-1332 implementación, checkOnly en MIKIDEV); lectura y publicar, no", () => {
    const si = ["[SFEI-1478] Corrección de test de la clase de ejemplo", "SFEI-1332: implementación del campo nuevo", "lanza el checkOnly en MIKIDEV", "valida el cambio en QA",
      "aplica el diff de la rama de ejemplo", "despliega en el sandbox", "corre los tests en el org MIKIDEV", "RunSpecifiedTests de la clase de ejemplo", "sf project deploy start --dry-run"];
    const no = ["Deploy report de co17 (solo lectura)", "dime la SOQL de licencias", "publica la nota en el canal", "lee el diff del bloque 560 y resúmelo", "contesta a Coo con el resultado"];
    for (const t of si) igual([t, P.pideImplementarOValidar(t)], [t, true], "implementar/validar");
    for (const t of no) igual([t, P.pideImplementarOValidar(t)], [t, false], "lectura / publicar");
  });

  await prueba("jsonAtender: el JSON de atender-slack.sh (channel, ts, thread_ts, quien, text, oficina); quien nunca es Humano; sin hilo, nada", () => {
    const bs = [{ id: "coo-sfei1478-fix", tit: "[SFEI-1478] Corrección de test", de: "Coo", cuerpo: "" }, { id: "Dani, 1332", tit: "impl", de: "", cuerpo: "" }];
    const j = P.jsonAtender({ nota: "para: Claude\nDetalle: corrige el test", bloques: bs, hilo: "1795000000.000100", canal: "C0PRUEBA", ahora: Date.parse("2026-11-26T10:00:00Z") });
    igual([j.channel, j.thread_ts, j.quien, j.oficina, "escritura" in j], ["C0PRUEBA", "1795000000.000100", "Coo", true, false], "campos y sin escritura");
    casa(j.ts, /^\d{10}\.\d{6}$/, "ts con forma de Slack");
    casa(j.text, /^\(Encargo del canal git, no de Humano: las escrituras en org siguen bloqueadas hasta su OK[^\n]*\)\npara: Claude\nDetalle: corrige el test\nBloques: coo-sfei1478-fix, Dani 1332$/, "el texto lleva la nota y los bloques");
    igual(P.jsonAtender({ nota: "x", bloques: bs, hilo: "", canal: "C" }), null, "sin hilo: null (se usa lanzar-claude.sh)");
    igual(P.jsonAtender({ nota: "x", bloques: [{ id: "a", tit: "t", de: "Humano" }], hilo: "1.1", canal: "C" }).quien, "Humano", "(el autor del bloque, si fuera Humano, lo decide el bloque; el vigía solo pone IAs)");
    igual(P.idsDe([{ id: "a,b" }, { id: "a b" }, { id: "", tit: "Sin id" }]), ["a b", "Sin id"], "ids sin comas, sin repetir y con el título si no hay id");
  });

  await prueba("ejecuta() pasa al lanzador los bloques que originaron el despertar (tercer argumento)", () => {
    const tip = "<!-- para: Claude | id: coo-uno | accion: x | estado: lo hace: Claude — a -->\n## [AAA-1] Uno\nEncargo a Claude: haz uno.\n\n<!-- para: Claude | id: coo-dos | accion: x | estado: lo hace: Claude — b -->\n## [BBB-2] Dos\nEncargo a Claude: haz dos.\n";
    const r = P.decide({ tip, viejos: [""], estado: {}, ahora: Date.parse("2026-11-26T10:00:00Z"), ocupadas: {} });
    const vistos = [];
    P.ejecuta(r, { canal: "principal", sha: "a".repeat(40), desde: "b".repeat(40), ahora: Date.parse("2026-11-26T10:00:00Z"), lanzar: (ia, f, bs) => { vistos.push([ia, P.idsDe(bs)]); return 0; } });
    igual(vistos, [["Claude", ["coo-uno", "coo-dos"]]], "una despertada con los dos bloques");
  });

  // ---------- canal principal: canal-pendientes.js de punta a punta ----------
  const BL_IMPL = "<!-- para: Claude | id: coo-sfei1478-test-20261126 | accion: coordinacion | estado: lo hace: Claude — corrige el test y valida con checkOnly en MIKIDEV -->\n## [SFEI-1478] Corrección de test de la clase de ejemplo\nEncargo a Claude: corrige el test y lanza el checkOnly en MIKIDEV.\n\n— Coo\n";
  const BL_LEC = "<!-- para: Claude | id: coo-soql-licencias-20261126 | accion: coordinacion | estado: lo hace: Claude — saca la SOQL -->\n## [SFEI-560] SOQL de licencias (solo lectura)\nEncargo a Claude: dime la SOQL de licencias y publícala en el canal.\n\n— Coo\n";
  const BL_1332 = "<!-- para: Claude | id: coo-sfei1332-impl-20261126 | accion: coordinacion | estado: lo hace: Claude — implementa -->\n## [SFEI-1332] Implementación del campo de ejemplo\nEncargo a Claude: implementa el cambio acordado.\n\n— Coo\n";
  const corre = (T, tipTxt, { hilo = "1795000000.000100" } = {}) => {
    const logs = path.join(T, "logs"), falsos = path.join(T, "falsos"), out = path.join(T, "out");
    fs.rmSync(out, { recursive: true, force: true }); fs.rmSync(path.join(logs, "traspasos-principal.json"), { force: true });
    fs.mkdirSync(logs, { recursive: true }); lanzadoresFalsos(falsos);
    if (hilo) fs.writeFileSync(path.join(logs, "timbre-hilo.txt"), hilo + "\n"); else fs.rmSync(path.join(logs, "timbre-hilo.txt"), { force: true });
    const f = (n, txt) => { const x = path.join(T, n); fs.writeFileSync(x, txt); return x; };
    const r = spawnSync("node", [path.join(HERR, "canal-pendientes.js"), "--canal", "principal", "--tip", f("tip", "# Canal\n\n" + tipTxt), "--base", f("base", "# Canal\n"), "--lim", f("lim", "# Canal\n"),
      "--sha", "a".repeat(40), "--desde", "b".repeat(40), "--estado", logs, "--base-min", "5"],
      { encoding: "utf8", timeout: 60e3, env: { ...process.env, CANAL_LOGS: logs, VIGIA_LANZADORES: falsos, CANAL_PRUEBAS: "1", CANAL_BASH: "bash", FALSO_OUT: out, SLACK_API_URL: "" } });
    return { r, out };
  };
  const mkT = (n) => fs.mkdtempSync(path.join(os.tmpdir(), n));

  await prueba("canal principal: un bloque de implementar/validar (SFEI-1478) va a atender-slack.sh con un JSON de IA en el hilo del timbre, BLOQUES y sin Slack", async () => {
    const T = mkT("vigia-impl-");
    try {
      const { r, out } = corre(T, BL_IMPL);
      casa(r.stdout, /despierto a Claude \(rc=0\)/, "despertada (" + (r.stdout + r.stderr).trim().slice(0, 200) + ")");
      igual(await espera(path.join(out, "atender.json")), true, "atender-slack.sh recibió el JSON");
      const j = JSON.parse(fs.readFileSync(path.join(out, "atender.json"), "utf8"));
      igual([j.thread_ts, j.oficina, j.quien !== "Humano", "escritura" in j], ["1795000000.000100", true, true, false], "hilo del timbre, de la oficina, quien no es Humano y sin escritura");
      casa(j.text, /SFEI-1478[\s\S]*Bloques: coo-sfei1478-test-20261126$/, "el texto lleva el encargo y los ids");
      igual(fs.readFileSync(path.join(out, "atender.bloques"), "utf8"), "coo-sfei1478-test-20261126", "BLOQUES en el entorno");
      igual(fs.readFileSync(path.join(out, "atender.sinslack"), "utf8"), "1", "CANAL_SIN_SLACK=1: en pruebas no sale nada a Slack");
      igual(fs.existsSync(path.join(out, "lanzar-claude.args")), false, "y no se usó lanzar-claude.sh");
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  });
  await prueba("canal principal: SFEI-1332 (implementación) también va a atender-slack.sh", async () => {
    const T = mkT("vigia-impl2-");
    try {
      const { out } = corre(T, BL_1332);
      igual(await espera(path.join(out, "atender.json")), true, "atender-slack.sh");
      igual(fs.readFileSync(path.join(out, "atender.bloques"), "utf8"), "coo-sfei1332-impl-20261126", "con su id");
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  });
  await prueba("canal principal: un recado de solo lectura / publicar sigue yendo a lanzar-claude.sh (con BLOQUES) y no a atender-slack.sh", async () => {
    const T = mkT("vigia-lec-");
    try {
      const { r, out } = corre(T, BL_LEC);
      casa(r.stdout, /despierto a Claude \(rc=0\)/, "despertada");
      igual(await espera(path.join(out, "lanzar-claude.bloques")), true, "lanzar-claude.sh");
      igual(fs.readFileSync(path.join(out, "lanzar-claude.bloques"), "utf8"), "coo-soql-licencias-20261126", "con el id del bloque en BLOQUES");
      casa(fs.readFileSync(path.join(out, "lanzar-claude.args"), "utf8"), /^principal\n.*\n[a]{40}\n[b]{40}\n/, "con los argumentos de siempre (canal, nota, sha, desde)");
      igual(fs.existsSync(path.join(out, "atender.json")), false, "sin atender-slack.sh");
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  });
  await prueba("canal principal: implementar sin hilo de timbre → cae a lanzar-claude.sh (no inventa hilo); mezcla lectura + implementar → atender-slack.sh con los dos ids", async () => {
    const T = mkT("vigia-mix-");
    try {
      let x = corre(T, BL_IMPL, { hilo: "" });
      igual(await espera(path.join(x.out, "lanzar-claude.bloques")), true, "sin hilo: lanzar-claude.sh");
      igual(fs.existsSync(path.join(x.out, "atender.json")), false, "y no atender-slack.sh");
      x = corre(T, BL_LEC + "\n" + BL_IMPL);
      igual(await espera(path.join(x.out, "atender.json")), true, "mezcla: atender-slack.sh");
      igual(fs.readFileSync(path.join(x.out, "atender.bloques"), "utf8"), "coo-soql-licencias-20261126,coo-sfei1478-test-20261126", "con los dos ids");
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  });

  // ---------- segundo canal: vigia-canal-timbre.sh ----------
  await prueba("segundo canal (vigia-canal-timbre.sh): implementar → atender-slack.sh; lectura → lanzar-claude.sh; los dos con BLOQUES", async () => {
    const T = mkT("vigia-seg-");
    try {
      const g = (cwd, ...a) => { const r = spawnSync("git", ["-c", "user.email=p@p", "-c", "user.name=p", ...a], { cwd, encoding: "utf8", windowsHide: true });
        if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`); return r.stdout.trim(); };
      const bare = path.join(T, "origen.git"), semilla = path.join(T, "semilla"), HOME = path.join(T, "home"), herr = path.join(T, "herr"), out = path.join(T, "out"), wt = path.join(HOME, "wt-canal-claude");
      for (const d of [semilla, path.join(HOME, ".canal-logs"), path.join(HOME, ".config"), herr]) fs.mkdirSync(d, { recursive: true });
      g(T, "init", "--bare", "-q", bare);
      g(semilla, "init", "-q", "-b", "canal/proyecto/compartido");
      const FICH = path.join(semilla, "CANAL_PROYECTO.md"), commit = (txt, msg) => { fs.appendFileSync(FICH, txt); g(semilla, "add", "."); g(semilla, "commit", "-q", "-m", msg); g(semilla, "push", "-q", "-f", sh(bare), "HEAD:refs/heads/canal/proyecto/compartido"); return g(semilla, "rev-parse", "HEAD"); };
      // (un bloque ya contestado en el canal: sin él, contestados() sale vacío y su awk «NR==FNR» se come el stdin; así es el canal de verdad)
      const sha0 = commit("# Canal de ejemplo\n\n<!-- para: Claude | id: Dani-0-base | accion: encargo -->\n## [BASE-1] Algo ya contestado\nPido a Claude: nada.\n\n<!-- para: Dani | id: Claude-0-resp | accion: respuesta | responde-a: Dani-0-base -->\n## Claude · [BASE-1] Hecho\nListo.\n", "inicio");
      g(T, "clone", "-q", "-b", "canal/proyecto/compartido", sh(bare), wt);
      for (const f of ["vigia-canal-timbre.sh", "canal-pendientes.js", "canal-bloques.js", "tapar-secretos.js"]) fs.copyFileSync(path.join(HERR, f), path.join(herr, f));
      lanzadoresFalsos(herr);
      const L = path.join(HOME, ".canal-logs");
      fs.writeFileSync(path.join(L, "vigia-canal-vistos.txt"), "id-anterior\n"); fs.writeFileSync(path.join(L, "vigia-canal-sha.txt"), sha0 + "\n");
      fs.writeFileSync(path.join(L, "timbre-hilo.txt"), "1795000000.000100\n");
      const pasada = () => { fs.rmSync(out, { recursive: true, force: true });
        const r = spawnSync("bash", [sh(path.join(herr, "vigia-canal-timbre.sh")), "--ya"], { encoding: "utf8", windowsHide: true, timeout: 90e3,
          env: { ...process.env, HOME: sh(HOME), USERPROFILE: HOME, EDIFICIO_CONFIG: "ninguno", CANAL_PRUEBAS: "1", SLACK_API_URL: "", FALSO_OUT: sh(out), VIGIA_TURNO_REPO: sh(semilla) } });
        const lf = path.join(L, "vigia-canal.log"); return { r, log: fs.existsSync(lf) ? fs.readFileSync(lf, "utf8") : "" }; };
      const bloque = (id, tit, cuerpo) => `\n<!-- para: Claude | id: ${id} | accion: encargo -->\n## ${tit}\n${cuerpo}\n`;

      commit(bloque("Dani-1478-test", "[SFEI-1478] Corrección de test y checkOnly en MIKIDEV", "Pido a Claude: corrige el test y valida con checkOnly en MIKIDEV."), "bloque de implementar");
      let x = pasada();
      igual(await espera(path.join(out, "atender.json")), true, "implementar: atender-slack.sh (log: " + x.log.slice(-300) + " / rc=" + x.r.status + " / stderr: " + String(x.r.stderr).slice(0, 400) + " / stdout: " + String(x.r.stdout).slice(0, 300) + ")");
      const j = JSON.parse(fs.readFileSync(path.join(out, "atender.json"), "utf8"));
      igual([j.thread_ts, j.oficina, j.quien !== "Humano"], ["1795000000.000100", true, true], "JSON de IA en el hilo del timbre");
      casa(j.text, /Bloques: Dani-1478-test$/, "con el id");
      igual(fs.readFileSync(path.join(out, "atender.bloques"), "utf8"), "Dani-1478-test", "BLOQUES");
      igual(fs.readFileSync(path.join(out, "atender.sinslack"), "utf8"), "1", "sin Slack en pruebas");
      igual(fs.existsSync(path.join(out, "lanzar-claude.args")), false, "sin lanzar-claude.sh");
      casa(x.log, /atender-slack \(implementar\/validar\) rc=0/, "y queda en el log del vigía");

      commit(bloque("Dani-560-soql", "[SFEI-560] SOQL de licencias", "Pido a Claude: dime la SOQL de licencias y publícala en el canal."), "bloque de lectura");
      x = pasada();
      igual(await espera(path.join(out, "lanzar-claude.bloques")), true, "lectura: lanzar-claude.sh (log: " + x.log.slice(-300) + ")");
      igual(fs.readFileSync(path.join(out, "lanzar-claude.bloques"), "utf8"), "Dani-560-soql", "con BLOQUES");
      igual(fs.existsSync(path.join(out, "atender.json")), false, "sin atender-slack.sh");
    } finally { await new Promise((y) => setTimeout(y, 300)); try { fs.rmSync(T, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) {} }
  });
};
