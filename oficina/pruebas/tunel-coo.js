"use strict";
// herramientas/tunel-coo.js (sin lanzar cloudflared) y tunelCoo en /api/estado de la oficina.
const fs = require("fs"), path = require("path"), os = require("os");
const TU = require("../../herramientas/tunel-coo.js");
const S = require("../server.js");

module.exports = async ({ prueba, igual }) => {
  console.log("Túnel de Coo");

  await prueba("tunel coo: saca la URL https://….trycloudflare.com de la salida de cloudflared", async () => {
    const l = "2026-11-25T15:30:00Z INF |  https://raro-nombre-de-prueba.trycloudflare.com                                  |";
    igual(TU.extraeUrl(l), "https://raro-nombre-de-prueba.trycloudflare.com", "url");
    igual(TU.extraeUrl("INF Requesting new quick Tunnel on trycloudflare.com..."), "", "el aviso previo no es la URL");
    igual(TU.extraeUrl("https://api.trycloudflare.com/tunnel"), "https://api.trycloudflare.com", "(se queda con el host; el supervisor solo mira la primera)");
  });

  await prueba("tunel coo: sin token, quick tunnel a la pasarela; con CLOUDFLARE_TUNNEL_TOKEN, run con el token SOLO en el entorno", async () => {
    const q = TU.plan({}, 4392);
    igual([q.modo, q.args, q.env], ["quick", ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:4392"], {}], "quick");
    const f = TU.plan({ CLOUDFLARE_TUNNEL_TOKEN: "tok-secreto-xyz", COO_TUNNEL_URL: "https://coo.ejemplo.com/api/coo/publicar" }, 4392);
    igual([f.modo, f.args, f.env, f.baseUrl], ["fijo", ["tunnel", "--no-autoupdate", "run"], { TUNNEL_TOKEN: "tok-secreto-xyz" }, "https://coo.ejemplo.com"], "fijo");
    igual(f.args.join(" ").includes("tok-secreto"), false, "el token nunca en argv");
  });

  await prueba("tunel coo: busca cloudflared en el PATH y, si no, en %USERPROFILE%\\.local\\bin", async () => {
    const bin = path.join("C:", "u", ".local", "bin", "cloudflared.exe"), enPath = path.join("C:", "herr", "cloudflared.exe");
    igual(TU.buscaCloudflared({ env: { PATH: ["C:\\nada", path.dirname(enPath)].join(path.delimiter), USERPROFILE: path.join("C:", "u") }, existe: (f) => f === enPath || f === bin, win: true }), enPath, "PATH primero");
    igual(TU.buscaCloudflared({ env: { PATH: "C:\\nada", USERPROFILE: path.join("C:", "u") }, existe: (f) => f === bin, win: true }), bin, ".local\\bin");
    igual(TU.buscaCloudflared({ env: { PATH: "" , USERPROFILE: "C:\\u" }, existe: () => false, win: true }), "", "ninguno");
  });

  await prueba("tunel coo: relanza con espera creciente y con tope (5 s, 10 s, … 5 min)", async () => {
    igual([1, 2, 3, 7, 12].map(TU.espera), [5e3, 10e3, 20e3, 300e3, 300e3], "esperas");
    igual(TU.MAX_CAIDAS > 0 && TU.MAX_CAIDAS < 50, true, "tope de caídas");
  });

  await prueba("tunel coo: coo-tunel.json y coo-tunel-url.txt atómicos, sin secretos; tunelCoo en /api/estado los enseña", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "tunel-")), fj = path.join(T, "coo-tunel.json"), fu = path.join(T, "coo-tunel-url.txt");
    try {
      igual(S.tunelCoo(fj), null, "sin fichero, null");
      const e = TU.estadoTunel({ ok: true, modo: "quick", baseUrl: "https://abc-def.trycloudflare.com", puerto: 4392, ahora: new Date(Date.UTC(2026, 10, 25, 14, 30)) });
      TU.guardaEstado(e, { estado: fj, url: fu });
      igual(fs.readdirSync(T).sort(), ["coo-tunel-url.txt", "coo-tunel.json"], "sin temporales");
      igual(fs.readFileSync(fu, "utf8").trim(), "https://abc-def.trycloudflare.com/api/coo/publicar", "url.txt");
      const esperado = { ok: true, modo: "quick", baseUrl: "https://abc-def.trycloudflare.com", url: "https://abc-def.trycloudflare.com/api/coo/publicar", puertoPasarela: 4392, actualizadoEn: "2026-11-25T14:30:00.000Z" };
      igual(S.tunelCoo(fj), esperado, "tunelCoo");
      // un campo de más en el fichero (p. ej. un token) no pasa a /api/estado
      fs.writeFileSync(fj, JSON.stringify({ ...esperado, token: "no-debe-salir", ok: false })); fs.utimesSync(fj, new Date(2030, 0, 1), new Date(2030, 0, 1));
      const est = S.estadoConTunel({ listo: true, hilos: [] }, fj);
      igual([est.tunelCoo.ok, "token" in est.tunelCoo, est.hilos], [false, false, []], "estado con tunelCoo, releído y filtrado");
      const txt = S.cuerpoEstado(est, 1, "").buf.toString("utf8");
      igual([/"tunelCoo":\{/.test(txt), /no-debe-salir/.test(txt)], [true, false], "en el cuerpo de /api/estado");
      igual(TU.limpia("TUNNEL_TOKEN=eyJhbGciOi.abc Authorization: Bearer x"), "TUNNEL_TOKEN=[oculto] Authorization: [oculto] x", "el log tapa secretos");
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  });
};
