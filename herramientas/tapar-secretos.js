// tapar-secretos.js - v572: UNA sola redacción de secretos para todo lo que las herramientas imprimen o apuntan (mule.js,
// los errores de la oficina, las notas del canal). Antes cada una llevaba su regex y todas dejaban trozos a la vista: la de
// mule.js solo conocía «Bearer» con esa mayúscula y un juego de caracteres corto (el token se veía a partir del primer
// carácter raro, y entero si iba entre comillas, en minúsculas, en JSON escapado o partido en dos líneas); las de las
// notas cambiaban la PALABRA «token» por «…» y dejaban el valor. Lo del 20/11 fue una sesión de Salesforce
// («Bearer 00D…!AQE…»): la regex paraba en el «!» y dejaba a la vista los 90 y pico caracteres de después.
// Regla: ante la duda se tapa de más. Del secreto no queda NI UN carácter: sale «••••» en su sitio.
//   tapaSecretos(texto, { secretos: [valores exactos que se conocen], largos: false para no tapar hex/base64 largos sueltos })
// Qué tapa: «Bearer/Basic <token>» (cualquier mayúscula, con comillas o sin ellas, en JSON, JSON escapado y cabeceras);
// clave=valor y "clave":"valor" cuando la clave parece un secreto (password, access_token, client_secret, api_key,
// authorization, cookie…), también en querystring, XML y «--password x»; usuario:clave@ en una URL; claves PEM; JWT (eyJ…);
// tokens de Slack (xox?-, xapp-, webhooks) y de otros servicios; y ristras largas de hex o base64.
// Los cortes: un token partido en varias líneas (la siguiente línea es solo «letras de token») se tapa entero, y uno cortado
// al final del texto (sin comilla de cierre ni salto de línea), también.
// Límite conocido: una ristra SIN clave ni prefijo que se parte en trozos de menos de 32 caracteres no se distingue de texto.
"use strict";
const M = "••••";
const CLAVE = /pass(?!ed|ing|ive|age|enger)|secret|token|pwd|credential|private.?key|signature|api.?key|access.?key|authorization|^auth$|cookie|session.?id|jwt|bearer|^sig$/i;
const CABECERA = /authorization|cookie/i;          // su valor sin comillas llega hasta el final de la línea
const ESQUEMA_TAPADO = /^(?:bearer|basic)\s+•+$/i;
// la línea siguiente es la continuación de un token partido si es SOLO letras de token (hasta el fin de línea, una comilla o el final)
const SIGUE = /(?:\r?\n|\\r\\n|\\n)[ \t]*[A-Za-z0-9._~+\/=-]+(?=[ \t]*(?:\r?\n|\\r|\\n|\\*["']|&|$))/y;
const sigue = (s, fin) => { for (;;) { SIGUE.lastIndex = fin; const m = SIGUE.exec(s); if (!m) return fin; fin = SIGUE.lastIndex; } };
const pega = (re, s, i) => { re.lastIndex = i; const m = re.exec(s); return m ? m[0].length : 0; };

// recorre s con re (global); rango(m) devuelve [ini, fin] de lo que hay que tapar (o null) y de ahí se sigue buscando
function tapa(s, re, rango) {
  let sal = "", desde = 0, m; re.lastIndex = 0;
  while ((m = re.exec(s))) {
    if (!m[0]) { re.lastIndex++; continue; }
    const r = rango(m); if (!r || r[1] <= r[0]) continue;
    const fin = sigue(s, r[1]);
    sal += s.slice(desde, r[0]) + M; desde = fin; re.lastIndex = fin;
  }
  return sal + s.slice(desde);
}

const COMILLA = /\\*["']/y;
const SUELTO = /(?:[^\s"'\\&•]|\\(?!\\*["'nrt]))+/y;                   // valor sin comillas: hasta un espacio, «&» o una comilla
const SUELTO_BEARER = /(?:[^\s"'\\&,;<>(){}\[\]•]|\\(?!\\*["'nrt]))+/y;  // el de «Bearer x»: además para en , ; y paréntesis
const LINEA = /(?:[^\r\n"\\]|\\(?!\\*["'nrt]))+/y;
// el valor que empieza en i: [ini, fin] con las comillas dentro (se tapa todo); sin comilla de cierre, hasta el final del texto
function valor(s, i, suelto) {
  const c = pega(COMILLA, s, i);
  if (c) {
    const d = s.slice(i, i + c), q = d[c - 1]; let j = i + c;
    if (c === 1) { for (; j < s.length && s[j] !== q; j++) if (s[j] === "\\") j++; }   // "…": las \" de dentro no cierran
    else { j = s.indexOf(d, j); if (j < 0) j = s.length; }                              // \"…\": hasta la misma marca
    const fin = Math.min(s.length, j + c);
    return { ini: i, fin, dentro: s.slice(i + c, Math.min(j, s.length)) };
  }
  const n = pega(suelto, s, i);
  return n ? { ini: i, fin: i + n, dentro: s.slice(i, i + n) } : null;
}

const es3 = (x) => /[a-z]/.test(x) && /[A-Z]/.test(x) && /\d/.test(x);
function largo(x) {   // ¿esta ristra es un token? hex de 32 o más; o 40 o más con pinta de azar (y no una ruta ni un nombre con guiones)
  const t = x.replace(/=+$/, "");
  if (/^[0-9a-fA-F]{32,}$/.test(t)) return true;
  if (t.length < 40) return false;
  if (/^[A-Za-z0-9+]+$/.test(t)) return /[A-Za-z]/.test(t) && /\d/.test(t);
  return es3(t) && (t.match(/\//g) || []).length * 12 <= t.length;
}

function tapaSecretos(texto, o = {}) {
  let s = String(texto == null ? "" : texto);
  // 0) los valores que quien llama conoce (su token, su client secret): tal cual
  for (const x of [...new Set((o.secretos || []).map((v) => String(v || "")).filter((v) => v.length >= 4))].sort((a, b) => b.length - a.length)) s = s.split(x).join(M);
  // 1) claves PEM (también cortadas, sin el END)
  s = s.replace(/-----BEGIN [A-Z0-9 ]*-----[\s\S]*?(?:-----END [A-Z0-9 ]*-----|$)/g, M);
  // 2) usuario:clave@ en una URL
  s = s.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s\/@:"']+:[^\s\/@"']+@/gi, "$1" + M + "@");
  // 3) Bearer / Basic <token>
  s = tapa(s, /\b(bearer|basic)((?:\s|%20|\+|\\[nrt])+)/gi, (m) => {
    const v = valor(s, m.index + m[0].length, SUELTO_BEARER); if (!v) return null;
    if (/^basic$/i.test(m[1]) && /^[a-z]+$/.test(v.dentro)) return null;   // «Basic authentication…» es una frase
    return [v.ini, v.fin];
  });
  // 4) clave = valor · "clave":"valor" · \"clave\":\"valor\" · clave%3Dvalor
  s = tapa(s, /(?:\\*["'])?([A-Za-z_][\w.-]*)(?:\\*["'])?\s*(?:=>|[:=]|%3[Dd])\s*/g, (m) => {
    if (!CLAVE.test(m[1])) return null;
    const i = m.index + m[0].length;
    const v = valor(s, i, CABECERA.test(m[1]) ? LINEA : SUELTO); if (!v) return null;
    if (ESQUEMA_TAPADO.test(v.dentro.trim())) return null;                                         // ya es «Bearer ••••»
    if (/^(?:bearer|basic)$/i.test(v.dentro) && /^\s+•/.test(s.slice(v.fin, v.fin + 8))) return null;
    return [v.ini, v.fin];
  });
  // 5) <password>valor</password>
  s = s.replace(/<([\w:.-]+)(\s[^>]*)?>([^<•]+)(?=<\/\1>|$)/g, (m, k, at, v) => (CLAVE.test(k) ? `<${k}${at || ""}>${M}` : m));
  // 6) --password valor
  s = tapa(s, /(?:^|\s)--?[\w-]*(?:pass|secret|token|pwd|api-?key)[\w-]*[ \t]+/gi, (m) => { const v = valor(s, m.index + m[0].length, SUELTO); return v && !v.dentro.startsWith("-") ? [v.ini, v.fin] : null; });
  // 7) JWT, Slack y otros tokens con prefijo propio
  s = tapa(s, /(?<![A-Za-z0-9])eyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*)*/g, (m) => [m.index, m.index + m[0].length]);
  s = tapa(s, /xox[a-z]-[^\s"'\\&,;<>(){}\[\]•]*|xapp-[^\s"'\\&,;<>(){}\[\]•]+|\b00D[A-Za-z0-9]{9,15}![A-Za-z0-9._]+|\b(?:gh[pousr]_[A-Za-z0-9]{10,}|github_pat_\w+|glpat-[\w-]+|sk-[A-Za-z0-9_-]{16,}|key_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16}|AIza[\w-]{20,})/g, (m) => [m.index, m.index + m[0].length]);
  s = s.replace(/(hooks\.slack\.com\/(?:services|triggers|workflows)\/)[^\s"'\\•]+/gi, "$1" + M);
  // 8) ristras largas de hex o base64
  if (o.largos !== false) s = tapa(s, /(?<![A-Za-z0-9+_=-])[A-Za-z0-9+\/_-]{32,}={0,2}/g, (m) => {
    if (largo(m[0])) return [m.index, m.index + m[0].length];
    let p = m.index;
    for (const trozo of m[0].split("/")) { if (largo(trozo)) return [p, p + trozo.length]; p += trozo.length + 1; }   // …/ruta/<token>
    return null;
  });
  return s;
}

module.exports = { tapaSecretos, MARCA: M };
