"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), { spawn } = require("child_process");
const S = require("../server.js");

module.exports = async ({ prueba, igual, C, T, setAhora }) => {
  console.log("la oficina al momento (v506)");
  const { m } = C;
  const L0 = () => ({ arranquesCursor: [], frenos: [], avisosCoo: [], sesionHilo: {}, lanzHilo: {}, cursorSlack: [], esperas: [], ultEsc: 0, lanz: [], timbreHilo: "", traspasos: [] });
  await prueba("v506: Claude lanzado hace un momento sale «arrancando» (en marcha) sin esperar a ver su proceso; al contestar, o a los 3 min, ya no", () => {
    const R = m("20:06:49", "Humano", "*Hilo: Prueba de la oficina de casa*"), J = m("20:07:23", "Humano", "@Claude prueba de la oficina de casa: contesta solo «recibido desde casa» y cierra con [hecho]");
    const h = { ts: R.ts, msgs: [R, J] }, arr = { [R.ts]: { Claude: T("20:07:23") } };
    setAhora(T("20:07:30"));
    let x = S.analizar([h], { ...L0(), arrancando: arr }, null, null, []).hilos[0];
    igual([x.estado, x.trabajan.map((t) => [t.ia, t.arrancando])], ["marcha", [["Claude", true]]], "a los 7 s: Claude arrancando");
    setAhora(T("20:07:30"));
    igual(S.analizar([h], L0(), null, null, []).hilos[0].estado !== "marcha", true, "sin el aviso de arranque, aún no (lo de antes)");
    const resp = m("20:08:47", "Claude", "recibido desde casa\n[hecho]");
    setAhora(T("20:08:50"));
    x = S.analizar([{ ts: R.ts, msgs: [R, J, resp] }], { ...L0(), arrancando: arr }, null, null, []).hilos[0];
    igual([x.estado, x.trabajan.length], ["cerrado", 0], "contestó: cerrado, ya no arranca");
    setAhora(T("20:10:30"));
    igual(S.analizar([h], { ...L0(), arrancando: arr }, null, null, []).hilos[0].trabajan.length, 0, "a los 3 min sin señal, ya no cuenta como arrancando");
    igual([S.marcaArranque("1.1", "Claude"), S.marcaArranque("1.1", "Grok"), S.marcaArranque("", "Claude")], [true, false, false], "solo Claude, Cursor y Coo, con hilo");
  });
  await prueba("v508: trabajando mientras vive su lanzador; al acabar, «terminó» (o «no pudo»); sin proceso a los 3 min, no se dice; Coo por webhook, «avisado», nunca «trabajando»", () => {
    const R = m("20:06:49", "Humano", "*Hilo: Prueba de la oficina de casa*"), J = m("20:07:23", "Humano", "@Claude prueba: contesta «recibido desde casa» y [hecho]");
    const h = { ts: R.ts, msgs: [R, J] }, ini = T("20:07:23"), ver = (hms, act, msgs = h.msgs, P = null) => { setAhora(T(hms)); return S.analizar([{ ts: R.ts, msgs }], { ...L0(), arrancando: { [R.ts]: act } }, P, null, []).hilos[0]; };
    let x = ver("20:07:50", { Claude: { ini, fin: 0, lanzador: true } });
    igual([x.estado, x.trabajan.map((t) => [t.ia, t.arrancando])], ["marcha", [["Claude", true]]], "27 s: arrancando");
    x = ver("20:08:40", { Claude: { ini, fin: 0, lanzador: true } });
    igual([x.estado, x.trabajan.map((t) => [t.ia, t.arrancando, t.desde])], ["marcha", [["Claude", false, ini]]], "77 s, su lanzador sigue vivo: trabajando desde las 20:07");
    x = ver("20:09:00", { Claude: { ini, fin: T("20:08:47"), rc: 0, lanzador: true } }, [R, J, m("20:08:47", "Claude", "recibido desde casa\n[hecho]")]);
    igual([x.estado, x.trabajan.length, x.terminaron], ["cerrado", 0, [{ ia: "Claude", fin: T("20:08:47"), rc: 0 }]], "acabó: «terminó 20:08», ya no trabaja");
    x = ver("20:08:10", { Claude: { ini, fin: T("20:08:05"), rc: 3, lanzador: true } });
    igual([x.trabajan.length, x.terminaron.map((t) => t.rc)], [0, [3]], "su lanzador falló: «no pudo» (rc 3), no «trabajando»");
    x = ver("20:12:30", { Claude: { ini, fin: 0, lanzador: true } }, h.msgs, { claudeHilo: [] });
    igual(x.trabajan.length, 0, "5 min sin fin pero sin ningún Claude vivo en ese hilo: no se dice que trabaja (aviso de fin perdido)");
    x = ver("20:12:30", { Claude: { ini, fin: 0, lanzador: true } }, h.msgs, { claudeHilo: [{ ses: "s1", ini }] });
    igual(x.trabajan.length, 0, "(un Claude vivo de OTRO hilo tampoco cuenta)");
    x = ver("20:10:00", { Coo: { ini, fin: T("20:07:25"), rc: 0, lanzador: false } });
    igual([x.trabajan.length, x.avisados.map((a) => a.ia)], [0, ["Coo"]], "Coo por webhook: «avisado», no «trabajando»");
    x = ver("20:10:00", { Coo: { ini, fin: T("20:07:25"), rc: 0, lanzador: false } }, [R, J, m("20:09:30", "Coo", "Hecho.\n[hecho]")]);
    igual(x.avisados.length, 0, "Coo contestó: ya no está «avisado»");
    x = ver("20:08:00", { Coo: { ini, fin: T("20:07:25"), rc: 9, lanzador: false } });
    igual([x.avisados.length, x.terminaron.map((t) => t.que)], [0, ["no se pudo avisar"]], "el aviso a Coo falló: se dice");
    x = ver("20:07:50", { Coo: { ini, fin: 0, lanzador: true } });
    igual(x.trabajan.map((t) => t.ia), ["Coo"], "Grok desde Slack (atender-grok.sh) sí trabaja AQUÍ mientras vive su lanzador");
  });
  await prueba("v510: lo del canal git, al momento: se lee en cada vuelta mientras alguna IA trabaja, está avisada o acaba de terminar; y publicar-canal.sh avisa a la oficina", () => {
    const t = 10 * 3600e3, MIN = 60e3;
    igual([S.enMovimiento(t, { h: { Claude: { ini: t - 5 * MIN, fin: 0, lanzador: true } } }), S.enMovimiento(t, { h: { Claude: { ini: t - 9 * MIN, fin: t - MIN, rc: 0, lanzador: true } } }),
      S.enMovimiento(t, { h: { Claude: { ini: t - 9 * MIN, fin: t - 5 * MIN, rc: 0, lanzador: true } } }), S.enMovimiento(t, { h: { Coo: { ini: t - 10 * MIN, fin: t - 10 * MIN, rc: 0, lanzador: false } } }),
      S.enMovimiento(t, { h: { Coo: { ini: t - 20 * MIN, fin: t - 20 * MIN, rc: 0, lanzador: false } } }), S.enMovimiento(t, {})],
      [true, true, false, true, false, false], "trabajando / acaba de terminar / terminó hace 5 min / Coo avisado / Coo hace 20 min / nada");
    const sh = fs.readFileSync(path.join(__dirname, "..", "..", "herramientas", "publicar-canal.sh"), "utf8");
    igual(/if \[ -f "\$HOME\/\.canal-logs\/oficina\.pid" \]; then\n\s+curl -s -m 2 [^\n]*"git":true[^\n]*\/api\/toque"/.test(sh), true, "al publicar, toque «git» (solo donde corre la oficina; sin esperar)");
  });
  await prueba("v511: al reiniciarse sola, espera a que la vieja se cierre, la arranca y comprueba que contesta (si no, otra vez, hasta 3)", () => {
    const g = S.guionRelanzar(4321, "Canal IAs - oficina", 4317);
    // (v547: con plan B: pide la tarea, comprueba el puerto y, si no vuelve, la arranca directa; ver relanzador-planb.js)
    igual([/^Wait-Process -Id 4321 -Timeout 60$/m.test(g), /schtasks \/run \/tn "Canal IAs - oficina"/.test(g), /\$c\.ConnectAsync\('127\.0\.0\.1', 4317\)\.Wait\(500\)/.test(g), /Start-Process -FilePath/.test(g)],
      [true, true, true, true], "espera, arranca, comprueba el puerto y tiene plan B");
    if (process.platform === "win32") {
      const f = path.join(os.tmpdir(), `relanzar-${process.pid}.ps1`); fs.writeFileSync(f, g);
      const r = require("child_process").spawnSync("powershell", ["-NoProfile", "-Command", `$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('${f}',[ref]$null,[ref]$e); if($e){'MAL'}else{'BIEN'}`], { encoding: "utf8", windowsHide: true });
      fs.rmSync(f, { force: true });
      igual(String(r.stdout).trim(), "BIEN", "PowerShell lo entiende");
    }
  });
  await prueba("v506: un toque refresca ya y, si llegan muchos seguidos, como mucho una vez cada 2 s", () => {
    const prog = []; const programa = (f, ms) => { prog.push(ms); return 1; };
    const a = S.pideRefresco(Date.now(), programa), b = S.pideRefresco(Date.now(), programa);
    igual([a === "ya" || a === "en cola", b, prog.length], [true, "en cola", 1], "el segundo se junta con el primero");
  });
  await prueba("v506: la oficina de verdad da /api/eventos (Server-Sent Events) y acepta /api/toque de este equipo; de otra web, no", async () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "tiempo-real-"));
    const puerto = await new Promise((r) => { const s = http.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
    const p = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], { windowsHide: true, stdio: "ignore",
      env: { ...process.env, HOME: d, USERPROFILE: d, OFICINA_PORT: String(puerto), OFICINA_REPO: path.join(d, "no-hay-repo"), CANAL_LOGS: path.join(d, ".canal-logs") } });
    const pide = (metodo, ruta, cab = {}, cuerpo = "") => new Promise((r) => {
      const q = http.request({ host: "127.0.0.1", port: puerto, path: ruta, method: metodo, headers: { Host: `127.0.0.1:${puerto}`, ...cab } }, (x) => {
        let b = ""; const fin = () => r({ code: x.statusCode, tipo: x.headers["content-type"] || "", b });
        if (/event-stream/.test(x.headers["content-type"] || "")) { x.on("data", (c) => { b += c; if (/retry: 5000/.test(b)) { fin(); q.destroy(); } }); }
        else x.on("data", (c) => b += c).on("end", fin);
      }); q.on("error", () => r({ code: 0 })); q.end(cuerpo); });
    try {
      for (let i = 0; i < 40; i++) { const r = await pide("GET", "/api/version"); if (r.code) break; await new Promise((x) => setTimeout(x, 250)); }
      const ev = await pide("GET", "/api/eventos");
      igual([ev.code, /text\/event-stream/.test(ev.tipo), /retry: 5000/.test(ev.b)], [200, true, true], "eventos: abierto");
      const ok = await pide("POST", "/api/toque", { "Content-Type": "application/json" }, JSON.stringify({ hilo: "1795028808.212139", ia: "Claude" }));
      const fuera = await pide("POST", "/api/toque", { "Content-Type": "application/json", Origin: "https://malo.example" }, "{}");
      const host = await pide("GET", "/api/eventos", { Host: "malo.example" });
      igual([ok.code, fuera.code, host.code], [204, 403, 403], "toque de este equipo sí; de otra web o con otro Host, no");
      igual(os.getPriority(p.pid), os.constants.priority.PRIORITY_ABOVE_NORMAL, "v507: prioridad por encima de lo normal");
      const inf = await pide("GET", "/api/informe"), rehaz = await pide("POST", "/api/informe", { "Content-Type": "application/json" }, "{}");
      igual([inf.code, /Aún no hay informe/.test(inf.b), rehaz.code], [404, true, 403], "v513: /api/informe");
    } finally { try { p.kill(); } catch (e) {} await new Promise((r) => setTimeout(r, 300)); fs.rmSync(d, { recursive: true, force: true }); }
  });
};
