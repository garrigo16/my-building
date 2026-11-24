"use strict";
const fs = require("fs"), path = require("path"), os = require("os");

function confCalendario() {
  const o = {};
  try {
    for (const l of fs.readFileSync(path.join(os.homedir(), ".config", "oficina-calendario.env"), "utf8").split("\n")) {
      const x = l.replace("\r", "").trim(), i = x.indexOf("=");
      if (i > 0 && !x.startsWith("#")) o[x.slice(0, i)] = x.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch (e) {}
  return o;
}
function urlCalendario() { return confCalendario().CALENDARIO_ICS || null; }

function fecha(v) {
  const m = String(v || "").match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/); if (!m) return null;
  const [, Y, M, D, h, mi, s, z] = m;
  if (h === undefined) return { t: new Date(+Y, +M - 1, +D).getTime(), dia: true };
  if (z) return { t: Date.UTC(+Y, +M - 1, +D, +h, +mi, +s), dia: false };
  return { t: new Date(+Y, +M - 1, +D, +h, +mi, +s).getTime(), dia: false };
}
const desescapa = (s) => String(s || "").replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");

function leerICS(txt) {
  const lineas = String(txt).replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const evs = []; let e = null, cal = "";
  for (const l of lineas) {
    if (l === "BEGIN:VEVENT") { e = { exdate: [], att: [] }; continue; }
    if (l === "END:VEVENT") { if (e) evs.push(e); e = null; continue; }
    const i = l.indexOf(":"); if (i < 0) continue;
    const cab = l.slice(0, i), val = l.slice(i + 1), nombre = cab.split(";")[0].toUpperCase();
    if (!e) { if (nombre === "X-WR-CALNAME") cal = val.trim(); continue; }
    if (nombre === "SUMMARY") e.titulo = desescapa(val);
    else if (nombre === "DTSTART") e.ini = fecha(val);
    else if (nombre === "DTEND") e.fin = fecha(val);
    else if (nombre === "RRULE") e.rrule = Object.fromEntries(val.split(";").map((p) => p.split("=")));
    else if (nombre === "EXDATE") for (const v of val.split(",")) { const f = fecha(v); if (f) e.exdate.push(f.t); }
    else if (nombre === "RECURRENCE-ID") e.recid = fecha(val);
    else if (nombre === "UID") e.uid = val;
    else if (nombre === "STATUS") e.estado = val.trim().toUpperCase();
    else if (nombre === "LOCATION") e.lugar = desescapa(val);
    else if (nombre === "DESCRIPTION") e.desc = desescapa(val);
    else if (nombre === "X-GOOGLE-CONFERENCE") e.meet = val.trim();
    else if (nombre === "ATTENDEE") e.att.push({ cab, mail: val.replace(/^mailto:/i, "").trim().toLowerCase() });
  }
  return { evs, cal: cal.toLowerCase() };
}

const DIAS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const inicioDia = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const diasEntre = (a, b) => Math.round((inicioDia(b) - inicioDia(a)) / 86400e3);
function cae(r, ini, d) {
  const di = new Date(ini), dd = new Date(d), iv = +(r.INTERVAL || 1), by = r.BYDAY ? r.BYDAY.split(",") : null;
  const dif = diasEntre(ini, d); if (dif < 0) return false;
  switch (r.FREQ) {
    case "DAILY": return dif % iv === 0 && (!by || by.some((b) => b.slice(-2) === DIAS[dd.getDay()]));
    case "WEEKLY": {
      const lunes = (t) => { const x = new Date(inicioDia(t)); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x.getTime(); };
      const sem = Math.round((lunes(d) - lunes(ini)) / (7 * 86400e3));
      return sem % iv === 0 && (by ? by.some((b) => b.slice(-2) === DIAS[dd.getDay()]) : dd.getDay() === di.getDay());
    }
    case "MONTHLY": {
      const meses = (dd.getFullYear() - di.getFullYear()) * 12 + dd.getMonth() - di.getMonth(); if (meses % iv) return false;
      if (r.BYMONTHDAY) return r.BYMONTHDAY.split(",").map(Number).includes(dd.getDate());
      if (by) return by.some((b) => { const m = b.match(/^([+-]?\d+)?([A-Z]{2})$/); if (!m || m[2] !== DIAS[dd.getDay()]) return false; if (!m[1]) return true;
        const n = +m[1], k = Math.floor((dd.getDate() - 1) / 7) + 1, ult = new Date(dd.getFullYear(), dd.getMonth() + 1, 0).getDate();
        return n > 0 ? k === n : dd.getDate() > ult - 7 * -n && dd.getDate() <= ult - 7 * (-n - 1); });
      return dd.getDate() === di.getDate();
    }
    case "YEARLY": return (dd.getFullYear() - di.getFullYear()) % iv === 0 && dd.getMonth() === di.getMonth() && dd.getDate() === di.getDate();
  }
  return false;
}

function meetDe(e) {
  if (e.meet) return e.meet;
  const m = `${e.lugar || ""} ${e.desc || ""}`.match(/https:\/\/(meet\.google\.com\/[a-z0-9-]+|[\w.-]*zoom\.us\/j\/\S+|teams\.microsoft\.com\/\S+)/i);
  return m ? m[0].replace(/[>)\].,]+$/, "") : null;
}

