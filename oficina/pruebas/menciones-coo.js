"use strict";
const S = require("../server.js");
const EJEMPLO = require("../../herramientas/config.js").EJEMPLO.slack.ias.coo;

module.exports = async ({ prueba, igual }) => {
  console.log("el @coo del panel solo es mención si hay un id real");
  await prueba("con el id de ejemplo, «@coo hola» se queda igual", async () => {
    igual(S.textoConMenciones("@coo hola", { coo: EJEMPLO }), "@coo hola", "id de ejemplo");
    igual(S.textoConMenciones("@coo hola", { coo: "" }), "@coo hola", "sin id");
    igual(S.textoConMenciones("mira (@coo) esto", {}), "mira (@coo) esto", "sin coo en el mapa");
  });
  await prueba("con un id real, «@coo hola» sale como mención", async () => {
    igual(S.textoConMenciones("@coo hola", { coo: "U0REAL00001" }), "<@U0REAL00001> hola", "id real");
    igual(S.textoConMenciones("hola @Coo y (@coo)", { coo: "U0REAL00001" }), "hola <@U0REAL00001> y (<@U0REAL00001>)", "varias, sin mirar mayúsculas");
  });
};
