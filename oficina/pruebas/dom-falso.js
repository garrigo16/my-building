// dom-falso.js - v567: un navegador de mentira, lo justo para EJECUTAR el <script> de public/index.html en node (sin jsdom ni
// nada que instalar) y ver si pinta o revienta. No dibuja: cada elemento guarda lo que le ponen (innerHTML, textContent, clases,
// data-…) y contesta a todo lo demás con algo que no rompe. Lo usa pruebas/pagina-pinta.js.
//   const P = cargaPagina({ estado, apuntes });   // ejecuta el script entero (como al abrir la página)
//   P.ctx.pinta(estado)                             // una función de la página, por su nombre
//   await P.reposa()                                // deja correr las promesas y los setTimeout de una vez (no los setInterval)
//   P.errores                                       // lo que la página mandó a console.error / window.onerror / promesas sin recoger
//   P.el("deti").innerHTML                          // lo que la página escribió en un elemento por su id
//   P.posts                                         // los POST que intentó (no sale ninguno: se contestan con { ok:false })
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");

// algo que vale para todo: se puede llamar, construir, leer cualquier propiedad, recorrer (vacío) y pasar a texto ("") o número (0)
function comodin() {
  const cache = new Map();
  const p = new Proxy(function () {}, {
    get(_, k) {
      if (k === Symbol.toPrimitive) return (h) => (h === "number" ? 0 : "");
      if (k === Symbol.iterator) return function* () {};
      if (k === "then" || k === "toJSON" || typeof k === "symbol") return undefined;
      if (k === "length" || k === "width" || k === "height" || k === "top" || k === "left" || k === "right" || k === "bottom" || k === "x" || k === "y") return 0;
      if (k === "toString" || k === "valueOf") return () => "";
      if (!cache.has(k)) cache.set(k, comodin());
      return cache.get(k);
    },
    set() { return true; }, has() { return true; }, deleteProperty() { return true; },
    apply() { return comodin(); }, construct() { return comodin(); },
  });
  return p;
}

function clases() {
  const s = new Set();
  return { add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)), contains: (c) => s.has(c),
    toggle(c, f) { const pon = f === undefined ? !s.has(c) : !!f; if (pon) s.add(c); else s.delete(c); return pon; },
    replace(a, b) { s.delete(a); s.add(b); }, get length() { return s.size; }, toString: () => [...s].join(" "), forEach: (f) => s.forEach(f), [Symbol.iterator]: () => s[Symbol.iterator]() };
}

