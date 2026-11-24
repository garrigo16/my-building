// regla-ok.js - v192: ¿es un OK de Humano? UNA sola regla para la oficina (server.js) y la escucha (escucha-slack.js); antes
// cada uno tenía su copia. atender-slack.sh la tiene en bash (mismo criterio); oficina/pruebas/casuisticas.js comprueba que
// los tres dicen lo mismo.
"use strict";
function esOk(t) {
  const s = String(t || "").replace(/<@[A-Z0-9]+>/g, " ").trim();
  if (/^\s*(@[\w.-]+[\s,:]*)*(ok|okey|okay)\b/i.test(s)) return true;
  const sin = s.replace(/(^|\s)@[\w.-]+[,:]?/g, " ").replace(/\s+/g, " ").trim();
  return !/\n/.test(s) && sin.length <= 80 && !/\?/.test(sin)
    && /(^|[^\p{L}])(ok|okey|okay|vale|adelante|dale|hazlo|s[ií]|env[ií]alo|m[aá]ndalo|s[uú]belo|[aá]brel[ao])(?!\p{L})/iu.test(sin)
    && !/(^|[^\p{L}])(no|espera|cancela|todav[ií]a|a[uú]n)(?!\p{L})/iu.test(sin);
}
module.exports = { esOk };
