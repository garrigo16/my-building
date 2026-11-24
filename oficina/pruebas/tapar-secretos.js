// tapar-secretos.js (pruebas) - v572: la redacción común de secretos (herramientas/tapar-secretos.js) y su uso en mule.js.
// El 20/11 el coordinador vio trozos de un bearer token en la salida de «mule.sh logs». Todo lo de aquí es de mentira:
// ni una llamada sale del equipo (fetch falso, como en mule.js de esta carpeta). Los «tokens» se montan a trozos para que
// ningún buscador de secretos los tome por buenos.
// La regla de la prueba: del secreto no puede quedar NI UN carácter. Por eso el contexto de los casos de corte va todo en
// minúsculas y sin cifras y los secretos en MAYÚSCULAS y cifras: una sola mayúscula o cifra en la salida es una fuga.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const HERR = path.join(__dirname, "..", "..", "herramientas");
const { tapaSecretos: tapar } = require(path.join(HERR, "tapar-secretos.js"));
const M = "••••", XOX = "xo" + "xb-", EYJ = "ey" + "J";

module.exports = async ({ prueba, igual }) => {
  console.log("Secretos tapados del todo (tapar-secretos.js, mule.js)");

  await prueba("v572: cada forma de secreto sale tapada entera y lo demás queda como estaba", () => {
    const casos = [
      // Bearer: cualquier mayúscula, con comillas o sin ellas, en JSON, en JSON escapado y en cabeceras
      ["Authorization: Bearer abc.DEF-123_x~y+z/w==", "Authorization: Bearer " + M],
      ["authorization: bearer abc123", "authorization: bearer " + M],
      ["AUTHORIZATION: BEARER abc123", "AUTHORIZATION: BEARER " + M],
      // el del 20/11: una sesión de Salesforce lleva «!» y la regex vieja paraba ahí (se veía todo lo de después)
      ["GET /services/data con Authorization: Bearer 00D" + "5g00000FALSO!AQEAQFalsa_Sesion.De.Mentira9876543210abcdefXYZ", "GET /services/data con Authorization: Bearer " + M],
      ["llamo con Bearer 00D" + "5g00000FALSO!AQEAQFalsa_Sesion.De.Mentira9876543210abcdefXYZ y sigo", "llamo con Bearer " + M + " y sigo"],
      ["cabecera y más texto Authorization: Bearer abc!def y sigo", "cabecera y más texto Authorization: " + M],   // una cabecera se tapa hasta el fin de la línea
      ["sesión suelta 00D" + "5g00000FALSO!AQEAQFalsa_Sesion.De.Mentira9876543210 fin", "sesión suelta " + M + " fin"],
      ["token corto Bearer a1 fin", "token corto Bearer " + M + " fin"],
      ["raro Bearer abc:def|ghi*jkl%2Bmno resto", "raro Bearer " + M + " resto"],
      ['cabecera Bearer "abc123" y Bearer \'abc\' fin', "cabecera Bearer " + M + " y Bearer " + M + " fin"],
      ['{"Authorization":"Bearer abc123","user":"juan"}', '{"Authorization":"Bearer ' + M + '","user":"juan"}'],
      ['{\\"Authorization\\":\\"Bearer abc123\\",\\"user\\":\\"juan\\"}', '{\\"Authorization\\":\\"Bearer ' + M + '\\",\\"user\\":\\"juan\\"}'],
      ["x-api-key: abcd1234\nAuthorization: Basic dXNlcjpwYXNz\nBasic authentication failed", "x-api-key: " + M + "\nAuthorization: Basic " + M + "\nBasic authentication failed"],
      ["Authorization: abcdef sin esquema\nsigue la traza", "Authorization: " + M + "\nsigue la traza"],
      ["Cookie: a=b; sid=xyz\nsiguiente linea", "Cookie: " + M + "\nsiguiente linea"],
      // clave y valor: JSON, JSON escapado, querystring, mapas de Java, XML, línea de órdenes, URL con usuario
      ['payload {"password":"hunter2","user":"juan","client_secret":"abc123"}', 'payload {"password":' + M + ',"user":"juan","client_secret":' + M + "}"],
      ['payload {\\"access_token\\":\\"zz9\\",\\"expires_in\\":3600}', 'payload {\\"access_token\\":' + M + ',\\"expires_in\\":3600}'],
      ['comilla dentro "password":"ab\\"cd","n":1', 'comilla dentro "password":' + M + ',"n":1'],
      ["llamada a https://x.invalid/api?access_token=zzz999&page=2&api_key=K1&x=1", "llamada a https://x.invalid/api?access_token=" + M + "&page=2&api_key=" + M + "&x=1"],
      ["redirect=https%3A%2F%2Fx.invalid%3Faccess_token%3Dzzz999 fin", "redirect=https%3A%2F%2Fx.invalid%3Faccess_token%3D" + M + " fin"],
      ["{password=hunter2, user=juan} pwd: 'a b c' apiKey => \"q\"", "{password=" + M + " user=juan} pwd: " + M + " apiKey => " + M],
      ["refresh_token: r1 id_token=i2 X-Auth-Token: t3 private_key=k4 secretKey=s5", "refresh_token: " + M + " id_token=" + M + " X-Auth-Token: " + M + " private_key=" + M + " secretKey=" + M],
      ["<password>hunter2</password><user>juan</user>", "<password>" + M + "</password><user>juan</user>"],
      ["jdbc:mysql://user:p4ss@host/db y curl --password hunter2 -u x", "jdbc:mysql://" + M + "@host/db y curl --password " + M + " -u x"],
      // JWT, Slack, ristras largas de hex y de base64, clave PEM
      ["jwt " + EYJ + "hbGciOiJIUzI1NiJ9." + EYJ + "zdWIiOiIxIn0.abc-DEF_123 fin", "jwt " + M + " fin"],
      ["slack " + XOX + "123-456-AbCdEf y xo" + "xp-9-zz y xapp" + "-1-A1-zz fin", "slack " + M + " y " + M + " y " + M + " fin"],
      ["aviso a https://hooks.slack" + ".com/services/T1/B2/abcDEF fin", "aviso a https://hooks.slack.com/services/" + M + " fin"],
      ["hex 0123456789abcdef0123456789abcdef01234567 fin", "hex " + M + " fin"],
      ["url https://h.invalid/f/0123456789abcdef0123456789abcdef/x y https://h.invalid/f/0123456789abcdef0123456789abcdef/y/fedcba9876543210fedcba9876543210", "url https://h.invalid/f/" + M + "/x y https://h.invalid/f/" + M + "/y/" + M],
      ["url con mezcla https://h.invalid/files/0123456789ABCDEF0123456789abcdef/x", "url con mezcla https://h." + M],   // ante la duda, de más
      ["b64 QWxhZGRpbjpvcGVuIHNlc2FtZQ+abc/DEF0123456789xyzXYZ== fin", "b64 " + M + " fin"],
      ["-----BEGIN PRIVATE KEY-----\nMIIabc\ndef\n-----END PRIVATE KEY-----\nfin", M + "\nfin"],
      // los cortes raros: partido en varias líneas y al final sin salto de línea ni comilla de cierre
      ["partido Authorization: Bearer abcDEF123\n   ghiJKL456\r\n\tmnoPQR789\notra linea normal", "partido Authorization: Bearer " + M + "\notra linea normal"],
      ['partido {"access_token":"abcDEF\n  ghiJKL","n":1}', 'partido {"access_token":' + M + ',"n":1}'],
      ["partido con \\n escrito: bearer abcDEF123\\nghiJKL456\\\"}", "partido con \\n escrito: bearer " + M + "\\\"}"],
      ["partido b64\nQWxhZGRpbjpvcGVuIHNlc2FtZQabcDEF0123456789xyzXYZab\nQWxhZGRpbjpv\nfin de la clave", "partido b64\n" + M + "\nfin de la clave"],
      ['cortado "client_secret":"abcdef', 'cortado "client_secret":' + M],
      ["cortado Authorization: Bearer abcDEF", "cortado Authorization: Bearer " + M],
      ["cortado ?access_token=abc", "cortado ?access_token=" + M],
      ["cortado " + EYJ + "hbGciOi", "cortado " + M],
      ["cortado -----BEGIN RSA PRIVATE KEY-----\nMIIabc", "cortado " + M],
      // lo que NO es un secreto se queda
      ["passed: 5, tokens usados: 12, author: juan, key: valor", "passed: 5, tokens usados: 12, author: juan, key: valor"],
      ["ruta /cloudhub/api/v2/applications/MyApp1/deployments/D1/logs de app-ventas-system-api-qa-con-nombre-largo-v2", "ruta /cloudhub/api/v2/applications/MyApp1/deployments/D1/logs de app-ventas-system-api-qa-con-nombre-largo-v2"],
      ["QA\tsandbox\t123e4567-e89b-12d3-a456-426614174000\nUAT\tsandbox\tE2\n", "QA\tsandbox\t123e4567-e89b-12d3-a456-426614174000\nUAT\tsandbox\tE2\n"],
      ["  db.password = " + M + " (tapado)", "  db.password = " + M + " (tapado)"],
    ];
    for (const [entra, sale] of casos) {
      igual(tapar(entra), sale, "«" + entra.slice(0, 50) + "»");
      igual(tapar(tapar(entra)), sale, "dos pasadas dan lo mismo: «" + entra.slice(0, 50) + "»");
    }
    igual(tapar("mi token es tok-raro y otra vez tok-raro; el otro, zzzz", { secretos: ["tok-raro", "zzzz", "", null] }), "mi token es " + M + " y otra vez " + M + "; el otro, " + M, "los secretos que se conocen, tal cual");
    igual(tapar("commit 0123456789abcdef0123456789abcdef01234567 y bearer abc", { largos: false }), "commit 0123456789abcdef0123456789abcdef01234567 y bearer " + M, "largos:false deja los hash y sigue tapando lo demás");
  });

  // contexto en minúsculas y sin cifras; secreto en MAYÚSCULAS y cifras: una mayúscula o una cifra en la salida = fuga
  const S = "Q7ZK9XW2M4PL8RT6VB3NH5JD1GF0CYSAQ7ZK9XW2M4PL8RT6";   // 48, sin prefijo
  const FORMAS = [   // [nombre, antes, secreto, después, mínimo de caracteres para que se pueda reconocer]
    ["cabecera bearer", "llamada con authorization: bearer ", S, "", 1],
    ["bearer suelto", "mando bearer ", S, "", 1],
    ["bearer en json", '{"authorization":"bearer ', S, '"}', 1],
    ["bearer en json escapado", '{\\"authorization\\":\\"bearer ', S, '\\"}', 1],
    ["bearer entre comillas", 'bearer "', S, '"', 1],
    ["access_token en json", '{"access_token":"', S, '","otro":"x"}', 1],
    ["client_secret en json escapado", '{\\"client_secret\\":\\"', S, '\\"}', 1],
    ["password en querystring", "https://x.invalid/a?password=", S, "&pagina=x", 1],
    ["api_key con dos puntos", "api_key: ", S, "", 1],
    ["jwt", "va un jwt ", EYJ + "AAAA9.BBBB8.CCCC7DDDD6", "", 3],
    ["slack", "token de slack ", XOX + "1234-5678-ABCDEF99", "", 5],
    ["hex largo", "un hash ", "0123456789ABCDEF0123456789ABCDEF01234567", "", 32],
    ["base64 largo", "una ristra ", S, "", 40],
  ];
  const fuga = (sale) => (/[A-Z0-9]/.exec(sale) || /eyJ|xox/.exec(sale) || [""])[0];
  const mira = (nombre, entra) => { const sale = tapar(entra), f = fuga(sale); if (f || !sale.includes(M)) throw new Error(`${nombre}: se escapa «${f}» · entra ${JSON.stringify(entra)} · sale ${JSON.stringify(sale)}`); };

  await prueba("v572: el secreto cortado en cualquier punto, al final y sin salto de línea: no queda ni un carácter", () => {
    for (const [nombre, antes, sec, despues, min] of FORMAS) {
      mira(nombre + " (entero)", antes + sec + despues);
      mira(nombre + " (entero, con salto)", antes + sec + despues + "\notra linea normal\n");
      for (let k = min; k <= sec.length; k++) mira(`${nombre} (cortado en ${k})`, antes + sec.slice(0, k));
    }
  });

  await prueba("v572: el secreto partido en varias líneas por cualquier punto: no queda ni un carácter", () => {
    for (const [nombre, antes, sec, despues, min] of FORMAS) for (const salto of ["\n", "\r\n", "\n    ", "\\n"]) {
      for (let k = min; k < sec.length; k++) {
        mira(`${nombre} (partido en ${k})`, antes + sec.slice(0, k) + salto + sec.slice(k) + despues + "\notra linea normal");
        mira(`${nombre} (partido en ${k}, al final)`, antes + sec.slice(0, k) + salto + sec.slice(k) + despues);
      }
      const k = Math.max(min, 16), k2 = k + 9;   // y en tres trozos
      mira(`${nombre} (en tres líneas)`, antes + sec.slice(0, k) + salto + sec.slice(k, k2) + salto + sec.slice(k2) + despues + "\notra linea normal");
    }
  });

  await prueba("v572: mule.js pasa por la redacción TODO lo que escribe (logs, errores y trazas), no solo «logs»", () => {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "mule-sec-")), HOME = path.join(T, "home");
    const TOK = "tkfalso+de/mentira=999", CS = "cl4ve+f4lsa/mul3=x", JWT = EYJ + "hbGciOiJIUzI1NiJ9.cuerpoFALSO123.firmaFALSA456", LARGO = "Zm9vYmFyMTIzNDU2Nzg5MEZPT0JBUmZvb2JhcjEyMzQ1Njc4OTBGT09CQVI";
    try {
      fs.mkdirSync(path.join(HOME, ".config"), { recursive: true });
      fs.writeFileSync(path.join(HOME, ".config", "mulesoft.env"), `MULE_CLIENT_ID=id-falso\nMULE_CLIENT_SECRET="${CS}"\n`);
      const FF = path.join(T, "fetch-falso.js");
      fs.writeFileSync(FF, `const R = (st, j, txt) => ({ ok: st < 300, status: st, json: async () => j, text: async () => txt || JSON.stringify(j) });
const TOK = ${JSON.stringify(TOK)}, CS = ${JSON.stringify(CS)}, JWT = ${JSON.stringify(JWT)}, LARGO = ${JSON.stringify(LARGO)};
globalThis.fetch = async (url, o = {}) => {
  const u = url.replace("https://anypoint.mulesoft.com", "");
  if (u === "/accounts/api/v2/oauth2/token") return R(200, { access_token: TOK });
  if (u === "/accounts/api/me") return R(200, { client: { org_id: "ORG1" } });
  if (u === "/accounts/api/organizations/ORG1/environments") return R(200, { data: [{ name: "QA", type: "sandbox", id: "E1" }] });
  if (u === "/cloudhub/api/v2/applications") return R(200, [{ domain: "app-qa", status: "bearer " + JWT }]);
  if (u === "/cloudhub/api/v2/applications/app-qa") return R(200, { domain: "app-qa", status: "STARTED", region: "token=" + LARGO, properties: { "sf.url": "https://usuario:clavefalsa9@ejemplo.invalid/x?access_token=" + LARGO, "nota": "Bearer " + JWT, "db.password": "p4ss" } });
  if (u === "/cloudhub/api/v2/applications/app-qa/deployments?orderByDate=DESC") return R(200, { data: [{ deploymentId: "D1" }] });
  if (u.startsWith("/cloudhub/api/v2/applications/app-qa/deployments/D1/logs?")) return R(200, [
    { event: { timestamp: 1794960000000, priority: "INFO", message: 'cortado al final sin salto {"client_secret":"' + LARGO.slice(0, 30) } },
    { event: { timestamp: 1794959000000, priority: "DEBUG", message: "partido en lineas Authorization: Bearer " + JWT.slice(0, 20) + "\\n  " + JWT.slice(20) + "\\ny sigue la traza" } },
    { event: { timestamp: 1794958000000, priority: "INFO", message: "la app repite su token " + TOK + " y su secreto " + CS + " y un jwt suelto " + JWT } },
    { event: { timestamp: 1794957000000, priority: "INFO", message: '{\\\\"authorization\\\\":\\\\"bearer ' + LARGO + '\\\\"} y BEARER "' + JWT + '"' } },
    { event: { timestamp: 1794956000000, priority: "INFO", message: "BankInfo ok: 25 registros" } }]);
  if (u === "/cloudhub/api/v2/applications/prohibida") return R(403, {}, '{"message":"Forbidden","sent":"authorization: bearer ' + TOK + '","jwt":"' + JWT + '"}');
  if (u === "/cloudhub/api/v2/applications/rota") throw new Error("connect ECONNRESET con headers { authorization: 'bearer " + TOK + "' } y " + JWT);
  if (u === "/cloudhub/api/v2/applications/traza") setTimeout(() => { throw new Error("suelta: Bearer " + JWT); }, 0);
  return R(404, {});
};
`);
      const ENV = { ...process.env, HOME, USERPROFILE: HOME, NODE_OPTIONS: "" };
      const mule = (args) => { const r = spawnSync(process.execPath, ["--require", FF, path.join(HERR, "mule.js"), ...args], { encoding: "utf8", timeout: 30e3, env: ENV }); return { rc: r.status, out: r.stdout, err: r.stderr, todo: r.stdout + "\n" + r.stderr }; };
      // ni un trozo de 4 caracteres de ningún secreto, ni en stdout ni en stderr
      const trozos = (s) => { const t = new Set(); for (let i = 0; i + 4 <= s.length; i++) t.add(s.slice(i, i + 4)); return [...t]; };
      const SECRETOS = [TOK, CS, JWT, LARGO, "clavefalsa9", "p4ss"];
      const limpio = (q, r) => { for (const s of SECRETOS) for (const t of trozos(s)) if (r.todo.includes(t)) throw new Error(`${q}: se escapa «${t}» · ${JSON.stringify(r.todo.slice(0, 600))}`); };

      let r = mule(["logs", "QA", "app-qa", "50"]); limpio("logs", r);
      const ls = r.out.trimEnd().split("\n");
      igual([r.rc, ls.length, /BankInfo ok: 25 registros$/.test(ls[0]), /y sigue la traza$/.test(ls[ls.length - 2]), ls[ls.length - 1]],
        [0, 6, true, true, '2026-11-18 00:00:00 INFO cortado al final sin salto {"client_secret":' + M], "logs: todas las líneas, lo que no es secreto intacto y el token cortado del final, tapado");
      igual((r.out.match(/••••/g) || []).length >= 7, true, "logs: cada secreto deja su marca");
      r = mule(["apps", "QA"]); limpio("apps", r); igual([r.rc, /^app-qa\tbearer ••••\t/.test(r.out)], [0, true], "apps: también pasa por la redacción");
      r = mule(["app", "QA", "app-qa"]); limpio("app", r);
      igual([r.rc, /db\.password = •••• \(tapado\)/.test(r.out), /sf\.url = https:\/\/••••@ejemplo\.invalid\/x\?access_token=••••/.test(r.out), /nota = Bearer ••••/.test(r.out), /región: token=••••/.test(r.out)],
        [0, true, true, true, true], "app: un secreto dentro del VALOR de una propiedad con nombre inocente también se tapa");
      r = mule(["app", "QA", "prohibida"]); limpio("403", r);
      igual([r.rc, /HTTP 403 .*le falta ese permiso de lectura.*Forbidden/.test(r.err)], [1, true], "el cuerpo de un error HTTP sale tapado");
      r = mule(["app", "QA", "rota"]); limpio("excepción", r);
      igual([r.rc, /^mule: connect ECONNRESET/.test(r.err)], [1, true], "el mensaje de una excepción sale tapado");
      r = mule(["app", "QA", "traza"]); limpio("no capturada", r);
    } finally { fs.rmSync(T, { recursive: true, force: true }); }
  });

  await prueba("v572: las otras copias de la redacción (errores de la oficina, notas del canal) tapan el valor, no solo la palabra", () => {
    const S2 = require("../server.js"), pend = require(path.join(HERR, "canal-pendientes.js"));
    const sucio = "fallo con Bearer " + EYJ + "abc.def.ghi y " + XOX + "12-AbC.dEf y token=zzz999 y key_" + "0123456789abcdefABCD";
    for (const [q, f] of [["limpiaErr de la oficina", S2.limpiaErr], ["limpio de canal-pendientes", pend.limpio]]) {
      igual(typeof f, "function", q + " se exporta");
      const sale = f(sucio);
      igual([/abc|def|ghi|AbC|dEf|zzz999|0123456789/.test(sale), /^fallo con /.test(sale)], [false, true], q + ": «" + sale + "»");
    }
  });
};
