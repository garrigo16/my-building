"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const VO = require("../../herramientas/vigila-oficina.js");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("v548: el plan B del relanzador del estreno (de verdad en PowerShell, con schtasks de mentira)");
  const S = require("../server.js");
  const h0 = Date.parse("2026-11-19T10:35:29Z");   // jueves, en horario
  const pasa = async (o = {}) => { const hechos = [];
    const r = await VO.revisa({ consulta: async () => false, pid: 4242, vive: () => false, est: o.est || {}, ahora: o.ahora || h0, estrenoT: o.estrenoT || 0,
      matar: () => hechos.push("matar"), arrancar: () => hechos.push("tarea"),
      esperar: async () => { const v = (o.vuelve || []).shift(); hechos.push("espera" + (v ? "→ok" : "")); return !!v; },
      hayOficina: async () => !!o.hay, directa: () => hechos.push("directa"),
      avisar: (desde) => hechos.push("aviso " + new Date(desde).toISOString().slice(11, 16)), horario: o.horario || (() => true) });
    return { ...r, hechos }; };

  await prueba("v548: el guion del relanzador, de verdad en PowerShell (schtasks de mentira): vuelve con la tarea, con el arranque directo o «NO VUELVE»", async () => {
    if (process.platform !== "win32") return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relanz-")), marca = path.basename(dir), puerto = 45000 + Math.floor(Math.random() * 4000);
    const srv = path.join(dir, "oficina-de-mentira.js"), muda = path.join(dir, "oficina-muda.js"), log = path.join(dir, "relanzar.log"), pids = path.join(dir, "pids.txt");
    fs.writeFileSync(srv, `require("fs").appendFileSync(${JSON.stringify(pids)}, process.pid + "\\n"); require("http").createServer((q, r) => r.end("ok")).listen(${puerto}, "127.0.0.1"); setTimeout(() => process.exit(0), 20000);`);
    fs.writeFileSync(muda, `require("fs").appendFileSync(${JSON.stringify(pids)}, process.pid + "\\n"); setTimeout(() => process.exit(0), 300);`);
    const corre = (server, schtasks) => {
      try { fs.rmSync(log, { force: true }); } catch (e) {}
      const g = S.guionRelanzar(999999, "Prueba que no existe", puerto, process.execPath, server, log, { paso: 100, patron: marca, prefijo: `function schtasks { ${schtasks} }` });
      const f = path.join(dir, "relanzar.ps1"); fs.writeFileSync(f, g);
      const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", f], { encoding: "utf8", timeout: 60e3, windowsHide: true });
      const t = fs.existsSync(log) ? fs.readFileSync(log, "utf8").replace(/^﻿/, "") : "";
      for (const p of (fs.existsSync(pids) ? fs.readFileSync(pids, "utf8") : "").split(/\s+/).filter(Boolean)) { try { process.kill(+p); } catch (e) {} }
      try { fs.rmSync(pids, { force: true }); } catch (e) {}
      return { rc: r.status, t };
    };
    try {
      let x = corre(srv, `Start-Process -FilePath '${process.execPath}' -ArgumentList '"${srv}"' -WindowStyle Hidden; 'CORRECTO: simulado'`);
      igual([x.rc, /pido la tarea; schtasks: CORRECTO: simulado/.test(x.t), /vuelve \(la tarea\)/.test(x.t), /directa/.test(x.t)], [0, true, true, false], "la tarea arranca: vuelve con ella");
      x = corre(srv, "'CORRECTO: simulado, pero no arranca nada'");
      igual([x.rc, /a los 20 s sin proceso: la pido otra vez/.test(x.t), /a los 40 s ni proceso ni puerto: la arranco directa/.test(x.t), /vuelve \(directa\)/.test(x.t)], [0, true, true, true], "la tarea no arranca (lo de hoy): vuelve con el arranque directo");
      x = corre(muda, "'CORRECTO: simulado, pero no arranca nada'");
      igual([x.rc, /NO VUELVE: ni la tarea ni el arranque directo/.test(x.t)], [1, true], "ni así: «NO VUELVE» y sale con 1");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
};
