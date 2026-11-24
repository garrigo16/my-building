"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const S = require("../server.js");

const vivo = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = async ({ prueba, igual }) => {
  console.log("git de red: de 2 en 2 y sin procesos colgados");
  await prueba("v371: fetch, ls-remote y push son git de red; log, show y rev-parse no (esos no esperan cola)", () => {
    igual(S.esGitRed("git", ["-C", "x", "fetch", "-q", "origin"]), true, "fetch");
    igual(S.esGitRed("git", ["-C", "x", "ls-remote", "origin"]), true, "ls-remote");
    igual(S.esGitRed("C:\\Program Files\\Git\\cmd\\git.exe", ["push", "origin", "x"]), true, "push con ruta");
    igual(S.esGitRed("git", ["-C", "x", "log", "-1"]), false, "log");
    igual(S.esGitRed("git", ["show", "HEAD:fetch"]), false, "show (aunque el fichero se llame fetch)");
    igual(S.esGitRed("node", ["fetch"]), false, "no es git");
  });

  await prueba("v371: 6 ls-remote a la vez → como mucho 2 corriendo, los 6 acaban bien", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "gitred-"));
    try {
      execFileSync("git", ["init", "-q", "--bare", d]);
      S.gitRed.max = 0;
      const rs = await Promise.all(Array.from({ length: 6 }, () => S.run("git", ["ls-remote", d], { timeout: 30e3 })));
      igual(rs.every((r) => r.ok), true, "los 6 bien");
      igual(S.gitRed.max, 2, "máximo a la vez");
      igual(S.gitRed.activos, 0, "nada colgado al acabar");
      igual(S.gitRed.cola.length, 0, "cola vacía");
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  await prueba("v371: al pasar el tiempo se corta el árbol entero (el hijo también) y el error lo dice", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "arbol-"));
    try {
      const pidF = path.join(d, "hijo.pid"), js = path.join(d, "padre.js");
      fs.writeFileSync(js, `const cp=require("child_process"),fs=require("fs");
const h=cp.spawn(process.execPath,["-e","setTimeout(()=>{},60000)"],{stdio:"ignore"});
fs.writeFileSync(${JSON.stringify(pidF)},String(h.pid)); setTimeout(()=>{},60000);`);
      const t0 = Date.now();
      const r = await S.run(process.execPath, [js], { timeout: 1500 });
      igual(r.ok, false, "no ok");
      igual(/sin respuesta en 2 s: cortado/.test(r.err), true, "el error dice que se cortó: " + r.err);
      igual(Date.now() - t0 < 15000, true, "vuelve enseguida");
      const hijo = +fs.readFileSync(pidF, "utf8");
      let muerto = false; for (let i = 0; i < 30 && !muerto; i++) { muerto = !vivo(hijo); if (!muerto) await espera(200); }
      igual(muerto, true, "el hijo también ha muerto");
    } finally { await espera(300); fs.rmSync(d, { recursive: true, force: true }); }
  });
};
