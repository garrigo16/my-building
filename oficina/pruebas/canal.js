"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("publicar en el canal git (publicar-canal.sh)");
  await prueba("v220: LEIDO con el sha CORTO de la nota (10 caracteres) publica; uno de verdad viejo sigue parando y lista lo no leído", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "canal-pub-")), wt = path.join(d, "wt"), RAMA = "canal/humano/claude-cursor";
    const git = (...a) => { const r = spawnSync("git", a, { cwd: wt, encoding: "utf8" }); if (r.status) throw new Error(a.join(" ") + ": " + r.stderr); return r.stdout.trim(); };
    try {
      spawnSync("git", ["init", "-q", "--bare", path.join(d, "origen.git")]);
      spawnSync("git", ["clone", "-q", path.join(d, "origen.git"), wt]);
      git("config", "user.name", "Prueba"); git("config", "user.email", "prueba@example.invalid"); git("checkout", "-q", "-b", RAMA);
      fs.writeFileSync(path.join(wt, "CANAL_CLAUDE_CURSOR.md"), "# Canal\n"); git("add", "."); git("commit", "-q", "-m", "A");
      const A = git("rev-parse", "HEAD");
      fs.appendFileSync(path.join(wt, "CANAL_CLAUDE_CURSOR.md"), "\n---\n\n<!-- para: Claude | id: Coo-1 -->\n## Coo · 16:00 · algo\n"); git("commit", "-q", "-am", "B");
      const B = git("rev-parse", "HEAD"); git("push", "-q", "origin", `HEAD:refs/heads/${RAMA}`); git("checkout", "-q", "--detach");
      const bloque = path.join(d, "b.md"); fs.writeFileSync(bloque, "<!-- para: Coo | id: 999 | estado: hecho -->\n## Claude · HORA · prueba\n\nTexto.\n");
      const publica = (leido) => spawnSync("bash", [path.join(__dirname, "..", "..", "herramientas", "publicar-canal.sh"), "principal", bloque, "[skip ci] Canal: prueba"],
        { encoding: "utf8", env: { ...process.env, WT: wt, HOME: d, LEIDO: leido, NOTA: "" } });
      const r1 = publica(B.slice(0, 10));
      igual([r1.status, /PUBLICADO/.test(r1.stdout)], [0, true], "sha corto del último commit: publica (" + (r1.stderr || "").trim().slice(0, 120) + ")");
      const r2 = publica(A.slice(0, 10));
      igual(r2.status, 6, "sha corto de un commit viejo: para"); casa(r2.stderr, /no has leído[\s\S]*\bB\b/, "y lista lo que no ha leído");
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });

  await prueba("canal ORQ-22: wt desacoplado detrás de origin avanza en fast-forward y publica; con commit local divergente para (3) sin force", () => {
    const RAMA = "canal/humano/claude-cursor", FICH = "CANAL_CLAUDE_CURSOR.md";
    const script = path.join(__dirname, "..", "..", "herramientas", "publicar-canal.sh");
    const montar = () => {
      const d = fs.mkdtempSync(path.join(os.tmpdir(), "canal-ff-")), wt = path.join(d, "wt"), otro = path.join(d, "otro"), origen = path.join(d, "origen.git");
      const g = (cwd, ...a) => { const r = spawnSync("git", a, { cwd, encoding: "utf8" }); if (r.status) throw new Error(a.join(" ") + ": " + r.stderr); return r.stdout.trim(); };
      spawnSync("git", ["init", "-q", "--bare", origen]);
      spawnSync("git", ["clone", "-q", origen, wt]);
      for (const c of [wt]) { g(c, "config", "user.name", "Prueba"); g(c, "config", "user.email", "prueba@example.invalid"); }
      g(wt, "checkout", "-q", "-b", RAMA);
      fs.writeFileSync(path.join(wt, FICH), "# Canal\n"); g(wt, "add", "."); g(wt, "commit", "-q", "-m", "A");
      g(wt, "push", "-q", "origin", `HEAD:refs/heads/${RAMA}`); g(wt, "checkout", "-q", "--detach");
      spawnSync("git", ["clone", "-q", "-b", RAMA, origen, otro]);
      g(otro, "config", "user.name", "Otro"); g(otro, "config", "user.email", "otro@example.invalid");
      fs.appendFileSync(path.join(otro, FICH), "\n---\n\nremoto\n"); g(otro, "commit", "-q", "-am", "R");
      g(otro, "push", "-q", "origin", `HEAD:refs/heads/${RAMA}`);
      const bloque = path.join(d, "b.md"); fs.writeFileSync(bloque, "<!-- para: Coo | id: 999 | estado: hecho -->\n## Claude · HORA · prueba\n\nTexto.\n");
      const publica = () => spawnSync("bash", [script, "principal", bloque, "[skip ci] Canal: prueba"],
        { encoding: "utf8", env: { ...process.env, WT: wt, HOME: d, LEIDO: "", NOTA: "" } });
      return { d, wt, origen, g, publica };
    };
    let t = montar();
    try {
      const R = t.g(t.origen, "rev-parse", `refs/heads/${RAMA}`);
      const r = t.publica();
      igual([r.status, /PUBLICADO/.test(r.stdout)], [0, true], "detrás de origin: fast-forward y publica (" + (r.stderr || "").trim().slice(0, 120) + ")");
      igual(t.g(t.origen, "rev-parse", `refs/heads/${RAMA}~1`), R, "el remoto conserva el commit que ya tenía debajo del nuevo");
    } finally { fs.rmSync(t.d, { recursive: true, force: true }); }
    t = montar();
    try {
      fs.writeFileSync(path.join(t.wt, "local.txt"), "x\n"); t.g(t.wt, "add", "."); t.g(t.wt, "-c", "user.name=Prueba", "-c", "user.email=prueba@example.invalid", "commit", "-q", "-m", "L");
      const L = t.g(t.wt, "rev-parse", "HEAD"), R = t.g(t.origen, "rev-parse", `refs/heads/${RAMA}`);
      const r = t.publica();
      igual(r.status, 3, "commit local divergente: para con código 3");
      casa(r.stderr, /no es fast-forward/, "y lo explica");
      igual(t.g(t.origen, "rev-parse", `refs/heads/${RAMA}`), R, "el remoto no cambia");
      igual(t.g(t.wt, "rev-parse", "HEAD"), L, "el commit local de wt se conserva");
    } finally { fs.rmSync(t.d, { recursive: true, force: true }); }
  });
};
