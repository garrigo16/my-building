// hecho-con-pr.js - un [hecho] en un tema de Jira con PR de Bitbucket no lo cierra hasta que el ticket esté en «En QA» o la PR mergeada. Datos inventados, sin red.
"use strict";
const S = require("../server.js");

module.exports = async ({ prueba, igual, casa, C, T, setAhora }) => {
  const { m } = C;
  const L0 = () => ({ arranquesCursor: [], frenos: [], avisosCoo: [], sesionHilo: {}, lanzHilo: {}, cursorSlack: [], esperas: [], ultEsc: 0, lanz: [], timbreHilo: "", traspasos: [], sfAuto: { no: {}, apagado: true } });
  const PR = "https://bitbucket.org/equipo-demo/repo-demo/pull-requests/5088";
  const raiz = (tit) => m("12:30:00", "Humano", `*Hilo: Equipo · ${tit}*\n🎯 Objetivo: arreglar el ejemplo`);
  const hecho = (txt) => m("13:12:36", "Coo", txt || `Coo: PR abierta: ${PR} [hecho: PR de DEMO-1482 abierta]`);
  const ver = (msgs, { pr, enqa } = {}) => { setAhora(T("13:23")); S.setPR(pr || {}); S.setJiraEnQA(enqa || {}); return S.analizar([{ ts: msgs[0].ts, msgs }], L0(), null, null, []).hilos[0]; };
  const limpia = () => { S.setPR({}); S.setJiraEnQA({}); };

  console.log("v599: [hecho] con PR de Bitbucket en tema de Jira");
  await prueba("v599: ticket + PR, ticket no En QA, último mensaje [hecho] -> espera, no cierra", () => {
    const h = ver([raiz("DEMO-1482 ejemplo"), hecho()]);
    igual([h.estado, h.caja], ["espera_otro", "esperando"], "estado");
    casa(h.motivo, /^⏳ esperando merge de la PR #5088$/, "motivo");
  });
  await prueba("v599: el hecho de las 13:12 sin el mensaje de espera de Coo tampoco cierra (hilo de DEMO-1482)", () => {
    const h = ver([raiz("DEMO-1482 ejemplo"), hecho(), m("13:21:29", "Humano", "Pero no hay que cerrarla hasta que la PR no haya subido a QA")]);
    igual(h.estado === "cerrado", false, "no cerrado");
  });
  await prueba("v599: el ticket ya está En QA -> sí se cierra", () => {
    const h = ver([raiz("DEMO-1482 ejemplo"), hecho()], { enqa: { "DEMO-1482": 1 } });
    igual(h.estado, "cerrado", "estado"); casa(h.motivo, /^✔ cerrado en el hilo \(hecho/, "motivo");
  });
  await prueba("v599: la PR está mergeada -> sí se cierra", () => {
    const h = ver([raiz("DEMO-1482 ejemplo"), hecho()], { pr: { 5088: { state: "MERGED", dest: "main", t: T("13:20") } } });
    igual(h.estado, "cerrado", "estado");
  });
  await prueba("v599: sin PR en el hilo (con ticket) -> cierra como siempre", () => {
    const h = ver([raiz("DEMO-1482 ejemplo"), m("13:12:36", "Coo", "Coo: listo. [hecho: arreglado]")]);
    igual(h.estado, "cerrado", "estado");
  });
  await prueba("v599: con PR pero sin ticket de Jira -> cierra como siempre", () => {
    const h = ver([raiz("ejemplo sin ticket"), hecho()]);
    igual(h.estado, "cerrado", "estado");
  });
  await prueba("v599: Humano dice «cámbialo: dalo por hecho» -> se cierra aunque falte el merge", () => {
    const h = ver([raiz("DEMO-1482 ejemplo"), hecho(), m("13:22:00", "Humano", "cámbialo: dalo por hecho")]);
    igual(h.estado, "cerrado", "estado");
  });
  limpia();
};
