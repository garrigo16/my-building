"use strict";
const S = require("../server.js");

module.exports = async ({ prueba, igual, T, setAhora }) => {
  console.log("«¿Qué gasta?»: solo trabajo");
  const DENTRO = ["C--Users-usuar-Documents-Oca-Global-Repository-oca-salesforce", "E--Trabajo-Oca-Global-Repositorio-oca-salesforce", "E--oca-sf",
    "C--Users-usuar--claude-relevo", "C--Users-usuar--claude-relevo--claude-worktrees-diseno-oficina-fd29b9", "C--Users-usuar-wt-canal-claude", "C--Users-usuar-wt-proyecto-claude"];
  const FUERA = ["E--Otro-Proyecto", "E--Otro-Proyecto--claude-worktrees-rama-de-prueba", "E--Otra-Carpeta", "E--Otra-Carpeta--claude-worktrees-otra-rama",
    "C--Users-usuar-Documents-Notas", "C--Users-usuar-Documents-Notas-v2", "C--Users-usuar-AppData-Local-Temp",
    "C--Users-usuar-AppData-Local-Claude-Data-claude-pzs8sxrjxfjjc-scratch-workspaces-8101bf95-c665296d-scratch-2026-11-17-61982c", "E--Proyecto-nuevo-cualquiera"];
  await prueba("lista blanca: oca-salesforce (C:, E:, oca-sf), el Edificio y sus worktrees, el canal git; nada más", () => {
    igual(DENTRO.filter((d) => !S.esTrabajo(d)), [], "deberían contar");
    igual(FUERA.filter((d) => S.esTrabajo(d)), [], "no deberían contar (personal, chats sin carpeta, nuevos)");
  });
  await prueba("ni en la lista ni en los totales: otros proyectos y los chats sin carpeta", () => {
    setAhora(T("18:50"));
    const dia = new Date(T("18:50")); const k = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, "0")}-${String(dia.getDate()).padStart(2, "0")}`;
    const ses = {}; [...DENTRO.slice(0, 2), ...FUERA.slice(0, 5)].forEach((dir, i) => { ses["s" + i] = { dir, inp: 1000, cw: 0, cr: 0, out: 0, n: 1, ini: T("18:00"), fin: T("18:10"), mod: "", ep: "claude-desktop" }; });
    S.setConsumo({ v: 4, archivos: {}, dias: {}, ses: { [k]: ses } });
    const g = S.gastoSesiones().hoy;
    igual(g.top.map((x) => x.dir).sort(), DENTRO.slice(0, 2).sort(), "sesiones"); igual(g.total, 2000, "total");
    igual(g.porTipo.slack + g.porTipo.canal + g.porTipo.tu, 2000, "por tipo");
  });
  await prueba("una sesión de un hilo de Slack que se rehízo por tamaño sigue contando como «Slack», no como «canal»", () => {
    const fs = require("fs"), path = require("path"), os = require("os");
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "gasto-")); fs.mkdirSync(path.join(d, "sesiones-slack"));
    const vieja = "3203ebcd-310c-4bb5-8630-a239dbc3bfda", nueva = "22bd9e93-5f10-42b4-a322-11ae9867e025", canal = "aaaaaaaa-1111-2222-3333-444444444444";
    fs.writeFileSync(path.join(d, "sesiones-slack", "CCANAL00001-1794903477.325769"), nueva);
    fs.writeFileSync(path.join(d, "sesiones-slack.log"), `2026-11-17T17:50:48+01:00 hilo 1794903477.325769 sesion_nueva ctx=105962 vieja=${vieja}\n`);
    setAhora(T("18:50"));
    const dia = new Date(T("18:50")); const k = `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, "0")}-${String(dia.getDate()).padStart(2, "0")}`;
    const s = (sid) => ({ dir: "C--Users-usuar-Documents-Oca-Global-Repository-oca-salesforce", inp: 100, cw: 0, cr: 0, out: 0, n: 1, ini: T("17:00"), fin: T("17:10"), mod: "", ep: "cli" });
    S.setConsumo({ v: 4, archivos: {}, dias: {}, ses: { [k]: { [vieja]: s(), [nueva]: s(), [canal]: s() } } });
    const g = S.gastoSesiones(d).hoy;
    try { igual(Object.fromEntries(g.top.map((x) => [x.sid.slice(0, 8), x.tipo])), { "3203ebcd": "slack", "22bd9e93": "slack", aaaaaaaa: "canal" }, "tipos"); }
    finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
};
