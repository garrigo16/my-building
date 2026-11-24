// servidor-falso.js - una oficina de mentira con HTTP de verdad, para recorrer «Estoy en ello» y «Juntar» de punta a punta: la página
// real, sus POST reales, los ficheros de estado en una carpeta temporal y un Slack simulado. No lee Slack, git ni el disco del equipo.
// A mano: node oficina/pruebas/servidor-falso.js [puerto] (GET /__enviados enseña lo que habría salido; Ctrl+C lo para).
// Los Host/Origin se reescriben al de la oficina (postLocal solo admite ese puerto): es el único apaño.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http");

const MIN = 60e3;
const tsDe = (ms) => (ms / 1000).toFixed(6);
const msg = (t, quien, texto) => ({ ts: tsDe(t), quien, texto, menc: [] });

// los temas de la prueba, a partir de «ahora» (t0, en ms)
function hilosDe(t0) {
  const h = (min) => t0 - min * MIN;
  // A) «Te toca»: Sara contestó por privado de Slack (EEE posible, por Slack)
  const A0 = msg(h(270), "Humano", "*Hilo: Luis · DEMO-101 tema de ejemplo A*\n🎯 Objetivo: Ayudar a Luis con el ejemplo A");
  const A1 = msg(h(136), "Coo", "Coo: aviso enviado a Sara. [espera: Sara — repetir la prueba del ejemplo A]");
  // B) «Te toca»: Charla trae a Marta por Google Chat (EEE no posible: «Copiar aviso»)
  const B0 = msg(h(200), "Humano", "*Hilo: Marta · DEMO-202 tema de ejemplo B*\n🎯 Objetivo: contestar a Marta");
  const B1 = msg(h(100), "Coo", "Coo: aviso enviado a Marta. [espera: Marta — confirmar el ejemplo B]");
  const B2 = msg(h(2), "Charla", "💬 Charla: Marta contestó: no le va el ejemplo B (Google Chat)");
  // C) viejo que espera a Eva + hilo nuevo de Pau con la misma clave: propuesta «¿Juntar?»
  const C0 = msg(h(240), "Humano", "*Hilo: Luis · DEMO-303 tema de ejemplo C*\n🎯 Objetivo: Ayudar a Luis con el ejemplo C");
  const C1 = msg(h(150), "Coo", "Coo: aviso enviado a Eva por Google Chat. [espera: Eva — repetir el ejemplo C de DEMO-303]");
  const D0 = msg(h(20), "Charla", "_Hilo: Pau · DEMO-303, subir el arreglo_\n🎯 Objetivo: contestar a Pau\n📥 Origen: Chat · Pau Ruiz\nDani ha subido el arreglo.");
  const D1 = msg(h(19), "Charla", "💬 Charla: Pau ha escrito: arreglo listo. [te toca: ¿le confirmo que lo probamos mañana?]");
  return {
    A: { ts: A0.ts, msgs: [A0, A1] }, B: { ts: B0.ts, msgs: [B0, B1, B2] }, C: { ts: C0.ts, msgs: [C0, C1] }, D: { ts: D0.ts, msgs: [D0, D1] },
    respEsperas: { [A0.ts]: { nombre: "Sara", uid: "USARA", dm: "DSARA", t: h(2), texto: "sigue sin funcionarle" } },
  };
}

const L0 = (o) => ({ arranquesCursor: [], frenos: [], avisosCoo: [], sesionHilo: {}, lanzHilo: {}, cursorSlack: [], esperas: [], ultEsc: 0, lanz: [], timbreHilo: "", traspasos: [], ...o });

