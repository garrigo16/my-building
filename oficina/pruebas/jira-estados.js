// jira-estados.js — paso automático En curso / En QA en Jira según la caja del tema (dobles, sin red)
"use strict";
const S = require("../server.js");

module.exports = async ({ prueba, igual }) => {
  const llamadas = [];
  let status = { name: "Nueva petición", statusCategory: { key: "new" } };
  const api = async (u, b) => {
    llamadas.push((b ? "POST " : "GET ") + u + (b ? " " + JSON.stringify(b) : ""));
    if (/\/transitions$/.test(u) && !b) return { transitions: [{ id: "11", name: "Iniciar", to: { name: "En curso" } }, { id: "21", name: "A QA", to: { name: "En QA" } }] };
    if (/\?fields=status/.test(u)) return { fields: { status } };
    return {};
  };
  const v = {}, claves = ["SFEI-1"];
  const hilo = (caja, motivo) => [{ titulo: "SFEI-1 · prueba", caja, motivo: motivo || "" }];
  await prueba("estados Jira: primera vez en Nuevo solo se anota", async () => {
    await S.jiraSincronizaEstados({ hilos: hilo("nuevo"), claves, api, v, ahora: 1 });
    igual(llamadas.length, 0); igual(v.trans["SFEI-1"].visto, "nuevo");
  });
  await prueba("estados Jira: sale de Nuevo -> En curso (una sola vez)", async () => {
    await S.jiraSincronizaEstados({ hilos: hilo("trabajando"), claves, api, v, ahora: 2 });
    await S.jiraSincronizaEstados({ hilos: hilo("trabajando"), claves, api, v, ahora: 3 });
    igual(llamadas.filter((x) => x.startsWith("POST")).join("|"), 'POST /rest/api/3/issue/SFEI-1/transitions {"transition":{"id":"11"}}');
  });
  await prueba("estados Jira: cerrado con hecho -> En QA", async () => {
    status = { name: "En curso", statusCategory: { key: "indeterminate" } };
    await S.jiraSincronizaEstados({ hilos: hilo("cerrado", "✔ cerrado en el hilo (hecho)"), claves, api, v, ahora: 4 });
    igual(llamadas.filter((x) => x.startsWith("POST")).pop(), 'POST /rest/api/3/issue/SFEI-1/transitions {"transition":{"id":"21"}}');
  });
  await prueba("estados Jira: tema que ya estaba en marcha no se toca", async () => {
    const n = llamadas.length, v2 = {};
    await S.jiraSincronizaEstados({ hilos: [{ titulo: "SFEI-2 · x", caja: "trabajando" }], claves: ["SFEI-2"], api, v: v2, ahora: 1 });
    await S.jiraSincronizaEstados({ hilos: [{ titulo: "SFEI-2 · x", caja: "cerrado", motivo: "✔ cerrado en el hilo" }], claves: ["SFEI-2"], api, v: v2, ahora: 2 });
    igual(llamadas.length, n);
  });
};
