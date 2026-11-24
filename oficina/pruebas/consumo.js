"use strict";
const fs = require("fs"), path = require("path"), os = require("os");

module.exports = async ({ prueba, igual }) => {
  console.log("el gasto de las sesiones (leerConsumo)");
  await prueba("v360: solo trabajo; canal frente a tus sesiones; un mensaje repetido cuenta una vez; la línea a medias espera; lo de hace más de 9 días, no", async () => {
    const S = require("../server.js"), antes = S.verConsumo();
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "consumo-")), P = path.join(d, "projects"), F = path.join(d, "consumo.json");
    const CANAL = path.join(P, "E--Trabajo-Oca-Global-Repositorio-oca-salesforce"), TU = path.join(P, "C--Users-x--claude-relevo"), FUERA = path.join(P, "E--Otra-Carpeta");
    for (const x of [CANAL, TU, FUERA]) fs.mkdirSync(x, { recursive: true });
    const hace = (h) => new Date(Date.now() - h * 3600e3).toISOString();
    const linea = (id, h, u, extra = {}) => JSON.stringify({ timestamp: hace(h), message: { id, model: "claude-sonnet-5-5", usage: u }, ...extra }) + "\n";
    const U = (i, cw, cr, o) => ({ input_tokens: i, cache_creation_input_tokens: cw, cache_read_input_tokens: cr, output_tokens: o });
    try {
      S.setConsumo({ v: 4, archivos: {}, dias: {}, ses: {} });   // como lo deja la oficina al arrancar en un equipo nuevo
      fs.writeFileSync(path.join(CANAL, "s-canal.jsonl"), linea("m1", 1, U(10, 100, 1000, 5)) + linea("m1", 1, U(10, 100, 1000, 5)) + '{"sin":"usage"}\n' + linea("m2", 1, U(1, 0, 50, 2)));
      fs.writeFileSync(path.join(TU, "s-tu.jsonl"), linea("m3", 2, U(3, 0, 0, 7), { entrypoint: "claude-desktop" }) + linea("m4", 300, U(999, 0, 0, 999)) + linea("m5", 1, U(4, 0, 0, 1)).slice(0, 30));
      fs.writeFileSync(path.join(FUERA, "s-fuera.jsonl"), linea("m6", 1, U(500, 0, 0, 500)));
      await S.leerConsumo({ base: P, fichero: F });
      const c = S.verConsumo(), dia = Object.keys(c.dias)[0], dd = c.dias[dia];
      igual([Object.keys(c.dias).length, dd.canal, dd.tu], [1, { nuevos: 10 + 100 + 5 + 1 + 0 + 2, cache: 1050, msgs: 2 }, { nuevos: 10, cache: 0, msgs: 1 }],
        "canal (repo de OCA) y tus sesiones por separado; m1 repetido cuenta una vez; lo de hace 300 h y lo de otros proyectos, fuera; la línea a medias, aún no");
      const ses = c.ses[dia];
      igual([ses["s-canal"].n, ses["s-canal"].mod, ses["s-tu"].ep, Object.keys(ses).includes("s-fuera")], [2, "claude-sonnet-5-5", "claude-desktop", false], "por sesión, con su modelo y de dónde viene");
      fs.appendFileSync(path.join(TU, "s-tu.jsonl"), linea("m5", 1, U(4, 0, 0, 1)).slice(30));
      await S.leerConsumo({ base: P, fichero: F });
      igual(S.verConsumo().dias[dia].tu, { nuevos: 10 + 5, cache: 0, msgs: 2 }, "la línea, ya completa, cuenta en la vuelta siguiente (y lo de antes no se vuelve a contar)");
      igual(JSON.parse(fs.readFileSync(F, "utf8")).dias[dia].tu.msgs, 2, "se guarda en SU fichero (el de verdad, intacto)");
    } finally { S.setConsumo(antes); fs.rmSync(d, { recursive: true, force: true }); }
  });
};