// reuniones entre [desde, hasta) (por defecto hoy y mañana), ordenadas
function reuniones(txt, yo, desde, hasta) {
  const { evs, cal } = leerICS(txt); const mio = (yo || cal || "").toLowerCase();
  desde = desde || inicioDia(Date.now()); hasta = hasta || desde + 2 * 86400e3;
  const cambios = new Map();   // uid|hora original -> evento que la sustituye
  for (const e of evs) if (e.recid && e.uid) cambios.set(e.uid + "|" + e.recid.t, e);
  const rechazado = (e) => e.att.some((a) => a.mail === mio && /PARTSTAT=DECLINED/i.test(a.cab));
  const fuera = [];
  const mete = (e, t, dur) => {
    if (e.estado === "CANCELLED" || rechazado(e) || t >= hasta || t + Math.max(dur, 1) <= desde) return;
    fuera.push({ t, fin: t + dur, titulo: e.titulo || "(sin título)", todoDia: !!(e.ini && e.ini.dia), meet: meetDe(e), lugar: e.lugar && !/^https?:/.test(e.lugar) ? e.lugar : null, uid: e.uid || "" });
  };
  for (const e of evs) {
    if (!e.ini) continue;
    const dur = e.fin ? e.fin.t - e.ini.t : e.ini.dia ? 86400e3 : 30 * 60e3;
    if (e.recid) { mete(e, e.ini.t, dur); continue; }   // cambio suelto de una repetición
    if (!e.rrule) { mete(e, e.ini.t, dur); continue; }
    const r = e.rrule, hastaR = r.UNTIL ? (fecha(r.UNTIL) || {}).t : Infinity, cuenta = r.COUNT ? +r.COUNT : Infinity;
    const di = new Date(e.ini.t); let n = 0;
    for (let d = inicioDia(e.ini.t); d < hasta; d += 86400e3) {
      const dia = new Date(d); dia.setHours(di.getHours(), di.getMinutes(), di.getSeconds(), 0);   // hora local (cambios de hora)
      const t = dia.getTime(); if (t > hastaR) break;
      if (!cae(r, e.ini.t, d)) continue;
      if (++n > cuenta) break;
      if (t + dur <= desde) continue;
      if (e.exdate.includes(t)) continue;
      const c = cambios.get(e.uid + "|" + t); if (c) continue;   // la sustituye su cambio suelto (ya metido arriba)
      mete(e, t, dur);
    }
  }
  return fuera.sort((a, b) => a.t - b.t || a.titulo.localeCompare(b.titulo));
}

