"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync, execFileSync } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("Grok desde Slack (atender-grok.sh)");
  await prueba("v330: «@grok …» → 👀, encargo limpio a Grok, su bloque pegado en el hilo (con aviso si te necesita) y ✅; si no arranca o no contesta, lo dice", () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "atgrok-")), H = path.join(T, "herr"), HOME = path.join(T, "home");
    const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const sl = (p) => p.replace(/\\/g, "/");
    try {
      for (const d of [H, path.join(HOME, ".canal-logs")]) fs.mkdirSync(d, { recursive: true });
      fs.copyFileSync(path.join(HERR, "atender-grok.sh"), path.join(H, "atender-grok.sh"));
      const ORI = path.join(T, "origen"), OTRO = path.join(T, "otro"), WT = path.join(HOME, "wt-canal-claude"), RAMA = "canal/humano/claude-cursor";
      fs.mkdirSync(OTRO); git(OTRO, "init", "-q"); git(OTRO, "checkout", "-q", "-b", RAMA); fs.writeFileSync(path.join(OTRO, "CANAL_CLAUDE_CURSOR.md"), "# Canal\n");
      git(OTRO, "add", "."); git(OTRO, "-c", "user.name=p", "-c", "user.email=p@p", "commit", "-q", "-m", "uno");
      git(T, "clone", "-q", "--bare", OTRO, ORI); git(OTRO, "remote", "add", "origin", ORI); git(T, "clone", "-q", ORI, WT);
      const reg = sl(path.join(T, "llamadas.txt")), enc = sl(path.join(T, "encargo.txt"));
      fs.writeFileSync(path.join(H, "responder-slack.sh"), `#!/usr/bin/env bash\nif [ "$1" = --reaccion ]; then echo "reacción $4" >> '${reg}'; else printf 'hilo %s: %s\\n' "$2" "$(tr '\\n' '/' < "$3")" >> '${reg}'; fi\n`);
      fs.writeFileSync(path.join(H, "avisar-humano.sh"), `#!/usr/bin/env bash\necho "aviso: $1" >> '${reg}'\n`);
      fs.writeFileSync(path.join(H, "lanzar-grok.sh"), `#!/usr/bin/env bash
cp "$ENCARGO_F" '${enc}'; echo "grok lanzado $1" >> '${reg}'
case "\${GROK_HACE:-}" in
  falla) exit 14 ;;
  contesta|otra)
    cd '${sl(OTRO)}'; if [ "$GROK_HACE" = contesta ]; then printf '\\n### [Grok] Tercera lectura\\n@humano\\nTiene razón Claude: el redondeo va al final.\\n— Grok\\n' >> CANAL_CLAUDE_CURSOR.md
    else printf '\\n### [Coo] Otra cosa\\nnada que ver\\n' >> CANAL_CLAUDE_CURSOR.md; fi
    git -c user.name=p -c user.email=p@p commit -qam bloque && git push -q origin '${RAMA}' ;;
esac
exit 0
`);
      const lanza = (hace, extra = {}) => { try { fs.unlinkSync(reg); } catch (e) {}
        const J = path.join(T, "evento.json"); fs.writeFileSync(J, JSON.stringify({ text: "<@U0BOT> @grok ¿quién tiene razón con el redondeo?", channel: "C0PRUEBA", ts: "1794960000.000700", thread_ts: "1794960000.000100" }));
        const r = spawnSync("bash", [path.join(H, "atender-grok.sh"), J], { encoding: "utf8", timeout: 90e3,
          env: { ...process.env, HOME, GROK_HACE: hace, ESPERA_PASO_S: "0", ESPERA_GROK_S: "20", ...extra } });
        return { rc: r.status, ll: (fs.existsSync(reg) ? fs.readFileSync(reg, "utf8") : "").trim().split("\n"), quedaJ: fs.existsSync(J) }; };

      let r = lanza("contesta");
      igual([r.rc, r.ll[0], r.ll[1], fs.readFileSync(enc, "utf8"), r.quedaJ], [0, "reacción eyes", "grok lanzado principal", "¿quién tiene razón con el redondeo?", false], "👀, Grok lanzado con el encargo sin «@grok» ni menciones; el fichero del evento, borrado");
      casa(r.ll[2], /^hilo 1794960000\.000100: Grok está en ello/, "avisa en el hilo de que está en ello");
      casa(r.ll[3], /^hilo 1794960000\.000100: \(te necesita\) Grok ha respondido \(canal \w{10}\):\/\/### \[Grok\] Tercera lectura\/@humano\/Tiene razón Claude/, "pega su bloque en el hilo, marcado «te necesita» porque lleva @humano");
      igual([r.ll[4], r.ll[5]], ["aviso: Grok necesita algo de ti: mira su respuesta en el hilo.", "reacción white_check_mark"], "y avisa a Humano y pone ✅");
      r = lanza("falla");
      igual([r.rc, /No he podido lanzar a Grok/.test(r.ll.join("\n"))], [14, true], "si Grok no arranca (webhook o freno): lo dice en el hilo");
      r = lanza("otra", { ESPERA_GROK_S: "3" });
      igual([r.rc, /Grok ha respondido/.test(r.ll.join("\n")), /Grok no ha publicado nada en 45 min/.test(r.ll.join("\n"))], [0, false, true], "un bloque de otra IA no cuenta; sin respuesta de Grok, lo dice al final");
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  });
};
