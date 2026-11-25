"use strict";
// oficina/pasarela-coo.js: la puerta del túnel de Coo. Sin red de fuera: la pasarela y un destino falso en 127.0.0.1.
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const P = require("../pasarela-coo.js");

const CLAVE = "clave-pasarela-prueba-456";
const escucha = (srv) => new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
const cierra = (srv) => new Promise((r) => srv.close(() => r()));
function pide(puerto, { method = "POST", ruta = "/api/coo/publicar", cabeceras = {}, cuerpo } = {}) {
  return new Promise((ok, mal) => {
    const b = cuerpo === undefined ? null : Buffer.from(typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo));
    const r = http.request({ hostname: "127.0.0.1", port: puerto, path: ruta, method, headers: { ...(b ? { "Content-Type": "application/json", "Content-Length": b.length } : {}), ...cabeceras } }, (res) => {
      const t = []; res.on("data", (d) => t.push(d)); res.on("end", () => ok({ code: res.statusCode, txt: Buffer.concat(t).toString("utf8") }));
    });
    r.on("error", mal); if (b) r.write(b); r.end();
  });
}

module.exports = async ({ prueba, igual }) => {
  console.log("Pasarela del túnel de Coo");
  const llegadas = [];
  const destino = http.createServer((req, res) => { const t = []; req.on("data", (d) => t.push(d)); req.on("end", () => {
    llegadas.push({ method: req.method, url: req.url, auth: req.headers.authorization, tipo: req.headers["content-type"], cuerpo: Buffer.concat(t).toString("utf8") });
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, ts: "1795541000.000100", permalink: "https://ejemplo.slack.com/archives/C0CJ16RBL6A/p1795541000000100" })); }); });
  const pd = await escucha(destino);
  const mk = (o = {}) => P.crearPasarela({ clave: () => CLAVE, destino: () => `http://127.0.0.1:${pd}/api/coo/publicar`, maxPorMin: 100, ...o });
  const BUENO = { channel: "C0CJ16RBL6A", thread_ts: "1795540186.383009", text: "Prueba de túnel HTTPS de Coo [hecho]" };
  const auth = { Authorization: "Bearer " + CLAVE };

  try {
    await prueba("pasarela coo: GET /api/estado y cualquier otra ruta o método → 404 sin cuerpo, y nunca se reenvían", async () => {
      const s = mk(), p = await escucha(s); const antes = llegadas.length;
      try {
        for (const [method, ruta] of [["GET", "/api/estado"], ["GET", "/"], ["POST", "/api/estado"], ["POST", "/api/enviar"], ["GET", "/api/coo/publicar"], ["PUT", "/api/coo/publicar"], ["POST", "/api/coo/publicar/x"], ["POST", "/../api/estado"]]) {
          const r = await pide(p, { method, ruta, cabeceras: auth, cuerpo: method === "GET" ? undefined : BUENO });
          igual([r.code, r.txt], [404, ""], `${method} ${ruta}`);
        }
        igual(llegadas.length, antes, "nada llegó al destino");
      } finally { await cierra(s); }
    });

    await prueba("pasarela coo: sin Bearer 401, clave mala 401, sin clave configurada 503 (sin reenviar)", async () => {
      const s = mk(), p = await escucha(s); const antes = llegadas.length;
      try {
        igual((await pide(p, { cuerpo: BUENO })).code, 401, "sin Authorization");
        igual((await pide(p, { cuerpo: BUENO, cabeceras: { Authorization: "Bearer otra" } })).code, 401, "clave mala");
        igual((await pide(p, { cuerpo: BUENO, cabeceras: { Authorization: "Bearer " + CLAVE + "x" } })).code, 401, "un carácter de más");
        igual((await pide(p, { cuerpo: BUENO, cabeceras: { Authorization: CLAVE } })).code, 401, "sin «Bearer»");
        igual(llegadas.length, antes, "nada reenviado");
      } finally { await cierra(s); }
      const s2 = mk({ clave: () => "" }), p2 = await escucha(s2);
      try { igual((await pide(p2, { cuerpo: BUENO, cabeceras: auth })).code, 503, "sin clave"); } finally { await cierra(s2); }
    });

    await prueba("pasarela coo: cuerpo de más de 16 KB → 413 sin reenviar", async () => {
      const s = mk(), p = await escucha(s); const antes = llegadas.length;
      try {
        const r = await pide(p, { cabeceras: auth, cuerpo: { ...BUENO, text: "x".repeat(17 * 1024) } });
        igual(r.code, 413, "grande");
        igual(llegadas.length, antes, "nada reenviado");
      } finally { await cierra(s); }
    });

    await prueba("pasarela coo: más de N peticiones por minuto → 429", async () => {
      let t = 1e12; const s = mk({ maxPorMin: 3, ahora: () => t }), p = await escucha(s);
      try {
        for (let i = 0; i < 3; i++) igual((await pide(p, { cuerpo: BUENO })).code, 401, "dentro del tope " + i);
        igual((await pide(p, { cuerpo: BUENO, cabeceras: auth })).code, 429, "la cuarta, aunque traiga clave");
        t += 61e3;
        igual((await pide(p, { cuerpo: BUENO, cabeceras: auth })).code, 200, "pasado el minuto, otra vez");
      } finally { await cierra(s); }
    });

    await prueba("pasarela coo: POST /api/coo/publicar con clave → reenvía a la oficina (Bearer y JSON) y devuelve su 200 y su JSON", async () => {
      const s = mk(), p = await escucha(s); const antes = llegadas.length;
      try {
        const r = await pide(p, { ruta: "/api/coo/publicar?x=1", cabeceras: auth, cuerpo: BUENO });
        igual(r.code, 200, "código");
        igual(JSON.parse(r.txt).permalink, "https://ejemplo.slack.com/archives/C0CJ16RBL6A/p1795541000000100", "permalink");
        const l = llegadas[antes];
        igual([llegadas.length - antes, l.method, l.url, l.auth, l.tipo, JSON.parse(l.cuerpo)], [1, "POST", "/api/coo/publicar", "Bearer " + CLAVE, "application/json", BUENO], "lo que llega a la oficina");
      } finally { await cierra(s); }
    });

    await prueba("pasarela coo: la oficina caída → 502; el código de la oficina (403/400) pasa tal cual", async () => {
      const s = mk({ destino: () => "http://127.0.0.1:9/api/coo/publicar" }), p = await escucha(s);
      try { igual((await pide(p, { cabeceras: auth, cuerpo: BUENO })).code, 502, "oficina caída"); } finally { await cierra(s); }
      const d2 = http.createServer((q, r) => { q.resume(); q.on("end", () => { r.writeHead(400, { "Content-Type": "application/json" }); r.end('{"ok":false,"error":"text vacío"}'); }); }), pd2 = await escucha(d2);
      const s2 = mk({ destino: () => `http://127.0.0.1:${pd2}/api/coo/publicar` }), p2 = await escucha(s2);
      try { const r = await pide(p2, { cabeceras: auth, cuerpo: BUENO }); igual([r.code, JSON.parse(r.txt).error], [400, "text vacío"], "400 de la oficina"); } finally { await cierra(s2); await cierra(d2); }
    });

    await prueba("pasarela coo: la clave sale de canal-slack.env (COO_WEBHOOK_KEY, si no GROK_WEBHOOK_KEY) y se relee al cambiar", async () => {
      const T = fs.mkdtempSync(path.join(os.tmpdir(), "pasarela-")), f = path.join(T, "canal-slack.env");
      try {
        const lee = P.lectorClave(f);
        igual(lee(), "", "sin fichero");
        fs.writeFileSync(f, "GROK_WEBHOOK_KEY=g1\nOTRA=x\n"); igual(lee(), "g1", "GROK");
        fs.writeFileSync(f, "GROK_WEBHOOK_KEY=g1\nCOO_WEBHOOK_KEY=c22\n"); fs.utimesSync(f, new Date(2030, 0, 1), new Date(2030, 0, 1));
        igual(lee(), "c22", "COO manda y se relee");
        igual([P.claveBuena("c22", "c22"), P.claveBuena("c2", "c22"), P.claveBuena("", "c22")], [true, false, false], "comparación");
      } finally { fs.rmSync(T, { recursive: true, force: true }); }
    });
  } finally { await cierra(destino); }
};
