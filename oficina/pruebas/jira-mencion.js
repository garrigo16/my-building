// jira-mencion.js — menciones de Jira en tickets que no son nuevos: respuesta en el hilo existente o tema sin 🆕 (dobles, sin red)
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const S = require("../server.js");

const YO = "712020:9a0593ee-df53-4d5c-a373-78baf2c63882";

module.exports = async ({ prueba, igual, casa, C, setAhora, oficina }) => {
  const tmp = () => path.join(os.tmpdir(), "jira-mencion-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".json");
  const auth = "Basic fake";
  const corte = Date.parse("2026-11-20T10:00:00+01:00");
  const ahoraT = Date.parse("2026-11-26T16:54:00+01:00");
  const creadoC = "2026-11-26T16:50:00+01:00";

  const ticket = (key, cat, nombre) => ({
    key,
    fields: {
      summary: "[CORE] Corregir algo " + key,
      status: { name: nombre, statusCategory: { key: cat } },
      issuetype: { name: "Tarea" }, priority: { name: "Media" },
      reporter: { displayName: "Ana", accountId: "x1" }, creator: { displayName: "Ana", accountId: "x1" },
      created: "2026-11-10T10:00:00+01:00", updated: creadoC,
      assignee: { accountId: YO, displayName: "Miquel" },
      description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Detalle" }] }] },
      comment: { comments: [{ id: "1191398", created: creadoC, author: { accountId: "x2", displayName: "Victoria Nardone" },
        body: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "mention", attrs: { id: YO } }, { type: "text", text: " validado en QA, ya se puede subir" }] }] } }] },
    },
  });

  // Una pasada del vigía con una mención; devuelve los envíos [{ texto, opc }]
  const pasada = async (issues, hilos) => {
    const JIRA_F = tmp(), envios = [];
    fs.writeFileSync(JIRA_F, JSON.stringify({ corteNuevo: corte, desde: corte, vistos: {}, asignadas: {}, nuevos: {}, yo: YO, tz: "Europe/Madrid", base: true }));
    const api = async (u, b) => {
      if (u === "/rest/api/3/myself") return { accountId: YO, timeZone: "Europe/Madrid" };
      if (b && b.jql && /updated >= -1d/.test(b.jql)) return { issues };
      return { issues: [] };
    };
    setAhora(ahoraT);
    await S.jiraVigia({ JIRA_F, auth, api, ahora: () => ahoraT, hilos, conTurno: () => true,
      publicar: async (texto, opc) => { envios.push({ texto, opc }); return { ok: true, ts: "1795708439.919069" }; } });
    return envios;
  };

  const tema = (key, ts, estado, caja, tSlack) => ({ titulo: "Revisar continuación " + key, ts, estado, caja, tSlack: tSlack || Number(ts) * 1000 });

  console.log("vNNN: Jira mención — respuesta en el hilo del ticket o tema sin marca de nuevo");

  await prueba("mención sin tema previo: tema sin 🆕 y analizar() no lo deja en nuevo", async () => {
    const envios = await pasada([ticket("SFEI-1294", "indeterminate", "Pendiente de prod")], []);
    igual(envios.length, 1, "un post");
    igual(envios[0].opc, undefined, "sin thread_ts: tema nuevo");
    casa(envios[0].texto, /\*Hilo: SFEI-1294/, "cabecera");
    igual(/🆕|:new:|Nuevo de Jira/.test(envios[0].texto), false, "sin marca de nuevo");
    casa(envios[0].texto, /focusedCommentId=1191398/, "enlace al comentario");
    const h = { ts: C.ts("16:54"), msgs: [C.m("16:54", "Humano", envios[0].texto)] };
    const a = oficina("17:00", [h]);
    const th = a.hilos[0];
    igual(th.estado === "nuevo" || th.caja === "nuevo", false, "no está en Nuevo");
    igual([th.estado, th.caja], ["humano", "toca"], "humano / te toca");
    igual(/^📥\s*nuevo de /i.test(th.motivo), false, "motivo no empieza por «nuevo de»");
    casa(th.motivo, /^📥 mención de Jira:/, "motivo de mención");
  });

  await prueba("mención en ticket con tema abierto: una respuesta en su hilo, sin 🆕 ni «Hilo:»", async () => {
    const envios = await pasada([ticket("SFEI-1294", "indeterminate", "Pendiente de prod")], [tema("SFEI-1294", "1795531709.903399", "espera_ia", "esperando")]);
    igual(envios.length, 1, "un solo post");
    igual(envios[0].opc && envios[0].opc.thread_ts, "1795531709.903399", "thread_ts del tema");
    igual(/🆕|:new:|Nuevo de Jira|Hilo:/.test(envios[0].texto), false, "sin cabecera ni marca");
    casa(envios[0].texto, /Victoria Nardone/, "autor");
    casa(envios[0].texto, /validado en QA/, "comentario");
    casa(envios[0].texto, /browse\/SFEI-1294\?focusedCommentId=1191398/, "enlace");
  });

  await prueba("tema abierto y tema cerrado de la misma clave: responde en el abierto", async () => {
    const hilos = [tema("SFEI-1294", "1795000000.000001", "cerrado", "cerrado", 1795999999000), tema("SFEI-1294", "1795531709.903399", "humano", "toca", 1795531709000)];
    const envios = await pasada([ticket("SFEI-1294", "indeterminate", "Pendiente de prod")], hilos);
    igual(envios.length, 1, "un post");
    igual(envios[0].opc && envios[0].opc.thread_ts, "1795531709.903399", "el abierto");
  });

  await prueba("varios abiertos: el de actividad más reciente", () => {
    const hilos = [tema("SFEI-1294", "1795100000.000001", "humano", "toca", 1795100000000), tema("SFEI-1294", "1795200000.000001", "espera_ia", "esperando", 1795300000000), tema("OTRO-1", "1795400000.000001", "humano", "toca")];
    igual(S.jiraHiloDeClave(hilos, "SFEI-1294").ts, "1795200000.000001", "más reciente");
    igual(S.jiraHiloDeClave([tema("SFEI-1294", "1.1", "olvidado", "cerrado")], "SFEI-1294"), null, "solo cerrados: ninguno");
    igual(S.jiraClaveEnHilos(hilos, "SFEI-1294"), true, "jiraClaveEnHilos sigue igual");
  });

  await prueba("solo hay temas cerrados: tema nuevo sin 🆕", async () => {
    const envios = await pasada([ticket("SFEI-1294", "indeterminate", "Pendiente de prod")], [tema("SFEI-1294", "1795000000.000001", "cerrado", "cerrado")]);
    igual(envios.length, 1, "un post");
    igual(envios[0].opc, undefined, "sin thread_ts");
    casa(envios[0].texto, /\*Hilo: SFEI-1294/, "tema nuevo");
    igual(/🆕|:new:|Nuevo de Jira/.test(envios[0].texto), false, "sin marca");
  });

  await prueba("asignación de Jira sin 🆕: motivo «asignación de Jira» y fuera de Nuevo", () => {
    const raiz = `*Hilo: SFEI-1500 · algo*\n🎯 Objetivo: contestar o atender lo que pide Ana en Jira (te la han asignado)\n📥 Origen: Jira · Ana\n\nDetalle\n\n🔗 https://x/browse/SFEI-1500`;
    const a = oficina("17:00", [{ ts: C.ts("16:54"), msgs: [C.m("16:54", "Humano", raiz)] }]);
    igual(a.hilos[0].estado === "nuevo" || a.hilos[0].caja === "nuevo", false, "no está en Nuevo");
    casa(a.hilos[0].motivo, /^📥 asignación de Jira:/, "motivo de asignación");
  });

  await prueba("ticket realmente nuevo (🆕) sigue en la columna Nuevo", () => {
    const raiz = `*Hilo: ABC-7 · tema*\n🎯 Objetivo: revisar el ticket nuevo ABC-7 de Jira\n📥 Origen: Jira · Ana\n🆕 Nuevo de Jira\n🔗 https://x/browse/ABC-7`;
    const a = oficina("16:58", [{ ts: C.ts("16:54"), msgs: [C.m("16:54", "Humano", raiz)] }]);
    igual([a.hilos[0].estado, a.hilos[0].caja], ["nuevo", "nuevo"], "columna Nuevo");
    igual(a.deTi.length, 0, "fuera de Te toca");
  });
};
