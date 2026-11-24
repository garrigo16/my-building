// pausa-no-toca.js - un tema en pausa (apuntes.ajustes.pausas) que te tocaba no se queda en la caja «toca» del servidor. Datos inventados.
"use strict";
const S = require("../server.js");

module.exports = async ({ prueba, igual, casa, C, T, setAhora }) => {
  const { m } = C;
  const L0 = (o) => ({ arranquesCursor: [], frenos: [], avisosCoo: [], sesionHilo: {}, lanzHilo: {}, cursorSlack: [], esperas: [], ultEsc: 0, lanz: [], timbreHilo: "", traspasos: [], ...(o || {}) });
  const ver = (hms, hilos, L) => { setAhora(T(hms)); return S.analizar(hilos, L0({ sfAuto: { no: {}, apagado: false }, ...(L || {}) }), null, null, []); };
  const MS = [m("09:00:00", "Charla", "Hilo: Proyecto Uno · tema de ejemplo\nObjetivo: dejar listo el ejemplo\nOrigen: Chat"),
    m("10:00:00", "Coo", "Coo: quedo atento a lo que diga Ana. [espera: Ana — probar el ejemplo]")];
  const TIT = "Proyecto Uno · tema de ejemplo";
  const hilo = (extra) => ({ ts: MS[0].ts, msgs: [...MS, ...(extra || [])] });
  const pausa = (hasta) => ({ pausas: { [TIT]: { t: T("10:30"), motivo: "Hoy no", hasta } } });
  const toca = [m("10:20:00", "Coo", "Coo: Ana ha contestado. [te toca: ¿Le digo que sí?]")];

  console.log("v577: lo que está en pausa no es «toca» en el servidor");
  await prueba("v577: sin pausa el tema es «toca» (el caso base)", () => {
    const a = ver("11:00", [hilo(toca)]), h = a.hilos[0];
    igual([h.caja, h.estado, a.deTi.length, h.cajaReal], ["toca", "humano", 1, undefined], "sin pausa, toca");
  });
  await prueba("v577: en pausa hasta mañana: caja «pausa», fuera de deTi y de los contadores, con su caja de antes en cajaReal", () => {
    const a = ver("11:00", [hilo(toca)], { apuntes: pausa(T("11:00") + 86400e3) }), h = a.hilos[0];
    igual([h.caja, h.estado, h.cajaReal, h.estadoReal], ["pausa", "pausa", "toca", "humano"], "en pausa, sin perder la caja original");
    igual([a.deTi.length, a.hilos.filter((x) => x.caja === "toca").length, a.hilos.filter((x) => x.estado === "humano").length, h.pideOk, h.opciones, h.llevar], [0, 0, 0, null, [], null], "ni deTi, ni contadores, ni pregunta");
    casa(h.motivo, /^⏸ Lo pausaste tú hasta las /, "y dice por qué");
  });
  await prueba("v577: pausa sin fecha de fin (hasta null): sigue en pausa hasta que se reanude", () => {
    const h = ver("11:00", [hilo(toca)], { apuntes: pausa(null) }).hilos[0];
    igual([h.caja, h.cajaReal], ["pausa", "toca"], "sin fin, en pausa");
  });
  await prueba("v577: pausa vencida: vuelve sola a «toca», sin rastro de la pausa", () => {
    const a = ver("11:00", [hilo(toca)], { apuntes: pausa(T("10:59")) }), h = a.hilos[0];
    igual([h.caja, h.estado, a.deTi.length, h.cajaReal, h.estadoReal], ["toca", "humano", 1, undefined, undefined], "vencida, toca");
  });
  await prueba("v577: pausa con mensaje nuevo después: la regla de siempre (la pausa manda hasta su fin); la caja original queda para la página", () => {
    const nuevo = [...toca, m("10:50:00", "Coo", "Coo: Ana insiste. [te toca: ¿Le contesto ya?]")];
    const h = ver("11:00", [hilo(nuevo)], { apuntes: pausa(T("11:00") + 86400e3) }).hilos[0];
    igual([h.caja, h.cajaReal], ["pausa", "toca"], "con mensaje nuevo, igual que antes de la v577 (marcaJ no mira mensajes en las pausas)");
    const v = ver("11:00", [hilo(nuevo)], { apuntes: pausa(T("10:55")) }).hilos[0];
    igual([v.caja, v.estado], ["toca", "humano"], "y al vencer, vuelve");
  });
  await prueba("v577: la página usa cajaReal para «Está en pausa y te toca» y su vista de pausados", () => {
    const html = require("fs").readFileSync(require("path").join(__dirname, "..", "public", "index.html"), "utf8");
    casa(html, /\["toca","esperando"\]\.includes\(h\.cajaReal\|\|h\.caja\)\) return false;/, "vivoTrasMarca");
    casa(html, /caja:h\.cajaReal\|\|h\.caja,/, "apuntaOculto");
  });
};
