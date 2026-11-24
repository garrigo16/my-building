"use strict";

const IAS = ["Claude", "Cursor", "Coo", ...((() => { try { return require("./config.js").config().codex.activo; } catch (e) { return false; } })() ? ["Codex"] : [])];
const GENERICAS = /^(ACUSE|CRUCE|DECISI[OÓ]N|LECTURA|REVISI[OÓ]N|CONFORME|HECHO|PREGUNTA|PROPUESTA|CAMBIOS|RESPUESTA|NOTA|OK|AVISO|INFORME|BORRADOR|CIERRE|COORD|COORDINACI[OÓ]N|INFO|SLACK|OCA|URGENTE|SEGUIMIENTO|RESUMEN|PLAN|ESTADO|CONTRASTE|CORRECCI[OÓ]N|TERCERA LECTURA|VOTO|RELEVO|SLACK ?(→|->|A) ?CANAL)$/;

const plano = (s) => String(s || "").replace(/[*`_]/g, "");
const sinTildes = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

function partir(txt) {
  const t = String(txt || "").replace(/\r/g, "").replace(/\n(#{2,3} [^\n]*)\n(<!-- para:[^\n]*-->)/g, "\n$2\n$1");
  return t.split(/\n(?=<!-- para:)/).filter((b) => b.startsWith("<!-- para:"));
}

function cabecera(b) {
  const cab = (String(b).match(/^<!--(.*?)-->/) || [])[1] || "";
  const o = { _: cab };
  for (const f of cab.split("|")) { const m = f.match(/^\s*([a-záéíóúñ-]+)\s*:\s*([\s\S]*?)\s*$/i); if (m && !(m[1].toLowerCase() in o)) o[m[1].toLowerCase()] = m[2]; }
  return o;
}

function paraDe(s) {
  const t = String(s || "").replace(/Cursor\s*\/\s*Coo(rdinador)?/gi, "Coo");
  return [...new Set([...t.matchAll(/\b(Claude|Cursor|Coo|Grok|Criba|Codex|Humano|JJ|todos)\b/gi)].map((m) => {
    const n = m[1].toLowerCase(); return n === "jj" ? "Humano" : n === "todos" ? "todos" : n[0].toUpperCase() + n.slice(1);
  }))];
}

function etiquetasDe(tit) {
  const out = [];
  for (const m of String(tit || "").matchAll(/\[([^\]\n]{2,60})\]/g)) {
    for (let p of m[1].split(/\s*(?:·|\/|,|;|\||\s—\s|\s-\s)\s*/)) {
      p = sinTildes(p).trim().toUpperCase().replace(/\s+/g, " ");
      if (p.length >= 2 && p.length <= 30 && !GENERICAS.test(p) && !/^\d{1,2}:\d{2}$/.test(p) && !out.includes(p)) out.push(p);
    }
  }
  return out;
}

const LUEGO = /\b(?:tras|despu[eé]s de|cuando (?:llegue|d[eé]|haya|tenga)|en cuanto (?:llegue|d[eé]|haya|tenga))\s+(?:(?:el|ese|su|tu|este)\s+)?(?:OK|visto bueno|aprobaci[oó]n|luz verde)\b|\b(?:solo|s[oó]lo|[uú]nicamente)\s+si\b|\bsi\s+(?:sale\s+|da\s+|queda\s+)?(?:Failed|KO|falla)\b/i;
const esLuego = (que) => { const m = String(que || "").match(LUEGO); return !!m && !/\s[ye]\s|,/.test(que.slice(0, m.index)); };
const partes = (v) => { const out = [""]; let n = 0; for (const ch of String(v)) { if (ch === "(") n++; else if (ch === ")") n = Math.max(0, n - 1); if (ch === ";" && !n) out.push(""); else out[out.length - 1] += ch; } return out.map((s) => s.trim()); };
function estadoDe(v) {
  if (!v) return null;
  const e = { hace: [], que: "", toca: "", hecho: false };
  v = String(v).replace(/[[\]]/g, " ").replace(/\s+\/\s+(?=(?:te toca|lo hace|hecho|info|espera)\b)/gi, "; ");
  for (const parte of partes(v)) {
    const m = parte.match(/^\s*(te toca|lo hace|hecho|info|espera)\b\s*:?\s*([\s\S]*)$/i); if (!m) continue;
    if (m[1].toLowerCase() === "espera") {
      const quien = m[2].split(/\s+[—–-]\s+|:\s/)[0].trim().slice(0, 40);
      if (/^(Humano|JJ)$/i.test(quien)) { if (!e.toca) { e.toca = m[2].replace(/^(?:Humano|JJ)\s*(?:[—–:-]\s*|$)/i, "").trim() || "te toca a ti"; e.tocaEspera = true; } }
      else if (IAS.includes(paraDe(quien)[0] || "") && paraDe(quien).length === 1) {
        const ia = paraDe(quien)[0], qt = m[2].split(/\s+[—–-]\s+|:\s/).slice(1).join(" — ").trim().slice(0, 160);
        if (esLuego(qt)) (e.luego = e.luego || []).push({ ia, que: qt }); else if (!e.hace.includes(ia)) { e.hace.push(ia); if (qt) e.que = qt; if (LUEGO.test(qt)) (e.quiza = e.quiza || []).push({ ia, que: qt }); }
      }
      else e.esperaA = quien;
      continue;
    }
    const k = m[1].toLowerCase(), r = m[2].trim();
    const otro = r.match(/^(?!(?:Humano|JJ)\b)([A-ZÁÉÍÓÚ][a-záéíóúñ]{1,14}|[A-Z]{2})\s*[—–]\s/);
    if (k === "te toca" && otro && !/^(Elige|Decide|Confirma|Revisa|Dime|Aprueba|Mira|Valida|Responde|Contesta|Ok|Sí|Si)$/i.test(otro[1])) e.tocaA = otro[1];
    else if (k === "te toca") e.toca = r.replace(/^(?:Humano|JJ)\s*(?:[—–:-]\s*|$)/i, "").trim() || "te toca a ti";
    else if (k === "lo hace") {
      const [quien, ...que] = r.split(/\s+[—–-]\s+|:\s/), qt = que.join(" — ").trim().slice(0, 160);
      if (esLuego(qt)) { for (const ia of paraDe(quien)) if (IAS.includes(ia)) (e.luego = e.luego || []).push({ ia, que: qt }); continue; }   // v460
      for (const ia of paraDe(quien)) if (IAS.includes(ia) && !e.hace.includes(ia)) { e.hace.push(ia); if (LUEGO.test(qt)) (e.quiza = e.quiza || []).push({ ia, que: qt }); }
      if (qt) e.que = qt;
    } else if (k === "hecho") e.hecho = true;
  }
  if (e.toca && e.quiza) for (const q of e.quiza) { e.hace = e.hace.filter((x) => x !== q.ia); (e.luego = e.luego || []).push(q); }
  delete e.quiza;
  return e.hace.length || e.toca || e.hecho || e.tocaA || e.esperaA || e.luego ? e : null;
}

function pideIADe(b) {
  if (b.estado) return b.estado.hace.filter((x) => x !== b.de);
  const cuerpo = plano(b.tit + "\n" + b.cuerpo);
  if (/^info\b/i.test(b.accion || "") || /\b(es informativo|no os toca (hacer )?nada|no hace falta que hag[aá]is nada|solo para que lo sep[aá]is)\b/i.test(cuerpo)) return [];
  const out = [];
  for (const X of IAS) {
    if (X === b.de || !(b.para.includes(X) || b.para.includes("todos"))) continue;
    const x = X.toLowerCase();
    const res = [
      new RegExp(`petici[oó]n(es)?\\s+(a\\s+|para\\s+)?${x}\\b`, "i"),
      new RegExp(`\\bp[ií](do|dele|den)\\s+a\\s+${x}\\b`, "i"),
      new RegExp(`\\bencargo\\s+(a|para)\\s+${x}\\b`, "i"),
      new RegExp(`\\ble toca a ${x}\\b`, "i"),
      new RegExp(`\\bsiguiente:?\\s*${x}\\b`, "i"),
      new RegExp(`\\bfalta(n)?\\s+(el\\s+|la\\s+)?(conforme|ok|cruce|lectura|respuesta|parte)\\s+de\\s+${x}\\b`, "i"),
      new RegExp(`\\bfalta(n)?(\\s+que)?\\s*[.:]?\\s*${x}\\b(?!\\s*[.:]?\\s*(nada|ninguna))`, "i"),
      new RegExp(`\\b${x}\\b[^.\\n]{0,60}\\bconforme o cambios\\b`, "i"),
      new RegExp(`\\bpara\\s+${x}\\s*:`, "i"),
      new RegExp(`(^|[\\s(])@${x}\\b`, "im"),
    ];
    const item = new RegExp(`^\\s*(?:\\d+\\.|[-•])\\s*${x}\\b\\s*(?:[.:·—–]|\\s-)(.*)$`, "im");
    const linea = (cuerpo.match(new RegExp(item.source, "gim")) || []).map((l) => (l.match(item) || [])[1] || "");
    const PIDE = /\b(prioridad|falta|pido|petici[oó]n|necesito|tu (punto|parte|bloque)|haz|lee|cruza|confirma|revisa|publica|saca|mira|comprueba|contesta|responde|patch|corrige|actualiza|prepara)\b/i;
    const ESTADO = /\bnada\b|ninguna|cuando toque|siguiente hito|^\s*(sin\b|no\b|ok\b|hecho|hecha|conforme)/i;
    if (res.some((re) => re.test(cuerpo)) || linea.some((l) => PIDE.test(l) && !ESTADO.test(l))) out.push(X);
  }
  return out;
}

// petición a Humano por el texto (lo de siempre, v137/v152)
const PREGUNTA_J = /^\**Pregunta a Humano\b[^\n]*\?/mi;
const PIDE_J = /DECISI[OÓ]N HUMANO|OK DE ENV[IÍ]O PENDIENTE DE HUMANO|elige Humano|queda en Humano|elecci[oó]n de Humano|^@humano\b|^(falta|pendiente) de humano:|necesito tu ok|tu ok al paso|^\**PARA HUMANO:|^\**Pregunta a Humano\b[^\n]*\?|siguiente:\s*\**humano/mi;

function parse(b) {
  const c = cabecera(b);
  const tit = (b.split("\n").find((l) => /^#{2,3}\s/.test(l)) || "").replace(/^#+\s*/, "").trim();
  const AUTOR = /^(?:\[?\s*(?:\d+\s*·\s*)?)(Claude|Cursor|Coo|Codex|Grok|Criba)\b/i, BIEN = ["Claude", "Cursor", "Coo", "Codex", "Grok", "Criba"];
  const aut = (tit.match(AUTOR) || [])[1] || (String(c.id || "").trim().match(AUTOR) || [])[1] || "";
  const de = aut ? BIEN.find((x) => x.toLowerCase() === aut.toLowerCase()) : "";
  const cuerpo = b.replace(/^<!--.*?-->\n?/, "").trim();
  const x = { cab: c._, para: paraDe(c.para), id: (c.id || "").trim(), accion: (c.accion || "").trim(), respondeA: c["responde-a"] || "",
    tit, de, etiquetas: etiquetasDe(tit), cuerpo,
    estado: estadoDe([c.estado, ...String(c._).split("|").filter((f) => /^\s*(te toca|espera)\s*:/i.test(f))].filter(Boolean).join("; ")) };
  x.tag = x.etiquetas[0] || "";
  x.clave = (x.id ? "id:" + x.id + "|" : "") + "tit:" + tit.slice(0, 120);
  x.pideIA = pideIADe(x);
  x.pideHumanoTexto = x.estado ? (!!x.estado.toca || PREGUNTA_J.test(b)) : PIDE_J.test(b);
  return x;
}

function mismaEtiqueta(a, b) {
  const x = String(a).replace(/-/g, " "), y = String(b).replace(/-/g, " ");
  if (x === y) return true;
  const [c, l] = x.length <= y.length ? [x, y] : [y, x];
  return c.length >= 5 && l.startsWith(c + " ");
}
const comparten = (a, b) => a.some((t) => b.some((u) => mismaEtiqueta(t, u)));

const TEMA_NO = /^(COO|CLAUDE|CURSOR|GROK|CRIBA|OCA|SLACK|CANAL|CRUCE|ACUSE|COORD|COORDINACION|RESPUESTA|ENCARGO|VOTO|VOTOS|FINAL|START|NOTA|HUMANO|INFO|PARA|FASE|PARTE|CIERRE|TEXTO|\d+)$/;
function temasDe(b) {
  const s = new Set(), pon = (p) => { p = sinTildes(String(p || "")).toUpperCase(); if (p.length >= 4 && !TEMA_NO.test(p)) s.add(p); };
  for (const e of b.etiquetas || []) { pon(e); String(e).split(/[^A-Za-z0-9-]+/).forEach(pon); }
  for (const m of String(b.tit + " " + b.id).matchAll(/\b[A-Z][A-Z0-9]+-\d+\b/g)) pon(m[0]);
  if (!/^\d+$/.test(b.id || "")) String(b.id || "").split("-").forEach(pon);
  return s;
}
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function aliasDe(id) {
  id = String(id || "").trim(); if (id.length < 2) return [];
  const s = new Set([id]), sinF = id.replace(/-20\d{6}$/, ""); if (sinF.length >= 6) s.add(sinF); return [...s];
}
const citaId = (texto, id) => aliasDe(id).some((a) => new RegExp(`(^|[^\\w-])${escRe(a)}(?![\\w]|-\\d)`, "i").test(String(texto || "")));
const respondeADe = (b) => String(b.respondeA || "").split(/\s*[,;]\s*/).map((x) => x.trim()).filter((x) => x.length >= 2);
const clavesDe = (b) => [...aliasDe(b.id), ...respondeADe(b).flatMap(aliasDe), ...(b.etiquetas || []).filter((e) => /\d/.test(e))];
function ligados(a, b) {
  const ka = clavesDe(a), kb = clavesDe(b);
  return ka.some((k) => kb.some((q) => k.toUpperCase() === q.toUpperCase() || mismaEtiqueta(k.toUpperCase(), q.toUpperCase())))
    || (!!a.id && citaId(b.respondeA, a.id)) || (!!b.id && citaId(a.respondeA, b.id));
}
function contestado(bs, i, ia) {
  const b = bs[i];
  const idNum = /^\d{2,5}$/.test(b.id) ? b.id : "";
  const idTxt = !idNum && String(b.id || "").length >= 6 ? b.id : "";
  const temas = b.etiquetas.length ? null : temasDe(b);
  const aQue = respondeADe(b);
  for (let j = i + 1; j < bs.length; j++) {
    const o = bs[j]; if (o.de !== ia) continue;
    const texto = o.respondeA + "\n" + o.tit + "\n" + o.cuerpo.slice(0, 1500);
    if (idTxt && texto.includes(idTxt)) return true;
    if (aQue.some((k) => citaId(o.respondeA, k))) return true;
    if (!b.etiquetas.length && !idNum && !idTxt) return true;
    if (comparten(b.etiquetas, o.etiquetas)) return true;
    if (idNum && new RegExp(`\\b${idNum}\\b`).test(o.respondeA + "\n" + o.tit + "\n" + o.cuerpo.slice(0, 600))) return true;
    if (temas && temas.size) { const ot = sinTildes(o.tit + " " + o.id + " " + (o.etiquetas || []).join(" ")).toUpperCase(); if ([...temas].some((t) => ot.includes(t))) return true; }
    else if (temas && !b.etiquetas.length && !idNum) return true;   // sin tema reconocible: como antes, cualquier bloque suyo
  }
  return false;
}

// todos los bloques de un texto, con lo que FALTA de cada uno: faltan = IAs a las que se pidió algo y aún no han contestado;
// pideHumano = lo que pide a Humano, pero solo cuando ya no falta ninguna IA (si no, aún no es su turno)
function leer(txt) { return leerLista(partir(txt)); }
const RETIENE = /\bretenid[oa]s?\b|\bretengo\b|\bobsolet[oa]s?\b|\bno se lleva(n)? a (Humano|JJ)\b|\bsin efecto\b|\banulad[oa]s?\b|\bdescartad[oa]s?\b|\bya no (vale|aplica)n?\b/i;
const SUSTITUYE = /\bsustituyen? a\s/i;
const llave = (x) => (aliasDe(x)[0] || "").toUpperCase();
function retenidos(bs) {
  const primera = new Map();   // id → índice del primer bloque que lo retiró
  bs.forEach((c, ci) => {
    const ids = new Set(), antes = bs.slice(0, ci);
    if (/^correcci[oó]n\b/i.test(c.accion || "")) respondeADe(c).forEach((x) => ids.add(x));
    for (const frase of plano(c.tit + "\n" + c.cuerpo).replace(/\[[^\]\n]*\]/g, " ").split(/(?<=[.;:\n])/)) {
      const s = frase.match(SUSTITUYE), zona = RETIENE.test(frase) ? frase : s ? frase.slice(s.index, s.index + s[0].length + 40) : "";
      if (zona) for (const o of antes) if (o.id && citaId(zona, o.id)) ids.add(o.id);
    }
    if (!ids.size) return;
    c.retiene = [...ids];
    for (const x of ids) if (!primera.has(llave(x))) primera.set(llave(x), ci);
    const por = c.id || c.tit.slice(0, 60);
    antes.forEach((o, oi) => {
      if (o.retenido) return;
      const esEl = !!o.id && [...ids].some((x) => aliasDe(x).some((a) => aliasDe(o.id).includes(a)));
      const cuelga = !o.retiene && [...ids].some((x) => oi < primera.get(llave(x))
        && (citaId(o.respondeA, x) || citaId(o.estado && o.estado.toca, x) || citaId(o.tit, x)));
      if (esEl || cuelga) o.retenido = { por, de: c.de || "" };
    });
  });
}
function leerLista(raws) {
  const bs = raws.map(parse);
  retenidos(bs);
  bs.forEach((b, i) => {
    const sinRespuesta = b.retenido ? [] : b.pideIA.filter((ia) => !contestado(bs, i, ia));
    b.superado = !!b.de && b.etiquetas.length > 0 && bs.slice(i + 1).some((o) => o.de === b.de && comparten(b.etiquetas, o.etiquetas));
    if (!b.superado && b.de && b.id) b.superado = bs.slice(i + 1).some((o) => o.de === b.de && citaId(o.respondeA, b.id));
    b.faltan = b.superado ? [] : sinRespuesta;
    b.pideHumano = b.pideHumanoTexto && !sinRespuesta.length && !b.retenido;
  });
  bs.forEach((b, i) => {
    if (!b.pideHumano) return;
    const o = bs.slice(i + 1).filter((x) => !x.retenido && x.faltan.length && ligados(b, x)).pop();
    if (o) { b.pideHumano = false; b.enPreparacion = { id: o.id, de: o.de, faltan: o.faltan, accion: o.accion }; }
  });
  bs.forEach((b, i) => {
    if (!b.pideHumano || !b.estado) return;
    const antes = bs.slice(Math.max(0, i - 40), i);
    let o = null;
    if (REMITE.test(b.estado.toca)) o = antes.filter((x) => x.estado && x.estado.toca && !REMITE.test(x.estado.toca) && !x.retenido && ligados(b, x)).pop();
    else if (!/[?¿]/.test(b.estado.toca) && (b.estado.tocaEspera || /^(cruce|acuse|conforme)\b/i.test(b.accion || "") || /\b(acuse|conforme|cruce)\b/i.test(b.tit)))
      o = antes.filter((x) => x.pideHumano && x.estado && /[?¿]/.test(x.estado.toca) && !x.retenido && x.id && citaId(b.respondeA, x.id)).pop();
    if (o) { b.estado.toca = o.estado.toca; b.tocaDe = o.tocaDe || o.id; }
  });
  return bs;
}
const REMITE = /\bpregunta (?:ya )?(?:en|hecha en) (?:Slack|el canal|el hilo)\b|\bno (?:la )?repite\b|\ben Slack\s*(?:\([^)]*\))?\s*$|^\s*(?:el\s+)?OK\b[^?¿]{0,40}$/i;

module.exports = { partir, cabecera, paraDe, etiquetasDe, estadoDe, pideIADe, parse, contestado, leer, leerLista, mismaEtiqueta, comparten, GENERICAS, IAS,
  citaId, aliasDe, ligados, RETIENE };   // v398
