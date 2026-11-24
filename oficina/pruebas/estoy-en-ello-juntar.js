// estoy-en-ello-juntar.js - «Estoy en ello» y «Juntar» de punta a punta, con el servidor falso y datos inventados. Nada sale a Slack,
// Google Chat ni correo.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http");
const S = require("../server.js");
const { arranca } = require("./servidor-falso.js");
const { cargaPagina } = require("./dom-falso.js");

// un POST como el de la página: mismo origen (Origin + Sec-Fetch-Site) y JSON
const posta = (o, ruta, cuerpo, { origen = true } = {}) => new Promise((res, rej) => {
  const b = JSON.stringify(cuerpo), h = { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(b), Host: `127.0.0.1:${o.puerto}` };
  if (origen) { h.Origin = o.url; h["Sec-Fetch-Site"] = "same-origin"; }
  const q = http.request({ host: "127.0.0.1", port: o.puerto, path: ruta, method: "POST", headers: h }, (r) => { let t = ""; r.on("data", (d) => t += d); r.on("end", () => { let j = null; try { j = JSON.parse(t); } catch (e) {} res({ code: r.statusCode, body: j }); }); });
  q.on("error", rej); q.end(b);
});
const lee = (o, ruta) => new Promise((res, rej) => http.get({ host: "127.0.0.1", port: o.puerto, path: ruta }, (r) => { let t = ""; r.on("data", (d) => t += d); r.on("end", () => res({ code: r.statusCode, txt: t })); }).on("error", rej));
const estado = async (o) => JSON.parse((await lee(o, "/api/estado")).txt);

