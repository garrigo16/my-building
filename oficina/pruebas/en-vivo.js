// en-vivo.js - v159: el estado que daría la oficina AHORA con los datos reales (Slack, logs, procesos, canal git), sin
// arrancar el servidor ni escribir nada. Para comparar antes/después de un cambio en analizar().
// Uso: node oficina/pruebas/en-vivo.js [filtro-de-título]
"use strict";
const s = require("../server.js");
(async () => {
  const [hs, P, git] = await Promise.all([s.leerSlack(), s.leerProcesos().catch(() => null), s.leerGit().catch(() => [])]);
  const a = s.analizar(hs, s.leerLogs(), P, null, git);
  const re = process.argv[2] ? new RegExp(process.argv[2], "i") : null;
  for (const h of a.hilos) if (!re || re.test(h.titulo)) console.log(h.estado.padEnd(9), h.titulo.slice(0, 50).padEnd(50), "|", h.motivo.slice(0, 160));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
