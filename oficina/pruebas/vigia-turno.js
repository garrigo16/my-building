"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");

module.exports = async ({ prueba, igual }) => {
  console.log("el vigía del canal git lee el turno del origin del Edificio");
  await prueba("sin VIGIA_TURNO_REPO lee el turno del Edificio; apuntando a un repo sin tags, no puede leerlo", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "vigia-turno-"));
    try {
      const g = (cwd, ...a) => { const r = spawnSync("git", ["-c", "user.email=p@p", "-c", "user.name=p", ...a], { cwd, encoding: "utf8", windowsHide: true });
        if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`); return r.stdout; };
      const bare = path.join(T, "origen.git"), edif = path.join(T, "edif"), otro = path.join(T, "otro"), HOME = path.join(T, "home");
      for (const d of [bare, edif, otro, path.join(edif, "herramientas"), path.join(HOME, ".config")]) fs.mkdirSync(d, { recursive: true });
      g(bare, "init", "--bare", "-q");
      g(edif, "init", "-q"); fs.writeFileSync(path.join(edif, "a.txt"), "a"); g(edif, "add", "."); g(edif, "commit", "-q", "-m", "a");
      g(edif, "tag", "turno-casa"); g(edif, "remote", "add", "origin", bare); g(edif, "push", "-q", "origin", "HEAD:refs/heads/main", "refs/tags/turno-casa");
      g(otro, "init", "-q"); fs.writeFileSync(path.join(otro, "b.txt"), "b"); g(otro, "add", "."); g(otro, "commit", "-q", "-m", "b");
      g(otro, "remote", "add", "origin", bare.replace(/\\/g, "/") + "-sin-tags");
      const sinTags = path.join(T, "sintags.git"); g(T, "init", "--bare", "-q", sinTags); g(otro, "remote", "set-url", "origin", sinTags);
      g(otro, "push", "-q", "origin", "HEAD:refs/heads/main");
      fs.writeFileSync(path.join(HOME, ".config", "oficina-equipo.txt"), "otro");
      fs.copyFileSync(path.join(HERR, "vigia-canal-timbre.sh"), path.join(edif, "herramientas", "vigia-canal-timbre.sh"));
      const corre = (extra) => {
        const r = spawnSync("bash", [path.join(edif, "herramientas", "vigia-canal-timbre.sh").replace(/\\/g, "/"), "--ya"], { encoding: "utf8", windowsHide: true, timeout: 60e3,
          env: { ...process.env, HOME: HOME.replace(/\\/g, "/"), USERPROFILE: HOME, CANAL_REPO: otro.replace(/\\/g, "/"), EDIFICIO_CONFIG: "ninguno", ...extra } });
        const f = path.join(HOME, ".canal-logs", "vigia-canal.log");
        return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "";
      };
      const sin = corre({});
      igual(/no puedo leer el turno/.test(sin), false, "con el origin del Edificio, lee el turno (log: " + sin.slice(-200) + ")");
      fs.rmSync(path.join(HOME, ".canal-logs"), { recursive: true, force: true });
      const con = corre({ VIGIA_TURNO_REPO: otro.replace(/\\/g, "/") });
      igual(/no puedo leer el turno/.test(con), true, "con un repo sin tags, no lo lee (la prueba mira de verdad)");
    } finally { try { fs.rmSync(T, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (e) {} }
  });
};
