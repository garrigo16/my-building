"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), { execFileSync, spawn, spawnSync } = require("child_process");
const S = require("../server.js"), U = require("../update.js");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("v566: update en cocina, actualizar auto o manual y estreno en caliente");
  const Real = global.FechaReal || Date;
  const git = (dir, ...a) => execFileSync("git", ["-C", dir, "-c", "user.name=Lola Prueba", "-c", "user.email=t@t", ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const escribe = (dir, f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };

  await prueba("config: «manual» salvo que el fichero diga «auto»; OFICINA_ACTUALIZAR manda", async () => {
    const con = (txt, env = {}) => U.leeConfig({ dir: "X:/repo/oficina", env, leer: (f) => { if (txt === null || !/repo[\\/]config\.local\.json$/.test(f)) throw new Error("no hay"); return txt; } });
    igual(con(null).actualizar, "manual", "sin fichero");
    igual(con('{"persona":{"nombre":"Lola"}}').actualizar, "manual", "con fichero y sin decirlo");
    igual(con('{"actualizar":"auto"}').actualizar, "auto", "lo dice el fichero");
    igual(con('\uFEFF{"actualizar":"Manual"}').actualizar, "manual", "con BOM y mayúscula");
    igual(con('{"actualizar":"cuando quiera"}').actualizar, "manual", "un valor que no vale: el de por defecto con fichero");
    igual(con(null, { OFICINA_ACTUALIZAR: "manual" }).actualizar, "manual", "la variable manda");
    igual(con('{"actualizar":"manual"}', { EDIFICIO_CONFIG: "ninguno" }).actualizar, "manual", "EDIFICIO_CONFIG=ninguno: como sin fichero");
    igual(con('{"cocina":{"ignora":["tmp/*"],"minutos":10}}').cocina, { ignora: ["tmp/*"], minutos: 10, dias: 3, diasPR: 30 }, "cocina: lo dicho y, lo demás, por defecto");
    igual(S.upd.cfg.actualizar, "manual", "la oficina de las pruebas no lee el fichero del equipo");
  });

  await prueba("v566 «qué trae»: del asunto de los commits, sin la etiqueta de versión y sin enrollarse", async () => {
    igual(U.resumeCommit("v565 [profunda]: robustez: una fuente colgada (Cursor, 1 de cada 12 llamadas) ya no para la vuelta 30 s; la oficina y la escucha no se cierran"),
      "robustez: una fuente colgada (Cursor, 1 de cada 12 llamadas) ya no para la vuelta 30 s", "hasta el primer «;»");
    igual(U.resumeCommit("v562 [profunda] + v460 [diseño]: los coordinadores dentro de la oficina"), "los coordinadores dentro de la oficina", "dos versiones");
    igual(U.resumeCommit("v561: cada tema dice quién lo tiene (no «Acaba de contestar» ni «Esperando a otros»)"), "cada tema dice quién lo tiene (no «Acaba de contestar» ni «Esperando a otros»)", "sin etiqueta");
    igual(U.resumeCommit("arreglo suelto"), "arreglo suelto", "sin versión");
    igual(U.resumeCommit("v600: " + "muy largo ".repeat(20)).length <= 90, true, "como mucho 90 letras");
    igual(U.queTrae(["v103: tres", "v102: dos", "v101: uno"]), "tres · dos · y 1 más", "dos y la cuenta");
    igual(U.versionDe(["retoque", "v567 [x]: a", "v566: b"]), "567", "la versión más nueva que se nombre");
  });

  await prueba("v566 la línea: una sola y por orden (estrenando > lista > estrenada > cocina); los botones, solo en manual", async () => {
    const t = new Real(2026, 10, 20, 22, 0, 0).getTime(), lista = { sha: "a".repeat(40), n: 2, version: "567", trae: "robustez · y 1 más" };
    const cocina = [{ tipo: "ia", nombre: "wt-1", ficheros: 3, commits: 0, t: t - 2 * 60e3 }];
    const L = (u) => U.lineaUpdate({ modo: "auto", lista: null, cocina: [], pospuesto: 0, estrenando: null, reciente: null, bloqueado: false, ...u }, t);
    igual(L({}), null, "nada en camino: no hay línea");
    igual(L({ cocina }), { que: "cocina", texto: "🍳 Update en cocina: una IA trabajando en la oficina (último cambio, a las 21:58)", botones: [] }, "una IA");
    casa(L({ cocina: [...cocina, { ...cocina[0], nombre: "wt-2", t: t - 60e3 }, { tipo: "pr", nombre: "#12", autor: "Lola", asunto: "el botón nuevo", commits: 2, t },
      { tipo: "rama", nombre: "mejora-x", autor: "Marcos", commits: 1, t: t - 26 * 3600e3 }] }).texto,
      /^🍳 Update en cocina: 2 IAs trabajando en la oficina \(último cambio, a las 21:59\) · PR #12 de Lola \(«el botón nuevo»\) · rama mejora-x de Marcos \(1 commit, el 19\/11\)$/, "IAs, PR y rama");
    igual(L({ lista, cocina }), { que: "lista", texto: "⬆ Versión nueva lista: v567 (robustez · y 1 más) · se estrena sola en un momento", botones: [] }, "auto: lista y sin botones");
    igual(L({ lista, bloqueado: true }), null, "auto y no puede ponerse al día: lo dice su aviso, no la línea");
    igual(L({ modo: "manual", lista, cocina }), { que: "lista", texto: "⬆ Versión nueva lista: v567 (robustez · y 1 más)", botones: ["ahora", "posponer"] }, "manual: con los dos botones");
    igual(L({ modo: "manual", lista, pospuesto: t + 3 * 3600e3 }), { que: "pospuesta", texto: "⬆ v567 lista · pospuesta hasta las 01:00", botones: ["ahora"] }, "pospuesta: sigue a mano");
    igual(L({ modo: "manual", lista, pospuesto: t - 1 }).que, "lista", "pasada la hora, vuelve a avisar");
    igual(L({ modo: "manual", lista, estrenando: { version: "567", t } }), { que: "estrenando", texto: "⬆ Actualizando a v567…", botones: [] }, "estrenando manda");
    igual(L({ reciente: { version: "567", t: t - 60e3 }, cocina }).texto, "✔ Estrenada la v567 a las 21:59", "recién estrenada (3 min)");
    igual(L({ reciente: { version: "567", t: t - 4 * 60e3 } }), null, "y luego, nada");
  });

  const T = fs.mkdtempSync(path.join(os.tmpdir(), "update-"));
  try {
    const O = path.join(T, "origin.git"), EQ = path.join(T, "eq"), CA = path.join(T, "casa");
    execFileSync("git", ["init", "-q", "--bare", "-b", "main", O]);
    execFileSync("git", ["clone", "-q", O, CA], { stdio: "ignore" });
    for (const f of ["oficina/server.js", "oficina/public/index.html", "herramientas/escucha-slack.js"]) escribe(CA, f, "v1\n");
    git(CA, "add", "-A"); git(CA, "commit", "-q", "-m", "v200: inicio"); git(CA, "push", "-q", "origin", "HEAD:main");
    execFileSync("git", ["clone", "-q", "-b", "main", O, EQ], { stdio: "ignore" });
    const sube = (f, msg, ref = "HEAD:main") => { escribe(CA, f, msg + "\n"); git(CA, "commit", "-q", "-am", msg); git(CA, "push", "-q", "origin", ref); };
    const mira = (o = {}) => U.miraCocina({ ejecuta: S.run, repo: EQ, ahora: Real.now(), cfg: U.COCINA, memo: {}, ...o });

    await prueba("v566 cocina: al día y sin nadie trabajando, nada; un worktree con cambios recientes es «una IA»; pasado el rato, deja de contar", async () => {
      let k = await mira(); igual([k.lista, k.cocina], [null, []], "nada");
      git(EQ, "worktree", "add", "-q", "-b", "ia-botones", path.join(T, "wt1")); escribe(path.join(T, "wt1"), "oficina/server.js", "a medias\n");
      k = await mira(); igual(k.cocina.map((x) => [x.tipo, x.nombre, x.ficheros, x.commits]), [["ia", "ia-botones", 1, 0]], "el worktree con un fichero a medias");
      casa(U.lineaUpdate({ modo: "manual", ...k }, Real.now()).texto, /^🍳 Update en cocina: una IA trabajando en la oficina \(último cambio, a las \d+:\d\d\)$/, "la línea");
      git(path.join(T, "wt1"), "commit", "-q", "-am", "wip"); k = await mira();
      igual(k.cocina.map((x) => [x.tipo, x.ficheros, x.commits]), [["ia", 0, 1]], "con el commit hecho y sin subir, sigue en cocina");
      k = await mira({ ahora: Real.now() + 46 * 60e3 }); igual(k.cocina, [], "46 min sin tocarlo: ya no está «trabajando»");
      escribe(EQ, "oficina/public/index.html", "cambio mío\n"); k = await mira();
      igual(k.cocina.filter((x) => x.tipo === "local").map((x) => x.ficheros), [1], "y el propio checkout con cambios sin subir");
      git(EQ, "checkout", "-q", "--", "."); git(EQ, "worktree", "remove", "--force", path.join(T, "wt1"));
    });

    await prueba("v566 cocina: ramas y PRs abiertas del remoto con commits que main no tiene (no las ignoradas, ni las ya mezcladas, ni las viejas)", async () => {
      git(CA, "checkout", "-q", "-b", "mejora-x"); sube("oficina/public/index.html", "v201: el botón nuevo; y otra cosa", "HEAD:mejora-x");
      git(CA, "push", "-q", "origin", "HEAD:refs/heads/estado-oficina", "HEAD:refs/heads/canal/lola/claude", "HEAD:refs/pull/12/head", "HEAD:refs/pull/12/merge", "HEAD:refs/pull/9/head");
      git(CA, "checkout", "-q", "main");
      let k = await mira();
      igual(k.cocina.map((x) => [x.tipo, x.nombre, x.autor, x.asunto, x.commits]), [["rama", "mejora-x", "Lola", "el botón nuevo", 1], ["pr", "#12", "Lola", "el botón nuevo", 1]],
        "la rama y la PR abierta (#9 no tiene «merge»: cerrada; estado-oficina y canal/*: ignoradas)");
      igual(k.lista, null, "main no ha cambiado: no hay versión nueva");
      igual((await mira({ ahora: Real.now() + 4 * 24 * 3600e3 })).cocina.map((x) => x.nombre), ["#12"], "a los 4 días la rama ya no cuenta; la PR abierta, sí (30 días)");
      git(CA, "merge", "-q", "--ff-only", "mejora-x"); git(CA, "push", "-q", "origin", "HEAD:main");
      k = await mira(); igual(k.cocina, [], "mezclada en main: sale de la cocina…");
      igual([k.lista && k.lista.version, k.lista && k.lista.n, k.lista && k.lista.trae], ["201", 1, "el botón nuevo"], "…y pasa a «versión nueva lista», con lo que trae");
    });

    await prueba("v566 manual: main va por delante y NO se trae nada; sale «⬆ Versión nueva lista» con botones; «Actualizar ahora» la trae y estrena", async () => {
      sube("oficina/server.js", "v202 [profunda]: la oficina hace algo mejor; y más");
      const cabeza = git(EQ, "rev-parse", "HEAD"); let n = 0, visto = null; const reinicia = (r) => { n++; visto = r; };
      S.upd.cfg.actualizar = "manual"; S.upd.mem = {};
      try {
        igual(await S.repasaCodigo({ repo: EQ, reinicia, reiniciaEsc: async () => {} }), null, "la vuelta de cada 3 min no actualiza");
        igual([git(EQ, "rev-parse", "HEAD") === cabeza, n], [true, 0], "ni pull ni reinicio");
        let l = S.estadoUpdate().linea;
        igual([l.que, l.texto, l.botones], ["lista", "⬆ Versión nueva lista: v202 (la oficina hace algo mejor · el botón nuevo)", ["ahora", "posponer"]], "la línea, con lo que traen los dos commits");
        S.upd.mem.pospuesto = Date.now() + 3 * 3600e3;
        igual([S.estadoUpdate().linea.que, S.estadoUpdate().linea.botones], ["pospuesta", ["ahora"]], "«Más tarde»: pospuesta");
        await S.repasaCodigo({ repo: EQ, reinicia, reiniciaEsc: async () => {} }); igual([git(EQ, "rev-parse", "HEAD") === cabeza, n], [true, 0], "pospuesta: sigue sin tocar nada");
        const r = await S.repasaCodigo({ ahoraMismo: true, repo: EQ, reinicia, reiniciaEsc: async () => {} });
        igual([r.que, r.version, r.ofi, n, visto.deSha === cabeza, visto.aSha === git(CA, "rev-parse", "HEAD")], ["actualizado", "202", true, 1, true, true], "«Actualizar ahora»: pull y estreno, con los sha para el rollback");
        igual(git(EQ, "rev-parse", "HEAD"), git(CA, "rev-parse", "HEAD"), "al día");
        igual(S.upd.lista, null, "y la línea de «lista» desaparece");
      } finally { S.upd.cfg.actualizar = "auto"; S.upd.mem = {}; S.upd.lista = null; S.upd.cocina = []; }
    });

    await prueba("v566 auto: como siempre (se trae main y estrena sola); la versión que no arrancó NO se trae otra vez hasta que main cambie", async () => {
      sube("oficina/server.js", "v203: otra");
      let n = 0; const reinicia = () => { n++; }, antes = git(EQ, "rev-parse", "HEAD");
      try {
        S.upd.mem = { malo: { sha: git(CA, "rev-parse", "HEAD"), huella: "x", version: "203", aviso: "La v203 no arranca", t: Date.now() } };
        igual([await S.repasaCodigo({ repo: EQ, reinicia, reiniciaEsc: async () => {} }), git(EQ, "rev-parse", "HEAD") === antes, n], [null, true, 0], "la mala no se trae");
        igual(S.estadoUpdate().linea, null, "ni se anuncia «se estrena sola» (lo dice su aviso)");
        sube("oficina/server.js", "v204: la arreglada");
        const r = await S.repasaCodigo({ repo: EQ, reinicia, reiniciaEsc: async () => {} });
        igual([r.que, r.version, n], ["actualizado", "204", 1], "main cambia: se trae y estrena sola");
      } finally { S.upd.mem = {}; S.upd.lista = null; S.upd.cocina = []; }
    });

    await prueba("v566 rollback: la versión nueva no arranca → el disco vuelve a la de antes (sin pisar cambios) y el aviso lo cuenta", async () => {
      const de = git(EQ, "rev-parse", "HEAD"); sube("oficina/server.js", "v205: rota"); git(EQ, "pull", "-q", "--ff-only"); const a = git(EQ, "rev-parse", "HEAD");
      const r = { que: "actualizado", deSha: de, aSha: a, version: "205" };
      escribe(EQ, "oficina/public/index.html", "cambio a medias\n");
      let x = await U.rollback({ ejecuta: S.run, repo: EQ, r, motivo: "se cierra al arrancar: SyntaxError: Unexpected token (server.js:12)", antes: "204" });
      igual([x.vuelta, git(EQ, "rev-parse", "HEAD") === a, /no he podido deshacerla/.test(x.aviso)], [false, true, true], "con cambios a medias no se toca nada y lo dice");
      git(EQ, "checkout", "-q", "--", ".");
      x = await U.rollback({ ejecuta: S.run, repo: EQ, r, motivo: "se cierra al arrancar: SyntaxError: Unexpected token (server.js:12)", antes: "204" });
      igual([x.vuelta, git(EQ, "rev-parse", "HEAD") === de, git(EQ, "status", "--porcelain")], [true, true, ""], "vuelve a la de antes, limpio");
      igual(x.aviso, "La v205 no arranca: se cierra al arrancar: SyntaxError: Unexpected token (server.js:12). He vuelto sola a la v204 y la oficina sigue en marcha (sin corte). Se probará otra vez cuando haya otra versión en main.", "el aviso");
      x = await U.rollback({ ejecuta: S.run, repo: EQ, r: { que: "estrenar", deSha: de, aSha: de, version: "204" }, motivo: "no ha pedido el relevo en 45 s" });
      igual([x.vuelta, /^El código nuevo de este equipo \(v204\) no arranca: no ha pedido el relevo en 45 s\. La oficina sigue en marcha/.test(x.aviso)], [false, true], "código de este equipo (sin pull que deshacer): solo avisa");
      igual(S.motivoArranque("C:\\o\\oficina\\server.js:4711\n  }}\n   ^\n\nSyntaxError: Unexpected token '}'\n    at wrapSafe (node:internal/modules/cjs/loader:1:1)\n\nNode.js v24"), "SyntaxError: Unexpected token '}' (server.js:4711)", "el motivo, de lo que dejó la nueva al cerrarse");
    });
  } finally { fs.rmSync(T, { recursive: true, force: true }); }

  await prueba("v569: tras el estreno en caliente, «Código al día» dice la versión NUEVA y el diario lo cuenta como estreno (no «sin avisar»)", async () => {
    const r = { que: "actualizado", de: "3e20dff", a: "a5ab678", version: "567", ofi: true, t: 1795211945000 };
    const viejo = { listo: true, t: 5, hilos: [], alDia: { version: "566", a: "3e20dff", t: 1 }, envio: { directo: true, k: "clave-vieja" } };
    const antes = S.verCodigo().alDia;
    try {
      S.verCodigo().alDia = { version: "566", a: "3e20dff", t: 1 };   // lo que la nueva leyó de al-dia.json al cargar
      const c = JSON.parse(JSON.stringify(S.cuerpoRelevo(r, viejo)));
      igual([c.ok, c.alDia.version, c.estado.alDia.version, c.estado.alDia.a], [true, "567", "567", "a5ab678"], "la que se va pasa la versión que acaba de traer");
      const h = S.heredaRelevo(c, "clave-nueva");
      igual([h.heredado, h.alDia.version, h.alDia.a, h.envio.k, S.verCodigo().alDia.version], [true, "567", "a5ab678", "clave-nueva", "567"], "la nueva la enseña ya y la guarda para sus vueltas");
      const c2 = S.cuerpoRelevo({ que: "reiniciar", version: "" }, viejo);
      igual([c2.alDia, c2.estado.alDia.version], [null, "566"], "un reinicio del mismo código no cambia la versión");
      igual(S.heredaRelevo({ ok: true, alDia: null, estado: null }), null, "sin estado que heredar, arranca como siempre");
    } finally { S.verCodigo().alDia = antes; S.upd.lista = null; S.upd.cocina = []; }
    const D = require("../diario.js"), d = D.nuevo("casa"), t0 = new Real(2026, 10, 20, 22, 37, 30).getTime();
    D.apuntaLinea(d, "update: reinicio pedido desde la página (mismo código, sin corte)", t0);
    igual(D.apuntaLinea(d, "estreno en caliente: arranco la oficina nueva al lado; esta sigue atendiendo hasta que la nueva pida el relevo", t0), true, "la que se va lo apunta");
    D.apuntaLinea(d, "estreno en caliente: tengo el puerto 52 ms después de pedirlo; enseño lo último de la oficina de antes hasta mi primera vuelta", t0 + 1100);
    D.apuntaLinea(d, "arranque: lista en 6.9 s (Slack a los 1.6 s, canal git a los 6.1 s, vuelta 2)", t0 + 8000);
    D.apuntaLinea(d, "estreno en caliente (v567): arranco la oficina nueva al lado; esta sigue atendiendo hasta que la nueva pida el relevo", t0 + 20 * 60e3);
    D.apuntaLinea(d, "estreno en caliente FALLIDO: La v567 no arranca: se cierra al arrancar. He vuelto sola a la v566", t0 + 20 * 60e3 + 3000);
    D.apuntaLinea(d, "arranque: lista en 17 s (Slack a los 2.7 s)", t0 + 25 * 60e3);
    const x = d.dias[Object.keys(d.dias)[0]];
    igual(x.arranques.map((a) => [a.en, !!a.estreno]), [["6.9 s", true], ["17 s", false]], "el relevo en caliente es un estreno; un arranque tras un estreno FALLIDO (la de antes no se fue) es sin avisar");
    casa(D.resumen(d).join("\n"), /la oficina arrancó 2 veces: 1 por estrenar código y 1 sin avisar/, "y así sale en el resumen");
  });

  await prueba("v566 el relanzador como red del estreno en caliente (PowerShell de verdad): si la de antes sigue, nada; si la nueva contesta, nada; si no contesta nadie, la tarea", async () => {
    if (process.platform !== "win32") return;
    const g0 = S.guionRelanzar(4242), g1 = S.guionRelanzar(4242, undefined, undefined, undefined, undefined, undefined, { relevo: true });
    igual([/relevo en caliente/.test(g0), /Start-Sleep -Milliseconds 2000/.test(g0), /sigue la oficina de antes/.test(g1), /vuelve \(relevo en caliente/.test(g1), /pido la tarea/.test(g1)], [false, true, true, true, true], "el guion de siempre no cambia; el de relevo añade sus dos salidas");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relevo-")), marca = path.basename(dir), log = path.join(dir, "relanzar.log"), pids = path.join(dir, "pids.txt");
    const srv = path.join(dir, "oficina-de-mentira.js");
    const libre = () => new Promise((r) => { const s = http.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const corre = (pid, puerto, schtasks) => {
      try { fs.rmSync(log, { force: true }); } catch (e) {}
      const f = path.join(dir, "relanzar.ps1");
      fs.writeFileSync(f, S.guionRelanzar(pid, "Prueba que no existe", puerto, process.execPath, srv, log, { relevo: true, espera: 2, paso: 200, patron: marca, prefijo: `function schtasks { ${schtasks} }` }));
      const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", f], { encoding: "utf8", timeout: 60e3, windowsHide: true });
      return { rc: r.status, t: fs.existsSync(log) ? fs.readFileSync(log, "utf8").replace(/^\uFEFF/, "") : "" };
    };
    const viva = http.createServer((q, r) => r.end("ok")); await new Promise((r) => viva.listen(0, "127.0.0.1", r));
    try {
      let x = corre(process.pid, viva.address().port, "'no debería pedirse'");
      igual([x.rc, /relevo \(pid \d+\): no se hizo, sigue la oficina de antes/.test(x.t), /pido la tarea/.test(x.t)], [0, true, false], "la de antes sigue viva (la nueva no arrancó): no toca nada");
      x = corre(999999, viva.address().port, "'no debería pedirse'");
      igual([x.rc, /vuelve \(relevo en caliente, pid 999999\)/.test(x.t), /pido la tarea/.test(x.t)], [0, true, false], "la de antes se fue y la nueva contesta: nada que hacer");
      const puerto = await libre();
      fs.writeFileSync(srv, `require("fs").appendFileSync(${JSON.stringify(pids)}, process.pid + "\\n"); require("http").createServer((q, r) => r.end("ok")).listen(${puerto}, "127.0.0.1"); setTimeout(() => process.exit(0), 20000);`);
      x = corre(999999, puerto, `Start-Process -FilePath '${process.execPath}' -ArgumentList '"${srv}"' -WindowStyle Hidden; 'CORRECTO: simulado'`);
      igual([x.rc, /pido la tarea; schtasks: CORRECTO: simulado/.test(x.t), /vuelve \(la tarea\)/.test(x.t)], [0, true, true], "se fue y no contesta nadie: el camino de siempre (la tarea)");
    } finally {
      viva.close(); for (const p of (fs.existsSync(pids) ? fs.readFileSync(pids, "utf8") : "").split(/\s+/).filter(Boolean)) { try { process.kill(+p); } catch (e) {} }
      await new Promise((r) => setTimeout(r, 300)); fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ---------- dos oficinas de verdad ----------
  const pide = (puerto, ruta, o = {}) => new Promise((res) => {
    const cuerpo = o.cuerpo ? JSON.stringify(o.cuerpo) : null;
    const rq = http.request({ host: "127.0.0.1", port: puerto, path: ruta, method: cuerpo ? "POST" : "GET", timeout: 3000, agent: false,
      headers: cuerpo ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(cuerpo), Origin: `http://127.0.0.1:${puerto}`, "Sec-Fetch-Site": "same-origin" } : {} }, (r) => {
      let t = ""; r.setEncoding("utf8"); r.on("data", (d) => { t += d; }); r.on("end", () => { let j = null; try { j = JSON.parse(t); } catch (e) {} res({ code: r.statusCode, j }); });
      r.on("error", () => res({ code: 0 })); });
    rq.on("timeout", () => rq.destroy()); rq.on("error", () => res({ code: 0 })); rq.end(cuerpo || undefined);
  });
  const espera = async (fn, ms, cada = 100) => { const t0 = Real.now(); for (;;) { const v = await fn(); if (v) return v; if (Real.now() - t0 > ms) return null; await new Promise((r) => setTimeout(r, cada)); } };
  const oficina = async (extra = {}) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "caliente-"));
    const puerto = await new Promise((r) => { const s = http.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const env = { ...process.env, HOME: d, USERPROFILE: d, OFICINA_PORT: String(puerto), OFICINA_REPO: path.join(d, "no-hay-repo"), CANAL_LOGS: path.join(d, ".canal-logs"),
      OFICINA_SIN_AL_DIA: "1", OFICINA_RELEVO_LANZA: "directo", EDIFICIO_CONFIG: "ninguno", ...extra(d) };
    const p = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { windowsHide: true, env, stdio: "ignore" });
    let salio = null; p.on("exit", (c) => { salio = c; });
    const logs = path.join(d, ".canal-logs"), pidDe = () => { try { return +fs.readFileSync(path.join(logs, "oficina.pid"), "utf8"); } catch (e) { return 0; } };
    const log = () => { try { return fs.readFileSync(path.join(logs, "oficina-envios.log"), "utf8"); } catch (e) { return ""; } };
    const cierra = async () => { for (const x of [p.pid, pidDe()]) { try { process.kill(x); } catch (e) {} } await new Promise((r) => setTimeout(r, 400)); try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} };
    return { d, puerto, p, salio: () => salio, pidDe, log, cierra };
  };

  await prueba("v566 estreno en caliente, de verdad: la nueva arranca al lado, pide el relevo y coge el puerto; la página no ve un corte de más de 1,5 s", async () => {
    if (process.platform !== "win32") return;
    const o = await oficina(() => ({}));
    try {
      const j0 = await espera(async () => { const r = await pide(o.puerto, "/api/estado"); return r.j && r.j.listo ? r.j : null; }, 30e3);
      igual(!!j0, true, "la primera oficina está lista"); const pid0 = o.pidDe();
      igual([j0.update && j0.update.modo, j0.update && j0.update.linea], ["manual", null], "estado.update: el modo y, sin nada en camino, sin línea");
      igual((await pide(o.puerto, "/api/actualizar", { cuerpo: { k: "mala", que: "reiniciar" } })).code, 403, "sin la clave de la página, no");
      let sigue = true, ultOk = Real.now(), corte = 0, heredado = 0, fallos = 0;
      const sondeo = (async () => { while (sigue) { const r = await pide(o.puerto, "/api/estado"); const t = Real.now();
        if (r.code === 200 && r.j && r.j.listo) { corte = Math.max(corte, t - ultOk); ultOk = t; if (r.j.heredado) heredado++; } else fallos++;
        await new Promise((x) => setTimeout(x, 25)); } })();
      const r = await pide(o.puerto, "/api/actualizar", { cuerpo: { k: j0.envio.k, que: "reiniciar" } });
      igual([r.code, r.j && r.j.ok], [200, true], "el estreno se pide");
      const pid1 = await espera(() => (o.pidDe() !== pid0 && o.pidDe()) || 0, 40e3);
      await new Promise((x) => setTimeout(x, 1500)); sigue = false; await sondeo;
      const log = o.log();
      igual([!!pid1, o.salio()], [true, 0], "hay oficina nueva (otro pid) y la de antes ha salido con 0");
      igual([/estreno en caliente: arranco la oficina nueva al lado/.test(log), /pide el relevo a los [\d.]+ s: le paso lo último leído y suelto el puerto/.test(log), /estreno en caliente: tengo el puerto \d+ ms después de pedirlo; enseño lo último/.test(log)],
        [true, true, true], "lo apuntan las dos");
      igual(corte < 1500, true, `el corte más largo sin respuesta con datos: ${corte} ms (${fallos} peticiones sin respuesta)`);
      console.log(`      (corte medido en la prueba: ${corte} ms; ${fallos} peticiones sin respuesta; ${heredado} con el estado heredado)`);
      const j1 = await espera(async () => { const x = await pide(o.puerto, "/api/estado"); return x.j && x.j.listo && !x.j.heredado ? x.j : null; }, 30e3);
      igual([!!j1, j1 && j1.envio.k !== j0.envio.k, j1 && j1.update && j1.update.estrenando], [true, true, null], "la nueva hace su vuelta: estado propio, clave nueva y ya no «actualizando»");
      igual(fs.existsSync(path.join(o.d, ".canal-logs", "relevo.json")), false, "y el relevo queda recogido");
    } finally { await o.cierra(); }
  });

  await prueba("v566 si la versión nueva no arranca, la de antes NO se cae: sigue contestando, lo avisa y no envía nada raro", async () => {
    if (process.platform !== "win32") return;
    const o = await oficina((d) => { const f = path.join(d, "rota.js"); fs.writeFileSync(f, 'if (process.argv.includes("--relevo")) throw new SyntaxError("versión rota de prueba");\n');
      return { NODE_OPTIONS: `--require "${f.replace(/\\/g, "/")}"` }; });
    try {
      const j0 = await espera(async () => { const r = await pide(o.puerto, "/api/estado"); return r.j && r.j.listo ? r.j : null; }, 30e3);
      igual(!!j0, true, "la oficina está lista"); const pid0 = o.pidDe();
      let sigue = true, fallos = 0, n = 0;
      const sondeo = (async () => { while (sigue) { const r = await pide(o.puerto, "/api/estado"); n++; if (!(r.code === 200 && r.j && r.j.listo)) fallos++; await new Promise((x) => setTimeout(x, 25)); } })();
      igual((await pide(o.puerto, "/api/actualizar", { cuerpo: { k: j0.envio.k, que: "reiniciar" } })).code, 200, "se pide el estreno");
      const j1 = await espera(async () => { const x = await pide(o.puerto, "/api/estado"); return x.j && x.j.errores && x.j.errores.update ? x.j : null; }, 30e3);
      sigue = false; await sondeo;
      igual(!!j1, true, "sale el aviso");
      casa(j1.errores.update, /no arranca: se cierra al arrancar: SyntaxError: versión rota de prueba.*La oficina sigue en marcha con el de antes/, "el aviso dice por qué");
      igual([o.pidDe() === pid0, o.salio(), fallos, j1.update.estrenando, j1.envio.k === j0.envio.k], [true, null, 0, null, true], `la misma oficina, viva, sin una sola petición fallida (${n}) y ya no «actualizando»`);
      casa(o.log(), /estreno en caliente FALLIDO: El código nuevo de este equipo/, "y queda en su log");
    } finally { await o.cierra(); }
  });
};
