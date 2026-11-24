"use strict";
const fs = require("fs"), path = require("path");

const DIAS = 3, TOPE_AVISOS = 60, TOPE_ARRANQUES = 40, MIN = 60e3;
const LATE_ABIERTO = 60 * MIN;
const JUNTA_MIN = 10 * MIN;
const p2 = (n) => String(n).padStart(2, "0");
const diaDe = (t) => { const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const hhmm = (t) => { const d = new Date(t); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const corto = (s, n = 220) => { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// ¿esta línea del log de la oficina habla de un fallo?
const FALLO = /no he podido|no se pudo|no se pudieron|no pude|no puedo|no puede entrar|\berror|fall[oó]\b|ha fallado|atascad|colgad|ca[ií]d[ao]|rechazad|time ?out|aborted|sin conexi[oó]n|sin red|no arranc|no vuelve|no contesta|ilegible|\broto\b|✘/i;
const NO_FALLO = /^estado (sube|baja): (sin cambios|subido|bajado|lo último lo subió|no hay estado)|^arranque: lista|: ok$|sin errores/i;
const esFallo = (l) => FALLO.test(l) && !NO_FALLO.test(l);
// dos líneas iguales salvo las cifras (horas, pids, ids de hilo) son el mismo aviso
const huella = (l) => String(l).toLowerCase().replace(/\d[\d.:]*/g, "#").replace(/\s+/g, " ").trim().slice(0, 120);

const nuevo = (equipo) => ({ equipo: equipo || "", t: 0, dias: {} });
function lee(f, equipo) {
  try { const d = JSON.parse(fs.readFileSync(f, "utf8")); if (d && typeof d === "object" && d.dias && typeof d.dias === "object") { d.equipo = d.equipo || equipo || ""; return d; } } catch (e) {}
  return nuevo(equipo);
}
// el día de `ahora` dentro del diario (lo crea; fuera los días que sobran)
function elDia(d, ahora) {
  const k = diaDe(ahora);
  if (!d.dias[k]) { d.dias[k] = { errores: {}, avisos: [], arranques: [] }; for (const v of Object.keys(d.dias).sort().reverse().slice(DIAS)) delete d.dias[v]; }
  return d.dias[k];
}

// Lo que la oficina tiene AHORA en `errores` ({ fuente: texto }). Devuelve true si hay que guardar (algo se abre o se cierra).
function apuntaErrores(d, errs, ahora = Date.now()) {
  const hoy = elDia(d, ahora); let cambia = false;
  for (const [k, texto] of Object.entries(errs || {})) {
    const e = hoy.errores[k];
    if (!e) { hoy.errores[k] = { texto: corto(texto), desde: ahora, hasta: ahora, veces: 1, abierto: true }; cambia = true; }
    else if (!e.abierto) { Object.assign(e, { texto: corto(texto), hasta: ahora, veces: (e.veces || 1) + 1, abierto: true }); cambia = true; }
    else e.hasta = ahora;
  }
  for (const [k, e] of Object.entries(hoy.errores)) if (e.abierto && !(k in (errs || {}))) { delete e.abierto; e.hasta = ahora; cambia = true; }
  if (!cambia && Object.values(hoy.errores).some((e) => e.abierto) && ahora - (d.t || 0) >= LATE_ABIERTO) cambia = true;
  return cambia;
}

// Una línea del log de la oficina. Devuelve true si hay que guardar ya (un aviso nuevo o un arranque).
function apuntaLinea(d, linea, ahora = Date.now()) {
  const l = corto(linea, 200); if (!l) return false;
  const hoy = elDia(d, ahora);
  // (v569: el estreno en caliente también es un estreno —lo apuntan la oficina que se va y la que llega—; si falla, la de antes sigue
  // y no hay arranque que esperar)
  if (/^estreno en caliente FALLIDO/i.test(l)) delete d.estreno;
  else if (/^(me reinicio para estrenar|estreno en caliente\b)/i.test(l)) { d.estreno = ahora; return true; }
  const a = l.match(/^arranque: lista en ([\d.,]+ s)/i);
  if (a) {
    const estreno = !!d.estreno && ahora - d.estreno < 10 * MIN; delete d.estreno;
    hoy.arranques.push({ t: ahora, en: a[1], ...(estreno ? { estreno: true } : {}) });
    if (hoy.arranques.length > TOPE_ARRANQUES) hoy.arranques.splice(0, hoy.arranques.length - TOPE_ARRANQUES);
    return true;
  }
  if (!esFallo(l)) return false;
  const h = huella(l), ya = hoy.avisos.find((x) => x.h === h);
  if (ya) { ya.veces = (ya.veces || 1) + 1; ya.ult = ahora; d.sucio = true; return ahora - (d.t || 0) >= JUNTA_MIN; }
  if (hoy.avisos.length >= TOPE_AVISOS) { hoy.masAvisos = (hoy.masAvisos || 0) + 1; return false; }
  hoy.avisos.push({ t: ahora, ult: ahora, veces: 1, texto: l, h });
  return true;
}

function guarda(f, d, ahora = Date.now()) {
  d.t = ahora; delete d.sucio;
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + ".tmp", JSON.stringify(d)); fs.renameSync(f + ".tmp", f); return true; } catch (e) { return false; }
}

// El diario de la oficina en marcha: apunta y guarda cuando hace falta. Sin fichero (pruebas), no hace nada.
function abre(f, equipo, { alGuardar } = {}) {
  if (!f) return { errores() {}, linea() {}, d: null };
  const d = lee(f, equipo); d.equipo = equipo || d.equipo;
  const quiza = (cambia, ahora) => { if (cambia && guarda(f, d, ahora) && alGuardar) { try { alGuardar(); } catch (e) {} } };
  return {
    d,
    // (lo que solo sumó veces en el log sale con la siguiente vuelta, pasados 10 min de lo último guardado)
    errores(errs, ahora = Date.now()) { try { quiza(apuntaErrores(d, errs, ahora) || (!!d.sucio && ahora - (d.t || 0) >= JUNTA_MIN), ahora); } catch (e) {} },
    linea(l, ahora = Date.now()) { try { quiza(apuntaLinea(d, l, ahora), ahora); } catch (e) {} },
  };
}

// El resumen de un día en lenguaje llano: [líneas]. `dia` = "AAAA-MM-DD" (sin él, el último día apuntado).
function resumen(d, dia) {
  if (!d || !d.dias) return ["(sin diario de errores)"];
  const k = dia || Object.keys(d.dias).sort().pop();
  const fecha = k ? `${k.slice(8, 10)}/${k.slice(5, 7)}` : "hoy", quien = `«${d.equipo || "?"}»`;
  const x = k && d.dias[k];
  const hasta = d.t ? ` (apuntado hasta las ${hhmm(d.t)}${diaDe(d.t) !== k ? ` del ${diaDe(d.t).slice(8, 10)}/${diaDe(d.t).slice(5, 7)}` : ""})` : "";
  if (!x) return [`Sin nada apuntado el ${fecha} en ${quien}${hasta}.`];
  const o = [];
  for (const [fuente, e] of Object.entries(x.errores || {}).sort((a, b) => a[1].desde - b[1].desde)) {
    const dur = Math.round((e.hasta - e.desde) / MIN);
    const cuando = e.abierto ? `desde las ${hhmm(e.desde)} y seguía a las ${hhmm(Math.max(e.hasta, d.t || 0))}` : dur < 1 ? `a las ${hhmm(e.desde)}` : `de ${hhmm(e.desde)} a ${hhmm(e.hasta)}`;
    o.push(`  ✘ ${fuente} · ${cuando}${e.veces > 1 ? ` (${e.veces} veces)` : ""}: ${e.texto}`);
  }
  for (const a of (x.avisos || [])) o.push(`  ⚠ ${hhmm(a.t)}${a.veces > 1 ? ` (${a.veces} veces, la última a las ${hhmm(a.ult)})` : ""} · ${a.texto}`);
  if (x.masAvisos) o.push(`  ⚠ y ${x.masAvisos} aviso(s) más sin apuntar (tope de ${TOPE_AVISOS} al día)`);
  const arr = x.arranques || [], sin = arr.filter((a) => !a.estreno);
  if (arr.length) o.push(`  ↻ la oficina arrancó ${arr.length} ${arr.length === 1 ? "vez" : "veces"}: ${arr.length - sin.length} por estrenar código` +
    (sin.length ? ` y ${sin.length} sin avisar (caída o reinicio del equipo: ${sin.map((a) => hhmm(a.t)).join(", ")})` : ""));
  const nErr = Object.keys(x.errores || {}).length, nAv = (x.avisos || []).length;
  const cab = nErr + nAv ? `Errores del ${fecha} en ${quien}${hasta}: ${nErr} de la oficina, ${nAv} en el log` : `Sin errores apuntados el ${fecha} en ${quien}${hasta}`;
  return [cab + (o.length ? ":" : "."), ...o];
}

const NOMBRE = /^diario--([\w-]{1,40})\.json$/;
// los diarios que hay en una carpeta (el de este equipo y los bajados de los otros): [{ equipo, ruta, nombre }]
function enCarpeta(dir) {
  let fs0 = []; try { fs0 = fs.readdirSync(dir); } catch (e) {}
  return fs0.filter((f) => NOMBRE.test(f)).sort().map((f) => ({ equipo: f.match(NOMBRE)[1].toLowerCase(), ruta: path.join(dir, f), nombre: f }));
}

module.exports = { abre, lee, guarda, nuevo, apuntaErrores, apuntaLinea, resumen, enCarpeta, esFallo, huella, diaDe, NOMBRE, DIAS, TOPE_AVISOS };
