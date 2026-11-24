// con herramientas/cursor-apagado nada llama a la API de Cursor y el recado pasa a Claude.
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");
module.exports = async ({ prueba, igual, casa }) => {
  console.log("interruptor de Cursor (herramientas/cursor-apagado)");
  const T = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-apagado-")), H = path.join(T, "h"), home = path.join(T, "home"), rastro = path.join(T, "rastro.txt");
  const sl = (p) => p.replace(/\\/g, "/");
  fs.mkdirSync(H); fs.mkdirSync(path.join(home, ".config"), { recursive: true });
  fs.writeFileSync(path.join(home, ".config", "canal-slack.env"), "CURSOR_API_KEY=clave-de-mentira\nSLACK_BOT_TOKEN=de-mentira\nGROK_WEBHOOK_URL=http://127.0.0.1:9/no\nGROK_WEBHOOK_KEY=de-mentira\n");
  for (const f of ["lanzar-cursor.sh", "atender-cursor-slack.sh", "avisar-coo.sh", "lanzar-grok.sh", "atender-grok.sh"]) fs.copyFileSync(path.join(HERR, f), path.join(H, f));
  for (const f of ["lanzar-claude.sh", "atender-slack.sh"]) fs.writeFileSync(path.join(H, f), `#!/usr/bin/env bash\necho "${f} desvio=\${CANAL_DESVIO_CURSOR:-0} $(cat "\${1}" 2>/dev/null | head -c 120)" >> '${sl(rastro)}'\n`);
  fs.writeFileSync(path.join(H, "validar-nota.sh"), "#!/usr/bin/env bash\nexit 0\n");
  fs.writeFileSync(path.join(H, "freno.sh"), "#!/usr/bin/env bash\necho TOCA_CURSOR >> '" + sl(rastro) + "'\nexit 0\n");
  fs.writeFileSync(path.join(H, "cursor-agente.js"), "process.exit(1);\n");
  fs.writeFileSync(path.join(H, "cursor-apagado"), "apagado\n");
  const env = { ...process.env, HOME: home, USERPROFILE: home, CANAL_PRUEBAS: "1", CURSOR_APAGADO_PRUEBA: "1", CURSOR_API_URL: "http://127.0.0.1:9/no" };
  const bash = (...a) => cp.spawnSync(process.env.CANAL_BASH || "bash", a, { env, encoding: "utf8", timeout: 30000 });
  const lee = () => { try { const s = fs.readFileSync(rastro, "utf8"); fs.unlinkSync(rastro); return s; } catch (e) { return ""; } };
  try {
    await prueba("cursor apagado: lanzar-cursor pasa el recado a Claude sin tocar la API", () => {
      const n = path.join(T, "n.txt"); fs.writeFileSync(n, "para: Cursor\n@cursor\nCoinciden: x\n");
      const r = bash(sl(path.join(H, "lanzar-cursor.sh")), "principal", sl(n), "a".repeat(40), "b".repeat(40));
      const v = lee(); igual(r.status, 0); casa(v, /lanzar-claude\.sh desvio=1/); igual(/TOCA_CURSOR/.test(v), false, "ni el freno de Cursor");
    });
    await prueba("cursor apagado: si la nota ya va a Claude, no se abre otro", () => {
      const n = path.join(T, "n2.txt"); fs.writeFileSync(n, "para: Claude\n@cursor\nCoinciden: x\n");
      const r = bash(sl(path.join(H, "lanzar-cursor.sh")), "principal", sl(n), "a".repeat(40), "b".repeat(40));
      igual([r.status, lee()], [0, ""]);
    });
    await prueba("cursor apagado: atender-cursor pasa el encargo de Slack a Claude con el aviso", () => {
      const j = path.join(T, "j.json"); fs.writeFileSync(j, JSON.stringify({ text: "mira esto", channel: "C1", ts: "1.1", thread_ts: "1.0", quien: "Coo" }));
      const r = bash(sl(path.join(H, "atender-cursor-slack.sh")), sl(j));
      const v = lee(); igual(r.status, 0); casa(v, /atender-slack\.sh/); casa(v, /Cursor está apagado/);
    });
    await prueba("cursor apagado: avisar-coo pasa el encargo a Claude y no llama al webhook", async () => {
      const r = bash(sl(path.join(H, "avisar-coo.sh")), "C1", "1.0", "Claude", "1.1");
      let v = ""; for (let i = 0; i < 40 && !v; i++) { await new Promise((ok) => setTimeout(ok, 100)); v = lee(); }
      igual(r.status, 0); casa(v, /atender-slack\.sh/); casa(v, /Coo está apagado/);
    });
    await prueba("cursor apagado: la tercera lectura de Grok pasa a Claude", () => {
      const n = path.join(T, "n3.txt"); fs.writeFileSync(n, "para: Grok\nTercera lectura: sí\n");
      const r = bash(sl(path.join(H, "lanzar-grok.sh")), "principal", sl(n), "a".repeat(40), "b".repeat(40));
      const v = lee(); igual(r.status, 0); casa(v, /lanzar-claude\.sh desvio=1/);
    });
    await prueba("cursor apagado: el encargo directo a Grok pasa a Claude", () => {
      const j = path.join(T, "g.json"); fs.writeFileSync(j, JSON.stringify({ text: "@grok mira", channel: "C1", ts: "2.1", thread_ts: "2.0" }));
      const r = bash(sl(path.join(H, "atender-grok.sh")), sl(j));
      const v = lee(); igual(r.status, 0); casa(v, /atender-slack\.sh/); casa(v, /Grok está apagado/);
    });
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
};
