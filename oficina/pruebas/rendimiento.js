"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), zlib = require("zlib");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("rendimiento: consumo asíncrono y estáticos con gzip");
  await prueba("rendimiento: leerConsumo limpia en asíncrono las claves de ficheros que ya no existen sin romper el conteo", async () => {
    const S = require("../server.js"), antes = S.verConsumo();
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "rend-")), P = path.join(d, "projects"), F = path.join(d, "consumo.json");
    const CANAL = path.join(P, "E--Trabajo-Oca-Global-Repositorio-oca-salesforce"); fs.mkdirSync(CANAL, { recursive: true });
    const hace = new Date(Date.now() - 3600e3).toISOString();
    try {
      const fantasmas = {}; for (let i = 0; i < 40; i++) fantasmas[path.join(d, "no-existe-" + i + ".jsonl")] = { off: 10 };
      S.setConsumo({ v: 4, archivos: fantasmas, dias: {}, ses: {} });
      fs.writeFileSync(path.join(CANAL, "s1.jsonl"), JSON.stringify({ timestamp: hace, message: { id: "r1", model: "x", usage: { input_tokens: 2, output_tokens: 3 } } }) + "\n");
      await S.leerConsumo({ base: P, fichero: F });
      const c = S.verConsumo(), claves = Object.keys(c.archivos);
      igual([claves.length, claves[0].endsWith("s1.jsonl")], [1, true], "solo queda el fichero que existe");
      igual(Object.values(c.dias)[0].canal, { nuevos: 5, cache: 0, msgs: 1 }, "el conteo sigue bien");
    } finally { S.setConsumo(antes); fs.rmSync(d, { recursive: true, force: true }); }
  });
  await prueba("rendimiento: el index.html se sirve con gzip y con window.EDIFICIO y persona.js", async () => {
    const S = require("../server.js"), f = path.join(__dirname, "..", "public", "index.html");
    const gz = await S.sirveEstatico(f, "gzip, deflate");
    igual([gz.gzip, gz.tipo], [true, "text/html"], "con Accept-Encoding: gzip va comprimido");
    const html = zlib.gunzipSync(gz.buf).toString("utf8");
    casa(html, /window\.EDIFICIO=\{/, "lleva window.EDIFICIO"); casa(html, /<script src="\/persona\.js"><\/script><\/head>/, "lleva persona.js");
    const plano = await S.sirveEstatico(f, "");
    igual(plano.gzip, false, "sin gzip va en claro"); igual(plano.buf.toString("utf8"), html, "mismo contenido");
    igual((await S.sirveEstatico(f, "gzip")).buf === gz.buf, true, "la segunda vez sale de la caché");
    igual(await S.sirveEstatico(path.join(__dirname, "..", "public", "no-existe.js"), "gzip"), null, "lo que no existe, null (404)");
  });
};
