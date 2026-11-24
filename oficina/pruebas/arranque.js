"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), { spawn } = require("child_process");

module.exports = async ({ prueba, igual }) => {
  console.log("la oficina arranca de verdad");
  await prueba("v246: `node oficina/server.js` con una carpeta de usuario vacía arranca, contesta y sigue viva a los 8 s", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "arranque-"));
    const puerto = await new Promise((r) => { const s = http.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    let salida = "", vivo = true;
    const p = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { windowsHide: true,
      env: { ...process.env, HOME: d, USERPROFILE: d, OFICINA_PORT: String(puerto), OFICINA_REPO: path.join(d, "no-hay-repo"), CANAL_LOGS: path.join(d, ".canal-logs") } });
    p.stdout.on("data", (x) => salida += x); p.stderr.on("data", (x) => salida += x); p.on("exit", () => { vivo = false; });
    try {
      await new Promise((r) => setTimeout(r, 8000));
      const codigo = await new Promise((r) => http.get(`http://127.0.0.1:${puerto}/`, (x) => { x.resume(); r(x.statusCode); }).on("error", () => r(0)));
      igual([vivo, codigo], [true, 200], "viva y contesta (" + salida.replace(/\s+/g, " ").slice(-200) + ")");
      igual(/ReferenceError|TypeError|SyntaxError/.test(salida), false, "sin errores al arrancar");
    } finally { try { p.kill(); } catch (e) {} await new Promise((r) => setTimeout(r, 300)); fs.rmSync(d, { recursive: true, force: true }); }
  });
};
