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

  // Pasarela api.atlassian.com: fetch inyectado (sin api), sin red
  const SITIO = "https://ocaglobal.atlassian.net", CLOUD = "672ec942-a5f0-4394-ab76-11c77a59769e";
  const PASA = "https://api.atlassian.com/ex/jira/" + CLOUD;
  const resp = (status, cuerpo) => ({ ok: status >= 200 && status < 300, status, json: async () => cuerpo });
  const fetchFake = ({ tenant = 200, pasarela = 200, sitio = 200 } = {}) => {
    const urls = [];
    const f = async (url, op) => {
      urls.push(url);
      if (url === SITIO + "/_edge/tenant_info") { if (tenant === "red") throw new Error("ECONNRESET"); return resp(tenant, { cloudId: CLOUD }); }
      const st = url.startsWith(PASA) ? pasarela : url.startsWith(SITIO) ? sitio : 599;
      if (st === "red") throw new Error("ECONNRESET");
      if (st !== 200) return resp(st, {});
      const u = url.replace(PASA, "").replace(SITIO, ""), b = op && op.body ? JSON.parse(op.body) : null;
      if (u === "/rest/api/3/myself") return resp(200, { accountId: YO, timeZone: "Europe/Madrid" });
      if (b && b.jql && /statusCategory = "To Do"/.test(b.jql)) return resp(200, { issues: [issueToDo("TST-300", "2026-11-20T12:00:00+01:00")] });
      return resp(200, { issues: [] });
    };
    f.urls = urls; return f;
  };
  const pasadaFetch = async (fetchFn, cfgJira = {}) => {
    const JIRA_F = tmp(), corte = Date.parse("2026-11-20T10:00:00+01:00"), posts2 = [];
    fs.writeFileSync(JIRA_F, JSON.stringify({ corteNuevo: corte, desde: corte - 1e7, vistos: {}, asignadas: {}, tz: "Europe/Madrid", base: true }));
    const env = process.env.JIRA_CLOUD_ID; delete process.env.JIRA_CLOUD_ID; S.sinJiraCloudIds();
    try {
      await S.jiraVigia({ JIRA_F, auth, JIRA_SITE: SITIO, fetch: fetchFn, cfgJira, publicar: async (t) => { posts2.push(t); return { ok: true, ts: "1" }; },
        ahora: () => Date.parse("2026-11-20T12:01:00+01:00"), hilos: [], conTurno: () => true });
    } finally { if (env !== undefined) process.env.JIRA_CLOUD_ID = env; }
    return { posts2, rest: fetchFn.urls.filter((x) => /\/rest\//.test(x)) };
  };

  await prueba("pasarela: con tenant_info, la API va a api.atlassian.com y el enlace al sitio", async () => {
    const f = fetchFake();
    const { posts2, rest } = await pasadaFetch(f);
    igual(f.urls[0], SITIO + "/_edge/tenant_info", "pide tenant_info");
    igual(rest.length > 0 && rest.every((x) => x.startsWith(PASA + "/rest/api/3/")), true, "REST por la pasarela");
    igual(posts2.length, 1, "un post");
    casa(posts2[0], /🔗 https:\/\/ocaglobal\.atlassian\.net\/browse\/TST-300/, "enlace en el sitio");
    igual(/api\.atlassian\.com/.test(posts2[0]), false, "sin pasarela en el enlace");
  });

  await prueba("pasarela: JIRA_CLOUD_ID en la config evita tenant_info", async () => {
    const f = fetchFake({ tenant: 500 });
    const { rest } = await pasadaFetch(f, { JIRA_CLOUD_ID: CLOUD });
    igual(f.urls.includes(SITIO + "/_edge/tenant_info"), false, "sin tenant_info");
    igual(rest.every((x) => x.startsWith(PASA)), true, "REST por la pasarela");
  });

  await prueba("pasarela: tenant_info cachea el cloudId", async () => {
    S.sinJiraCloudIds();
    const env = process.env.JIRA_CLOUD_ID; delete process.env.JIRA_CLOUD_ID;
    try {
      const f = fetchFake();
      igual(await S.jiraCloudId(SITIO, f, {}), CLOUD, "primera");
      igual(await S.jiraCloudId(SITIO, f, {}), CLOUD, "segunda");
      igual(f.urls.length, 1, "una sola llamada");
    } finally { if (env !== undefined) process.env.JIRA_CLOUD_ID = env; S.sinJiraCloudIds(); }
  });

  await prueba("pasarela: si tenant_info falla, se usa el sitio", async () => {
    for (const tenant of [500, "red"]) {
      const f = fetchFake({ tenant });
      const { posts2, rest } = await pasadaFetch(f);
      igual(rest.length > 0 && rest.every((x) => x.startsWith(SITIO + "/rest/")), true, "REST al sitio (" + tenant + ")");
      igual(posts2.length, 1, "publica (" + tenant + ")");
    }
  });

  await prueba("pasarela: si la pasarela falla (401/502/red), se usa el sitio", async () => {
    for (const pasarela of [401, 502, "red"]) {
      const f = fetchFake({ pasarela });
      const { posts2, rest } = await pasadaFetch(f);
      igual(rest[0].startsWith(PASA), true, "intenta la pasarela (" + pasarela + ")");
      igual(rest.slice(1).every((x) => x.startsWith(SITIO + "/rest/")), true, "luego el sitio (" + pasarela + ")");
      igual(posts2.length, 1, "publica (" + pasarela + ")");
      casa(posts2[0], /browse\/TST-300/, "enlace");
    }
  });

  await prueba("kanban: columna Nuevo primera", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
    casa(html, /const COLS_K=\[\["Nuevo","nuevo"/, "COLS_K");
    casa(html, /const KG_COLS=\[\["NUEVO","nuevo"/, "KG_COLS");
  });
};