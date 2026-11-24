// aviso-coo-body.js - el JSON que avisar-coo.sh manda al webhook de Coo cabe en el destino (que corta hacia los 4 KiB):
// el script de verdad copiado a una carpeta temporal, un webhook FALSO local (127.0.0.1) que guarda el cuerpo, clave de mentira.
// Nada sale del equipo.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), { spawn } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");
const TOPE = 3584;

module.exports = async ({ prueba, igual }) => {
  console.log("avisar a Coo: el JSON del webhook, corto");
  await prueba("avisar-coo.sh: body < 3584 bytes, JSON válido, instruccion y personas primero, instruccion sin formato", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "avbody-")), H = path.join(T, "herr"), HOME = path.join(T, "home");
    const recibidos = [];
    const srv = http.createServer((q, r) => { const b = []; q.on("data", (x) => b.push(x)).on("end", () => { recibidos.push(Buffer.concat(b)); r.statusCode = 200; r.end("{}"); }); });
    await new Promise((r) => srv.listen(0, "127.0.0.1", r));
    try {
      for (const d of [H, path.join(HOME, ".config"), path.join(HOME, ".canal-logs")]) fs.mkdirSync(d, { recursive: true });
      for (const s of ["avisar-coo.sh", "freno.sh", "formato-para-humano.txt", "llano.js", "tapar-secretos.js"]) fs.copyFileSync(path.join(HERR, s), path.join(H, s));
      fs.writeFileSync(path.join(H, "responder-slack.sh"), "#!/usr/bin/env bash\nexit 0\n");
      fs.writeFileSync(path.join(HOME, ".config", "canal-slack.env"),
        `SLACK_HUMANO_ID=UHUMANO02\nCOO_WEBHOOK_URL=http://127.0.0.1:${srv.address().port}/webhook\nCOO_WEBHOOK_KEY=clave-de-mentira\nSLACK_WS_URL=https://espacio-de-prueba-bastante-largo.slack.com\n`);
      const lanza = (quien, hilo, varias = "", bloque) => new Promise((res) => {
        const env = { ...process.env, HOME, FRENO_MAX_HILO: "50" }; delete env.COO_BLOQUE;
        if (bloque !== undefined) env.COO_BLOQUE = bloque;
        const p = spawn("bash", [path.join(H, "avisar-coo.sh"), "C0PRUEBA00A", hilo, quien, "1794960099.123456", varias], { windowsHide: true, env });
        p.on("exit", (rc) => res(rc));
      });
      // los casos más largos de verdad: Humano a varios (instruccion más larga) y el canal git con su sha
      await lanza("Humano", "1794960000.000100", "1");
      await lanza("el canal git (principal, sha 1e460d57c5, bloque COO-coordinacion-20261124-21)", "1794960000.000200");
      await lanza("Claude", "1794960000.000300");
      // un bloque de verdad del canal git, bastante más largo que el tope (con acentos, emoji y saltos de línea),
      // como lo pasa timbre.sh (la nota entera); y Humano con bloque: no se le añade
      const cab = "para: Coo\n@coo\nestado: te toca — revisar el despliegue de v312 en el org de pruebas\nDetalle: ";
      const largo = cab + Array.from({ length: 120 }, (_, i) => `Paso ${i + 1}: revisa la clase OCA_Integración_${i} y el flujo «Alta de pedido» 🚀; si falla, dilo en tu bloque.`).join("\n") + "\nFIN-DEL-BLOQUE";
      if (Buffer.byteLength(largo) < 3 * TOPE) throw new Error("el bloque de prueba debería ser bastante más largo que el tope");
      await lanza("el canal git (principal, sha 1e460d57c5)", "1794960000.000400", "", largo);
      await lanza("Humano", "1794960000.000500", "", largo);
      igual(recibidos.length, 5, "cinco avisos al webhook falso");
      const formatoTxt = fs.readFileSync(path.join(HERR, "formato-para-humano.txt"), "utf8").replace(/\r/g, "");
      for (const b of recibidos) {
        if (b.length >= TOPE) throw new Error(`body de ${b.length} bytes (tope ${TOPE})`);
        const j = JSON.parse(b.toString("utf8"));
        const k = Object.keys(j);
        igual(k.slice(0, 2), ["instruccion", "personas"], "instruccion y personas, lo primero del objeto");
        igual(k.indexOf("instruccion") < k.indexOf("formato") && k.indexOf("personas") < k.indexOf("convenios"), true, "antes que formato y convenios");
        igual([!!j.instruccion, !!j.personas, !!j.formato, !!j.convenios], [true, true, true, true], "los cuatro campos con texto");
        igual(j.instruccion.includes(j.formato) || j.instruccion.includes(formatoTxt.slice(0, 40)), false, "instruccion no repite formato");
        igual(b.toString("utf8").split(j.formato).length - 1, 1, "formato aparece una sola vez");
      }
      igual(JSON.parse(recibidos[0]).instruccion.includes("VARIOS"), true, "Humano a varios: la instruccion lo dice");
      const js = recibidos.map((b) => JSON.parse(b.toString("utf8")));
      igual([0, 1, 2, 4].map((i) => "bloque" in js[i]), [false, false, false, false], "sin bloque (Humano, o sin nota) no se inventa el campo");
      const jb = js[3];
      igual(typeof jb.bloque, "string", "con bloque largo: campo bloque presente");
      igual([jb.bloque.startsWith(cab), jb.bloque.endsWith("…"), jb.bloque.includes("FIN-DEL-BLOQUE"), jb.bloque.length < largo.length], [true, true, false, true], "bloque recortado desde el final, con «…»");
      igual(Buffer.byteLength(recibidos[3]) >= TOPE - 200, true, "el recorte aprovecha el sitio (no tira de más)");
      igual(!!jb.instruccion && !!jb.personas && jb.responder_en === "canal_git", true, "con bloque largo siguen instruccion y personas");
      console.log(`    body con bloque largo: ${recibidos[3].length} bytes (bloque original ${Buffer.byteLength(largo)} bytes)`);
    } finally { srv.close(); fs.rmSync(T, { recursive: true, force: true }); }
  });
};