// lista que llega del Apps Script: se limpia y se queda con lo que no ha terminado antes de hoy
function normaliza(j) {
  if (!Array.isArray(j)) throw new Error("agenda: no es una lista");
  const desde = new Date(); desde.setHours(0, 0, 0, 0);
  return j.filter((x) => x && x.t && x.fin > desde.getTime()).map((x) => ({ t: +x.t, fin: +x.fin, titulo: String(x.titulo || "(sin título)"),
    todoDia: !!x.todoDia, meet: /^https:\/\//.test(x.meet || "") ? x.meet : null, lugar: x.lugar && !/^https?:/.test(x.lugar) ? String(x.lugar) : null, uid: String(x.uid || "") }))
    .sort((a, b) => a.t - b.t);
}

// v555: ninguna lectura de la agenda espera más de 20 s (si se cuelga, error a la vista y se reintenta)
const tope = () => AbortSignal.timeout(20e3);
async function leerReuniones() {
  // v114: si la empresa no deja la dirección secreta iCal, la agenda llega de un Apps Script de Humano
  // (herramientas/agenda-apps-script.gs): CALENDARIO_JSON=<url /exec> y CALENDARIO_CLAVE=<clave>
  const c = confCalendario();
  // v115: la agenda llega a un canal privado de Slack (el Apps Script la manda por webhook) y se lee con el bot
  if (c.CALENDARIO_CANAL) {
    let bot = "";
    try { for (const l of fs.readFileSync(path.join(os.homedir(), ".config", "canal-slack.env"), "utf8").split("\n")) {
        const x = l.replace("\r", "").trim(); if (x.startsWith("SLACK_BOT_TOKEN=")) bot = x.slice(16).trim().replace(/^["']|["']$/g, ""); } } catch (e) {}
    if (!bot) throw new Error("agenda: falta SLACK_BOT_TOKEN");
    const r = await fetch("https://slack.com/api/conversations.history", { method: "POST",
      headers: { Authorization: "Bearer " + bot, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ channel: c.CALENDARIO_CANAL, limit: "20" }), signal: tope() });
    const k = await r.json();
    if (!k.ok) throw new Error("agenda: Slack " + k.error + (k.error === "not_in_channel" || k.error === "channel_not_found" ? " (añade la app Claude OCA al canal)" : ""));
    const m = (k.messages || []).find((x) => /📅 Agenda de Humano|:date: Agenda de Humano/.test(x.text || "") && /```/.test(x.text || ""));
    if (!m) return [];
    const crudo = m.text.split("```")[1].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/<(https?:\/\/[^|>]+)(\|[^>]*)?>/g, "$1");
    let j; try { j = JSON.parse(crudo); } catch (e) { throw new Error("agenda: el mensaje de Slack no trae JSON válido"); }
    const lista = normaliza(j);
    if (Date.now() - parseFloat(m.ts) * 1000 > 7 * 3600e3) lista.vieja = true;   // el script no manda nada desde hace >7 h
    return lista;
  }
  if (c.CALENDARIO_JSON && c.CALENDARIO_CLAVE) {
    const r = await fetch(c.CALENDARIO_JSON + (c.CALENDARIO_JSON.includes("?") ? "&" : "?") + "k=" + encodeURIComponent(c.CALENDARIO_CLAVE), { redirect: "follow", signal: tope() });
    if (!r.ok) throw new Error("agenda " + r.status);
    const txt = await r.text(); let j;
    try { j = JSON.parse(txt); } catch (e) { throw new Error(/<html/i.test(txt) ? "agenda: Google pide iniciar sesión (el acceso del script no es «Cualquier usuario»)" : "agenda: respuesta rara"); }
    if (!Array.isArray(j)) throw new Error("agenda: " + (j && j.error || "error"));
    return normaliza(j);
  }
  const url = urlCalendario();
  if (!url) { const vacias = Object.keys(c).filter((k) => /^CALENDARIO_/.test(k) && !c[k]);
    if (vacias.length) throw new Error(`agenda sin configurar: ${vacias.join(", ")} está vacío en ~/.config/oficina-calendario.env (falta el ID «C…» del canal #agenda-humano)`);
    return null; }
  const r = await fetch(url, { headers: { Accept: "text/calendar" }, signal: tope() });
  if (!r.ok) throw new Error("calendario " + r.status);
  return reuniones(await r.text());
}

module.exports = { leerReuniones, reuniones, leerICS, urlCalendario };
