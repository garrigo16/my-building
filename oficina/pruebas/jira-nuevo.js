// jira-nuevo.js — vigía Jira «Nuevo» y estado nuevo en analizar() (dobles, sin red)
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const S = require("../server.js");

const FIXTURE = path.join(os.homedir(), ".codex", "oca", "evidencias", "OFICINA-JIRA-NUEVO", "20261125-1310", "jira-real-SFEI-1478-1377.json");
const CORTE_REAL = new Date("2026-11-24T11:15:00+01:00").getTime();
const YO = "712020:9a0593ee-df53-4d5c-a373-78baf2c63882";

module.exports = async ({ prueba, igual, casa, C, T, setAhora, oficina }) => {
  const tmp = () => path.join(os.tmpdir(), "jira-vistos-" + Date.now() + "-" + Math.random().toString(36).slice(2) + ".json");
  const auth = "Basic fake";
  const posts = [];
  let apiCalls = [];

  const apiFake = async (u, b) => {
    apiCalls.push({ u, b });
    if (u === "/rest/api/3/myself") return { accountId: YO, timeZone: "Europe/Madrid" };
    if (u.includes("/changelog")) return { values: [], isLast: true, total: 0 };
    if (b && b.jql && /SFEI-1478/.test(JSON.stringify(b))) {
      const j = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
      return j;
    }
    if (b && b.jql && /statusCategory = "To Do"/.test(b.jql)) {
      return { issues: [] };
    }
  return { issues: [] };
  };

  const issueToDo = (key, created) => ({
    key,
    fields: {
      summary: "Ticket de prueba " + key,
      status: { name: "Nueva", statusCategory: { key: "new" } },
      issuetype: { name: "Tarea" },
      priority: { name: "Media" },
      reporter: { displayName: "Ana", accountId: "x1" },
      creator: { displayName: "Ana", accountId: "x1" },
      created,
      updated: created,
      assignee: { accountId: YO, displayName: "Miquel" },
      description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Detalle ADF de prueba" }] }] },
    },
  });

  console.log("vNNN: Jira Nuevo — corte, publicación, analizar y kanban");

  await prueba("primera pasada: fija corteNuevo y no publica", async () => {
    const JIRA_F = tmp();
    const t0 = Date.parse("2026-11-20T10:00:00+01:00");
    setAhora(t0);
    const n = await S.jiraVigia({ JIRA_F, auth, api: apiFake, publicar: async () => ({ ok: true, ts: "1" }), ahora: () => t0, hilos: [], conTurno: () => true });
    igual(n, 0, "sin publicar");
    const v = JSON.parse(fs.readFileSync(JIRA_F, "utf8"));
    igual(v.corteNuevo, t0, "corte");
    igual(posts.length, 0, "sin posts");
  });

  await prueba("ticket To Do tras el corte publica mensaje Nuevo", async () => {
    const JIRA_F = tmp();
    const corte = Date.parse("2026-11-20T10:00:00+01:00");
    const creado = "2026-11-20T12:00:00+01:00";
    fs.writeFileSync(JIRA_F, JSON.stringify({ corteNuevo: corte, desde: corte - 1e7, vistos: {}, asignadas: {}, yo: YO, tz: "Europe/Madrid", base: true }));
    const posts2 = [];
    const api2 = async (u, b) => {
      if (u === "/rest/api/3/myself") return { accountId: YO, timeZone: "Europe/Madrid" };
      if (b && b.jql && /statusCategory = "To Do"/.test(b.jql)) return { issues: [issueToDo("TST-100", creado)] };
      if (b && b.jql && /updated >= -1d/.test(b.jql)) return { issues: [] };
      if (b && b.jql && /key in/.test(b.jql)) return { issues: [] };
      return apiFake(u, b);
    };
    const pub = async (texto) => { posts2.push(texto); return { ok: true, ts: "111.222" }; };
    setAhora(Date.parse(creado) + 60e3);
    await S.jiraVigia({ JIRA_F, auth, api: api2, publicar: pub, ahora: () => Date.parse(creado) + 60e3, hilos: [], conTurno: () => true });
    casa(posts2[0], /\*Hilo: TST-100/, "titulo");
    casa(posts2[0], /📥 Origen: Jira/, "origen");
    casa(posts2[0], /🆕 Nuevo de Jira/, "marca");
    casa(posts2[0], /browse\/TST-100/, "enlace");
    const v = JSON.parse(fs.readFileSync(JIRA_F, "utf8"));
    igual(!!v.nuevos["TST-100"], true, "dedup en json");
    const raiz = posts2[0];
    const h = { ts: C.ts("12:01"), msgs: [C.m("12:01", "Humano", raiz)] };
    const a = oficina("12:05", [h]);
    const th = a.hilos[0];
    igual([th.estado, th.caja], ["nuevo", "nuevo"], "analizar");
    igual(a.deTi.length, 0, "fuera de deTi");
  });

  await prueba("segunda pasada misma issue: sin post nuevo", async () => {
    const JIRA_F = tmp();
    const corte = Date.parse("2026-11-20T10:00:00+01:00");
    const creado = "2026-11-20T12:00:00+01:00";
    fs.writeFileSync(JIRA_F, JSON.stringify({ corteNuevo: corte, nuevos: { "TST-101": { t: corte, ts: corte } }, desde: corte, vistos: {}, yo: YO, tz: "Europe/Madrid", base: true }));
    const posts2 = [];
    const api2 = async (u, b) => {
      if (b && b.jql && /statusCategory = "To Do"/.test(b.jql)) return { issues: [issueToDo("TST-101", creado)] };
      if (b && b.jql && /updated >= -1d/.test(b.jql)) return { issues: [] };
      return { issues: [] };
    };
    await S.jiraVigia({ JIRA_F, auth, api: api2, publicar: async (t) => { posts2.push(t); return { ok: true, ts: "x" }; }, hilos: [], conTurno: () => true });
    igual(posts2.length, 0, "sin duplicar");
  });

  await prueba("indeterminate no se publica", async () => {
    const JIRA_F = tmp();
    const corte = Date.parse("2026-11-20T10:00:00+01:00");
    fs.writeFileSync(JIRA_F, JSON.stringify({ corteNuevo: corte, desde: corte, vistos: {}, yo: YO, tz: "Europe/Madrid", base: true }));
    const posts2 = [];
    const i = issueToDo("TST-200", "2026-11-20T14:00:00+01:00");
    i.fields.status.statusCategory.key = "indeterminate";
    const api2 = async (u, b) => {
      if (b && b.jql && /To Do/.test(b.jql)) return { issues: [i] };
      return { issues: [] };
    };
    await S.jiraVigia({ JIRA_F, auth, api: api2, publicar: async (t) => { posts2.push(t); return { ok: true }; }, hilos: [], conTurno: () => true });
    igual(posts2.length, 0, "sin publicar indeterminate");
  });

  await prueba("sin token: sin error y aviso", async () => {
    S.resetJiraSinToken();
    await S.jiraVigia({ JIRA_F: tmp(), auth: null, api: apiFake });
    casa(S.verErroresJira(), /Jira sin token/, "aviso");
  });

  await prueba("transición humano y [te toca] pasan a humano", () => {
    const raiz = `*Hilo: ABC-1 · tema*\n🎯 Objetivo: revisar el ticket nuevo ABC-1 de Jira\n📥 Origen: Jira · Ana\n🆕 Nuevo de Jira\n🔗 https://x/browse/ABC-1`;
    const h0 = { ts: C.ts("10:00"), msgs: [C.m("10:00", "Humano", raiz)] };
    let a = oficina("10:30", [h0]);
    igual(a.hilos[0].estado, "nuevo", "empieza nuevo");
    const h1 = { ts: h0.ts, msgs: [...h0.msgs, C.m("10:20", "Humano", "[te toca]")] };
    a = oficina("10:30", [h1]);
    igual([a.hilos[0].estado, a.hilos[0].caja], ["humano", "toca"], "pasa a te toca");
  });

  await prueba("vencimiento 4 h pasa a humano", () => {
    const raiz = `*Hilo: ABC-2 · tema*\n🎯 Objetivo: revisar el ticket nuevo ABC-2 de Jira\n📥 Origen: Jira · Ana\n🆕 Nuevo de Jira`;
    const h0 = { ts: C.ts("10:00"), msgs: [C.m("10:00", "Humano", raiz)] };
    const a = oficina("15:01", [h0]);
    igual(a.hilos[0].estado, "humano", "vence a las 4 h");
  });

  await prueba("done en Jira cierra", () => {
    const raiz = `*Hilo: ABC-3 · tema*\n🎯 Objetivo: revisar el ticket nuevo ABC-3 de Jira\n📥 Origen: Jira · Ana\n🆕 Nuevo de Jira`;
    const h0 = { ts: C.ts("10:00"), msgs: [C.m("10:00", "Humano", raiz)] };
    S.setJiraSalidas({ "ABC-3": { t: Date.parse("2026-11-20T11:00:00+01:00"), m: "done" } });
    const a = oficina("10:30", [h0]);
    igual(a.hilos[0].estado, "cerrado", "cerrado");
    S.setJiraSalidas({});
  });

  if (fs.existsSync(FIXTURE)) {
    await prueba("prueba real SFEI-1478/1377 con fixture", async () => {
      const JIRA_F = tmp();
      fs.writeFileSync(JIRA_F, JSON.stringify({ desde: CORTE_REAL - 1e7, vistos: {}, asignadas: {} }));
      const posts2 = [];
      const apiR = async (u, b) => {
        if (u === "/rest/api/3/myself") return { accountId: YO, timeZone: "Europe/Madrid" };
        if (b && b.jql && /statusCategory = "To Do"/.test(b.jql)) return JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
        if (b && b.jql && /updated >= -1d/.test(b.jql)) return { issues: [] };
        return { issues: [] };
      };
      setAhora(CORTE_REAL);
      await S.jiraVigia({ JIRA_F, auth, api: apiR, publicar: async () => ({ ok: true, ts: "99" }), ahora: () => CORTE_REAL, hilos: [], conTurno: () => true });
      const v = JSON.parse(fs.readFileSync(JIRA_F, "utf8"));
      igual(v.corteNuevo, CORTE_REAL, "corte fijado");
      setAhora(Date.parse("2026-11-24T12:00:00+01:00"));
      await S.jiraVigia({ JIRA_F, auth, api: apiR, publicar: async (t) => { posts2.push(t); return { ok: true, ts: "100" }; }, ahora: () => Date.parse("2026-11-24T12:00:00+01:00"), hilos: [], conTurno: () => true });
      igual(posts2.length, 1, "un post");
      casa(posts2[0], /SFEI-1478/, "1478");
      const h = { ts: C.ts("12:00"), msgs: [C.m("12:00", "Humano", posts2[0])] };
      const a = oficina("12:05", [h]);
      igual(a.hilos[0].estado, "nuevo", "en nuevo");
      posts2.length = 0;
      await S.jiraVigia({ JIRA_F, auth, api: apiR, publicar: async (t) => { posts2.push(t); return { ok: true }; }, ahora: () => Date.parse("2026-11-24T12:10:00+01:00"), hilos: a.hilos, conTurno: () => true });
      igual(posts2.length, 0, "sin duplicar segunda pasada");
    });
  } else {
    console.log("  (fixture real no encontrado: se salta caso SFEI)");
  }

  await prueba("kanban: columna Nuevo primera", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
    casa(html, /const COLS_K=\[\["Nuevo","nuevo"/, "COLS_K");
    casa(html, /const KG_COLS=\[\["NUEVO","nuevo"/, "KG_COLS");
  });
};