// un elemento: lo que se le escribe se queda; lo que se busca dentro de él SIEMPRE aparece (otro elemento), para que el código
// que viene detrás (el.querySelector(".pie").insertAdjacentHTML(…)) se ejecute en vez de saltarse
// (alPonerId: un elemento creado por la página al que luego le pone id — «ot.id = "p-otros"» — se encuentra después por ese id)
function elemento(tag = "div", id = "", hondo = 0, alPonerId = null) {
  const hijos = new Map(), oyentes = {}, attrs = {};
  // primer hijo, padre y hermanos: existen (otro elemento) las primeras veces que se piden, para que «b.firstChild.textContent = …»
  // funcione; después null, para que «while (el.firstChild) el.removeChild(el.firstChild)» acabe
  let pedidos = 0, pariente = null;
  const cerca = () => (hondo < 3 && pedidos++ < 40 ? (pariente = pariente || elemento("div", "", hondo + 1)) : null);
  const base = {
    tagName: String(tag).toUpperCase(), nodeName: String(tag).toUpperCase(), nodeType: 1, id, _html: "", _txt: "", className: "", value: "", checked: false, hidden: false, open: false, disabled: false,
    dataset: {}, style: new Proxy({ setProperty() {}, removeProperty() {}, getPropertyValue: () => "" }, { get: (t, k) => (k in t ? t[k] : ""), set: (t, k, v) => { t[k] = v; return true; } }),
    classList: clases(), children: [], childNodes: [], isConnected: true,
    get parentNode() { return cerca(); }, get parentElement() { return cerca(); }, get firstChild() { return cerca(); }, get lastChild() { return cerca(); },
    get firstElementChild() { return cerca(); }, get lastElementChild() { return cerca(); }, get offsetParent() { return cerca(); },
    nextSibling: null, previousSibling: null, nextElementSibling: null, previousElementSibling: null, shadowRoot: null,
    scrollTop: 0, scrollLeft: 0, scrollHeight: 0, scrollWidth: 0, clientWidth: 1024, clientHeight: 700, offsetWidth: 100, offsetHeight: 20, offsetTop: 0, offsetLeft: 0,
    selectionStart: 0, selectionEnd: 0, childElementCount: 0, files: [], options: [],
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); this._txt = ""; },
    get outerHTML() { return this._html; }, set outerHTML(v) { this._html = String(v); },
    get textContent() { return this._txt || this._html.replace(/<[^>]+>/g, ""); }, set textContent(v) { this._txt = String(v); this._html = ""; },
    get innerText() { return this.textContent; }, set innerText(v) { this.textContent = v; },
    insertAdjacentHTML(_, h) { this._html += String(h); }, insertAdjacentElement(_, e) { return e; }, insertAdjacentText(_, t) { this._txt += String(t); },
    append() {}, prepend() {}, appendChild: (x) => x, removeChild: (x) => x, insertBefore: (x) => x, replaceChild: (x) => x, replaceWith() {}, replaceChildren() {}, remove() {}, after() {}, before() {},
    cloneNode: () => elemento(tag), contains: () => false, matches: () => false, closest: () => null,
    querySelector(sel) { const k = String(sel); if (!hijos.has(k)) hijos.set(k, elemento("div")); return hijos.get(k); },
    querySelectorAll(sel) { return [this.querySelector(sel)]; },
    getElementsByClassName(c) { return [this.querySelector("." + c)]; }, getElementsByTagName(t) { return [this.querySelector(t)]; },
    setAttribute(k, v) { attrs[k] = String(v); }, getAttribute: (k) => (k in attrs ? attrs[k] : null), hasAttribute: (k) => k in attrs, removeAttribute(k) { delete attrs[k]; }, toggleAttribute() {},
    addEventListener(t, f) { (oyentes[t] = oyentes[t] || []).push(f); }, removeEventListener() {}, dispatchEvent: () => true,
    getBoundingClientRect: () => ({ top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20, x: 0, y: 0 }), getClientRects: () => [],
    focus() {}, blur() {}, click() {}, select() {}, scrollIntoView() {}, scrollTo() {}, scrollBy() {}, setSelectionRange() {}, showModal() {}, show() {}, close() {}, animate: () => comodin(),
    getContext: () => comodin(), getTotalLength: () => 0, getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }), play: () => Promise.resolve(), pause() {}, toDataURL: () => "",
    _oyentes: oyentes,
  };
  const yo = new Proxy(base, { get(t, k, r) { if (k in t || typeof k === "symbol") return Reflect.get(t, k, r); if (/^on[a-z]+$/.test(k)) return null; return undefined; },
    set(t, k, v, r) { const ok = Reflect.set(t, k, v, r); if (k === "id" && alPonerId && v) alPonerId(String(v), yo); return ok; } });
  return yo;
}

