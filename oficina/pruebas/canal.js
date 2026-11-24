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
};
