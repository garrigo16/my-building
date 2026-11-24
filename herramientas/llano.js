"use strict";
function llano(t) {
  return String(t || "")
    .replace(/\s*\(en el canal git:[^)]*\)/gi, "").replace(/^\s*(Humano|JJ)\s*[—–:-]\s*/i, "")
    .replace(/\b(?:del?\s+)?(?:el\s+)?bloque\s+(?:Claude|Cursor|Coo)\s*-\s*\d+\b/gi, "del borrador").replace(/\b(?:Claude|Cursor|Coo)\s*-\s*\d{1,4}\b/g, "")
    .replace(/`?\b[A-Z]{2,}(?:-[A-Za-z0-9]+)*-20\d{6}\b`?/g, "").replace(/`?\b(?:COO|CLAUDE|CURSOR)-[A-Z0-9-]{4,}\b`?/g, "")
    .replace(/\s*\([^()]*\b(?:sha|commit)\s*`?[0-9a-f]{7,40}`?[^()]*\)/gi, "")
    .replace(/\(?\b(?:sha|commit)\s*`?[0-9a-f]{7,40}`?\)?/gi, "").replace(/`[0-9a-f]{7,40}`/g, "")
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, "")
    .replace(/\b(cruzad[oa]s?|cruce)\s+3\s*\/\s*3\b/gi, "$1 por las tres IAs").replace(/\b3\s*\/\s*3\b/g, "las tres IAs")
    .replace(/\bcanal git\b/gi, "canal de las IAs").replace(/\(\s*[,;·]\s*/g, "(")
    .replace(/\(\s*(?:el\s+)?bloque\s+de\s+(Claude|Cursor|Coo|Grok)\s*,?\s*(\d{1,2}:\d{2})\s*\)/gi, "($1, $2)")
    .replace(/^[\s\S]*$/, (s) => ((s.match(/\bOK\s+\d{1,2}\b/g) || []).length === 1 ? s.replace(/\bOK\s+\d{1,2}\b(?=\s+(?:para|a|al)\b)/, "OK") : s))
    .replace(/\s*\((?:desde\s+)?(?:(?:su|la|tu)\s+)?sesi[oó]n\s+(?:con\s+)?PowerShell\)/gi, "")
    .replace(/,?\s*desde\s+(?:(?:su|la|tu)\s+sesi[oó]n\s+(?:con\s+)?)?PowerShell\s*,?/gi, " ")
    .replace(/\s*\((?:check ?only|checkOnly|dry[- ]run|validate)\)/gi, "")
    .replace(/\(\s*[,;·]?\s*\)/g, "").replace(/\s+([,.;:?])/g, "$1").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ")
    .replace(/\s+(?:de|del|en|al|a)\s*([?!.,;:]|$)/gi, "$1").trim();
}
module.exports = { llano };
