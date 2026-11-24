// delegado-antes.js - el «antes» de un tema delegado no dice «nadie lo ha cogido en 3 h»: dice desde cuándo no hay movimiento. Datos inventados.
"use strict";
const S = require("../server.js");

module.exports = async ({ prueba, igual, casa, C, T, setAhora }) => {
  const { m } = C;
  const L0 = (o) => ({ arranquesCursor: [], frenos: [], avisosCoo: [], sesionHilo: {}, lanzHilo: {}, cursorSlack: [], esperas: [], ultEsc: 0, lanz: [], timbreHilo: "", traspasos: [], ...(o || {}) });
  const SI = { no: {}, apagado: false };
  const ver = (ms, L) => { setAhora(ms); return S.analizar([{ ts: R.ts, msgs: [R, E] }], L0(L), null, null, []).hilos[0]; };
  const R = m("09:00:00", "Charla", "Hilo: Proyecto Uno · DEMO-1404\nObjetivo: revisar el ejemplo\nOrigen: Chat");
  const E = m("14:48:00", "Coo", "Coo: lo miramos. [lo hace: Claude — revisar el ejemplo]");
  const t0 = T("14:48");

  console.log("v578: el «antes» del delegado sale de la situación de ahora");
  await prueba("v578: delegado reciente (esperando a Ana desde hace 1 h): el «antes» queda como estaba, sin frase de olvido", () => {
    const W = m("14:48:00", "Coo", "Coo: He escrito a Ana. Quedamos a la espera de que Ana confirme el dato.");
    setAhora(t0 + 60 * 60e3);
    const h = S.analizar([{ ts: R.ts, msgs: [R, W] }], L0({ sfAuto: SI }), null, null, []).hilos[0];
    igual([h.estado, h.delegado.quien, h.delegado.auto], ["pausa", "coord-salesforce", true], "delegado");
    casa(h.delegado.antes, /^⏸ Esperando a Ana desde las 14:48/, "el «antes» de siempre");
    igual(/nadie lo ha cogido|sin movimiento/.test(h.delegado.antes), false, "sin frase de olvido");
  });
  await prueba("v578: encargo a Claude de hace 1 h (aún no son 3 h): no se delega ni cambia nada", () => {
    const h = ver(t0 + 60 * 60e3, { sfAuto: SI });
    igual([h.estado, h.delegado], ["parado", undefined], "sin delegar (parado a los 20 min, aún sin frase de 3 h)");
  });
  await prueba("v578: delegado realmente parado (1 día y 19 h): dice desde cuándo, con la fecha del último mensaje y sin «en 3 h»", () => {
    const h = ver(t0 + (43 * 60 + 5) * 60e3, { sfAuto: SI });
    igual(h.estado, "pausa", "delegado");
    casa(h.delegado.antes, /^➡️ Claude: revisar el ejemplo.* — sin movimiento desde el \d\d\/\d\d 14:48$/, "fecha del último mensaje");
    igual(/en 3 h|nadie lo ha cogido|hace/.test(h.delegado.antes), false, "ni «en 3 h», ni «nadie», ni «hace»");
  });
  await prueba("v578: sin mensajes nuevos, el texto y la huella de coord-salesforce son idénticos a dos horas distintas (no se reescribe el fichero cada hora)", () => {
    const a = ver(t0 + 5 * 3600e3 + 60e3, { sfAuto: SI }), b = ver(t0 + 3 * 86400e3 + 60e3, { sfAuto: SI }), huella = require("../coordinadores.js").huellaSF;
    igual(a.delegado.antes, b.delegado.antes, "mismo `antes`");
    igual(huella([a]), huella([b]), "misma huella");
    casa(a.delegado.antes, / — sin movimiento desde el \d\d\/\d\d 14:48$/, "y es el de «sin movimiento»");
  });
  await prueba("v578: sin delegar (sin sfAuto) el motivo no cambia: sigue «nadie lo ha cogido en 3 h»", () => {
    const h = ver(t0 + (43 * 60 + 5) * 60e3);
    igual([h.estado, h.delegado], ["olvidado", undefined], "sin delegar");
    casa(h.motivo, /^➡️ Claude: revisar el ejemplo.* — nadie lo ha cogido en 3 h$/, "motivo de siempre");
  });
};
