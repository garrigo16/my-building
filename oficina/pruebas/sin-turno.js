// sin-turno.js - v346: el equipo SIN turno es solo de lectura (con los dos equipos encendidos, que no salga nada duplicado). La
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), { spawn } = require("child_process");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("el equipo sin turno, solo de lectura");
  await prueba("v346: sin el turno, la oficina no contesta, no abre temas, no manda privados ni guarda apuntes (423 y dice por qué); nada sale", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "sinturno-")), LOG = path.join(d, "slack-publicado.log"), MARCA = path.join(d, "fetch-falso-cargado");
    const sl = (p) => p.replace(/\\/g, "/");
    fs.mkdirSync(path.join(d, ".config"));
    fs.writeFileSync(path.join(d, ".config", "canal-slack.env"), "SLACK_BOT_TOKEN=xoxb-falso-bot\r\n");
    fs.writeFileSync(path.join(d, ".config", "oficina-slack.env"), "SLACK_USER_TOKEN=xoxp-falso-usuario");
    fs.writeFileSync(path.join(d, ".config", "oficina-equipo.txt"), "pruebas\r\n");
    const FF = path.join(d, "fetch-falso.js");
    fs.writeFileSync(FF, [
      'const fs = require("fs");',
      `fs.writeFileSync(${JSON.stringify(MARCA)}, "sí");`,
      "globalThis.fetch = async (url, o = {}) => {",
      '  if (!String(url).startsWith("https://slack.com/api/")) throw new Error("fetch no permitido en la prueba");',
      `  if (String(url).includes("chat.postMessage")) fs.appendFileSync(${JSON.stringify(LOG)}, String(o.body) + "\\n");`,
      '  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ ok: true, messages: [], ts: "1.1" }) };',
      "};", ""].join("\n"));
    const puerto = await new Promise((r) => { const s = http.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const p = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { windowsHide: true, stdio: "ignore",
      env: { ...process.env, HOME: d, USERPROFILE: d, OFICINA_PORT: String(puerto), OFICINA_REPO: path.join(d, "no-hay-repo"), CANAL_BASH: path.join(d, "no-existe", "bash.exe"),
        NODE_OPTIONS: `--require "${sl(FF)}"`, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: `url.${sl(path.join(d, "no-existe-repo"))}/.insteadOf`, GIT_CONFIG_VALUE_0: "https://github.com/" } });
    const pide = (metodo, ruta, cuerpo, cab = {}) => new Promise((r) => {
      const q = http.request({ host: "127.0.0.1", port: puerto, method: metodo, path: ruta, headers: { "Content-Type": "application/json", ...cab } }, (x) => {
        let b = ""; x.on("data", (c) => b += c).on("end", () => { let j = null; try { j = JSON.parse(b); } catch (e) {} r({ st: x.statusCode, j }); }); });
      q.on("error", () => r({ st: 0, j: null })); if (cuerpo) q.write(JSON.stringify(cuerpo)); q.end(); });
    try {
      let est = null;
      for (let i = 0; i < 60 && !(est && est.listo); i++) { await new Promise((x) => setTimeout(x, 750)); est = (await pide("GET", "/api/estado")).j; }
      igual([fs.existsSync(MARCA), !!(est && est.listo)], [true, true], "el Slack falso está puesto y la oficina arranca (si no, no sigue)");
      if (!est || !est.listo) return;
      const DE_LA_PAGINA = { Host: `127.0.0.1:${puerto}`, Origin: `http://127.0.0.1:${puerto}`, "Sec-Fetch-Site": "same-origin" }, k = est.envio && est.envio.k;
      const rs = [];
      for (const [ruta, o] of [["/api/enviar", { hilo: "1.1", texto: "hola" }], ["/api/tema", { titulo: "x" }], ["/api/privado", { hilo: "1.1", texto: "hola" }], ["/api/apuntes", { ver: 0, notas: { a: "b" } }]])
        rs.push(await pide("POST", ruta, { k, ...o }, DE_LA_PAGINA));
      igual(rs.map((r) => r.st), [423, 423, 423, 423], "contestar, tema nuevo, privado y apuntes: 423 (solo lectura)");
      casa(rs[0].j && rs[0].j.error, /Este equipo \(«pruebas»\) no tiene el turno.*solo de lectura/, "y dice por qué y qué hacer");
      igual([fs.existsSync(LOG), fs.existsSync(path.join(d, ".oficina", "apuntes.json"))], [false, false], "nada publicado en Slack ni guardado");
    } finally { try { p.kill(); } catch (e) {} await new Promise((x) => setTimeout(x, 400)); fs.rmSync(d, { recursive: true, force: true }); }
  });
};
