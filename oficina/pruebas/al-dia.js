"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const S = require("../server.js");

module.exports = async ({ prueba, igual }) => {
  console.log("v383: ponerse al día solo (pull + reinicio de lo que cambie)");
  const T = fs.mkdtempSync(path.join(os.tmpdir(), "aldia-"));
  const git = (dir, ...a) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const escribe = (dir, f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };
  try {
    const O = path.join(T, "origin.git"), EQ = path.join(T, "eq"), CA = path.join(T, "casa");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", O]);
    execFileSync("git", ["clone", "-q", O, CA], { stdio: "ignore" });
    for (const f of ["oficina/server.js", "oficina/public/index.html", "herramientas/escucha-slack.js", "instalar.ps1"]) escribe(CA, f, "v1\n");
    git(CA, "add", "-A"); git(CA, "commit", "-q", "-m", "v100: inicio"); git(CA, "push", "-q", "origin", "HEAD:main");
    execFileSync("git", ["clone", "-q", "-b", "main", O, EQ], { stdio: "ignore" });
    const sube = (f, msg) => { escribe(CA, f, msg + "\n"); git(CA, "commit", "-q", "-am", msg); git(CA, "push", "-q", "origin", "HEAD:main"); };
    const llama = () => { const x = { esc: 0, ofi: 0 }; return { x, op: { ejecuta: S.run, repo: EQ, reiniciaEscucha: async () => { x.esc++; }, reiniciaOficina: () => { x.ofi++; } } }; };

    await prueba("cambia la escucha en main → se trae y reinicia SOLO la escucha; dice la versión", async () => {
      sube("herramientas/escucha-slack.js", "v101: escucha");
      const { x, op } = llama(); const r = await S.ponAlDia(op);
      igual([r.que, r.version, r.esc, r.ofi, x.esc, x.ofi], ["actualizado", "101", true, false, 1, 0], "resultado");
      igual(git(EQ, "rev-parse", "HEAD"), git(CA, "rev-parse", "HEAD"), "al día");
    });
    await prueba("cambia solo index.html → se trae sin reiniciar nada (la página se recarga sola); instalar.ps1 → aviso", async () => {
      sube("oficina/public/index.html", "v102: página");
      let { x, op } = llama(); let r = await S.ponAlDia(op);
      igual([r.que, r.esc, r.ofi, x.esc + x.ofi], ["actualizado", false, false, 0], "sin reinicios");
      sube("instalar.ps1", "v103: instalador");
      ({ x, op } = llama()); r = await S.ponAlDia(op); igual([r.que, r.instalar], ["actualizado", true], "instalar.ps1");
    });
    await prueba("cambia server.js → reinicia la oficina; sin novedades → nada", async () => {
      sube("oficina/server.js", "v104: oficina");
      let { x, op } = llama(); const r = await S.ponAlDia(op); igual([r.que, r.ofi, x.ofi], ["actualizado", true, 1], "oficina");
      ({ x, op } = llama()); igual((await S.ponAlDia(op)).que, "igual", "sin novedades");
    });
    await prueba("con cambios sin subir, o con commits propios sin subir, no toca nada y lo avisa", async () => {
      sube("oficina/server.js", "v105: otra");
      escribe(EQ, "oficina/server.js", "a medias\n");
      let { op } = llama(); let r = await S.ponAlDia(op);
      igual([r.que, /sin subir/.test(r.aviso)], ["sucio", true], "sucio");
      git(EQ, "checkout", "-q", "--", "."); escribe(EQ, "herramientas/escucha-slack.js", "mío\n"); git(EQ, "commit", "-q", "-am", "local");
      ({ op } = llama()); r = await S.ponAlDia(op);
      igual([r.que, /commits que no están en main/.test(r.aviso)], ["no ff", true], "commits propios");
    });
    await prueba("v504: lo subido desde ESTE checkout (HEAD ya movido aquí) se estrena igual si el repo está limpio; a medias, no", async () => {
      git(EQ, "reset", "-q", "--hard", "origin/main");
      escribe(EQ, "oficina/server.js", "v106: desde el checkout común\n"); git(EQ, "commit", "-q", "-am", "v106: profunda"); git(EQ, "push", "-q", "origin", "HEAD:main");
      let { x, op } = llama(); let r = await S.ponAlDia({ ...op, sinEstrenar: () => ({ oficina: true }) });
      igual([r.que, r.version, r.ofi, r.esc, x.ofi, x.esc], ["estrenar", "106", true, false, 1, 0], "reinicia la oficina aunque HEAD no se mueva");
      ({ x, op } = llama()); r = await S.ponAlDia({ ...op, sinEstrenar: () => ({}) });
      igual([r.que, x.ofi], ["igual", 0], "estrenado: nada");
      escribe(EQ, "oficina/server.js", "a medias\n");
      ({ x, op } = llama()); r = await S.ponAlDia({ ...op, sinEstrenar: () => ({ oficina: true }) });
      igual([r.que, x.ofi], ["sucio", 0], "con cambios a medias en el checkout, nunca (correría código sin subir)");
      git(EQ, "checkout", "-q", "--", ".");
    });
    await prueba("v504: «sin estrenar» solo si el cambio tiene más de 2 min; la escucha, como mucho una vez cada 30 min", () => {
      const MIN = 60e3, t = 10 * 3600e3;
      igual(S.sinEstrenarAhora(t - 20 * MIN, t - 20 * MIN, t, t - 3 * MIN, t - 3 * MIN, 0), { oficina: true, escucha: true }, "cambiado hace 3 min");
      igual(S.sinEstrenarAhora(t - 20 * MIN, t - 20 * MIN, t, t - MIN, t - MIN, 0), { oficina: false, escucha: false }, "hace 1 min: espera");
      igual(S.sinEstrenarAhora(t - 20 * MIN, t - 20 * MIN, t, 0, t - 30 * MIN, 0), { oficina: false, escucha: false }, "nada nuevo desde que arrancaron");
      igual(S.sinEstrenarAhora(t - 20 * MIN, t - 20 * MIN, t, 0, t - 3 * MIN, t - 10 * MIN).escucha, false, "la escucha ya se reinició hace 10 min: no otra vez");
    });
  } finally { fs.rmSync(T, { recursive: true, force: true }); }
};
