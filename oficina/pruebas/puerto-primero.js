// puerto-primero.js - v549 [profunda]: una oficina de más (el puerto ya está ocupado) sale con 0 SIN haber tocado nada. Antes, la
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), { spawn } = require("child_process");

module.exports = async ({ prueba, igual }) => {
  console.log("v549: la oficina abre el puerto antes de hacer nada");
  await prueba("v549: con el puerto ocupado, la oficina de más sale con 0 sin lanzar ningún proceso (ni git del turno)", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "puerto-primero-"));
    fs.mkdirSync(path.join(d, ".config")); fs.writeFileSync(path.join(d, ".config", "oficina-equipo.txt"), "prueba");
    const espia = path.join(d, "espia.js"), apunta = path.join(d, "espia.txt");
    fs.writeFileSync(espia, `const cp = require("child_process"), fs = require("fs");
for (const k of ["spawn", "execFile", "exec", "fork", "spawnSync", "execFileSync", "execSync"]) { const o = cp[k];
  cp[k] = function (...a) { try { fs.appendFileSync(${JSON.stringify(apunta)}, k + " " + String(a[0]).slice(-60) + "\\n"); } catch (e) {} return o.apply(this, a); }; }\n`);
    const ocupado = http.createServer((q, r) => r.end("otra")); await new Promise((r) => ocupado.listen(0, "127.0.0.1", r));
    const puerto = ocupado.address().port;
    let salida = "";
    try {
      const p = spawn(process.execPath, ["--require", espia, path.join(__dirname, "..", "server.js")], { windowsHide: true,
        env: { ...process.env, HOME: d, USERPROFILE: d, OFICINA_PORT: String(puerto), OFICINA_REPO: path.join(d, "no-hay-repo"), CANAL_LOGS: path.join(d, ".canal-logs") } });
      p.stdout.on("data", (x) => salida += x); p.stderr.on("data", (x) => salida += x);
      const codigo = await new Promise((r) => { const t = setTimeout(() => { try { p.kill(); } catch (e) {} r("no sale"); }, 15000); p.on("exit", (c) => { clearTimeout(t); r(c); }); });
      igual(codigo, 0, "sale con 0 (" + salida.replace(/\s+/g, " ").slice(-200) + ")");
      igual(fs.existsSync(apunta) ? fs.readFileSync(apunta, "utf8").trim() : "", "", "ningún proceso lanzado");
      igual(fs.existsSync(path.join(d, ".canal-logs", "oficina.pid")), false, "ni deja su pid");
      igual(/otra oficina ya contesta/.test(fs.readFileSync(path.join(d, ".canal-logs", "oficina-envios.log"), "utf8")), true, "y lo apunta");
    } finally { ocupado.close(); await new Promise((r) => setTimeout(r, 300)); fs.rmSync(d, { recursive: true, force: true }); }
  });
};
