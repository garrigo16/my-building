// enviado-usando.js - el pie «Enviado usando @app» / «Sent using @app» de lo que se envía por la app de la Oficina (sin red)
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const S = require("../server.js");

const BOT = "UBOT00001";
const PIES = ["*Enviado usando* <@UBOT00001>", "_Enviado usando_ <@UBOT00001>", "Enviado usando <@UBOT00001>", "*Sent using* <@UBOT00001>", "_Sent using_ <@UBOT00001>", "Sent using <@UBOT00001>"];

module.exports = async ({ prueba, igual, casa, C, oficina }) => {
  console.log("Pie «Enviado usando»");

  await prueba("enviado-usando: sinPieEnviado quita el pie en español y en inglés, con * o _", async () => {
    for (const pie of PIES) igual(S.sinPieEnviado(`Hola equipo\n${pie}`), "Hola equipo", "pie " + pie);
    igual(S.sinPieEnviado("Sin pie"), "Sin pie", "sin pie");
    igual(S.sinPieEnviado(null), "", "nulo");
  });

  await prueba("enviado-usando: el pie no cuenta como mención (hilo armado y menciones)", async () => {
    for (const pie of PIES) {
      const sinMenc = S.sinPieEnviado(`Mira esto ${pie}`);
      igual(/<@U[A-Z0-9]+>/.test(sinMenc), false, "sin menciones en " + pie);
    }
    // una mención real al lado del pie sí se conserva
    igual(S.sinPieEnviado("Hola <@UOTRO0002> *Enviado usando* <@UBOT00001>"), "Hola <@UOTRO0002>", "mención real");
  });

  await prueba("enviado-usando: payloadHumano añade el pie como bloque context y no lo duplica", async () => {
    const p = S.payloadHumano({ channel: "C0CJ16RBL6A", thread_ts: "1795540186.383009", text: "Hola" }, BOT);
    igual(p.channel, "C0CJ16RBL6A", "canal"); igual(p.thread_ts, "1795540186.383009", "hilo"); igual(p.text, "Hola", "text de respaldo");
    const ctx = p.blocks[p.blocks.length - 1];
    igual(ctx.type, "context", "último bloque context");
    igual(ctx.elements[0].text, "*Enviado usando* <@UBOT00001>", "texto del pie");
    igual(p.blocks[0].type, "section", "primero el texto");
    igual(p.blocks[0].text.text, "Hola", "texto en el bloque");
    // ya lleva el pie (es o en): no se duplica
    for (const pie of PIES) { const q = S.payloadHumano({ channel: "C0CJ16RBL6A", text: "Hola\n" + pie }, BOT); igual(q.blocks, undefined, "sin bloques si ya hay pie: " + pie); }
    // sin bot conocido: solo el texto, sin hilo si no lo hay
    const s = S.payloadHumano({ channel: "C0CJ16RBL6A", text: "Hola" }, "");
    igual(s, { channel: "C0CJ16RBL6A", text: "Hola" }, "sin bot");
    igual("thread_ts" in p && !("thread_ts" in s), true, "thread_ts solo si hay");
    // texto largo: varios bloques section de <= 3000 y un solo context
    const l = S.payloadHumano({ channel: "C0CJ16RBL6A", text: "a".repeat(6500) }, BOT);
    igual(l.blocks.map((b) => b.type).join(","), "section,section,section,context", "bloques de un texto largo");
    igual(l.blocks.every((b) => b.type !== "section" || b.text.text.length <= 3000), true, "secciones <= 3000");
  });

  await prueba("enviado-usando: saleYa no toma el pie como «ya salió» (es ni en)", async () => {
    // el pie lleva «enviado»: tras quitarlo no debe quedar nada que case con «enviado/salió»
    const YA_SALIO = /\b(enviado|ha salido|sali[oó]|ya est[aá] enviado)\b/i;
    for (const pie of PIES) igual(YA_SALIO.test(S.sinPieEnviado("Lo preparo ahora\n" + pie)), false, "pie " + pie);
    igual(YA_SALIO.test(S.sinPieEnviado("Ya está enviado\n" + PIES[0])), true, "un «ya está enviado» real sigue valiendo");
  });

  await prueba("enviado-usando: la escucha quita ambos pies antes de mirar menciones", async () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "herramientas", "escucha-slack.js"), "utf8");
    const linea = src.split("\n").find((l) => /const txtM = txt\.replace\(/.test(l));
    if (!linea) throw new Error("no encuentro txtM en escucha-slack.js");
    const limpia = vm.runInNewContext(`(txt) => { ${linea.trim()} return txtM; }`);
    for (const pie of PIES) igual(limpia("Hola " + pie).includes("<@UBOT00001>"), false, "txtM sin el bot en " + pie);
    igual(limpia("Hola <@UOTRO0002> " + PIES[3]).includes("<@UOTRO0002>"), true, "txtM conserva la mención real");
  });

  await prueba("enviado-usando: ofi viaja al estado solo en lo enviado por la app y la etiqueta Slack depende de ella", async () => {
    const R = C.m("09:00", "Humano", "Tema", { ofi: true });
    const A = C.m("09:01", "Coo", "Respuesta");
    const H = C.m("09:02", "Humano", "Escrito a mano en Slack");
    const a = oficina("09:05", [{ ts: R.ts, msgs: [R, A, H] }]);
    const msgs = a.hilos.find((h) => h.ts === R.ts).msgs;
    igual(msgs.map((x) => !!x.ofi), [true, false, false], "ofi solo en el enviado por la app");
    // el pintado: la etiqueta .msg-pie sale con m.ofi y no depende del texto
    const html = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
    const pinta = html.split("\n").find((l) => l.includes("h.msgs.map(m=>") && l.includes("msg-pie"));
    if (!pinta) throw new Error("no encuentro la etiqueta .msg-pie en pintaPanelMsgsBase");
    casa(pinta, /m\.ofi\?/, "la etiqueta depende de m.ofi");
    igual(/Enviado usando/i.test(pinta), false, "no busca el pie en el texto");
    casa(html, /\.msg-pie\{/, "estilo de .msg-pie");
  });
};
