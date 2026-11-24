// Uso: node oficina/tests/repaso-dia.js [desde hh:mm] [hasta hh:mm] [filtro de título] [--dia AAAA-MM-DD]
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const FechaReal = Date; let AHORA = FechaReal.now();
global.Date = class extends FechaReal { constructor(...a) { if (a.length) super(...a); else super(AHORA); } static now() { return AHORA; } };
const S = require("../server.js");
const LOGS = path.join(os.homedir(), ".canal-logs");
const args = process.argv.slice(2), iDia = args.indexOf("--dia"), dia = iDia >= 0 ? args.splice(iDia, 2)[1] : "";
const [desde = "09:00", hasta = "21:30", filtro = ""] = args;
const hoy = dia ? new FechaReal(`${dia}T12:00:00`) : new FechaReal(); if (isNaN(hoy)) { console.error("--dia: usa AAAA-MM-DD"); process.exit(2); }
const aMs = (hm) => { const [h, m] = hm.split(":").map(Number); const d = new FechaReal(hoy); d.setHours(h, m, 0, 0); return d.getTime(); };

(async () => {
  const [hs, git] = await Promise.all([S.leerSlack(), S.leerGit()]);
  const L = S.leerLogs();   // de ahora; se recorta por hora en cada paso
  const sesiones = S.lineas(path.join(LOGS, "sesiones-slack.log"), 5000).map((l) => l.match(/^(\S+) hilo ([\d.]+) quien=/)).filter(Boolean).map((m) => ({ t: Date.parse(m[1]), hilo: m[2] }));
  const linea = {};   // hilo → [[hh:mm, estado, motivo]]
  for (let t = aMs(desde); t <= aMs(hasta); t += 15 * 60e3) {
    AHORA = t;
    const hsT = hs.map((h) => ({ ...h, msgs: h.msgs.filter((m) => +m.ts * 1000 <= t) })).filter((h) => h.msgs.length);
    const gitT = git.map((g) => ({ ...g, todos: (g.todos || []).filter((b) => b.t && b.t <= t) }));
    const lanzHilo = {}; for (const s of sesiones) if (s.t <= t) lanzHilo[s.hilo] = Math.max(lanzHilo[s.hilo] || 0, s.t);
    const LT = { ...L, lanzHilo, avisosCoo: L.avisosCoo.filter((x) => x.t <= t), arranquesCursor: (L.arranquesCursor || []).filter((x) => x.t <= t),
      traspasos: (L.traspasos || []).filter((x) => x.t <= t), frenos: L.frenos.filter((x) => x.t <= t && t - x.t < 60 * 60e3), cursorSlack: [], lanz: [] };
    const a = S.analizar(hsT, LT, null, null, gitT);
    for (const h of a.hilos) {
      if (filtro && !h.titulo.toLowerCase().includes(filtro.toLowerCase())) continue;
      const l = linea[h.titulo] = linea[h.titulo] || [], ult = l[l.length - 1], hm = new FechaReal(t).toTimeString().slice(0, 5);
      const mot = h.motivo.replace(/\s+/g, " ").slice(0, 110);
      if (!ult || ult[1] !== h.estado || ult[2] !== mot) l.push([hm, h.estado, mot]);
    }
  }
  const baila = [];
  for (const [tit, l] of Object.entries(linea)) {
    if (l.length === 1 && ["cerrado", "olvidado"].includes(l[0][1])) continue;
    console.log(`\n■ ${tit.slice(0, 80)}`);
    for (const [hm, e, m] of l) console.log(`  ${hm}  ${e.padEnd(9)} ${m}`);
    const cambios = l.filter((x, i) => i && (x[1] === "humano") !== (l[i - 1][1] === "humano")).length;
    if (cambios >= 4) baila.push(`${tit.slice(0, 60)} (${cambios} entradas y salidas de «te toca»)`);
  }
  if (baila.length) console.log("\n⚠ estados que bailan:\n  " + baila.join("\n  "));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
