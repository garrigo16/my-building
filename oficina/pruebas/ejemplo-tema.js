// ejemplo-tema.js - plantilla de caso: un hilo de Slack inventado y lo que la oficina tiene que decir de él.
// Copia este fichero para tu caso. Datos SIEMPRE de mentira: un tema cualquiera, una persona A, horas cualesquiera.
"use strict";

module.exports = async ({ prueba, igual, C, oficina, tema }) => {
  const { m } = C;
  console.log("ejemplo: el estado de un tema según la etiqueta del último mensaje");
  const RAIZ = m("10:00", "Humano", "*Hilo: un tema de facturación*\n@Claude mira por qué no cuadra el total");
  const ver = (hms, ...resto) => { const h = { ts: RAIZ.ts, msgs: [RAIZ, ...resto] }, t = tema(oficina(hms, [h]), h); return [t.estado, t.motivo]; };

  await prueba("recién pedido a una IA: espera a esa IA", () => {
    igual(ver("10:05"), ["espera_ia", "esperando a Claude"], "sin respuesta todavía");
  });
  await prueba("[te toca: …]: la pregunta sale tal cual para la persona", () => {
    igual(ver("10:20", m("10:10", "Claude", "*¿Corrijo el redondeo?*\n1. El total suma dos veces el descuento.\n[te toca: ¿OK a corregir el redondeo?]")),
      ["humano", "🙋 ¿OK a corregir el redondeo?"], "te toca");
  });
  await prueba("[lo hace: Cursor — …]: el siguiente paso es de otra IA", () => {
    igual(ver("10:20", m("10:10", "Claude", "Lo reviso con Cursor.\n[lo hace: Cursor — cruzar el cálculo]")), ["espera_ia", "➡️ Cursor: cruzar el cálculo"], "lo hace");
  });
  await prueba("[hecho]: cerrado", () => {
    igual(ver("10:20", m("10:10", "Claude", "Arreglado y comprobado.\n[hecho]"))[0], "cerrado", "hecho");
  });
  await prueba("[espera: la persona A — …]: en pausa hasta que conteste", () => {
    igual(ver("10:20", m("10:10", "Claude", "Falta un dato.\n[espera: la persona A — confirmar el importe]")),
      ["espera_otro", "⏸ Esperando a la persona A desde las 10:10: confirmar el importe"], "espera a un tercero");
  });
};
