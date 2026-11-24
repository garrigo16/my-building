// relevo-claude.js - decide con qué cuenta de Claude se lanza: empresa (Team) por defecto; si ha agotado la ventana de 5 h o el
// cupo semanal, UN solo relevo a la personal (Pro); si las dos están agotadas, aviso con las dos horas de reinicio y se para.
// Sin red en pruebas: con CANAL_PRUEBAS=1 el estado sale de RELEVO_MOCK (fichero JSON) o RELEVO_USAGE_URL (URL falsa).
//
// Uso (lo llaman lanzar-claude.sh y atender-slack.sh):
//   node relevo-claude.js decidir                 -> JSON {cuenta:"empresa"|"personal"|null, aviso, ...}
//   node relevo-claude.js fallo <log> <cuenta>    -> mira el log del CLI; si es un tope de cuota, JSON como arriba para el relevo
// Formato del estado de una cuenta (el de /api/oauth/usage): {five_hour:{utilization,resets_at}, seven_day:{utilization,resets_at}}
// o cabeceras {"anthropic-ratelimit-unified-5h-status":"rejected","anthropic-ratelimit-unified-5h-reset":<epoch s>, ...-7d-...}.
"use strict";
const fs = require("fs"), os = require("os"), path = require("path");

const NOMBRE = { empresa: "Claude de empresa (Team)", personal: "Claude personal (Pro)" };
const TZ = "Europe/Madrid";