// el estado de /api/estado: analizar() de verdad sobre los temas + lo mínimo que pinta la página (misma forma que pagina-pinta.js)
function estadoDe(S, t0, F, dir) {
  const a = S.analizar([F.A, F.B, F.C, F.D], L0({ respEsperas: F.respEsperas, estoyEnEllo: S.leeEnEllo(path.join(dir, "estoy-en-ello.json")), juntados: S.leeJuntados(path.join(dir, "juntados.txt")), sfAuto: { no: {}, apagado: false } }), null, null, []);
  const dia = (n) => { const d = new Date(t0 - n * 86400e3); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const horas = () => Array.from({ length: 24 }, () => 0);
  return { listo: true, t: t0, ...a,
    linea: a.hilos.flatMap((h) => (h.msgs || []).slice(-3).map((x) => ({ t: x.t, quien: x.quien, tema: h.tema, hilo: h.ts, texto: String(x.texto || "").slice(0, 200) }))).sort((x, y) => x.t - y.t),
    git: [], errores: {}, alDia: null, canalHoy: {}, entreIAs: { matriz: [], pendientes: [], t: t0 },
    escucha: { viva: true, ultLog: t0 - 60e3, conexion: { estado: "conectada", desde: t0 - 3600e3 } },
    freno: { ultimaHora: 0, max: 40, proximo: 0, porQuien: {} }, envio: { directo: true, k: S.CLAVE },
    turno: { equipo: "casa", de: "casa", mio: true, sabido: true, latidos: { casa: t0 - 30e3 }, desde: 1, leido: t0 },
    semana: Array.from({ length: 14 }, (_, i) => ({ dia: dia(13 - i), temas: 0, msgs: {}, horas: horas(), porTema: {}, jIni: null, jFin: null, lanz: {}, frenos: 0 })),
    historial: {}, consumo: {}, gastoSes: { hoy: { total: 0, porTipo: { slack: 0, canal: 0, tu: 0 }, top: [] }, semana: { total: 0, porTipo: { slack: 0, canal: 0, tu: 0 }, top: [] } },
    coordinadores: ["coord-salesforce"], diarioOtro: null, coordinacion: { equipo: false }, reuniones: null, casa: dir, relanzar: a.relanzar || [],
    update: { modo: "manual", lista: null, cocina: [], pospuesto: 0, estrenando: null, reciente: null, bloqueado: false, linea: null },
    rendimiento: { cpu: 1, bloqueoMax: 0, bloqueoFase: "", bloqueos: 0, vuelta: { mediana: 1000, max: 2000 }, lento: null, fuentes: {} } };
}

// arranca({ S, dir, t0, puerto }) → { url, puerto, enviados, F, estado(), cerrar() }.  «dir» guarda lo que sobrevive a un reinicio
// (estoy-en-ello.json y juntados.txt); los envíos a Slack solo se apuntan en «enviados» (nada sale).
async function arranca({ S, dir, t0 = Date.now(), puerto = 0, enviados = [] }) {
  fs.mkdirSync(dir, { recursive: true });
  const F = hilosDe(t0), html = path.join(__dirname, "..", "public", "index.html");
  const f = path.join(dir, "estoy-en-ello.json"), fj = path.join(dir, "juntados.txt");
  const post = async (body, tok) => { enviados.push({ channel: body.channel, text: body.text, tok }); return { ok: true, ts: "1" }; };   // el Slack simulado
  let ultimo = estadoDe(S, t0, F, dir);
  const propio = (req) => `127.0.0.1:${req.socket.localPort}`, real = [...S.HOSTS][0];
  const servidor = http.createServer((req, res) => {
    const mio = propio(req);
    if (req.headers.host === mio) req.headers.host = real;
    if (req.headers.origin && req.headers.origin.replace(/^https?:\/\//, "") === mio) req.headers.origin = "http://" + real;
    const ruta = req.url.split("?")[0];
    const json = (c, o) => { res.writeHead(c, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(o)); };
    if (req.method === "POST" && ruta === "/api/estoy-en-ello") return S.enElloRuta(req, res, { mandar: (hilo) => S.mandaEnEllo(hilo, { hilos: ultimo.hilos, post, tok: "xoxp-de-mentira", f }), refresca: () => { ultimo = estadoDe(S, t0, F, dir); } });
    if (req.method === "POST" && ruta === "/api/juntar") return S.juntarRuta(req, res, fj, () => { ultimo = estadoDe(S, t0, F, dir); });
    if (ruta === "/api/estado") { ultimo = estadoDe(S, t0, F, dir); let ver = 0; try { ver = fs.statSync(html).mtimeMs; } catch (e) {} return json(200, { ...ultimo, version: ver }); }
    if (ruta === "/api/apuntes") return json(200, { ok: true, ver: 0, notas: {}, recordatorios: [], ajustes: {} });
    if (ruta === "/__enviados") return json(200, enviados);
    if (ruta === "/" || ruta === "/index.html") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); return res.end(fs.readFileSync(html)); }
    res.writeHead(404); res.end("no");
  });
  await new Promise((r) => servidor.listen(puerto, "127.0.0.1", r));
  const p = servidor.address().port;
  return { url: `http://127.0.0.1:${p}`, puerto: p, enviados, F, estado: () => (ultimo = estadoDe(S, t0, F, dir)),
    cerrar: () => new Promise((r) => { servidor.closeAllConnections && servidor.closeAllConnections(); servidor.close(() => r()); }) };
}

module.exports = { arranca, hilosDe };

// a mano: node oficina/pruebas/servidor-falso.js [puerto]
if (require.main === module) {
  // server.js se carga como módulo (PRUEBAS = require.main !== module): no abre puerto ni toca nada
  const S = require("../server.js"), dir = fs.mkdtempSync(path.join(os.tmpdir(), "oficina-falsa-"));
  S.setTurno({ equipo: "casa", de: "casa", mio: true, sabido: true });
  arranca({ S, dir, puerto: +process.argv[2] || 0 }).then((o) => {
    console.log(`Oficina FALSA en ${o.url} (carpeta ${dir}; nada sale a Slack; GET /__enviados)`);
    const sal = () => { o.cerrar().then(() => { fs.rmSync(dir, { recursive: true, force: true }); process.exit(0); }); };
    process.on("SIGINT", sal); process.on("SIGTERM", sal);
  });
}
