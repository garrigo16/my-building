"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), http = require("http"), { spawn } = require("child_process");
const H = path.join(__dirname, "..", "..", "herramientas", "cursor-agente.js");

module.exports = async ({ prueba, igual }) => {
  console.log("v392: Cursor sigue con su agente (follow-up) si está libre");
  const T = fs.mkdtempSync(path.join(os.tmpdir(), "creusa-")), F = path.join(T, "agentes.json"), BODY = path.join(T, "body.json");
  fs.writeFileSync(BODY, JSON.stringify({ prompt: { text: "recado nuevo" }, repos: [{ url: "x" }] }));
  let estadoAg = "IDLE", codRun = 201; const visto = [];
  const srv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)).on("end", () => {
    visto.push(req.method + " " + req.url + (b ? " " + b : ""));
    if (req.method === "GET" && req.url === "/v1/agents/bc-1") { res.writeHead(200); return res.end(JSON.stringify({ id: "bc-1", status: estadoAg })); }
    if (req.method === "POST" && req.url === "/v1/agents/bc-1/runs") { res.writeHead(codRun); return res.end(JSON.stringify(codRun < 300 ? { run: { id: "run-2" } } : { error: "agent_busy" })); }
    res.writeHead(404); res.end("{}"); }); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const env = { ...process.env, CANAL_PRUEBAS: "1", CURSOR_API_URL: `http://127.0.0.1:${srv.address().port}/v1/agents`, CURSOR_AGENTES_F: F, CURSOR_API_KEY: "clave-falsa" };
  const corre = (...a) => new Promise((res) => { const p = spawn(process.execPath, [H, ...a], { env }); let o = ""; p.stdout.on("data", (d) => (o += d)); p.on("close", (c) => res({ c, o })); });
  try {
    await prueba("sin agente apuntado → no reutiliza; apuntado y LIBRE → follow-up con el mismo agente y su run nuevo", async () => {
      igual((await corre("reusa", "slack:1.2", BODY)).c, 1, "nada apuntado");
      await corre("apunta", "slack:1.2", "bc-1");
      const r = await corre("reusa", "slack:1.2", BODY);
      igual([r.c, r.o], [0, "bc-1\trun-2"], "follow-up");
      igual(visto.some((v) => v.startsWith("POST /v1/agents/bc-1/runs") && /recado nuevo/.test(v) && !/repos/.test(v)), true, "solo el prompt");
    });
    await prueba("ocupado (ACTIVE o 409) o de hace más de 8 h → no reutiliza (se crea uno nuevo, como antes)", async () => {
      estadoAg = "ACTIVE"; igual((await corre("reusa", "slack:1.2", BODY)).c, 1, "ACTIVE");
      estadoAg = "IDLE"; codRun = 409; igual((await corre("reusa", "slack:1.2", BODY)).c, 1, "409 ocupado");
      codRun = 201; const m = JSON.parse(fs.readFileSync(F, "utf8")); m["slack:1.2"].t -= 9 * 3600e3; fs.writeFileSync(F, JSON.stringify(m));
      igual((await corre("reusa", "slack:1.2", BODY)).c, 1, "viejo");
    });
  } finally { srv.close(); fs.rmSync(T, { recursive: true, force: true }); }
};
