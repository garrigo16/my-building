(function () {
  "use strict";
  var E = window.EDIFICIO || {}, nombre = String(E.nombre || "").trim(), canal = String(E.canal || "").trim();
  var cambiaNombre = nombre && nombre.toLowerCase() !== "humano", cambiaCanal = canal && canal !== "canal-humano";
  if (!cambiaNombre && !cambiaCanal) return;
  var RE_CANAL = /canal-humano/g, RE_NOMBRE = /(^|[^A-Za-zÀ-ÿ0-9_@\/.-])Humano(?![A-Za-zÀ-ÿ0-9_-])/g, RE_MAYUS = /(^|[^A-Za-zÀ-ÿ0-9_@\/.-])HUMANO(?![A-Za-zÀ-ÿ0-9_-])/g;
  function pon(t) {
    if (!t || (t.indexOf("umano") < 0 && t.indexOf("HUMANO") < 0)) return t;
    if (cambiaCanal) t = t.replace(RE_CANAL, canal);
    if (cambiaNombre) t = t.replace(RE_NOMBRE, function (m, a) { return a + nombre; }).replace(RE_MAYUS, function (m, a) { return a + nombre.toUpperCase(); });
    return t;
  }
  var FUERA = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, CODE: 1, PRE: 1 }, ATRIB = ["title", "placeholder", "aria-label"];
  function repasa(n) {
    if (!n) return;
    if (n.nodeType === 3) { var v = pon(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v; return; }
    if (n.nodeType !== 1) return;
    for (var i = 0; i < ATRIB.length; i++) { var a = n.getAttribute && n.getAttribute(ATRIB[i]); if (a) { var b = pon(a); if (b !== a) n.setAttribute(ATRIB[i], b); } }
    if (FUERA[n.tagName] || n.isContentEditable) return;
    for (var c = n.firstChild; c; c = c.nextSibling) repasa(c);
  }
  function arranca() {
    repasa(document.body); document.title = pon(document.title);
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) {
        var m = ms[i];
        if (m.type === "characterData") repasa(m.target);
        else if (m.type === "attributes") repasa(m.target);
        else for (var j = 0; j < m.addedNodes.length; j++) repasa(m.addedNodes[j]);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATRIB });
  }
  if (document.body) arranca(); else document.addEventListener("DOMContentLoaded", arranca);
})();
