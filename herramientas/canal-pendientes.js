// Uso: node canal-pendientes.js --canal principal --tip <f> --base <f> --lim <f> --sha <sha> --desde <sha> --estado <dir> [--base-min <n>] [--seco]
//   --base-min: minutos desde la última pasada de este equipo (sin él, o -1: no hay, y se aplica también el corte de 3 h).
//   <f>: el fichero del canal en el tip, en la última pasada (base) y hace 3 h (lim).   --seco: dice qué haría y no toca nada.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const canal = require("./canal-bloques.js");

const AUTORES = ["Coo", "Grok", "Criba"];
const RELANZA_MIN = 25, REINTENTO_MIN = 14, MAX_BLOQUES = 15;

const PASADA_MAX_H = 64;
function viejosPara(base, lim, baseMin) { return baseMin >= 0 && baseMin <= PASADA_MAX_H * 60 ? [base] : [base, lim]; }

function decide({ tip, viejos, estado, ahora, ocupadas = {} }) {
  const bs = canal.leer(tip);
  const viejas = new Set();
  for (const t of viejos) for (const r of canal.partir(t)) viejas.add(canal.parse(r).clave);
  const porClave = new Map(bs.map((b) => [b.clave, b]));
  const est = JSON.parse(JSON.stringify(estado || {}));
  const acciones = [];
  // 1. lo que ya se despertó: ¿contestó? si no, una vez más; si tampoco, sin respuesta
  for (const [k, e] of Object.entries(est)) {
    const b = porClave.get(e.clave);
    if (!b || ahora - e.t0 > 24 * 3600e3) { delete est[k]; continue; }
    if (!b.faltan.includes(e.ia)) { acciones.push({ tipo: "CONTESTADO", ia: e.ia, b, k }); delete est[k]; continue; }
    if (e.n >= 3) continue;                                                  // ya avisado: la oficina lo enseña
    if (e.n === 0) { if (ahora - e.t >= REINTENTO_MIN * 60e3) acciones.push({ tipo: (e.fallos || 0) >= 2 ? "SIN_RESPUESTA" : "LANZO", ia: e.ia, b, k }); continue; }
    if (ahora - e.t < RELANZA_MIN * 60e3) continue;
    if (e.n === 1 && ocupadas[e.ia] > e.t) continue;                         // otro la despertó después: se espera
    acciones.push({ tipo: e.n === 1 ? "RELANZO" : "SIN_RESPUESTA", ia: e.ia, b, k });
  }
  const nuevos = [], esperan = [];
  for (const b of bs) {
    const porContrato = !!(b.estado && b.estado.hace && b.estado.hace.length);
    if (viejas.has(b.clave) || !(AUTORES.includes(b.de) || porContrato) || !b.faltan.length) continue;
    for (const ia of b.faltan) {
      const k = b.clave + "|" + ia; if (est[k]) continue;
      if (ocupadas[ia]) { esperan.push({ ia, b, desde: ocupadas[ia] }); est[k] = { clave: b.clave, ia, tit: b.tit.slice(0, 160), de: b.de, n: 1, t: ocupadas[ia], t0: ocupadas[ia], otro: true }; continue; }
      nuevos.push({ tipo: "LANZO", ia, b, k });
    }
  }
  const claves = [...new Set(nuevos.map((x) => x.b.clave))], nb = claves.length;
  if (nb > MAX_BLOQUES) {
    const quedan = new Set(claves.slice(-MAX_BLOQUES));   // los más nuevos (el canal va de viejo a nuevo)
    return { acciones: acciones.concat(nuevos.filter((x) => quedan.has(x.b.clave))), esperan, estado: est,
      freno: `${nb} bloques nuevos piden algo a la vez (máx. ${MAX_BLOQUES}): despierto por los ${MAX_BLOQUES} más nuevos` };
  }
  return { acciones: acciones.concat(nuevos), esperan, estado: est, freno: "" };
}

// primero se tapa el VALOR; después, las palabras que validar-nota.sh no deja pasar
const limpio = (s) => require("./tapar-secretos.js").tapaSecretos(String(s || "").replace(/\s+/g, " "), { largos: false }).replace(/(secret|password|token|xox[a-z]-|hooks\.slack\.com)/gi, "…").trim();
const ref = (b) => `${/^\d+$/.test(b.id) && !b.tit.startsWith(b.id) ? b.id + " · " : ""}${limpio(b.tit).slice(0, 110)}`;
const hhmm = (t) => new Date(t).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