module.exports = async ({ prueba, igual, casa, T, setAhora }) => {
  console.log("v575: «Estoy en ello» y «Juntar» de punta a punta (servidor falso, Slack simulado)");
  const t0 = T("13:26");
  const turno0 = S.verTurno();
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "eee-juntar-"));
  const abiertos = [];
  const sube = async (enviados) => { setAhora(t0); const o = await arranca({ S, dir: d, t0, enviados }); abiertos.push(o); return o; };
  try {
    S.setTurno({ equipo: "casa", de: "casa", mio: true, sabido: true });
    let o = await sube([]);
    const A = o.F.A.ts, B = o.F.B.ts, C = o.F.C.ts, D = o.F.D.ts, K = S.CLAVE;
    const tema = (e, ts) => e.hilos.find((h) => h.ts === ts);

    await prueba("v575: el estado del servidor falso: A y B en «Te toca» con su botón, C esperando y D con la propuesta de juntar", async () => {
      const e = await estado(o);
      igual(e.envio, { directo: true, k: K }, "envío directo, con clave");
      const a = tema(e, A), b = tema(e, B), dd = tema(e, D);
      igual([a.estado, a.caja], ["humano", "toca"], "A en «Te toca»");
      igual([a.estoyEnEllo.posible, a.estoyEnEllo.canal, a.estoyEnEllo.a, a.estoyEnEllo.yaEnviado], [true, "slack", "Sara", null], "A: Estoy en ello por Slack, sin enviar");
      igual([b.estado, b.estoyEnEllo.posible, b.estoyEnEllo.canal], ["humano", false, "google-chat"], "B: Google Chat, solo copiar");
      igual([tema(e, C).caja, dd.proponJuntar && dd.proponJuntar.ts], ["esperando", C], "C espera y D propone juntarse con C");
      igual((e.deTi || []).map((x) => x.hilo).sort(), [A, B, D].sort(), "«Te toca»: A, B y D (C no)");
    });

    await prueba("v575: el cerrojo de los POST: sin Origen de la página o con otra clave, no pasa nada (403) y no sale nada", async () => {
      const r1 = await posta(o, "/api/estoy-en-ello", { k: K, hilo: A }, { origen: false });
      const r2 = await posta(o, "/api/estoy-en-ello", { k: "otra", hilo: A });
      const r3 = await posta(o, "/api/juntar", { k: "otra", viejo: C, nuevo: D, si: true });
      igual([r1.code, r2.code, r3.code], [403, 403, 403], "tres 403");
      igual(o.enviados.length, 0, "nada enviado");
      igual(fs.existsSync(path.join(d, "juntados.txt")), false, "nada apuntado");
    });

    await prueba("v575: «👀 Estoy en ello» en A: sale UNA vez al privado de Sara, queda guardado y el segundo clic no repite", async () => {
      const r = await posta(o, "/api/estoy-en-ello", { k: K, hilo: A });
      igual([r.code, r.body.ok, r.body.a, r.body.canal], [200, true, "Sara", "slack"], "200");
      igual(o.enviados, [{ channel: "DSARA", text: "Lo he visto, estoy en ello 👀", tok: "xoxp-de-mentira" }], "lo que se habría enviado a Slack");
      const g = S.leeEnEllo(path.join(d, "estoy-en-ello.json")), claves = Object.keys(g);
      igual(claves.length, 1, "una entrada guardada"); casa(claves[0], new RegExp(`^${A.replace(".", "\\.")}\\|sara\\|\\d+$`), "clave: hilo|persona|mensaje");
      igual([g[claves[0]].a, g[claves[0]].canal], ["Sara", "slack"], "con quién y por dónde");
      const e = await estado(o);
      igual(!!(tema(e, A).estoyEnEllo.yaEnviado && tema(e, A).estoyEnEllo.yaEnviado.t), true, "el estado ya dice «✓ Avisado»");
      const r2 = await posta(o, "/api/estoy-en-ello", { k: K, hilo: A });
      igual([r2.code, o.enviados.length], [409, 1], "segundo clic: 409 y nada más a Slack");
    });

    await prueba("v575: «Estoy en ello» en B (Google Chat): no se envía nada (409 con el texto para copiar); en un tema sin persona, 404", async () => {
      const r = await posta(o, "/api/estoy-en-ello", { k: K, hilo: B });
      igual([r.code, r.body.copiar, o.enviados.length], [409, "Lo he visto, estoy en ello 👀", 1], "B: copiar, nada a Slack");
      casa(r.body.error, /no puede escribir por Google Chat/, "con el motivo");
      igual((await posta(o, "/api/estoy-en-ello", { k: K, hilo: C })).code, 404, "C: nadie a quien avisar");
    });

    await prueba("v575: sin turno, «Estoy en ello» da 423 y no envía", async () => {
      S.setTurno({ equipo: "casa", de: "otro", mio: false, sabido: true });
      try {
        const r = await posta(o, "/api/estoy-en-ello", { k: K, hilo: B });
        igual([r.code, o.enviados.length], [423, 1], "423");
      } finally { S.setTurno({ equipo: "casa", de: "casa", mio: true, sabido: true }); }
    });

    await prueba("v575: «Juntar» C con D: el viejo queda cerrado («sigue en» D), D lo trae en «viene de», una sola vez aunque se pulse dos veces", async () => {
      const r = await posta(o, "/api/juntar", { k: K, viejo: C, nuevo: D, si: true });
      igual([r.code, r.body.ok], [200, true], "200");
      const r2 = await posta(o, "/api/juntar", { k: K, viejo: C, nuevo: D, si: true });
      igual(r2.code, 200, "el segundo clic (otra pestaña) tampoco falla");
      igual(fs.readFileSync(path.join(d, "juntados.txt"), "utf8"), `${C} ${D}\n`, "una sola línea en juntados.txt");
      const e = await estado(o), c = tema(e, C), dd = tema(e, D);
      igual([c.estado, c.caja, c.sigueEn && c.sigueEn.ts, c.esperaA], ["cerrado", "cerrado", D, null], "C: cerrado y sigue en D");
      igual([(dd.vieneDe || []).map((x) => x.ts), dd.proponJuntar], [[C], undefined], "D: viene de C (una vez) y ya sin propuesta");
      igual(e.hilos.filter((h) => h.ts === C || h.ts === D).length, 2, "cada tema una sola vez en la lista");
      igual((e.deTi || []).filter((x) => x.hilo === C).length, 0, "C no sale en «Te toca»");
      igual((e.deTi || []).filter((x) => x.hilo === D).length, 1, "D, una vez");
    });

    await prueba("v575: un juntados.txt con el mismo par repetido (doble clic de antes de v575) no duplica el «viene de»", async () => {
      const f2 = path.join(d, "repetido.txt");
      fs.writeFileSync(f2, `${C} ${D}\n${C} ${D}\nno ${C} ${A}\nno ${C} ${A}\n`);
      igual(S.leeJuntados(f2), { si: [[C, D]], no: [[C, A]] }, "cada par una vez");
      fs.unlinkSync(f2);
    });

    await prueba("v575: peticiones mal hechas de «Juntar» (mismo hilo dos veces, ts roto): 400 y no se apunta nada", async () => {
      const g = path.join(d, "juntados.txt"), antes = fs.readFileSync(g, "utf8");
      igual((await posta(o, "/api/juntar", { k: K, viejo: C, nuevo: C, si: true })).code, 400, "el mismo hilo dos veces");
      igual((await posta(o, "/api/juntar", { k: K, viejo: "x", nuevo: D, si: true })).code, 400, "ts roto");
      igual(fs.readFileSync(g, "utf8"), antes, "nada nuevo apuntado");
    });

    await prueba("v575: tras REINICIAR el servidor falso todo sigue: Estoy en ello ya enviado (y no se reenvía) y C y D juntados", async () => {
      await o.cerrar();
      const enviados2 = [];
      o = await sube(enviados2);
      const e = await estado(o);
      igual(!!tema(e, A).estoyEnEllo.yaEnviado, true, "A: ya avisado");
      const r = await posta(o, "/api/estoy-en-ello", { k: K, hilo: A });
      igual([r.code, enviados2.length], [409, 0], "un clic tras el reinicio: 409 y nada a Slack");
      const c = tema(e, C), dd = tema(e, D);
      igual([c.caja, c.sigueEn && c.sigueEn.ts, (dd.vieneDe || []).map((x) => x.ts), dd.proponJuntar], ["cerrado", D, [C], undefined], "C y D juntados");
      igual(tema(e, B).estoyEnEllo.posible, false, "B sigue siendo solo copiar");
    });

    await prueba("v575: la página real, servida por el servidor falso, carga y pinta con ese estado sin errores (antes y después de actuar)", async () => {
      const h = await lee(o, "/");
      igual([h.code, /Estoy en ello/.test(h.txt), /data-juntar/.test(h.txt)], [200, true, true], "la página sale con sus dos botones");
      const e = await estado(o);
      const P = cargaPagina({ estado: e, apuntes: { ok: true, ver: 0, notas: {}, recordatorios: [], ajustes: {} }, html: h.txt });
      try { await P.reposa(); igual(P.errores, [], "sin errores al cargar"); P.ctx.pinta(e); await P.reposa(); igual(P.errores, [], "ni al repintar"); }
      finally { try { P.cierra && P.cierra(); } catch (x) {} }
    });
  } finally {
    for (const x of abiertos) { try { await x.cerrar(); } catch (e) {} }
    S.setTurno(turno0);
    fs.rmSync(d, { recursive: true, force: true });
  }
};
