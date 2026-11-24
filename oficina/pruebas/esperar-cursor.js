// esperar-cursor.js - v312: esperar-cursor.sh (la VUELTA de un recado de Cursor: espera a su agente, toma su NOTA y avisa) de
// punta a punta, AISLADO: el script de verdad y validar-nota.sh en una carpeta temporal, una API de Cursor falsa local (el script
// ya admite CANAL_PRUEBAS=1 + CURSOR_API_URL), un repo git temporal como canal y nota-slack / lanzar-claude / lanzar-grok /
// avisar-humano de mentira que solo apuntan lo que les llega. Nada sale del equipo.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), { spawn, execFileSync } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("la vuelta de Cursor (esperar-cursor.sh)");
  await prueba("v312: Cursor termina con nota → timbre, Claude y (si la pide) Grok; sin nota → aviso genérico a Claude; sin publicar, con error o colgado → Humano", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "espcur-")), H = path.join(T, "herr"), HOME = path.join(T, "home");
    const agentes = {};   // id → { status, result }
    const srv = http.createServer((q, r) => {
      const m = q.url.match(/^\/agents\/([\w-]+)\/runs(?:\/(\w+))?$/), a = m && agentes[m[1]];
      r.setHeader("Content-Type", "application/json");
      if (!a) { r.statusCode = 404; return r.end("{}"); }
      r.end(JSON.stringify(m[2] ? { run: { id: m[2], result: a.result } } : { items: [{ status: a.status, id: "run1" }] }));
    });
    await new Promise((x) => srv.listen(0, "127.0.0.1", x));
    const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    try {
      for (const d of [H, path.join(HOME, ".config"), path.join(HOME, ".canal-logs")]) fs.mkdirSync(d, { recursive: true });
      for (const s of ["esperar-cursor.sh", "validar-nota.sh"]) fs.copyFileSync(path.join(HERR, s), path.join(H, s));
      const reg = path.join(T, "llamadas.txt").replace(/\\/g, "/");
      for (const s of ["nota-slack", "lanzar-claude", "avisar-humano"]) fs.writeFileSync(path.join(H, s + ".sh"),
        `#!/usr/bin/env bash\nn=""; [ -f "\${2:-}" ] && n=$(tr '\\n' '/' < "$2"); printf '%s|%s|%s\\n' "${s}" "$1" "$n" >> '${reg}'\n`);
      fs.writeFileSync(path.join(H, "lanzar-grok.sh"), `#!/usr/bin/env bash\nprintf 'lanzar-grok|%s\\n' "$1" >> '${reg}'\nexit \${GROK_RC:-0}\n`);
      fs.writeFileSync(path.join(HOME, ".config", "canal-slack.env"), "CURSOR_API_KEY=clave-falsa-cursor\r\n");
      const ORI = path.join(T, "origen"), OTRO = path.join(T, "otro"), WT = path.join(HOME, "wt-canal-claude"), RAMA = "canal/humano/claude-cursor";
      fs.mkdirSync(OTRO); git(OTRO, "init", "-q"); git(OTRO, "checkout", "-q", "-b", RAMA); git(OTRO, "-c", "user.name=p", "-c", "user.email=p@p", "commit", "-q", "--allow-empty", "-m", "uno");
      git(T, "clone", "-q", "--bare", OTRO, ORI); git(OTRO, "remote", "add", "origin", ORI); git(T, "clone", "-q", ORI, WT);
      const publica = () => { git(OTRO, "-c", "user.name=p", "-c", "user.email=p@p", "commit", "-q", "--allow-empty", "-m", "bloque de Cursor"); git(OTRO, "push", "-q", "origin", RAMA); };
      const sha = () => git(OTRO, "rev-parse", "HEAD");
      const leer = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return ""; } };
      const espera = (id, desde, extra = {}) => new Promise((res) => { try { fs.unlinkSync(reg); } catch (e) {}
        const p = spawn("bash", [path.join(H, "esperar-cursor.sh"), "principal", id, desde], { windowsHide: true,
          env: { ...process.env, HOME, CANAL_PRUEBAS: "1", CURSOR_API_URL: `http://127.0.0.1:${srv.address().port}/agents`, ESPERA_PASO_S: "0", GROK_RC: "", ...extra } });
        const t = setTimeout(() => p.kill(), 60e3); p.on("exit", (rc) => { clearTimeout(t); res(rc); }); });
      const ll = () => leer(reg).trim().split("\n").filter(Boolean);

      let desde = sha(); publica();
      agentes.a1 = { status: "FINISHED", result: "He revisado la SOQL.\n\nNOTA:\n- para: Claude\n- Coinciden: la SOQL de licencias\n- No coinciden: nada\n- Tu OK: no hace falta\n- Tercera lectura: sí\n" };
      await espera("a1", desde);
      igual(ll().map((l) => l.split("|")[0]), ["nota-slack", "lanzar-claude", "lanzar-grok"], "con nota para Claude y tercera lectura: timbre, Claude y Grok");
      casa(ll()[0], /^nota-slack\|principal\|para: Claude\/Coinciden: la SOQL de licencias\/No coinciden: nada\/Tu OK: no hace falta\/Tercera lectura: sí\/$/, "la nota sale limpia (sin los «- » de la lista)");

      desde = sha(); publica(); agentes.a2 = { status: "FINISHED", result: "Hecho, lo he dejado en el canal." };
      await espera("a2", desde);
      igual([ll().map((l) => l.split("|")[0]), /para: Claude\/Coinciden: Cursor ha respondido en el canal \(sin nota propia\)/.test(ll()[0])], [["nota-slack", "lanzar-claude"], true], "sin nota: aviso genérico para que Claude lo lea");

      desde = sha(); agentes.a3 = { status: "FINISHED", result: "No he podido.\nNOTA:\npara: Claude\nCoinciden: x\nNo coinciden: y\nTu OK: no\nTercera lectura: no\n" };
      await espera("a3", desde);
      igual([ll().length, /^avisar-humano\|Cursor \(a3\) ha terminado sin publicar nada en el canal principal/.test(ll()[0])], [1, true], "terminó sin publicar en el canal: a Humano (no a Claude)");

      agentes.a4 = { status: "ERROR", result: "" };
      await espera("a4", desde);
      igual([ll().length, /ha terminado en ERROR/.test(ll()[0])], [1, true], "agente en ERROR: a Humano");
      agentes.a5 = { status: "RUNNING", result: "" };
      await espera("a5", desde, { ESPERA_MAX_S: "0" });
      igual([ll().length, /lleva más de 60 min sin terminar \(estado RUNNING\)/.test(ll()[0])], [1, true], "colgado: a la hora se avisa a Humano y se cierra solo");

      desde = sha(); publica(); agentes.a6 = { status: "FINISHED", result: "NOTA:\npara: Cursor\nCoinciden: x\nNo coinciden: nada\nTu OK: no hace falta\nTercera lectura: si\n" };
      await espera("a6", desde, { GROK_RC: "5" });
      igual(ll().map((l) => l.split("|")[0]), ["nota-slack", "lanzar-grok", "avisar-humano"], "nota sin Claude (no se le abre); Grok que no arranca → aviso a Humano");
      casa(ll()[2], /No he podido lanzar la tercera lectura de Grok \(principal \w{10}\), código 5/, "con el código");
    } finally { srv.close(); await new Promise((x) => setTimeout(x, 300)); fs.rmSync(T, { recursive: true, force: true }); }
  });
};
