"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const F = path.join(os.homedir(), ".oficina", "privados.json");
const AVISO = /\ble he (preguntado|escrito|mandado(?: un mensaje)?|pasado|enviado)\b[^.\n]{0,30}?\ba ([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)\b[^.\n]{0,80}?\b(por (slack|privado|dm|mensaje)|en privado|por mensaje privado)\b/i;
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// v554: para separar lo que es de otro asunto
const SALUDO = /^\s*(hola+|holi+|holis|buenas|buenos dias|buen dia|ey+|hey+|oye|una cosa|otra cosa)\b/;
const refsDe = (t) => { const s = String(t || ""), out = [];
  for (const m of s.matchAll(/pull-requests\/(\d+)|\bPR\s*#?(\d{3,})|#(\d{4,})\b/gi)) out.push(m[1] || m[2] || m[3]);
  for (const m of s.matchAll(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g)) out.push(m[0]);
  return [...new Set(out)]; };
const limpiaSlack = (t) => String(t || "").replace(/<@[A-Z0-9]+>/g, "@").replace(/<(https?:\/\/[^|>]+)\|([^>]+)>/g, "$2").replace(/<(https?:\/\/[^>]+)>/g, "$1").replace(/\n/g, " ").trim();
function resumen(t) {
  const s = limpiaSlack(t), refs = refsDe(t);
  const pr = refs.find((r) => /^\d+$/.test(r)), tk = refs.find((r) => /-/.test(r));
  const quita = s.replace(/https?:\/\/\S+|\b[\w-]+(\.[\w-]+)+\/\S*/g, "").replace(tk ? new RegExp("\\b(para|de|en|sobre|con|lo de)?\\s*" + tk + "\\b[:,]?", "g") : /$^/, "").replace(/\s+/g, " ").replace(/^\s*(hola+|holi+|holis|buenas|buenos d[ií]as|ey+|hey+|oye)[\s,!.:]*/i, "").replace(/^\s*[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+,\s*/, "");
  const palabras = quita.replace(/[:;,.!?¿¡]+\s*$/, "").split(/\s+/).filter(Boolean).slice(0, 10).join(" ").replace(/[:;,]+$/, "");
  return [tk, pr && "PR " + pr].filter(Boolean).join(" · ") + (palabras ? ((tk || pr) ? ": " : "") + palabras : "");
}

function lee() { try { return JSON.parse(fs.readFileSync(F, "utf8")); } catch (e) { return { avisos: {}, usuarios: null, usuariosT: 0 }; } }
function guarda(v) { try { fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F + ".tmp", JSON.stringify(v)); fs.renameSync(F + ".tmp", F); } catch (e) {} }

async function slack(metodo, params, tok) {
  const r = await fetch("https://slack.com/api/" + metodo, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const j = await r.json();
  if (!j.ok) { const e = new Error(metodo + ": " + j.error + (j.needed ? " (falta el permiso " + j.needed + ")" : "")); e.slack = j.error; throw e; }
  return j;
}

function encaja(u, nombre) {
  const n = sinTildes(nombre); if (n.length < 3) return false;
  const nombres = [u.real_name, u.profile && u.profile.display_name, u.profile && u.profile.real_name, u.name].filter(Boolean).map(sinTildes);
  return nombres.some((x) => x.split(/[\s._-]+/).some((p) => p && (p === n || p.startsWith(n) || (n.startsWith(p) && p.length >= 3))));
}

// hilos: [{ts, msgs:[{ts, quien, texto}]}] de #canal-humano; ctx: {tokUser, tokBot, CH, HUMANO, IAS, anota}
async function vigila(hilos, ctx) {
  const { tokUser, tokBot, CH, HUMANO, IAS, anota } = ctx;
  if (!tokUser || !tokBot) return;
  const v = lee(); v.avisos = v.avisos || {};
  const ahora = Date.now();
  v.reclamos = v.reclamos || {}; v.duenos = v.duenos || {}; v.hechos = v.hechos || {}; v.cursor = v.cursor || {};
  for (const a of Object.values(v.avisos)) if (a.dm && !a.desdeIA) a.desdeIA = String(Math.min(parseFloat(a.desde || a.avisoTs), parseFloat(a.avisoTs)));
  const avisoDe = (hilo, persona) => Object.values(v.avisos).filter((x) => x.hilo === hilo && x.dm && (!persona || x.persona === persona || sinTildes(x.persona).startsWith(sinTildes(persona).split(" ")[0])))
    .sort((x, y) => parseFloat(y.avisoTs) - parseFloat(x.avisoTs))[0];
  const ponDueno = (hilo, ts, persona) => {
    const a = avisoDe(hilo, persona) || avisoDe(hilo); if (!a) return null;
    const l = v.duenos[a.dm] = v.duenos[a.dm] || []; if (!l.some((d) => d.t === ts)) l.push({ t: ts, hilo }); a.estado = "vigilar"; return a;
  };
  if (!v.duenosMigrado) { for (const k of Object.keys(v.reclamos)) { const [hilo, ts] = k.split("|"); ponDueno(hilo, ts); } v.duenosMigrado = true; }
  for (const h of hilos || []) for (const m of h.msgs || []) {
    if (!m.privJ) continue;
    const k = h.ts + "|" + m.ts; if (v.reclamos[k]) continue;
    v.reclamos[k] = ahora;
    const a = ponDueno(h.ts, m.ts, m.privJ);
    if (a && anota) anota(`PRIVADO: lo que conteste ${a.persona} desde las ${new Date(parseFloat(m.ts) * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" })} va al hilo ${h.ts} (Humano le escribió desde ahí)`);
  }
  for (const [k, t] of Object.entries(v.reclamos)) if (ahora - t > 7 * 86400e3) delete v.reclamos[k];
  const relevo = {};
  for (const h of hilos || []) {
    const u = (String(((h.msgs || [])[0] || {}).texto || "").match(/Viene de:\s*<?(https?:\/\/[^\s>|]+)/) || [])[1] || "";
    const m1 = u.match(/thread_ts=(\d+\.\d+)/), m2 = u.match(/\/p(\d{10})(\d{6})/);
    const viejo = m1 ? m1[1] : m2 ? `${m2[1]}.${m2[2]}` : ""; if (viejo && viejo !== h.ts) relevo[viejo] = h.ts;
  }
  const sigue = (hilo) => { for (let i = 0; i < 6 && relevo[hilo]; i++) hilo = relevo[hilo]; return hilo; };
  // 1. avisos nuevos de las IAs (últimas 48 h)
  for (const h of hilos || []) for (const m of h.msgs || []) {
    if (!IAS.includes(m.quien)) continue;
    const t = parseFloat(m.ts) * 1000; if (ahora - t > 48 * 3600e3) continue;
    const k = h.ts + "|" + m.ts; if (v.avisos[k]) continue;
    const mm = String(m.texto || "").match(AVISO); if (!mm) continue;
    v.avisos[k] = { hilo: h.ts, avisoTs: m.ts, nombre: mm[2], ia: m.quien, estado: "buscar" };
  }
  // 2. localizar el privado de cada aviso pendiente
  const porBuscar = Object.values(v.avisos).filter((a) => a.estado === "buscar");
  if (porBuscar.length) {
    if (!v.usuarios || ahora - (v.usuariosT || 0) > 24 * 3600e3) {
      let us = [], cur = "";
      do { const j = await slack("users.list", { limit: "200", ...(cur ? { cursor: cur } : {}) }, tokUser); us.push(...(j.members || [])); cur = j.response_metadata && j.response_metadata.next_cursor; } while (cur);
      v.usuarios = us.filter((u) => !u.deleted && !u.is_bot && u.id !== "USLACKBOT").map((u) => ({ id: u.id, real_name: u.real_name, name: u.name, profile: { display_name: u.profile && u.profile.display_name, real_name: u.profile && u.profile.real_name } }));
      v.usuariosT = ahora;
    }
    let ims = [], cur = "";
    do { const j = await slack("conversations.list", { types: "im", limit: "200", ...(cur ? { cursor: cur } : {}) }, tokUser); ims.push(...(j.channels || [])); cur = j.response_metadata && j.response_metadata.next_cursor; } while (cur);
    const imDe = Object.fromEntries(ims.map((c) => [c.user, c.id]));
    for (const a of porBuscar) {
      const t = parseFloat(a.avisoTs);
      const cands = v.usuarios.filter((u) => u.id !== HUMANO && encaja(u, a.nombre) && imDe[u.id]).slice(0, 6);
      let hallado = null;
      for (const u of cands) {
        const j = await slack("conversations.history", { channel: imDe[u.id], oldest: String(t - 600), latest: String(t + 600), inclusive: "true", limit: "20" }, tokUser);
        const mio = (j.messages || []).filter((x) => x.user === HUMANO && (x.app_id || /Enviado usando/i.test(x.text || ""))).sort((x, y) => parseFloat(y.ts) - parseFloat(x.ts))[0];
        if (mio) { hallado = { dm: imDe[u.id], persona: u.real_name || u.name, desde: mio.ts }; break; }
      }
      if (hallado) Object.assign(a, hallado, { estado: "vigilar", ultimo: hallado.desde, desdeIA: hallado.desde });
      else if (ahora - t * 1000 > 2 * 3600e3) a.estado = "no_encontrado";   // lo reintenta 2 h (el privado puede tardar)
    }
  }
  // 3. vigilar respuestas y traerlas al hilo
  // v141: un fallo a mitad (Slack frena, red) ya no deja sin guardar lo ya traído: antes se volvía a publicar en la vuelta
  // siguiente (duplicados en el hilo). Se guarda tras cada aviso y el error se devuelve al final.
  let fallo = null;
  const porDm = {};
  for (const a of Object.values(v.avisos)) if (a.estado === "vigilar" && a.dm) (porDm[a.dm] = porDm[a.dm] || []).push(a);
  for (const [dm, avs] of Object.entries(porDm)) {
    try {
      const tramos = [...avs.filter((a) => !a.relevo).map((a) => ({ t: parseFloat(a.desdeIA || a.desde), hilo: a.hilo })), ...(v.duenos[dm] || []).map((d) => ({ t: parseFloat(d.t), hilo: d.hilo }))]
        .filter((x) => x.t).sort((x, y) => x.t - y.t);
      if (!tramos.length || ahora - tramos[tramos.length - 1].t * 1000 > 48 * 3600e3) { avs.forEach((a) => { a.estado = "caducado"; }); continue; }
      const cursor = v.cursor[dm] || String(Math.max(...avs.map((a) => parseFloat(a.ultimo || a.desde || 0))));
      const j = await slack("conversations.history", { channel: dm, oldest: String(Math.min(parseFloat(cursor), tramos[tramos.length - 1].t - 30)), limit: "100" }, tokUser);
      const hechos = new Set(v.hechos[dm] || []);
      const todos = (j.messages || []).filter((x) => x.user && !x.subtype).sort((x, y) => parseFloat(x.ts) - parseFloat(y.ts));
      const suyos = todos.filter((x) => x.user !== HUMANO && parseFloat(x.ts) > parseFloat(cursor) && !hechos.has(x.ts));
      if (!suyos.length) continue;
      if (ahora - parseFloat(suyos[suyos.length - 1].ts) * 1000 < 90e3) continue;
      const persona0 = avs[0].persona, pila = String((avs.find((b) => b.nombre) || {}).nombre || persona0 || "").split(/\s+/)[0];
      const conocido = (x) => tramos.some((y) => Math.abs(parseFloat(x.ts) - y.t) < 15);
      const deIA = (x) => !!(x.app_id || /Enviado usando/i.test(x.text || ""));
      const nombra = (t) => { const s = sinTildes(t); return [pila, avs[0].nombre].filter((n) => n && n.length >= 3).some((n) => new RegExp("\\b" + sinTildes(n)).test(s)); };
      for (const x of todos) {
        if (x.user !== HUMANO || conocido(x) || parseFloat(x.ts) < tramos[0].t) continue;
        const t = parseFloat(x.ts);
        let hilo = null, ia = null;
        const env = (ctx.enviados || []).find((e) => Math.abs(e.t / 1000 - t) < 60 && e.hilo);
        if (env) { tramos.push({ t, hilo: env.hilo }); continue; }
        if (deIA(x)) for (const h of hilos || []) for (const m of h.msgs || []) if (!hilo && IAS.includes(m.quien) && Math.abs(parseFloat(m.ts) - t) <= 600 && nombra(m.texto) && !/contestó por privado/.test(m.texto || "")) { hilo = h.ts; ia = m.quien; }
        if (hilo) {   // la IA le escribió desde otro hilo: la vigilancia pasa a ese hilo
          const k = `${hilo}|ia|${x.ts}`;
          if (!v.avisos[k]) { v.avisos[k] = { hilo, avisoTs: x.ts, nombre: pila, ia, estado: "vigilar", dm, persona: persona0, desde: x.ts, ultimo: x.ts, desdeIA: x.ts }; avs.push(v.avisos[k]);
            if (anota) anota(`PRIVADO: ${ia} escribió a ${persona0} desde el hilo ${hilo}: lo que conteste va allí`); }
        }
        tramos.push({ t, hilo, mano: !deIA(x), pregunta: hilo ? null : String(x.text || "") });
      }
      tramos.sort((x, y) => x.t - y.t);
      const hiloTexto = (ts) => ((hilos || []).find((h) => h.ts === ts) || { msgs: [] }).msgs.map((m) => m.texto || "").join("\n");
      // cada ráfaga (mensajes suyos seguidos, sin Humano en medio ni 15 min de hueco) va entera al mismo sitio
      const grupos = [];
      for (const x of suyos) {
        const t = parseFloat(x.ts), i = todos.indexOf(x), prev = todos[i - 1];
        const g0 = grupos[grupos.length - 1];
        if (g0 && prev && prev === g0.xs[g0.xs.length - 1] && t - parseFloat(prev.ts) < 900) { g0.xs.push(x); continue; }
        const tr = tramos.filter((y) => y.t <= t).pop() || tramos[0];
        let hilo = tr.hilo ? sigue(tr.hilo) : null, motivo = tr.hilo ? null : tr.mano ? "mano" : "fuera";
        const sigTr = tramos.find((y) => y.t > t), hasta = sigTr ? sigTr.t : Infinity;
        if (todos.some((y) => y.user === HUMANO && !deIA(y) && parseFloat(y.ts) > t && parseFloat(y.ts) <= hasta)) { hilo = null; motivo = "mano"; }
        if (hilo && prev && t - parseFloat(prev.ts) >= 1800) {
          const refs = refsDe(x.text), txt = sinTildes(hiloTexto(hilo));
          if (SALUDO.test(sinTildes(x.text)) || (refs.length && !refs.some((r) => txt.includes(sinTildes(r))))) { hilo = null; motivo = "otro"; }
        }
        const ant = motivo !== "mano" && motivo !== "otro" ? grupos.findLastIndex((g) => g.tr === tr && (g.motivo === "fuera" || g.motivo === "otro")) : -1;
        grupos.push({ hilo, motivo, tr, mismoQue: ant >= 0 ? ant : null, pregunta: motivo === "fuera" ? tr.pregunta : null, xs: [x] });
      }
      for (const g of grupos) {
        if (g.mismoQue != null && grupos[g.mismoQue].hilo) g.hilo = grupos[g.mismoQue].hilo;
        if (g.motivo === "mano") {   // Humano ya habla con él en Slack: no se trae
          v.hechos[dm] = [...(v.hechos[dm] || []), ...g.xs.map((x) => x.ts)].slice(-300); guarda(v);
          if (anota) anota(`PRIVADO: ${persona0} (${g.xs.length} mensaje(s)) no se trae: Humano le contesta a mano en Slack`); continue;
        }
        const hora = new Date(parseFloat(g.xs[0].ts) * 1000).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
        const cuerpo = g.xs.map((x) => limpiaSlack(x.text)).filter(Boolean).map((x) => "> " + x).join("\n").slice(0, 2500);
        let a, texto;
        if (!g.hilo) {   // suelto: tema propio, con su título
          const base = g.pregunta || g.xs[0].text;
          let titulo = `${pila} por privado · ${resumen(base) || hora}`; if (titulo.length > 90) titulo = titulo.slice(0, 90).replace(/\s+\S*$/, "") + "…";
          const raiz = `*Hilo: ${titulo}*\n📥 Origen: Slack · privado de ${persona0}` + (g.pregunta ? `\nTu cuenta le escribió (no desde un tema de la oficina): «${limpiaSlack(g.pregunta).slice(0, 300)}»` : "\nEs otro asunto: no es de ningún tema vigilado.");
          const r = await slack("chat.postMessage", { channel: CH, text: raiz, unfurl_links: "false" }, tokBot);
          g.hilo = r.ts;
          a = v.avisos[`${g.hilo}|suelto|${dm}`] = { hilo: g.hilo, avisoTs: g.xs[0].ts, nombre: pila, ia: "—", estado: "vigilar", dm, persona: persona0, desde: g.xs[0].ts, ultimo: g.xs[0].ts, desdeIA: g.xs[0].ts, suelto: true, traidos: 0 };
          avs.push(a); tramos.push({ t: parseFloat(g.xs[0].ts), hilo: g.hilo }); tramos.sort((x, y) => x.t - y.t);
          texto = `💬 *${a.persona}* contestó por privado (${hora}), ${g.pregunta ? "a un mensaje que no salió de ningún tema" : "de otro asunto"}:\n${cuerpo}`;
          if (anota) anota(`PRIVADO: ${persona0} escribió de otro asunto → tema nuevo «${titulo}» (${g.hilo})`);
        } else {
          a = avs.find((b) => b.hilo === g.hilo) || Object.values(v.avisos).find((b) => b.hilo === g.hilo && b.dm === dm);
          if (!a) { const base = avs.find((b) => sigue(b.hilo) === g.hilo) || avs[0];
            a = v.avisos[`${g.hilo}|relevo|${dm}`] = { ...base, hilo: g.hilo, relevo: true, avisoTs: String(Math.max(...avs.map((b) => parseFloat(b.avisoTs)))), traidos: 0 }; avs.push(a); }
          texto = a.suelto ? `💬 *${a.persona}* contestó por privado (${hora}):\n${cuerpo}` : `💬 *${a.persona}* contestó por privado (${hora}) a lo que le preguntó ${a.ia}:\n${cuerpo}`;
        }
        await slack("chat.postMessage", { channel: CH, thread_ts: g.hilo, text: texto, unfurl_links: "false" }, tokBot);
        a.ultimo = g.xs[g.xs.length - 1].ts; a.traidos = (a.traidos || 0) + g.xs.length;
        v.hechos[dm] = [...(v.hechos[dm] || []), ...g.xs.map((x) => x.ts)].slice(-300);
        guarda(v);
        if (anota) anota(`PRIVADO: ${a.persona} → hilo ${g.hilo} (${g.xs.length} mensaje(s))`);
      }
      v.cursor[dm] = suyos[suyos.length - 1].ts; guarda(v);
    } catch (e) { fallo = fallo || e; }
  }
  for (const [k, a] of Object.entries(v.avisos)) if (ahora - parseFloat(a.avisoTs) * 1000 > 7 * 86400e3) delete v.avisos[k];
  // v147: tramos, cursor y entregados de privados que ya no vigila ningún aviso, fuera
  const dmsVivos = new Set(Object.values(v.avisos).map((a) => a.dm).filter(Boolean));
  for (const o of [v.duenos, v.cursor, v.hechos]) for (const dm of Object.keys(o)) if (!dmsVivos.has(dm)) delete o[dm];
  for (const dm of Object.keys(v.duenos)) v.duenos[dm] = v.duenos[dm].filter((d) => ahora - parseFloat(d.t) * 1000 < 7 * 86400e3);
  guarda(v);
  if (fallo) throw fallo;
}

const memoria = { usuarios: null, usuariosT: 0, imDe: null, imT: 0 };
async function esperas(lista, { tokUser, HUMANO, llama = slack, mem = memoria, ahora = Date.now(), disco = lee } = {}) {
  const out = {};
  if (!tokUser || !lista.length) return out;
  if (!mem.usuarios || ahora - mem.usuariosT > 24 * 3600e3) {
    const v = disco();
    if (v.usuarios && ahora - (v.usuariosT || 0) < 24 * 3600e3) mem.usuarios = v.usuarios;
    else {
      let us = [], cur = "";
      do { const j = await llama("users.list", { limit: "200", ...(cur ? { cursor: cur } : {}) }, tokUser); us.push(...(j.members || [])); cur = j.response_metadata && j.response_metadata.next_cursor; } while (cur);
      mem.usuarios = us.filter((u) => !u.deleted && !u.is_bot && u.id !== "USLACKBOT").map((u) => ({ id: u.id, real_name: u.real_name, name: u.name, profile: { display_name: u.profile && u.profile.display_name, real_name: u.profile && u.profile.real_name } }));
    }
    mem.usuariosT = ahora;
  }
  if (!mem.imDe || ahora - mem.imT > 10 * 60e3) {
    let ims = [], cur = "";
    do { const j = await llama("conversations.list", { types: "im", limit: "200", ...(cur ? { cursor: cur } : {}) }, tokUser); ims.push(...(j.channels || [])); cur = j.response_metadata && j.response_metadata.next_cursor; } while (cur);
    mem.imDe = Object.fromEntries(ims.map((c) => [c.user, c.id])); mem.imT = ahora;
  }
  for (const e of lista) {
    const nombres = String(e.quien || "").split(/\s*(?:,|\/|&|\by\b|\be\b)\s*/i).map((x) => x.trim()).filter((x) => x.length >= 3);
    for (const n of nombres) {
      const cands = mem.usuarios.filter((u) => u.id !== HUMANO && encaja(u, n) && mem.imDe[u.id]).slice(0, 3);
      let hallado = null;
      for (const u of cands) {
        const j = await llama("conversations.history", { channel: mem.imDe[u.id], oldest: String((e.desde || 0) / 1000), limit: "20" }, tokUser);
        const suyos = (j.messages || []).filter((x) => x.user === u.id && !x.subtype && parseFloat(x.ts) * 1000 > (e.desde || 0)).sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
        if (suyos.length) { hallado = { nombre: (u.real_name || u.name || n).split(/\s+/)[0], uid: u.id, dm: mem.imDe[u.id], t: Math.round(parseFloat(suyos[suyos.length - 1].ts) * 1000),
          texto: suyos.slice(-4).map((x) => String(x.text || "").trim()).filter(Boolean).join(" · ").slice(0, 600) }; break; }
      }
      if (hallado) { out[e.hilo] = hallado; break; }
    }
  }
  return out;
}

module.exports = { vigila, encaja, AVISO, esperas, resumen };
