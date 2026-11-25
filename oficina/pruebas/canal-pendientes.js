"use strict";
const path = require("path");

module.exports = async ({ prueba, igual }) => {
  const P = require(path.join(__dirname, "..", "..", "herramientas", "canal-pendientes.js"));
  const ahora = Date.parse("2026-11-25T10:51:57Z");
  const tip = [
    "# Canal",
    "",
    "<!-- para: Claude | id: coo-sfei470-co17-report-20261125 | accion: coordinacion | estado: lo hace: Claude — saca el deploy report de co17 -->",
    "## [SFEI-470] Deploy report de co17 (solo lectura)",
    "Encargo a Claude: saca el JSON del deploy report.",
    "",
    "— Coo",
    ""
  ].join("\n");
  const cmdP = "C:\\Users\\jgarrigo\\AppData\\Roaming\\Claude\\claude-code\\2.1.326\\d31a4581af92\\claude.exe -p --model claude-sonnet-5-5 --permission-mode acceptEdits";

  await prueba("el vigía no espera por un log reciente si el Claude anterior ya terminó (mira el proceso, no el fichero)", () => {
    igual(P.claudeOcupada({ ahora, procesos: [] }), 0, "sin proceso vivo no está ocupado");
    const r = P.decide({ tip, viejos: [""], estado: {}, ahora, ocupadas: {} });
    igual(r.acciones.map((a) => a.tipo + " " + a.ia), ["LANZO Claude"], "con el Claude anterior ya muerto, lanza el bloque nuevo");
    igual((r.esperan || []).length, 0, "no lo deja en espera");
  });

  await prueba("el vigía sí espera si el proceso de Claude del canal sigue vivo", () => {
    const ini = ahora - 4 * 60e3;
    igual(P.claudeOcupada({ ahora, procesos: [{ CommandLine: cmdP, ini }] }), ini, "proceso -p vivo: ocupado desde su arranque");
    igual(P.claudeOcupada({ ahora, procesos: [{ CommandLine: "C:\\\\App\\\\claude.exe --type=gpu-process", ini }] }), 0, "el escritorio no cuenta");
    const ocupadas = { Claude: P.claudeOcupada({ ahora, procesos: [{ CommandLine: cmdP, ini }] }) };
    const r = P.decide({ tip, viejos: [""], estado: {}, ahora, ocupadas });
    igual(r.acciones.length, 0, "con el proceso vivo no lanza otro");
    igual(r.esperan.map((x) => x.ia), ["Claude"], "queda esperando al que ya corre");
  });
};
