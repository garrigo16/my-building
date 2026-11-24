"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const S = require("../server.js");
const HERR = path.join(__dirname, "..", "..", "herramientas");

module.exports = async ({ prueba, igual, casa, C, T, setAhora }) => {
  console.log("v491: el vigilante de procesos barato, en dos fases (VIGILANTE_BARATO=1)");

  await prueba("v491: la oficina manda la mirada solo con el interruptor, solo a Claude y solo para un proceso; el texto de siempre va aparte («normal»)", () => {
    const { m } = C;
    const R = m("15:50:00", "Coo", "_Hilo: carga nocturna · simulacro_\nPlan."), CL = m("15:55:00", "Claude", "Lanzo el simulacro.\n[lo hace: Claude — vigilar el simulacro carga nocturna hasta que termine y luego programar los sábados]");
    setAhora(T("16:30"));
    const L0 = { arranquesCursor: [], frenos: [], avisosCoo: [], sesionHilo: {}, lanzHilo: {}, cursorSlack: [], esperas: [], ultEsc: 0, lanz: [], timbreHilo: "", traspasos: [] };
    const r = S.analizar([{ ts: R.ts, msgs: [R, CL] }], L0, null, null, []).relanzar.find((x) => x.proceso);
    igual(!!r, true, "a la media hora, una mirada");
    casa(r.textoMirada, /SOLO MIRA, EN LECTURA[\s\S]*NADA si sigue igual; «TERMINADO: <lo que ves, con el dato>»[\s\S]*«FALLADO: <lo que ves>»[\s\S]*Lo que dejaste dicho:\n.*Lanzo el simulacro/, "texto de la mirada");
    casa(r.texto, /Si ha terminado o ha fallado, sigue con lo que tocaba después/, "el de siempre, intacto");
    const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "barato-")), "traspasos.log"), js = [];
    const falso = (args) => { if (/\.json$/.test(args[1] || "")) { js.push(JSON.parse(fs.readFileSync(args[1], "utf8"))); fs.unlinkSync(args[1]); } return true; };
    try {
      S.sinRelanzados(); S.relanzaPendientes([r], falso, log, () => {}, false);
      igual([js[0].text === r.texto, "mirada" in js[0], "normal" in js[0]], [true, false, false], "sin el interruptor: como antes");
      S.sinRelanzados(); S.relanzaPendientes([r], falso, log, () => {}, true);
      igual([js[1].text === r.textoMirada, js[1].mirada, js[1].normal === r.texto, js[1].oficina], [true, true, true, true], "con VIGILANTE_BARATO=1: mirada + el texto de siempre");
      casa(fs.readFileSync(log, "utf8"), /RELANZO\tClaude\tslack\t[^\t]*:proceso:\d+\t[^\n]*· mirada barata/, "traspasos.log dice que fue barata");
      S.sinRelanzados(); S.relanzaPendientes([{ ...r, ia: "Cursor" }, { ...r, hilo: "otro", proceso: false, clave: "slack:otro:1" }], falso, log, () => {}, true);
      igual([js[2].mirada, js[3].mirada], [undefined, undefined], "ni a Cursor ni a lo que no es un proceso");
    } finally { fs.rmSync(path.dirname(log), { recursive: true, force: true }); S.sinRelanzados(); }
  });

  await prueba("v491: atender-slack.sh: NADA → solo la mirada (Haiku, esfuerzo bajo, sin publicar); TERMINADO → sigue Sonnet en la misma sesión con lo que vio; si la mirada falla, Sonnet como antes", () => {
    const Tm = fs.mkdtempSync(path.join(os.tmpdir(), "barato-sh-")), H = path.join(Tm, "herr"), HOME = path.join(Tm, "home");
    try {
      for (const d of [H, HOME, path.join(HOME, ".canal-logs"), path.join(HOME, ".config"), path.join(Tm, "repo")]) fs.mkdirSync(d, { recursive: true });
      fs.copyFileSync(path.join(HERR, "atender-slack.sh"), path.join(H, "atender-slack.sh"));
      fs.copyFileSync(path.join(HERR, "formato-para-humano.txt"), path.join(H, "formato-para-humano.txt"));
      for (const s of ["responder-slack.sh", "freno.sh"]) fs.writeFileSync(path.join(H, s), "#!/usr/bin/env bash\nexit 0\n");
      // el Claude falso: guarda prompt y argumentos; si es la mirada (haiku), escribe FALSO_MIRADA en el fichero de respuesta
      const cli = path.join(Tm, "claude-falso.sh");
      fs.writeFileSync(cli, '#!/usr/bin/env bash\nn=$(ls "$HOME"/prompt-*.txt 2>/dev/null | wc -l)\ncat > "$HOME/prompt-$n.txt"\nprintf "%s\\n" "$@" > "$HOME/args-$n.txt"\n'
        + 'R=$(grep -o "[^ ]*slack-respuesta-[0-9.]*\\.txt" "$HOME/prompt-$n.txt" | head -1)\n'
        + 'if printf "%s\\n" "$@" | grep -q haiku; then [ -n "$R" ] && [ -n "${FALSO_MIRADA:-}" ] && printf "%s\\n" "$FALSO_MIRADA" > "$R"; exit ${FALSO_RC_MIRADA:-0}; fi\nexit 0\n');
      let k = 0, n = 0;
      const lanza = (json, env = {}) => {
        const j = path.join(Tm, `m${k}.json`), ts = `1794950000.${String(100 + k).padStart(6, "0")}`; k++;
        fs.writeFileSync(j, JSON.stringify({ channel: "C0PRUEBA", ts, thread_ts: "1794950000.000100", quien: "Coo", ...json }));
        spawnSync("bash", [path.join(H, "atender-slack.sh"), j], { encoding: "utf8", timeout: 60e3,
          env: { ...process.env, HOME, CLAUDE_CLI: cli, CANAL_REPO: path.join(Tm, "repo"), ...env } });
        const out = [];
        while (fs.existsSync(path.join(HOME, `prompt-${n}.txt`))) {
          out.push({ p: fs.readFileSync(path.join(HOME, `prompt-${n}.txt`), "utf8"), a: fs.readFileSync(path.join(HOME, `args-${n}.txt`), "utf8").split(/\r?\n/) }); n++;
        }
        return out;
      };
      const modelo = (a) => a[a.indexOf("--model") + 1], esfuerzo = (a) => a[a.indexOf("--effort") + 1], sesion = (a) => a[a.findIndex((x) => /^--(resume|session-id)$/.test(x)) + 1];
      const bloquea = (a, que) => a.slice(a.indexOf("--disallowedTools")).some((x) => x.includes(que));
      const MIRA = { text: "(Vigilante de la oficina, 16:30) SOLO MIRA, EN LECTURA… simulacro", normal: "(Vigilante de la oficina, 16:30) Si ha terminado o ha fallado, sigue con lo que tocaba después: programar los sábados.", oficina: true, mirada: true };
      lanza({ text: "@Claude vigila el simulacro", oficina: true });   // (crea la sesión del hilo)
      // 1) sigue igual
      const a = lanza(MIRA, { FALSO_MIRADA: "NADA" });
      igual(a.length, 1, "NADA: una sola llamada");
      igual([modelo(a[0].a), esfuerzo(a[0].a), a[0].a.includes("--resume")], ["claude-haiku-5-5", "low", true], "la mirada: Haiku, esfuerzo bajo, reanudando la sesión del hilo");
      igual([bloquea(a[0].a, "publicar-canal.sh"), bloquea(a[0].a, "responder-slack.sh"), bloquea(a[0].a, "sf project deploy")], [true, true, true], "sin publicar (Slack, canal git) ni escribir en orgs");
      casa(a[0].p, /MIRADA DEL VIGILANTE \(manda sobre todo lo anterior de este mensaje\)[\s\S]*exactamente NADA[\s\S]*TERMINADO: <lo que ves>/, "lo último del prompt: solo mirar");
      igual(/ESTE MENSAJE ES DE Coo, UNA IA/.test(a[0].p), false, "en la mirada no va «haz el trabajo y publícalo en el canal»");
      igual(a[0].a[a[0].a.indexOf("--max-budget-usd") + 1], "1", "tope de 1 $");
      // 2) ha terminado
      const b = lanza(MIRA, { FALSO_MIRADA: "TERMINADO: CARGA-01 en COMPLETED a las 16:20, 0 errores" });
      igual(b.length, 2, "TERMINADO: dos llamadas");
      igual([modelo(b[0].a), modelo(b[1].a), esfuerzo(b[1].a), b[1].a.includes("--resume"), sesion(b[1].a) === sesion(b[0].a)], ["claude-haiku-5-5", "claude-sonnet-5-5", "medium", true, true], "la segunda: Sonnet, en la MISMA sesión");
      casa(b[1].p, /dice: «TERMINADO: CARGA-01 en COMPLETED a las 16:20, 0 errores»\.\n\(Vigilante de la oficina, 16:30\) Si ha terminado o ha fallado, sigue con lo que tocaba después: programar los sábados\./, "con lo que vio la mirada y el texto de siempre");
      casa(b[1].p, /ESTE MENSAJE ES DE Coo, UNA IA: no puedes escribir en Slack/, "y la regla de siempre de un mensaje de IA (resultado al canal git)");
      igual([bloquea(b[1].a, "publicar-canal.sh"), bloquea(b[1].a, "responder-slack.sh"), bloquea(b[1].a, "sf project deploy")], [false, true, true], "la segunda puede publicar en el canal; Slack (mensaje de IA) y orgs, como siempre");
      igual(b[1].a[b[1].a.indexOf("--max-budget-usd") + 1], "3", "con el tope de siempre");
      // 3) FALLADO, con adornos de formato
      const c = lanza(MIRA, { FALSO_MIRADA: "**FALLADO:** el job acabó en ERROR (FIELD_CUSTOM_VALIDATION)" });
      igual([c.length, /dice: «\*\*FALLADO:\*\* el job acabó en ERROR/.test(c[1] && c[1].p)], [2, true], "FALLADO (con negritas): también sigue Sonnet");
      const d = lanza(MIRA, { FALSO_MIRADA: "NADA", FALSO_RC_MIRADA: "1" });
      igual([d.length, modelo(d[1].a), /La mirada en lectura/.test(d[1].p), /sigue con lo que tocaba después: programar los sábados/.test(d[1].p)], [2, "claude-sonnet-5-5", false, true], "rc 1: lo mira Sonnet con el texto de siempre");
      const e = lanza(MIRA, { FALSO_MIRADA: "Creo que va bien, aunque no estoy seguro" });
      igual([e.length, /La mirada en lectura/.test(e[1].p)], [2, false], "una respuesta que no se entiende: también");
      // 5) la marca no vale sin la oficina, ni con un mensaje de Humano
      const f = lanza({ ...MIRA, oficina: false }, { FALSO_MIRADA: "NADA" });
      const g = lanza({ ...MIRA, quien: "Humano" }, { FALSO_MIRADA: "NADA" });
      igual([f.length, modelo(f[0].a), g.length, modelo(g[0].a)], [1, "claude-sonnet-5-5", 1, "claude-sonnet-5-5"], "sin la oficina o de Humano: ni mirada ni Haiku");
      const log = fs.readFileSync(path.join(HOME, ".canal-logs", "sesiones-slack.log"), "utf8");
      casa(log, /mirada \(claude-haiku-5-5\): sigue igual/, "sesiones-slack.log: «sigue igual»");
      casa(log, /mirada \(claude-haiku-5-5, rc=0\): La mirada en lectura[^\n]*TERMINADO[^\n]*→ sigue claude-sonnet-5-5/, "sesiones-slack.log: la segunda fase");
    } finally {
      try { fs.rmSync(Tm, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) { if (!/^(EPERM|EBUSY|ENOTEMPTY)$/.test(e.code)) throw e; }
    }
  });
};
