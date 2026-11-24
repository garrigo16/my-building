"use strict";
const path = require("path");
const { execFileSync } = require("child_process");
const S = require(path.join(__dirname, "..", "oficina", "server.js"));
const canal = require(path.join(__dirname, "canal-bloques.js"));
const FechaReal = Date; let AHORA = FechaReal.now();
const hm = (s, def) => { const d = new FechaReal(); const m = String(s || def).match(/^(\d{1,2}):(\d{2})$/); d.setHours(+m[1], +m[2], 0, 0); return d.getTime(); };
const hhmm = (t) => new FechaReal(t).toTimeString().slice(0, 5);
const tsMs = (ts) => Math.round(parseFloat(ts) * 1000);
const corta = (s, n) => { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

function teToca(a) {
  const m = new Map();
  for (const h of a.hilos || []) if (h.estado === "humano") m.set("tema:" + h.ts, { tit: h.titulo, que: h.motivo, llevar: h.llevar ? h.llevar.texto : "" });
  for (const d of a.deTi || []) { const k = "tarjeta:" + (d.hilo || "") + ":" + corta(d.texto || d.pregunta || d.tit || "", 60); if (!m.has("tema:" + d.hilo)) m.set(k, { tit: corta(d.titulo || d.tit || "(tarjeta)", 60), que: d.texto || d.pregunta || "" }); }
  return m;
}

function horasDe(dif) {
  const idT = new Map(), idS = new Map();
  for (const trozo of String(dif || "").split("\x00").slice(1)) {
    const nl = trozo.indexOf("\n"), [h, cts] = trozo.slice(0, nl < 0 ? undefined : nl).trim().split(" "), d = nl < 0 ? "" : trozo.slice(nl + 1);
    for (const m of d.matchAll(/^\+<!--.*?\bid:\s*([^|]+?)\s*\|/gm)) if (!idT.has(m[1])) idT.set(m[1], +cts * 1000);
    for (const m of d.matchAll(/^\+#{2,3}\s+(.+)$/gm)) { const k = "tit:" + m[1].trim().slice(0, 160); if (!idT.has(k)) idT.set(k, +cts * 1000); if (!idS.has(k)) idS.set(k, h); }
  }
  return { tDe: (x) => S.horaBloque(idT, x), shaDe: (x) => idS.get("tit:" + x.tit.slice(0, 160)) || "" };
}
// v463: el canal como estaba a la hora t: los bloques publicados hasta entonces, leídos juntos (faltan, retenido… de ese momento)
function canalEn(raws, horas, t) {
  const kept = raws.filter((x) => { const tb = horas.tDe(x.p); return tb && tb <= t; }).map((x) => x.r);
  return S.bloquesDeTexto(kept.join("\n\n"), horas.tDe, horas.shaDe).reverse();
}

async function repaso(desde, hasta, cada) {
  const [hs, git] = await Promise.all([S.leerSlack(), S.leerGit().catch(() => [])]);
  const L = S.leerLogs();
  const git0 = (S.CANALES || []).map((c) => {
    const rama = `origin/${c.rama}`, sh = (args, max) => execFileSync("git", ["-C", S.REPO, ...args], { encoding: "utf8", maxBuffer: max || 64e6 });
    const commits = sh(["log", `--since=${new FechaReal(desde - 36 * 3600e3).toISOString()}`, "--format=%H", rama, "--", c.fichero]).trim().split("\n").filter(Boolean);
    const horas = horasDe(commits.length ? sh(["show", "--format=%x00%H %ct", "--unified=0", ...commits, "--", c.fichero], 512e6) : "");
    const raws = canal.partir(sh(["show", `${rama}:${c.fichero}`])).map((r) => ({ r, p: canal.parse(r) }));
    return { base: (git || []).find((g) => g.canal === c.nombre) || { canal: c.nombre, rama: c.rama }, raws, horas };
  });
  global.Date = class extends FechaReal { constructor(...a) { if (a.length) super(...a); else super(AHORA); } static now() { return AHORA; } };
  let antes = new Map(); const vida = new Map();
  for (let t = desde; t <= hasta; t += cada * 60e3) {
    AHORA = t;
    const hsF = hs.map((h) => ({ ...h, msgs: h.msgs.filter((x) => tsMs(x.ts) <= t) })).filter((h) => h.msgs.length);
    const gitF = git0.map((g) => { const todos = canalEn(g.raws, g.horas, t); return { ...g.base, todos, bloques: todos.slice(0, 10) }; });
    let a; try { a = S.analizar(hsF, L, null, null, gitF); } catch (e) { console.log(`${hhmm(t)}  ⚠ analizar falló: ${e.message}`); continue; }
    const ahora = teToca(a);
    for (const [k, v] of ahora) if (!antes.has(k)) { console.log(`${hhmm(t)}  + ${corta(v.tit, 55)}\n          ${corta(v.que, 150)}`); vida.set(k, { de: t, tit: v.tit }); }
    for (const [k, v] of antes) if (!ahora.has(k)) { const d = vida.get(k), h = k.startsWith("tema:") && (a.hilos || []).find((x) => "tema:" + x.ts === k);
      console.log(`${hhmm(t)}  − ${corta(v.tit, 55)} (estuvo ${Math.round((t - d.de) / 60e3)} min)${h ? `
          → ${h.estado}: ${corta(h.motivo, 140)}` : ""}`); }
    antes = ahora;
  }
  console.log(`\nAl final (${hhmm(hasta)}) siguen en «Te toca» ${antes.size}:`);
  for (const [k, v] of antes) console.log(`  · ${corta(v.tit, 60)} (desde las ${hhmm(vida.get(k).de)}): ${corta(v.que, 120)}`);
}

if (require.main === module) {
  const [d, h, c] = process.argv.slice(2);
  repaso(hm(d, "08:00"), h ? hm(h) : FechaReal.now(), +(c || 10)).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
}
module.exports = { teToca, horasDe, canalEn };
