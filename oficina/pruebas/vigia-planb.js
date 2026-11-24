"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const VO = require("../../herramientas/vigila-oficina.js");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("v547: el plan B del vigía de la oficina (arranque directo si la tarea no arranca; aviso si ni así)");
  const S = require("../server.js");
  const h0 = Date.parse("2026-11-19T10:35:29Z");   // jueves, en horario
  const pasa = async (o = {}) => { const hechos = [];
    const r = await VO.revisa({ consulta: async () => false, pid: 4242, vive: () => false, est: o.est || {}, ahora: o.ahora || h0, estrenoT: o.estrenoT || 0,
      matar: () => hechos.push("matar"), arrancar: () => hechos.push("tarea"),
      esperar: async () => { const v = (o.vuelve || []).shift(); hechos.push("espera" + (v ? "→ok" : "")); return !!v; },
      hayOficina: async () => !!o.hay, directa: () => hechos.push("directa"),
      avisar: (desde) => hechos.push("aviso " + new Date(desde).toISOString().slice(11, 16)), horario: o.horario || (() => true) });
    return { ...r, hechos }; };

  await prueba("v547: el vigía, si la tarea no vuelve en 25 s y no hay proceso, la arranca directa; si vuelve con la tarea, nada más", async () => {
    let r = await pasa({ vuelve: [true] });
    igual([r.que, r.hechos, r.est.caida], ["arrancada", ["tarea", "espera→ok"], null], "vuelve con la tarea");
    r = await pasa({ vuelve: [false, true] });
    igual([r.que, r.hechos, r.est.caida], ["arrancada+directa", ["tarea", "espera", "directa", "espera→ok"], null], "la tarea no; directa, sí");
    r = await pasa({ vuelve: [false, false], hay: true });
    igual([r.que.includes("directa"), r.hechos.includes("directa")], [false, false], "si hay proceso de la oficina (aún sin contestar), no se arranca otra");
  });

  await prueba("v547: si ni así vuelve: «no vuelve», est.caida desde el estreno, y UN aviso a Humano pasados 10 min (solo en horario)", async () => {
    const estrenoT = h0 - 8 * 60e3;
    let r = await pasa({ vuelve: [false, false], estrenoT });
    igual([r.que, r.est.caida && r.est.caida.desde, r.hechos.some((x) => /^aviso/.test(x))], ["arrancada+directa+no vuelve", estrenoT, false], "a los 8 min: aún sin aviso");
    r = await pasa({ vuelve: [false, false], estrenoT, est: r.est, ahora: h0 + 15 * 60e3 });
    igual([r.que, r.hechos.filter((x) => /^aviso/.test(x))], ["arrancada+directa+no vuelve+aviso", ["aviso 10:27"]], "a los 23 min: el aviso, con desde cuándo");
    r = await pasa({ vuelve: [false, false], estrenoT, est: r.est, ahora: h0 + 30 * 60e3 });
    igual(r.hechos.some((x) => /^aviso/.test(x)), false, "y una sola vez");
    r = await pasa({ vuelve: [false, false], estrenoT, ahora: h0 + 15 * 60e3, horario: () => false });
    igual(r.hechos.some((x) => /^aviso/.test(x)), false, "de noche o en fin de semana, sin Slack (salud.js lo enseña en rojo)");
    const bien = await VO.revisa({ consulta: async () => true, est: { caida: { desde: estrenoT, avisado: h0 } } });
    igual(bien.est.caida, null, "en cuanto contesta, ya no está caída");
  });

};