// la nota para despertar a cada IA (Cursor: el formato que exige validar-nota.sh)
function nota(ia, xs, ctx) {
  const autores = [...new Set(xs.map((x) => x.b.de))].join(" y ");
  const lista = xs.map((x) => ref(x.b) + (x.tipo === "RELANZO" ? ` (segundo aviso: te despertaron a las ${hhmm(x.e.t)} y no ha llegado tu bloque)` : "")).join("; ");
  const etq = [...new Set(xs.flatMap((x) => x.b.etiquetas))].slice(0, 3).join(", ");
  if (ia === "Cursor") return [`para: Cursor`, `@cursor`, `Coinciden: ${autores} te pide algo en el canal ${ctx.canal} y nadie te había despertado: ${lista}`.slice(0, 400),
    `No coinciden: -`, `Tu OK: no hace falta. Contesta en el canal ${ctx.canal} con tu bloque (para: ${autores}${etq ? `; etiqueta [${etq}]` : ""})`, `Tercera lectura: no`].join("\n") + "\n";
  return [`para: ${ia}`, `Detalle: en el canal ${ctx.canal} te piden algo y nadie te había despertado: ${lista}`,
    `Desde: vigía sin modelo (canal-pendientes.js), tramo ${String(ctx.desde).slice(0, 10)}..${String(ctx.sha).slice(0, 10)}`,
    `Qué hacer: lee esos bloques (busca su título) y haz SOLO lo que te piden a ti. Contesta en el canal ${ctx.canal} con tu bloque (para: ${autores}${etq ? `, con la etiqueta [${etq}] en el título` : ""}). Si no puedes (p. ej. te piden leer un org y desde el canal no llegas), dilo en tu bloque.`].join("\n") + "\n";
}

// ejecuta: lanzar(ia, ficheroNota) → código de salida (0 = despertada). Devuelve las líneas para traspasos.log.
function ejecuta(r, ctx) {
  const ahora = ctx.ahora, est = r.estado, lineas = [], dice = [];
  const apunta = (tipo, ia, b, extra) => lineas.push([new Date(ahora).toISOString(), tipo, ia, ctx.canal, b.clave, (extra ? extra + " · " : "") + limpio(b.tit).slice(0, 140)].join("\t"));
  if (r.freno) dice.push("FRENO: " + r.freno);
  for (const x of r.esperan || []) { lineas.push([new Date(x.desde).toISOString(), "LANZO", x.ia, ctx.canal, x.b.clave, "(lo despertó otro) · " + limpio(x.b.tit).slice(0, 120)].join("\t")); dice.push(`${x.ia} ya lo despertó otro a las ${hhmm(x.desde)}: no lo duplico; sigo su respuesta a ${ref(x.b)}`); }
  for (const a of r.acciones.filter((x) => x.tipo === "CONTESTADO")) { apunta("CONTESTADO", a.ia, a.b); dice.push(`${a.ia} ya contestó a ${ref(a.b)}`); }
  for (const a of r.acciones.filter((x) => x.tipo === "SIN_RESPUESTA")) {
    est[a.k] = { ...(est[a.k] || {}), n: 3, t: ahora }; apunta("SIN_RESPUESTA", a.ia, a.b); dice.push(`SIN RESPUESTA de ${a.ia} a ${ref(a.b)}: lo enseña la oficina`);
  }
  const porIA = {};
  for (const a of r.acciones.filter((x) => x.tipo === "LANZO" || x.tipo === "RELANZO")) (porIA[a.ia] = porIA[a.ia] || []).push({ ...a, e: est[a.k] || {} });
  for (const [ia, xs] of Object.entries(porIA)) {
    const txt = nota(ia, xs, ctx);
    if (ctx.seco) { dice.push(`DESPERTARÍA a ${ia} (${xs.map((x) => x.tipo).join(", ")}) con esta nota:\n${txt.trimEnd()}`); continue; }
    const f = path.join(os.tmpdir(), `vigia-nota-${ia}-${process.pid}.txt`); fs.writeFileSync(f, txt);
    let rc = 99; try { rc = ctx.lanzar(ia, f); } finally { try { fs.unlinkSync(f); } catch (e) {} }
    for (const x of xs) {
      const prev = est[x.k] || {};
      if (rc === 0) { est[x.k] = { clave: x.b.clave, ia, tit: x.b.tit.slice(0, 160), de: x.b.de, n: (prev.n || 0) + 1, t: ahora, t0: prev.t0 || ahora, desde: ctx.desde }; apunta(x.tipo, ia, x.b); }
      else { est[x.k] = { clave: x.b.clave, ia, tit: x.b.tit.slice(0, 160), de: x.b.de, n: 0, t: ahora, t0: prev.t0 || ahora, fallos: (prev.fallos || 0) + 1, desde: ctx.desde }; apunta("FALLO", ia, x.b, "rc=" + rc); }
    }
    dice.push(`${rc === 0 ? "despierto" : "NO he podido despertar"} a ${ia} (rc=${rc}): ${xs.map((x) => ref(x.b)).join("; ")}`);
  }
  return { lineas, dice };
}