// cargaPagina({ estado, apuntes, informe, ancho, html }) → { ctx, errores, posts, el, reposa }
function cargaPagina({ estado, apuntes = { ok: true, ver: 1, notas: {}, recordatorios: [], ajustes: {} }, informe = null, ancho = 1024, html = "" } = {}) {
  const fuente = html || fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  const scripts = [...fuente.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  // los id que existen en el HTML de verdad: getElementById de uno que no está devuelve null, como en el navegador
  const ids = new Set([...fuente.replace(/<script>[\s\S]*?<\/script>/g, "").matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const errores = [], posts = [], porId = new Map(), esperas = [], almacen = new Map();
  const el = (id) => { if (!porId.has(id)) porId.set(id, elemento("div", id)); return porId.get(id); };
  const oyDoc = {};
  const documento = Object.assign(elemento("html"), {
    getElementById: (id) => (ids.has(id) || porId.has(id) ? el(id) : null),
    createElement: (t) => elemento(t, "", 0, (id, e) => porId.set(id, e)),
    createElementNS: (_, t) => elemento(t), createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }), createDocumentFragment: () => elemento("fragment"),
    body: elemento("body"), documentElement: elemento("html"), head: elemento("head"), activeElement: null, hidden: false, visibilityState: "visible",
    title: "Oficina de las IAs", cookie: "", readyState: "complete", fonts: { ready: Promise.resolve(), add() {} },
    addEventListener(t, f) { (oyDoc[t] = oyDoc[t] || []).push(f); }, removeEventListener() {}, execCommand: () => true, hasFocus: () => true,
    getSelection: () => ({ toString: () => "", removeAllRanges() {}, addRange() {} }), createRange: () => comodin(),
    createTreeWalker: () => ({ nextNode: () => null, currentNode: null }), createNodeIterator: () => ({ nextNode: () => null }),
  });
  const guarda = { getItem: (k) => (almacen.has(k) ? almacen.get(k) : null), setItem: (k, v) => { almacen.set(k, String(v)); }, removeItem: (k) => { almacen.delete(k); }, clear: () => almacen.clear(), key: () => null, get length() { return almacen.size; } };
  const responde = (cuerpo, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => JSON.parse(JSON.stringify(cuerpo)), text: async () => JSON.stringify(cuerpo), headers: { get: () => "" } });
  const fetchFalso = (url, o = {}) => {
    const u = String(url), m = String((o && o.method) || "GET").toUpperCase();
    if (m !== "GET") { posts.push({ url: u, cuerpo: o.body || "" }); return responde({ ok: false, error: "prueba: nada se envía" }, 403); }
    if (u.startsWith("/api/estado")) return responde(estado);
    if (u.startsWith("/api/apuntes")) return responde(apuntes);
    if (u.startsWith("/api/informe")) return informe ? responde(informe) : responde({ ok: false }, 404);
    return Promise.reject(new Error("prueba: sin red (" + u.slice(0, 60) + ")"));
  };
  const ventana = {
    document: documento, console: { log() {}, info() {}, debug() {}, warn() {}, error: (...a) => errores.push("console.error: " + a.map((x) => (x && x.stack) || String(x)).join(" ")) },
    fetch: fetchFalso, localStorage: guarda, sessionStorage: guarda,
    setTimeout: (f, ms) => { if (typeof f === "function") esperas.push({ f, ms: +ms || 0 }); return esperas.length; }, clearTimeout() {},
    setInterval: () => 0, clearInterval() {}, requestAnimationFrame: (f) => { if (typeof f === "function") esperas.push({ f: () => f(0), ms: 16 }); return 0; }, cancelAnimationFrame() {},
    requestIdleCallback: (f) => { if (typeof f === "function") esperas.push({ f: () => f({ timeRemaining: () => 50, didTimeout: false }), ms: 1 }); return 0; }, cancelIdleCallback() {},
    queueMicrotask, structuredClone, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController, Intl, JSON, Math, Date, Promise, performance: { now: () => 0, mark() {}, measure() {} },
    innerWidth: ancho, innerHeight: 800, outerWidth: ancho, outerHeight: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0, pageYOffset: 0, pageXOffset: 0,
    location: { href: "http://127.0.0.1:4317/", origin: "http://127.0.0.1:4317", host: "127.0.0.1:4317", hostname: "127.0.0.1", pathname: "/", search: "", hash: "", reload() {}, replace() {}, assign() {} },
    history: { pushState() {}, replaceState() {}, back() {}, state: null, length: 1 },
    navigator: { userAgent: "node (prueba)", language: "es-ES", languages: ["es-ES"], onLine: true, platform: "Win32", maxTouchPoints: 0, hardwareConcurrency: 4,
      clipboard: { writeText: async () => {}, readText: async () => "" }, serviceWorker: undefined, vibrate() {}, sendBeacon: () => true },
    screen: { width: ancho, height: 800, availWidth: ancho, availHeight: 800 },
    matchMedia: (q) => ({ matches: /max-width:\s*(\d+)px/.test(q) ? ancho <= +RegExp.$1 : /min-width:\s*(\d+)px/.test(q) ? ancho >= +RegExp.$1 : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    getComputedStyle: () => new Proxy({ getPropertyValue: () => "" }, { get: (t, k) => (k in t ? t[k] : "") }),
    addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, scrollTo() {}, scrollBy() {}, focus() {}, blur() {}, open: () => null, close() {}, alert() {}, confirm: () => false, prompt: () => null,
    getSelection: () => ({ toString: () => "", removeAllRanges() {}, addRange() {} }),
    EventSource: class { constructor() { this.readyState = 1; } addEventListener() {} close() {} },
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } }, ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} }, PerformanceObserver: class { observe() {} disconnect() {} },
    Notification: Object.assign(class { close() {} }, { permission: "denied", requestPermission: async () => "denied" }),
    Audio: class { play() { return Promise.resolve(); } pause() {} }, Image: class { }, Event: class { constructor(t) { this.type = t; } }, CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    AudioContext: undefined, webkitAudioContext: undefined, speechSynthesis: undefined, SpeechSynthesisUtterance: undefined,
    Element: class {}, HTMLElement: class {}, Node: class {}, NodeFilter: { SHOW_ALL: -1, SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 }, DOMParser: class { parseFromString() { return documento; } }, Blob: class {}, FileReader: class {}, FormData: class {},
    CSS: { escape: (s) => String(s), supports: () => false }, crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000000", getRandomValues: (a) => a },
    atob: (s) => Buffer.from(String(s), "base64").toString("binary"), btoa: (s) => Buffer.from(String(s), "binary").toString("base64"),
  };
  ventana.window = ventana.self = ventana.globalThis = ventana.top = ventana.parent = ventana;
  const ctx = vm.createContext(ventana);
  const alFallar = (e) => errores.push("promesa sin recoger: " + ((e && e.stack) || e));
  process.on("unhandledRejection", alFallar);
  // let/const de arriba del todo no cuelgan de window: se sacan con otra pasada por el mismo contexto
  const saca = (nombre) => { try { return vm.runInContext(nombre, ctx); } catch (e) { return undefined; } };
  let rotura = null;
  for (const s of scripts) { try { vm.runInContext(s, ctx, { filename: "index.html <script>", timeout: 20000 }); } catch (e) { rotura = e; errores.push("al cargar: " + (e.stack || e)); break; } }
  // deja correr promesas y los setTimeout/requestAnimationFrame pedidos (cada uno UNA vez, hasta `vueltas` tandas), sin esperar de verdad
  const reposa = async (vueltas = 6) => {
    for (let i = 0; i < vueltas; i++) {
      await new Promise((r) => setImmediate(r));
      const tanda = esperas.splice(0).filter((x) => x.ms <= 5000);
      for (const x of tanda) { try { x.f(); } catch (e) { errores.push("en un temporizador: " + (e.stack || e)); } }
      await new Promise((r) => setImmediate(r));
      if (!esperas.length) break;
    }
    await new Promise((r) => setImmediate(r));
  };
  const suelta = () => process.removeListener("unhandledRejection", alFallar);
  // lo que hay escrito en TODOS los elementos con id (para buscar «undefined», «[object Object]»…)
  const todoElTexto = () => [...porId.entries()].map(([id, e]) => `#${id}: ${e._html || e._txt}`).join("\n");
  return { ctx, saca, errores, posts, el, reposa, suelta, rotura, todoElTexto, ids, oyentes: oyDoc, documento };
}

module.exports = { cargaPagina, elemento, comodin };
