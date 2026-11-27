// claude-pide-ok.js - «Claude pide OK para <acción>» en «Te toca» (respuestas de Claude que no llegaron al hilo, slack-respuesta-<ts>.txt)
// y «no puedo / queda para…» de Claude, que ya no es «ya está con ello». Datos inventados; nada sale a Slack ni al canal git; el disco
// solo en carpetas temporales.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const S = require("../server.js");
const canal = require("../../herramientas/canal-bloques.js");

module.exports = async ({ prueba, igual, casa, C, T, setAhora }) => {
  const AHORA0 = Date.now();   // el reloj simulado como estaba: los ficheros que van después (claude-relevo…) no deben heredar el mío
  try { await casos({ prueba, igual, casa, C, T, setAhora }); } finally { setAhora(AHORA0); }
};

async function casos({ prueba, igual, casa, C, T, setAhora }) {
  const { m } = C;
  const L0 = (o) => ({ arranquesCursor: [], frenos: [], avisosCoo: [], sesionHilo: {}, lanzHilo: {}, cursorSlack: [], esperas: [], ultEsc: 0, lanz: [], timbreHilo: "", traspasos: [], sfAuto: { no: {}, apagado: false }, ...(o || {}) });
  const ver = (hms, hilos, L, git) => { setAhora(T(hms)); return S.analizar(hilos, L0(L), null, null, git || []); };
  const RAIZ = m("09:00:00", "Humano", "*Hilo: Pau · DEMO-470 prueba en el org de ejemplo*\n🎯 Objetivo: validar el cambio de DEMO-470");
  const CL = m("09:30:00", "Claude", "Claude: miro lo de DEMO-470 y te cuento.");
  const tarjeta = (h) => !!(h.pideOk && h.pideOk.okClaude);
  const hilo = (extra) => ({ ts: RAIZ.ts, msgs: [RAIZ, CL, ...(extra || [])] });
  // lo que Claude dejó en el fichero de respuesta; «t» = mtime del fichero (ms)
  const resp = (texto, hms = "10:00", ts = CL.ts) => ({ f: `slack-respuesta-${ts}.txt`, ts, t: T(hms), texto });
  const PIDE = "Para validar DEMO-470 (checkOnly) necesito escribir en el org MIKIDEV y en este turno está bloqueado.\n[te toca: ¿Doy el OK a checkOnly de DEMO-470 en MIKIDEV?]";

  console.log("«Claude pide OK para <acción>»: respuestas guardadas que no llegaron a Slack");
  await prueba("pide OK y no llegó al hilo: tarjeta en «Te toca» con «Claude pide OK para <acción>», OK con escrituras y «vuelve a lanzar» en segundo lugar", () => {
    const a = ver("10:30", [hilo()], { respuestasSlack: [resp(PIDE)] }), h = a.hilos[0];
    igual([h.caja, h.estado, a.deTi.length, a.respuestasVistas], ["toca", "humano", 1, []], "en «Te toca» y sin marcar nada como visto");
    igual(h.cajaPor, "Claude pide OK para checkOnly de DEMO-470 en MIKIDEV", "el título de la tarjeta, con la acción del [te toca: …]");
    igual(h.pideOk.pregunta, "Claude pide OK para checkOnly de DEMO-470 en MIKIDEV", "la pregunta");
    const [A, B] = h.pideOk.opciones;
    igual([A.l, A.escritura, A.a, A.recomendada], ["A", true, "Claude", true], "primera opción: el OK, con escritura y a Claude");
    casa(A.texto, /^@Claude ok, checkOnly de DEMO-470 en MIKIDEV$/, "el texto del botón OK");
    igual(S.esOkHumano(A.texto), true, "y la regla de OK de siempre lo cuenta como OK (el servidor lo lanza con escritura: true)");
    casa(B.t, /^vuelve a lanzar a Claude/, "segunda opción: vuelve a lanzar");
    igual([B.escritura, B.a, S.esOkHumano(B.texto)], [false, "Claude", false], "sin escritura y no cuenta como OK");
    igual(h.opciones.length, 2, "el resumen de botones del tema");
  });
  await prueba("la acción sale del [te toca: …] o, sin él, de la pregunta con «OK» o de lo que «queda para…»", () => {
    igual(S.accionDeOk(PIDE), "checkOnly de DEMO-470 en MIKIDEV", "del [te toca: …]");
    igual(S.accionDeOk("Tengo el diff listo. ¿Doy el OK a aplicar el diff de DEMO-1332 en la rama de ejemplo? Hasta entonces no toco nada."), "aplicar el diff de DEMO-1332 en la rama de ejemplo", "de la pregunta");
    igual(S.accionDeOk("Hecho el análisis. La validación queda para una sesión con sf: validar DEMO-1478 en MIKIDEV."), "una sesión con sf: validar DEMO-1478 en MIKIDEV", "de «queda para …»");
  });
  await prueba("bloqueada por una escritura aunque no diga «OK»: también tarjeta", () => {
    const h = ver("10:30", [hilo()], { respuestasSlack: [resp("No puedo desplegar el cambio de DEMO-1332: las escrituras en el org están bloqueadas en este turno. Queda para cuando des el visto bueno.")] }).hilos[0];
    igual([h.caja, h.estado], ["toca", "humano"], "en «Te toca»");
    casa(h.pideOk.pregunta, /^Claude pide OK para /, "con el título de la tarjeta");
  });
  await prueba("lo que YA estaba en el hilo (aunque con otro formato) se marca visto SIN tarjeta", () => {
    const publicado = m("10:01:00", "Claude", "⚠️ _Para validar DEMO-470 (checkOnly)_ necesito escribir en el org *MIKIDEV* y en este turno está bloqueado.\n[te toca: ¿Doy el OK a checkOnly de DEMO-470 en MIKIDEV?]");
    const a = ver("10:30", [hilo([publicado])], { respuestasSlack: [resp(PIDE)] }), h = a.hilos[0];
    igual(a.respuestasVistas.map((x) => [x.f, x.por]), [[`slack-respuesta-${CL.ts}.txt`, "ya estaba en el hilo"]], "marcada como vista");
    igual(tarjeta(h), false, "y sin tarjeta de «Claude pide OK»");
  });
  await prueba("exactamente NADA, vacío, o un TERMINADO sin pedir nada: visto sin tarjeta", () => {
    for (const [txt, por] of [["NADA", "NADA"], ["  nada.\n", "NADA"], ["", "NADA"], ["TERMINADO: la carga acabó sin errores", "no pide OK ni quedó bloqueada"]]) {
      const a = ver("10:30", [hilo()], { respuestasSlack: [resp(txt)] });
      igual([a.respuestasVistas.map((x) => x.por), tarjeta(a.hilos[0])], [[por], false], `«${txt.trim()}»`);
    }
  });
  await prueba("si Humano ya contestó en el hilo después, queda visto y sin tarjeta (el OK del botón también lo deja visto)", () => {
    const ok = m("10:20:00", "Humano", "@Claude ok, checkOnly de DEMO-470 en MIKIDEV");
    const a = ver("10:30", [hilo([ok])], { respuestasSlack: [resp(PIDE)] });
    igual([a.respuestasVistas.map((x) => x.por), tarjeta(a.hilos[0])], [["Humano contestó después"], false], "visto");
  });
  await prueba("la respuesta de un hilo que no está en el panel: se espera 6 h y luego se marca visto; nunca tarjeta", () => {
    const otra = resp(PIDE, "10:00", "1799999999.000100");
    let a = ver("10:30", [hilo()], { respuestasSlack: [otra] });
    igual([a.respuestasVistas.length, a.deTi.length], [0, 0], "reciente: ni visto ni tarjeta");
    a = ver("17:00", [hilo()], { respuestasSlack: [otra] });
    igual([a.respuestasVistas.map((x) => x.por), a.deTi.length], [["sin hilo en el panel"], 0], "a las 7 h: visto");
  });
  await prueba("dos ficheros en el mismo hilo: tarjeta con la más nueva y la otra, vista", () => {
    const vieja = resp("Pido tu OK para la primera prueba.\n[te toca: ¿Doy el OK a la primera prueba?]", "09:50", CL.ts), nueva = { ...resp(PIDE, "10:10", RAIZ.ts) };
    const a = ver("10:30", [hilo()], { respuestasSlack: [vieja, nueva] });
    igual(a.hilos[0].pideOk.pregunta, "Claude pide OK para checkOnly de DEMO-470 en MIKIDEV", "la nueva");
    igual(a.respuestasVistas.map((x) => x.por), ["hay otra más nueva en el hilo"], "la vieja, vista");
  });
  await prueba("con Claude trabajando en el hilo no hay tarjeta; y la tarjeta quita el relanzo de Claude (sin OK no se le relanza)", () => {
    const P = { claudeHilo: [{ ses: "ses-1", ini: T("10:15") }] };
    setAhora(T("10:30"));
    const a = S.analizar([hilo()], L0({ respuestasSlack: [resp(PIDE)], sesionHilo: { "ses-1": RAIZ.ts } }), P, null, []);
    igual(tarjeta(a.hilos[0]), false, "Claude trabajando: sin tarjeta");
    const b = ver("10:30", [hilo()], { respuestasSlack: [resp(PIDE)] });
    igual(b.relanzar.filter((r) => r.ia === "Claude").length, 0, "sin relanzo de Claude");
  });
  await prueba("en disco: lee los slack-respuesta-*.txt recientes sin .visto, apunta el .visto y no repite; lo viejo no se mira", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "claude-pide-ok-"));
    try {
      const ahora = T("10:30"), tsr = (min) => ((ahora - min * 60e3) / 1000).toFixed(6);
      const fich = (ts, txt) => { fs.writeFileSync(path.join(d, `slack-respuesta-${ts}.txt`), txt); return `slack-respuesta-${ts}.txt`; };
      const f1 = fich(tsr(30), PIDE), f2 = fich(tsr(20), "NADA"), f3 = fich(tsr(10), "otra cosa"), viejo = fich(tsr(60 * 40), "muy viejo");
      fs.writeFileSync(path.join(d, "slack-20261126-101010.log"), "x");
      fs.writeFileSync(path.join(d, f3 + ".visto"), "ya visto");
      const l1 = S.leeRespuestasSlack(d, ahora);
      igual(l1.map((x) => x.f).sort(), [f1, f2].sort(), "solo recientes y sin .visto (no los .log, no el visto, no el de 40 h)");
      igual(l1.find((x) => x.f === f1).texto, PIDE, "con su texto");
      igual(S.apuntaRespuestaVista(f1, "prueba", d), true, "apunta el sidecar");
      casa(fs.readFileSync(path.join(d, f1 + ".visto"), "utf8"), /^\d{4}-\d\d-\d\dT[\d:.]+Z prueba\n$/, "con fecha y motivo");
      igual(S.leeRespuestasSlack(d, ahora).map((x) => x.f), [f2], "ya no sale el procesado");
      igual(fs.existsSync(path.join(d, viejo + ".visto")), false, "y el viejo no se toca");
    } finally { fs.rmSync(d, { recursive: true, force: true }); }
  });
  await prueba("la rotación de logs también limpia los .visto (mismo patrón que el fichero)", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
    casa(src, /slack-respuesta-\[\\d\.\]\+\\\.txt\(\?:\\\.visto\)\?/, "POR_LANZAMIENTO incluye .visto");
  });

  // ---- 2a: «no puedo» / «queda para…» de Claude ya no es «ya está con ello» ----
  const cabez = (ts) => `Hilo ${ts}`;
  const bloques = (...xs) => { const bs = canal.leer(xs.map((x) => x.txt).join("\n")); bs.forEach((b, i) => { b.t = xs[i].t; }); return [{ canal: "principal", todos: bs }]; };
  const PIDE_CLAUDE = { t: T("10:09"), txt: `<!-- para: Claude | id: 701 | accion: encargo -->\n## Coo · [DEMO-1478] Corrección de test en MIKIDEV\nEncargo a Claude: corrige el test de DEMO-1478 y valida en MIKIDEV. ${cabez(RAIZ.ts)}\n` };
  const traspaso = (b) => ({ t: T("10:09") + 30e3, tipo: "LANZO", ia: "Claude", canal: "principal", clave: b.clave, tit: b.tit });
  console.log("«no puedo» / «queda para…» de Claude en el canal git: no es «ya está con ello»");
  await prueba("referencia: un encargo a Claude ya despertado y sin «no puedo»: «ya está con ello» (pausa), como siempre", () => {
    const git = bloques(PIDE_CLAUDE), b = git[0].todos[0];
    igual(b.faltan, ["Claude"], "el bloque espera a Claude");
    const rec = m("10:10:00", "Claude", "Claude: recibido, me pongo con ello.");
    const a = ver("10:20", [hilo([rec])], { traspasos: [traspaso(b)] }, git), h = a.hilos[0];
    casa(h.motivo, /ya está con ello en el canal git/, "motivo de siempre");
    igual([h.estado, h.caja], ["pausa", "trabajando"], "en pausa, no en «Te toca»");
  });
  await prueba("Claude respondió en SLACK «no puedo…» / «queda para…»: no «ya está con ello»; tarjeta «Claude pide OK para …» en «Te toca»", () => {
    const git = bloques(PIDE_CLAUDE), b = git[0].todos[0];
    const no = m("10:10:00", "Claude", "Claude: no puedo validar desde el canal (sin sf). La validación queda para una sesión con CLI: validar DEMO-1478 en MIKIDEV.");
    const a = ver("10:20", [hilo([no])], { traspasos: [traspaso(b)] }, git), h = a.hilos[0];
    igual(/ya está con ello/.test(h.motivo), false, "ya no dice «ya está con ello» (" + h.motivo + ")");
    igual([h.estado, h.caja], ["humano", "toca"], "en «Te toca»");
    igual(h.pideOk.pregunta, "Claude pide OK para una sesión con CLI: validar DEMO-1478 en MIKIDEV", "pregunta con la acción de «queda para»");
    igual([h.pideOk.opciones[0].escritura, h.pideOk.opciones[0].a, h.pideOk.opciones[1].t.startsWith("vuelve a lanzar")], [true, "Claude", true], "OK primero (escrituras), vuelve a lanzar segundo");
    casa(h.motivo, /necesita una sesión con CLI/, "dice que necesita sesión con CLI");
    igual(a.relanzar.filter((r) => r.ia === "Claude").length, 0, "y no se le relanza");
  });
  await prueba("Claude respondió «no puedo» en un BLOQUE del canal git (de Claude, posterior al encargo): claudeNoPuede lo detecta y saca lo que «queda para…»", () => {
    const resp1 = { t: T("10:12"), txt: `<!-- para: Coo, Claude | id: Claude-702 | accion: respuesta | responde-a: 701 -->
## Claude · [DEMO-1478] No puedo validar en MIKIDEV
No puedo tocar orgs desde el canal; la validación queda para una sesión con sf. ${cabez(RAIZ.ts)}
` };
    const { todos } = bloques(PIDE_CLAUDE, resp1)[0];
    igual(todos.map((x) => x.de), ["Coo", "Claude"], "los dos bloques, con su autor");
    const n = S.claudeNoPuede(todos, todos[0], ["Claude"], []);
    igual([!!n, n && n.accion, n && n.bloque], [true, "una sesión con sf", "de Claude 10:12"], "detectado, con la acción");
    igual(S.claudeNoPuede([todos[0]], todos[0], ["Claude"], []), null, "sin el bloque de Claude, nada");
    igual(S.claudeNoPuede(todos, { ...todos[0], t: T("10:20") }, ["Claude"], []), null, "ni si el encargo es posterior a su «no puedo»");
  });
  await prueba("la ayuda: claudeNoPuede solo salta si Claude estaba esperado y dice «no puedo» o «queda para»", () => {
    const fb = { t: T("10:09"), id: "701", tit: "Encargo", de: "Coo" };
    igual(S.claudeNoPuede([], fb, ["Cursor"], [m("10:10:00", "Claude", "no puedo")]), null, "si no se le espera a Claude, nada");
    igual(S.claudeNoPuede([], fb, ["Claude"], [m("10:10:00", "Claude", "Hecho, subido el cambio.")]), null, "una respuesta normal, nada");
    igual(S.claudeNoPuede([], fb, ["Claude"], [m("09:00:00", "Claude", "no puedo")]), null, "una respuesta ANTERIOR al encargo, nada");
    igual(!!S.claudeNoPuede([], fb, ["Claude"], [m("10:10:00", "Claude", "Lo siento, no puedo hacerlo desde aquí")]), true, "«no puedo»");
    igual(!!S.claudeNoPuede([], fb, ["Claude"], [m("10:10:00", "Claude", "Queda para mañana, con sf")]), true, "«queda para»");
  });
}
