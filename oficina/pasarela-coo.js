// pasarela-coo.js - la única puerta de fuera hacia la oficina: solo POST /api/coo/publicar, con clave, tope de peticiones y de tamaño.
// Escucha SOLO en 127.0.0.1 (por defecto 4392); el túnel HTTPS (herramientas/tunel-coo.js) apunta aquí y nunca a la oficina.
// Todo lo demás (otro método, otra ruta) → 404 sin cuerpo. Sin Bearer o con clave mala → 401; sin clave configurada → 503;
// cuerpo grande → 413; más de COO_PASARELA_MAX_MIN peticiones por minuto → 429. Lo bueno se reenvía a la oficina
// (http://127.0.0.1:<oficina.puerto>/api/coo/publicar, o COO_DESTINO_URL) y se devuelve su código y su JSON.
// La clave: COO_WEBHOOK_KEY (o GROK_WEBHOOK_KEY) de ~/.config/canal-slack.env, releída si cambia el fichero. Nunca se escribe en logs.
"use strict";
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const { puertoOficina } = require(path.join(__dirname, "..", "herramientas", "puerto-oficina.js"));

const RUTA = "/api/coo/publicar";
const huella = (s) => crypto.createHash("sha256").update(String(s), "utf8").digest();
function claveBuena(dada, buena) { return crypto.timingSafeEqual(huella(dada), huella(buena)); }

// lee la clave del env con caché por mtime (y tamaño): si el fichero cambia, se relee
function lectorClave(fichero) {
  let visto = "", clave = "";
  return () => {
    let st; try { st = fs.statSync(fichero); } catch (e) { visto = ""; clave = ""; return ""; }
    const marca = st.mtimeMs + ":" + st.size;
    if (marca !== visto) {
      visto = marca; clave = "";
      try {
        const o = {};
        for (const l of fs.readFileSync(fichero, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)=(.*)$/); if (m) o[m[1]] = m[2].trim().replace(/^["']|["']$/g, ""); }
        clave = o.COO_WEBHOOK_KEY || o.GROK_WEBHOOK_KEY || "";
      } catch (e) { visto = ""; }
    }
    return clave;
  };
}

function crearPasarela(o = {}) {
  const env = o.env || process.env;
  const fichero = o.fichero || path.join(env.CANAL_HOME || os.homedir(), ".config", "canal-slack.env");
  const clave = o.clave || lectorClave(fichero);
  const destino = o.destino || (() => env.COO_DESTINO_URL || `http://127.0.0.1:${puertoOficina({ env })}${RUTA}`);
  const maxMin = +(o.maxPorMin || env.COO_PASARELA_MAX_MIN || 30), ventana = o.ventanaMs || 60e3;
  const maxBytes = +(o.maxBytes || env.COO_PASARELA_MAX_BYTES || 16 * 1024);
  const ahora = o.ahora || (() => Date.now());
  const anota = o.anota || (() => {});
  let marcas = [];
  const sinCuerpo = (res, code) => { res.writeHead(code); res.end(); };
  const json = (res, code, j) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(JSON.stringify(j)); };

  const srv = http.createServer((req, res) => {
    req.on("error", () => {});
    if (req.method !== "POST" || String(req.url || "").split("?")[0] !== RUTA) { req.resume(); return sinCuerpo(res, 404); }
    const t = ahora(); marcas = marcas.filter((x) => t - x < ventana);
    if (marcas.length >= maxMin) { req.resume(); res.setHeader("Retry-After", String(Math.ceil(ventana / 1000))); anota("429 tope de peticiones"); return json(res, 429, { ok: false, error: "demasiadas peticiones" }); }
    marcas.push(t);
    const buena = clave();
    if (!buena) { req.resume(); anota("503 sin clave configurada"); return json(res, 503, { ok: false, error: "pasarela sin clave configurada" }); }
    const m = String(req.headers.authorization || "").match(/^Bearer\s+(\S+)\s*$/i);
    if (!m || !claveBuena(m[1], buena)) { req.resume(); anota("401 " + (m ? "clave mala" : "sin Bearer")); return json(res, 401, { ok: false, error: "no autorizado" }); }
    if (+req.headers["content-length"] > maxBytes) { req.resume(); anota("413"); return json(res, 413, { ok: false, error: "demasiado grande" }); }
    const trozos = []; let n = 0, grande = false;
    req.on("data", (d) => { if (grande) return; n += d.length; if (n > maxBytes) { grande = true; anota("413"); json(res, 413, { ok: false, error: "demasiado grande" }); req.resume(); return; } trozos.push(d); });
    req.on("end", () => {
      if (grande) return;
      const cuerpo = Buffer.concat(trozos);
      let u; try { u = new URL(destino()); } catch (e) { return json(res, 502, { ok: false, error: "sin destino" }); }
      const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname, method: "POST", timeout: 30e3,
        headers: { Authorization: "Bearer " + m[1], "Content-Type": "application/json", "Content-Length": cuerpo.length } }, (rr) => {
        const vuelta = []; rr.on("data", (d) => vuelta.push(d));
        rr.on("end", () => {
          const txt = Buffer.concat(vuelta).toString("utf8");
          let j; try { j = JSON.parse(txt); } catch (e) { j = { ok: false, error: "respuesta no JSON de la oficina" }; }
          anota(`${rr.statusCode} reenviado`);
          json(res, rr.statusCode || 502, j);
        });
        rr.on("error", () => json(res, 502, { ok: false, error: "la oficina cortó la respuesta" }));
      });
      r.on("timeout", () => r.destroy(new Error("tiempo")));
      r.on("error", () => { if (!res.headersSent) { anota("502 oficina no responde"); json(res, 502, { ok: false, error: "la oficina no responde" }); } });
      r.end(cuerpo);
    });
  });
  srv.requestTimeout = 30e3; srv.headersTimeout = 15e3; srv.keepAliveTimeout = 5e3;
  return srv;
}

function arrancar({ puerto = +(process.env.COO_PASARELA_PORT || 4392), anota = () => {} } = {}) {
  const srv = crearPasarela({ anota });
  return new Promise((ok, mal) => { srv.once("error", mal); srv.listen(puerto, "127.0.0.1", () => { srv.removeListener("error", mal); ok(srv); }); });
}

module.exports = { crearPasarela, arrancar, claveBuena, lectorClave, RUTA };

if (require.main === module) {
  arrancar({ anota: (s) => console.log(new Date().toISOString() + " " + s) })
    .then((s) => console.log(`pasarela de Coo en http://127.0.0.1:${s.address().port}${RUTA}`))
    .catch((e) => { console.error("pasarela: " + e.message); process.exit(e.code === "EADDRINUSE" ? 0 : 1); });
}