module.exports = { limpio, decide, ejecuta, nota, viejosPara, AUTORES, MAX_BLOQUES, RELANZA_MIN };

if (require.main === module) {
  const arg = (n) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : ""; };
  const seco = process.argv.includes("--seco"), can = arg("canal") || "principal";
  const lee = (f) => { try { return f ? fs.readFileSync(f, "utf8") : ""; } catch (e) { return ""; } };
  const LOGS = process.env.CANAL_LOGS || path.join(os.homedir(), ".canal-logs");
  const fEst = path.join(arg("estado") || LOGS, `traspasos-${can}.json`);
  let estado = {}; try { estado = JSON.parse(fs.readFileSync(fEst, "utf8")); } catch (e) {}
  const ahora = Date.now();
  const ocupadas = {};
  for (const l of lee(path.join(LOGS, "cursor-arranques.log")).split(/\r?\n/).slice(-200)) {
    const m = l.match(/^(\S+) SI canal (\S+)/); const t = m ? Date.parse(m[1]) : 0;
    if (m && m[2] === can && ahora - t < 30 * 60e3) ocupadas.Cursor = Math.max(ocupadas.Cursor || 0, t);
  }
  try { for (const f of fs.readdirSync(LOGS).filter((f) => /^claude-\d{8}-\d{6}-/.test(f))) {
    const t = fs.statSync(path.join(LOGS, f)).birthtimeMs || 0; if (ahora - t < 30 * 60e3) ocupadas.Claude = Math.max(ocupadas.Claude || 0, t);
  } } catch (e) {}
  for (const l of lee(path.join(LOGS, "avisar-coo.log")).split(/\r?\n/).slice(-200)) {
    const m = l.match(/^(\S+) webhook de Coo \(hilo [\d.-]+, de el canal git \((\w+), sha [^)]*\)\): http (\d+)/); const t = m ? Date.parse(m[1]) : 0;
    if (m && m[2] === can && m[3][0] === "2" && ahora - t < 30 * 60e3) ocupadas.Coo = Math.max(ocupadas.Coo || 0, t);
  }
  const baseMin = /^\d+$/.test(arg("base-min")) ? +arg("base-min") : -1;   // minutos desde la última pasada (-1: no hay)
  const r = decide({ tip: lee(arg("tip")), viejos: viejosPara(lee(arg("base")), lee(arg("lim")), baseMin), estado, ahora, ocupadas });
  const AQUI = process.env.VIGIA_LANZADORES || __dirname;
  const BASH = process.env.CANAL_BASH || "bash";
  const lanzar = (ia, f) => {
    if (ia === "Claude") return spawnSync(BASH, [path.join(AQUI, "lanzar-claude.sh"), can, f, arg("sha"), arg("desde")], { stdio: "ignore", timeout: 120e3 }).status ?? 98;
    if (ia === "Cursor") return spawnSync(BASH, [path.join(AQUI, "lanzar-cursor.sh"), can, f, arg("sha"), arg("desde")], { stdio: "ignore", timeout: 240e3 }).status ?? 98;
    if (ia === "Codex") return spawnSync(BASH, [path.join(AQUI, "lanzar-codex.sh"), can, f, arg("sha"), arg("desde")], { stdio: "ignore", timeout: 120e3 }).status ?? 98;
    if (ia === "Coo") {   // Coo no tiene lanzador: su routine, por el hilo del timbre (como timbre.sh)
      const hilo = lee(path.join(LOGS, "timbre-hilo.txt")).trim(); if (!hilo) return 97;
      return spawnSync(BASH, [path.join(AQUI, "avisar-coo.sh"), process.env.SLACK_CANAL_ID || "CCANAL00001", hilo, `el canal git (${can}, sha ${arg("sha").slice(0, 10)}): te piden algo en un bloque`],
        { stdio: "ignore", timeout: 90e3, env: { ...process.env, FRENO_HILO: "-" } }).status ?? 98;
    }
    return 96;
  };
  const { lineas, dice } = ejecuta(r, { canal: can, sha: arg("sha"), desde: arg("desde"), seco, ahora, lanzar });
  for (const l of dice) console.log(l);
  if (!seco) {
    fs.mkdirSync(LOGS, { recursive: true });
    if (lineas.length) fs.appendFileSync(path.join(LOGS, "traspasos.log"), lineas.join("\n") + "\n");
    fs.mkdirSync(path.dirname(fEst), { recursive: true }); fs.writeFileSync(fEst, JSON.stringify(r.estado));
  } else if (!dice.length) console.log("nada nuevo que despertar en el canal " + can);
}