function partesMadrid(d) {
  const o = {};
  for (const p of new Intl.DateTimeFormat("es-ES", { timeZone: TZ, weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d)) o[p.type] = p.value;
  if (o.hour === "24") o.hour = "00";
  return o;
}
function cuando(d, ahora = new Date()) {
  const p = partesMadrid(d), q = partesMadrid(ahora), hora = `${p.hour}:${p.minute}`;
  if (p.day === q.day && p.month === q.month && p.year === q.year) return `hoy a las ${hora} (Madrid)`;
  return `el ${p.weekday} ${p.day}/${p.month} a las ${hora} (Madrid)`;
}
function nombreVentana(v) { return v === "5h" ? "la ventana de 5 horas" : "el cupo semanal"; }

// Estado normalizado: null si está bien (o no se sabe), {ventana:"5h"|"semanal", reinicio:Date|null} si agotada.
function normaliza(e) {
  if (!e || typeof e !== "object") return null;
  const h = (k) => e[k] ?? e[k.toLowerCase()];
  const fecha = (v) => { if (v == null || v === "") return null; const n = Number(v); const d = Number.isFinite(n) ? new Date(n < 1e11 ? n * 1000 : n) : new Date(v); return isNaN(d) ? null : d; };
  const cab5 = h("anthropic-ratelimit-unified-5h-status"), cab7 = h("anthropic-ratelimit-unified-7d-status");
  if (cab5 === "rejected") return { ventana: "5h", reinicio: fecha(h("anthropic-ratelimit-unified-5h-reset")) };
  if (cab7 === "rejected") return { ventana: "semanal", reinicio: fecha(h("anthropic-ratelimit-unified-7d-reset")) };
  const lleno = (x) => x && Number(x.utilization) >= 100;
  if (lleno(e.five_hour)) return { ventana: "5h", reinicio: fecha(e.five_hour.resets_at) };
  if (lleno(e.seven_day)) return { ventana: "semanal", reinicio: fecha(e.seven_day.resets_at) };
  return null;
}

// "resets 7:10pm (Europe/Madrid)" / "resets Nov 28, 6:59am" en el log del CLI -> Date (hora de Madrid).
function madridADate(y, mo, d, h, mi) {
  let t = Date.UTC(y, mo, d, h, mi);
  for (let i = 0; i < 2; i++) { const p = partesMadrid(new Date(t)); t += (Date.UTC(y, mo, d, h, mi) - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute)); }
  return new Date(t);
}
function deLog(texto, ahora = new Date()) {
  const m = /(?:you'?ve hit your|you have hit your|has alcanzado tu)\s+(5-hour|five-hour|weekly|7-day|week(?:ly)?|session)\s+limit[^\n]*?resets?\s+([^\n(]*?)\s*(?:\(|$|\n)/i.exec(texto || "");
  if (!m) return /Claude AI usage limit reached|usage limit reached/i.test(texto || "") ? { ventana: "5h", reinicio: null } : null;
  const ventana = /5-hour|five-hour|session/i.test(m[1]) ? "5h" : "semanal";
  const r = /(\d{1,2})(?::(\d{2}))?\s*([ap]m)/i.exec(m[2]); let reinicio = null;
  if (r) {
    let h = +r[1] % 12 + (/p/i.test(r[3]) ? 12 : 0); const mi = +(r[2] || 0), p = partesMadrid(ahora);
    reinicio = madridADate(+p.year, +p.month - 1, +p.day, h, mi);
    const fm = /([A-Za-z]{3})[a-z]*\s+(\d{1,2})/.exec(m[2]);
    if (fm) { const mes = "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(fm[1].toLowerCase()) / 3; if (mes >= 0) reinicio = madridADate(+p.year, mes, +fm[2], h, mi); }
    else if (reinicio <= ahora) reinicio = new Date(reinicio.getTime() + 864e5);
  }
  return { ventana, reinicio };
}

async function leeEstado(cuenta) {
  const pruebas = process.env.CANAL_PRUEBAS === "1";
  if (pruebas && process.env.RELEVO_MOCK) {
    try { return normaliza(JSON.parse(fs.readFileSync(process.env.RELEVO_MOCK, "utf8"))[cuenta]); } catch { return null; }
  }
  const url = pruebas ? process.env.RELEVO_USAGE_URL : (cuenta === "empresa" ? "https://api.anthropic.com/api/oauth/usage" : "");
  if (!url) return null;   // la personal no se consulta en real (sus credenciales no son nuestras): se sabe por el log del CLI
  const tok = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!tok && !pruebas) return null;
  try {
    const r = await fetch(url, { headers: { Authorization: "Bearer " + tok, "anthropic-beta": "oauth-2025-04-20" }, signal: AbortSignal.timeout(8000) });
    const cab = {}; r.headers.forEach((v, k) => { cab[k] = v; });
    const porCab = normaliza(cab);
    if (porCab) return porCab;
    if (r.status === 403) return null;   // el setup-token de empresa no tiene user:profile: sin dato, se lanza y ya dirá el log
    return r.ok ? normaliza(await r.json()) : null;
  } catch { return null; }
}

const DIR_LOGS = () => path.join(process.env.HOME || os.homedir(), ".canal-logs");
const ESTADO_F = () => path.join(DIR_LOGS(), "claude-relevo.json");
const leeMem = () => { try { return JSON.parse(fs.readFileSync(ESTADO_F(), "utf8")); } catch { return {}; } };
function guarda(cuenta, est) {
  try { fs.mkdirSync(DIR_LOGS(), { recursive: true }); const m = leeMem(); m[cuenta] = est ? { ventana: est.ventana, reinicio: est.reinicio ? est.reinicio.toISOString() : null } : null; fs.writeFileSync(ESTADO_F(), JSON.stringify(m)); } catch {}
}
function recuerda(cuenta, ahora) {
  const e = leeMem()[cuenta]; if (!e) return null;
  const r = e.reinicio ? new Date(e.reinicio) : null;
  return !r || r > ahora ? { ventana: e.ventana, reinicio: r } : null;   // si ya pasó su hora de reinicio, vuelve a estar libre
}
function frase(cuenta, est, ahora) { return `${NOMBRE[cuenta]} ha agotado ${nombreVentana(est.ventana)}` + (est.reinicio ? `. Se reinicia ${cuando(est.reinicio, ahora)}.` : "."); }

// estados = {empresa, personal} ya normalizados (null = libre). Devuelve la decisión.
function decide(estados, ahora = new Date()) {
  const { empresa, personal } = estados;
  if (!empresa) return { cuenta: "empresa", aviso: "" };
  if (!personal) return { cuenta: "personal", ventana: empresa.ventana, aviso: frase("empresa", empresa, ahora) + " Paso a la cuenta personal (Pro)." };
  const f = (c, e) => `${NOMBRE[c]} ha agotado ${nombreVentana(e.ventana)}` + (e.reinicio ? ` (se reinicia ${cuando(e.reinicio, ahora)})` : "");
  return { cuenta: null, aviso: `${f("empresa", empresa)} y ${f("personal", personal)}. No lanzo a nadie.` };
}

async function decidir(ahora = new Date()) {
  const empresa = (await leeEstado("empresa")) || recuerda("empresa", ahora);
  const personal = (await leeEstado("personal")) || recuerda("personal", ahora);
  if (empresa) guarda("empresa", empresa);
  return decide({ empresa, personal }, ahora);
}

// Tras un fallo del CLI con la cuenta `cuenta`: si el log dice tope de cuota, se apunta y se decide el relevo. Nunca más de uno:
// si la que falla es la personal, solo queda parar (con la hora de la empresa si se conoce).
function fallo(texto, cuenta, ahora = new Date()) {
  const est = deLog(texto, ahora);
  if (!est) return { cuenta: cuenta, cuota: false, aviso: "" };
  guarda(cuenta, est);
  const otra = cuenta === "empresa" ? "personal" : "empresa";
  if (cuenta === "empresa") return { ...decide({ empresa: est, personal: recuerda("personal", ahora) }, ahora), cuota: true };
  const emp = recuerda(otra, ahora);
  if (!emp) return { cuenta: null, cuota: true, aviso: frase("personal", est, ahora) + " No lanzo a nadie." };
  return { ...decide({ empresa: emp, personal: est }, ahora), cuota: true, cuenta: null };
}

// Constancia: ~/.canal-logs/claude-arranques.log y claude-aviso.json (el que lee el panel de la Oficina).
function registra(aviso) {
  try { fs.mkdirSync(DIR_LOGS(), { recursive: true });
    fs.appendFileSync(path.join(DIR_LOGS(), "claude-arranques.log"), `${new Date().toISOString()} ${aviso}\n`);
    fs.writeFileSync(path.join(DIR_LOGS(), "claude-aviso.json"), JSON.stringify({ aviso, ts: new Date().toISOString() })); } catch {}
}

module.exports = { decide, decidir, fallo, deLog, normaliza, cuando, frase };

if (require.main === module) {
  (async () => {
    const [cmd, a, b] = process.argv.slice(2);
    let r;
    if (cmd === "decidir") r = await decidir();
    else if (cmd === "fallo") r = fallo(fs.existsSync(a) ? fs.readFileSync(a, "utf8") : "", b || "empresa");
    else { console.error("uso: relevo-claude.js decidir | fallo <log> <cuenta>"); process.exit(2); }
    if (r.aviso) registra(r.aviso);
    if (process.argv.includes("--lineas")) console.log((r.cuenta || "parar") + "\n" + (r.aviso || "") + "\n" + (r.cuota ? "cuota" : ""));
    else console.log(JSON.stringify(r));
  })().catch(() => { console.log(JSON.stringify({ cuenta: "empresa", aviso: "" })); });   // ante un fallo del ayudante, el arranque de siempre
}
