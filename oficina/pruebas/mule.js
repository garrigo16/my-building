// mule.js (pruebas) - v310: herramientas/mule.js (MuleSoft en SOLO LECTURA para las IAs) AISLADO: un fetch falso que imita
// Anypoint cargado con --require, credenciales falsas y una carpeta de usuario de prueba (HOME y USERPROFILE). Nada sale del equipo.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const MULE = path.join(__dirname, "..", "..", "herramientas", "mule.js");

module.exports = async ({ prueba, igual, casa }) => {
  console.log("MuleSoft en solo lectura (mule.js)");
  await prueba("v310: solo GET (más el token); propiedades y líneas de log con pinta de secreto, tapadas; errores claros sin token a la vista", () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "mule-")), HOME = path.join(T, "home"), LOG = path.join(T, "fetch.log");
    try {
      fs.mkdirSync(path.join(HOME, ".config"), { recursive: true });
      const FF = path.join(T, "fetch-falso.js");
      fs.writeFileSync(FF, `const fs = require("fs");
const R = (st, j) => ({ ok: st < 300, status: st, json: async () => j, text: async () => JSON.stringify(j) });
globalThis.fetch = async (url, o = {}) => {
  fs.appendFileSync(process.env.FETCH_LOG, JSON.stringify({ url, metodo: o.method || "GET", auth: (o.headers || {}).Authorization }) + "\\n");
  const u = url.replace("https://anypoint.mulesoft.com", "");
  if (u === "/accounts/api/v2/oauth2/token") return process.env.FETCH_TOKEN_MAL ? R(401, {}) : R(200, { access_token: "tok-falso-acceso" });
  if (u === "/accounts/api/me") return R(200, { client: { org_id: "ORG1" } });
  if (u === "/accounts/api/organizations/ORG1/environments") return R(200, { data: [{ name: "QA", type: "sandbox", id: "E1" }, { name: "UAT", type: "sandbox", id: "E2" }] });
  if (u === "/cloudhub/api/v2/applications") return R(200, [{ domain: "app-qa", status: "STARTED", muleVersion: { version: "4.4.0" }, workers: { amount: 1, type: { name: "Micro" } } }]);
  if (u === "/cloudhub/api/v2/applications/app-qa") return R(200, { domain: "app-qa", status: "STARTED", properties: { "db.password": "p4ss-real", "sf.url": "https://ejemplo.invalid", "client_secret": "s3cr3t", "api.timeout": "30" } });
  if (u === "/cloudhub/api/v2/applications/app-qa/deployments?orderByDate=DESC") return R(200, { data: [{ deploymentId: "D1" }] });
  if (u.startsWith("/cloudhub/api/v2/applications/app-qa/deployments/D1/logs?")) return R(200, [
    { event: { timestamp: 1794960000000, priority: "INFO", message: "BankInfo ok: 25 registros" } },
    { event: { timestamp: 1794959000000, priority: "DEBUG", message: 'payload {"password":"hunter2","user":"usuario","client_secret":"abc123"}' } },
    { event: { timestamp: 1794958000000, priority: "INFO", message: "llamada a https://x.invalid/api?access_token=zzz999&page=2 con Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdef" } }]);
  if (u === "/cloudhub/api/v2/applications/prohibida") return R(403, { message: "Forbidden" });
  return R(404, {});
};
`);
      const ENV = { ...process.env, HOME, USERPROFILE: HOME, FETCH_LOG: LOG, FETCH_TOKEN_MAL: "", NODE_OPTIONS: "" };
      const leer = (f) => { try { return fs.readFileSync(f, "utf8"); } catch (e) { return ""; } };
      const llamadas = () => leer(LOG).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      const mule = (args, extra = {}) => { try { fs.unlinkSync(LOG); } catch (e) {}
        const r = spawnSync(process.execPath, ["--require", FF, MULE, ...args], { encoding: "utf8", timeout: 30e3, env: { ...ENV, ...extra } });
        return { rc: r.status, out: r.stdout, err: r.stderr }; };

      let r = mule(["entornos"]);
      igual([r.rc, /No encuentro .*mulesoft\.env/.test(r.err), llamadas().length], [8, true, 0], "sin mulesoft.env: código 8 y ni una llamada");
      fs.writeFileSync(path.join(HOME, ".config", "mulesoft.env"), "MULE_CLIENT_ID=id-falso\r\nMULE_CLIENT_SECRET=\"secreto-falso-mule\"\r\n");
      r = mule(["entornos"]);
      igual([r.rc, r.out], [0, "QA\tsandbox\tE1\nUAT\tsandbox\tE2\n"], "entornos");
      r = mule(["app", "qa", "app-qa"]);
      igual([r.rc, /db\.password = •••• \(tapado\)/.test(r.out), /client_secret = •••• \(tapado\)/.test(r.out), /sf\.url = https:\/\/ejemplo\.invalid/.test(r.out), /api\.timeout = 30/.test(r.out), /p4ss-real|s3cr3t/.test(r.out)],
        [0, true, true, true, true, false], "app (entorno sin mayúsculas): las propiedades con pinta de secreto, tapadas; las demás, a la vista");
      r = mule(["logs", "QA", "app-qa", "50"]);
      const ls = r.out.trim().split("\n");
      igual([r.rc, ls.length, /BankInfo ok/.test(ls[2])], [0, 3, true], "logs: las tres, de la más vieja a la más nueva");
      igual([/hunter2|abc123|zzz999|eyJhbGci/.test(r.out), /"password":••••/.test(r.out), /"user":"usuario"/.test(r.out), /access_token=••••&page=2/.test(r.out), /Bearer ••••/.test(r.out)],
        [false, true, true, true, true], "v310: en las líneas de log, los secretos tapados (y lo demás, intacto)");
      r = mule(["logs", "QA", "app-qa", "50", "bankinfo"]);
      igual(r.out.trim().split("\n").length, 1, "logs con texto: solo las que lo llevan");
      r = mule(["app", "QA", "prohibida"]);
      igual([r.rc, /HTTP 403 .*le falta ese permiso de lectura/.test(r.err)], [1, true], "403: dice que a la Connected App le falta ese permiso");
      r = mule(["apps", "PRE"]);
      igual([r.rc, /No encuentro el entorno «PRE»\. Hay: QA, UAT/.test(r.err)], [2, true], "entorno que no existe: dice cuáles hay");
      r = mule(["entornos"], { FETCH_TOKEN_MAL: "1" });
      igual([r.rc, /no da token \(HTTP 401\)/.test(r.err)], [9, true], "credenciales malas: código 9");
      r = mule(["borrar", "QA", "app-qa"]);
      igual([r.rc, llamadas().length], [2, 0], "una orden que no es de lectura no existe: uso y ni una llamada");
      const w = spawnSync("bash", [path.join(path.dirname(MULE), "mule.sh"), "borrar"], { encoding: "utf8", timeout: 30e3, env: ENV });
      igual([w.status, /^mule: uso: entornos \| apps/.test(w.stderr)], [2, true], "mule.sh (lo que usan las IAs) llega a mule.js con la ruta de Windows bien");
      mule(["logs", "QA", "app-qa"]); const todas = llamadas();
      igual(todas.filter((x) => x.metodo !== "GET").map((x) => x.url), ["https://anypoint.mulesoft.com/accounts/api/v2/oauth2/token"], "solo GET, salvo el POST del token");
      igual(todas.slice(1).every((x) => x.auth === "Bearer tok-falso-acceso"), true, "con el token de la Connected App");
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  });
};
