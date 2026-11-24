// v576: con herramientas/cursor-apagado la oficina no llama a api.cursor.com; sin el fichero, lee como siempre.
const fs = require("fs"), os = require("os"), path = require("path");
module.exports = async ({ prueba, igual }) => {
  console.log("v576: la oficina y el interruptor de Cursor");
  const S = require("../server.js");
  await prueba("v576: con cursor-apagado, leerCursor no hace ninguna petición; al quitarlo, vuelve a leer", async () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-apagado-of-")), fich = path.join(T, "cursor-apagado");
    const env0 = process.env.OFICINA_CURSOR_APAGADO, fetch0 = global.fetch, urls = [];
    process.env.OFICINA_CURSOR_APAGADO = fich;
    global.fetch = async (u) => { urls.push(String(u)); return { status: 200, ok: true, headers: {}, json: async () => ({ items: [] }) }; };
    try {
      fs.writeFileSync(fich, "apagado\n");
      const antes = JSON.stringify(S.verErrores());
      igual(S.cursorApagado(), true, "detecta el fichero");
      await S.leerCursor({ clave: "de-mentira" }); await S.leerCursor({ clave: "de-mentira" });
      igual(urls.length, 0, "peticiones con el fichero");
      igual(JSON.stringify(S.verErrores()), antes, "sin errores nuevos");
      fs.unlinkSync(fich);
      igual(S.cursorApagado(), false, "sin el fichero");
      const r = await S.leerCursor({ clave: "de-mentira" });
      igual([urls.length, /api\.cursor\.com/.test(urls[0] || ""), Array.isArray(r)], [1, true, true], "vuelve a leer sin reiniciar");
    } finally { global.fetch = fetch0; if (env0 === undefined) delete process.env.OFICINA_CURSOR_APAGADO; else process.env.OFICINA_CURSOR_APAGADO = env0; fs.rmSync(T, { recursive: true, force: true }); }
  });
};
