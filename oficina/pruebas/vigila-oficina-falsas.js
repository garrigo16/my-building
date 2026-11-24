"use strict";
const fs = require("fs"), path = require("path");
const VO = require("../../herramientas/vigila-oficina.js");

module.exports = async ({ prueba, igual }) => {
  console.log("v497: el vigía de la oficina sin falsas alarmas (PowerShell lento, reinicio para estrenar)");
  const h0 = Date.parse("2026-11-18T21:21:18Z");
  const pasa = async (vive, est, extra = {}) => { const hechos = [];
    const r = await VO.revisa({ consulta: async () => false, pid: 4242, vive: () => vive, est, ahora: h0, matar: (p) => hechos.push("matar " + p), arrancar: () => hechos.push("arrancar"), ...extra });
    return { ...r, hechos }; };

  await prueba("v497: pid vivo pero PowerShell no dice qué es (falla o tarda): espera una pasada, y nunca cierra un proceso sin ver que es la oficina", async () => {
    let r = await pasa(null, {});
    igual([r.que, r.hechos, r.est.arranques.length], ["esperar", [], 0], "1.ª pasada: espera (antes, «no estaba en marcha: arranco su tarea»)");
    r = await pasa(null, r.est);
    igual([r.que, r.hechos], ["arrancada", ["arrancar"]], "2.ª pasada: arranca su tarea, sin cerrar ese pid");
    r = await pasa(true, { colgada: 1 });
    igual([r.que, r.hechos], ["reiniciada", ["matar 4242", "arrancar"]], "visto que es la oficina y colgada: la cierra y la arranca (como antes)");
    r = await pasa(false, {});
    igual([r.que, r.hechos], ["arrancada", ["arrancar"]], "sin proceso: arranca a la primera (como antes)");
  });

  await prueba("v498: la espera por estreno cubre lo que reintenta el relanzador (calculado de su guion) y no mucho más; a los 3 min 30 s ya la levanta", async () => {
    const S = require("../server.js"), g = S.guionRelanzar(4242);
    // (v547: el relanzador con plan B: espera a que salga, un paso, 20 pasos con la tarea y 30 con el arranque directo)
    const espera = +((g.match(/Wait-Process -Id \d+ -Timeout (\d+)/) || [])[1] || NaN) * 1e3, paso = +((g.match(/Start-Sleep -Milliseconds (\d+)/) || [])[1] || NaN);
    const tope = +((g.match(/\.Wait\((\d+)\)/) || [])[1] || NaN);   // (cada comprobación del puerto, con su tope)
    const bucles = [...g.matchAll(/for \(\$k = 0; \$k -lt (\d+); \$k\+\+\) \{ Start-Sleep -Milliseconds (\d+)/g)].reduce((s, x) => s + +x[1] * (+x[2] + tope), 0);
    const max = espera + paso + bucles;
    igual([max, max <= VO.ESTRENO_MS, VO.ESTRENO_MS - max < 60e3], [162e3, true, true], "relanzador: 60 + 2 + 16 × 2,5 + 24 × 2,5 s = 2 min 42 s; espera 3 min");
    const r = await pasa(false, {}, { estrenoT: h0 - 3.5 * 60e3 });
    igual([r.que, r.hechos], ["arrancada", ["arrancar"]], "a los 3 min 30 s el relanzador ya ha fallado: arranca (antes esperaba hasta los 5 min y, si el vigía pasaba antes, 15 más)");
  });

  await prueba("v498: el portátil, mañana: su relanzador viejo (el de antes de la v511) no deja relanzar-oficina.ps1; si falla, la primera pasada del vigía nuevo la levanta", async () => {
    const r = await pasa(false, {}, { estrenoT: 0 });
    igual([r.que, r.hechos, r.est.arranques.length], ["arrancada", ["arrancar"], 1], "sin relanzador nuevo y sin proceso: arranca a la primera");
  });

  await prueba("v497: si la oficina escribió su relanzador hace menos de 3 min (reinicio para estrenar), espera: ni arranca ni lo cuenta", async () => {
    let r = await pasa(false, { arranques: [h0 - 3600e3] }, { estrenoT: h0 - 2 * 60e3 - 40e3 });
    igual([r.que, r.hechos, r.est.arranques.length, r.est.colgada], ["estreno", [], 1, 0], "a los 2 min 40 s del estreno: espera");
    r = await pasa(false, {}, { estrenoT: h0 - 6 * 60e3 });
    igual([r.que, r.hechos], ["arrancada", ["arrancar"]], "a los 6 min ya no es el estreno: arranca");
    r = await pasa(false, {}, { estrenoT: h0 + 60e3 });
    igual(r.que, "arrancada", "un relanzador con fecha futura (reloj raro) no frena nada");
  });

  await prueba("v497: esLaOficina: «no se sabe» (null) si PowerShell falla o no trae la línea de comandos; false si no existe o es otro", () => {
    const fuente = fs.readFileSync(path.join(__dirname, "..", "..", "herramientas", "vigila-oficina.js"), "utf8");
    const con = (exec, vivo = true) => new Function("execFileSync", "vivePid", fuente.match(/function esLaOficina\(pid\) \{[\s\S]*?\n\}/)[0] + "\nreturn esLaOficina;")(exec, () => vivo);
    igual(con(() => { const e = new Error("spawnSync powershell ETIMEDOUT"); e.code = "ETIMEDOUT"; throw e; })(4242), null, "PowerShell tarda más de 30 s: no se sabe");
    igual(con(() => "\r\n")(4242), null, "sin línea de comandos (otro usuario, permisos): no se sabe");
    igual(con(() => '"C:\\Program Files\\nodejs\\node.exe" C:\\Users\\x\\.claude\\relevo\\oficina\\server.js\r\n')(4242), true, "la oficina");
    igual(con(() => "C:\\Windows\\System32\\notepad.exe\r\n")(4242), false, "otro programa con ese pid");
    igual(con(() => { throw new Error("no debería mirar"); }, false)(4242), false, "el pid no existe");
  });
};
