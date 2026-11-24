// Uso: node herramientas/salud.js          (desde la carpeta del repo, en cualquier consola)
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const HOME = os.homedir(), LOGS = path.join(HOME, ".canal-logs"), CFG = path.join(HOME, ".config"), REPO = path.join(__dirname, "..");
const PUERTO = +process.env.OFICINA_PORT || 4391;   // el mismo que la tarea «Canal IAs - oficina» (OFICINA_PORT)
let mal = 0, avisos = 0;
const bien = (t) => console.log("  ✔ " + t);
const ojo = (t, que) => { avisos++; console.log("  ⚠ " + t + (que ? "\n      → " + que : "")); };
const fallo = (t, que) => { mal++; console.log("  ✘ " + t + (que ? "\n      → " + que : "")); };
const sh = (cmd, args, ms = 30e3) => { try { return execFileSync(cmd, args, { encoding: "utf8", timeout: ms, stdio: ["ignore", "pipe", "pipe"], windowsHide: true }).trim(); } catch (e) { return null; } };
const hace = (t) => { const m = Math.round((Date.now() - t) / 60e3); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} días`; };
const cola = (f, n = 50) => { try { return fs.readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).slice(-n); } catch (e) { return []; } };

(async () => {
  console.log("Este equipo");
  const equipo = (() => { try { return fs.readFileSync(path.join(CFG, "oficina-equipo.txt"), "utf8").trim(); } catch (e) { return ""; } })();
  const lsT = sh("git", ["-C", REPO, "ls-remote", "origin", "refs/tags/turno-*", "refs/latido/*"]) || "";
  const turno = (lsT.match(/turno-([\w-]+)/) || [])[1] || "";
  // v208: el latido del equipo con el turno (lo deja su oficina cada 10 min)
  let lat = 0; try { lat = (require(path.join(REPO, "oficina", "server.js")).latidosDe(lsT) || {})[turno.toLowerCase()] || 0; } catch (e) {}
  const late = lat ? `; su último latido, hace ${hace(lat)}` : "";
  if (!equipo) ojo("sin ~/.config/oficina-equipo.txt: no hay turno (escucha siempre)", ".\\instalar.ps1 -Equipo <nombre>");
  else if (!turno) ojo(`equipo «${equipo}»; no he podido leer de quién es el turno (¿sin red?)`);
  else if (turno === equipo) (lat && Date.now() - lat > 30 * 60e3 ? ojo : bien)(`equipo «${equipo}» y TIENE el turno: atiende Slack y escribe${late}`);
  else if (lat && Date.now() - lat > 30 * 60e3) fallo(`el turno es de «${turno}» pero no late desde hace ${hace(lat)}: si está apagado, nadie atiende Slack`, "si ese equipo no está en marcha: «Atender desde aqui.cmd» en este");
  else bien(`equipo «${equipo}»; el turno es de «${turno}»${late}: aquí solo lectura (para atender desde aquí: «Atender desde aqui.cmd»)`);

  console.log("Código");
  const estado = sh("git", ["-C", REPO, "status", "--porcelain"]);
  if (estado === null) fallo("no encuentro el repo con git", "este repo tiene que ser un clon de git (SETUP.md, paso 5)");
  else if (estado) ojo("hay cambios sin subir en el repo", "git status");
  sh("git", ["-C", REPO, "fetch", "-q", "--no-write-fetch-head", "origin", "main:refs/remotes/origin/main"], 60e3);
  const detras = sh("git", ["-C", REPO, "rev-list", "--count", "HEAD..origin/main"]);
  if (detras && +detras > 0) ojo(`el repo va ${detras} commit(s) por detrás de main`, "git pull y reinicia oficina y escucha (SETUP.md, paso 4b)");
  else if (detras !== null) bien(`repo al día (${sh("git", ["-C", REPO, "log", "-1", "--format=%h %s"]).slice(0, 80)})`);

  console.log("Claves (solo los nombres)");
  const nombres = (f) => { try { return fs.readFileSync(path.join(CFG, f), "utf8").split(/\r?\n/).map((l) => (l.match(/^([A-Z_][A-Z0-9_]*)=/) || [])[1]).filter(Boolean); } catch (e) { return null; } };
  const hay = nombres("canal-slack.env");
  const deben = ["SLACK_WEBHOOK_CANAL", "SLACK_CURSOR_ID", "CURSOR_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "SLACK_HUMANO_ID", "GROK_WEBHOOK_URL", "GROK_WEBHOOK_KEY",
    "SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "JIRA_EMAIL", "JIRA_API_TOKEN", "BITBUCKET_EMAIL", "BITBUCKET_API_TOKEN"];
  if (!fs.existsSync(path.join(REPO, "config.local.json"))) fallo("no está config.local.json (tu nombre, tus IDs de Slack y tu rama del canal)", "copia config.ejemplo.json a config.local.json y rellénalo (SETUP.md, paso 8); después: node herramientas/config.js");
  if (!hay) fallo("no está ~/.config/canal-slack.env (nivel B)", "créalo siguiendo .env.example (SETUP.md, paso 7); si ya lo tienes en tu otro equipo, cópialo de allí (USB o gestor; nunca por GitHub ni Slack)");
  else { const faltan = deben.filter((k) => !hay.includes(k)); faltan.length ? fallo("faltan en canal-slack.env: " + faltan.join(", "), "añade esas líneas (.env.example); aunque no uses esa pieza, deja la línea con el valor vacío. CLAUDE_CODE_OAUTH_TOKEN es el de este equipo") : bien(`canal-slack.env completo (${deben.length} claves)`); }
  for (const f of ["oficina-slack.env", "mulesoft.env", "oficina-calendario.env"]) fs.existsSync(path.join(CFG, f)) ? bien(f) : ojo(`no está ~/.config/${f} (opcional)`, "solo si usas esa pieza: ver .env.example");

  console.log("Piezas");
  const oficinaViva = () => { try { const p = +fs.readFileSync(path.join(LOGS, "oficina.pid"), "utf8").trim(); if (!p) return false; try { process.kill(p, 0); return true; } catch (e) { return e.code === "EPERM"; } } catch (e) { return false; } };
  // (PowerShell en UTF-8 y el estado en inglés, fijo: schtasks sale en la página de códigos de la consola y en el idioma del equipo)
  const tareas = (sh("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
    "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-ScheduledTask | Where-Object { $_.TaskName -like 'Canal IAs*' } | ForEach-Object { $_.TaskName + '|' + $_.State }"], 60e3) || "")
    .split(/\r?\n/).filter(Boolean).map((l) => l.split("|"));
  const ESTADO = { Running: "en marcha", Ready: "lista (arranca cuando toca)", Disabled: "DESHABILITADA", Queued: "en cola" };
  for (const [t, debe] of [["Canal IAs - oficina", "Running"], ["Canal IAs - escucha Slack", "Running"], ["Canal IAs - vig", ""]]) {
    const x = tareas.find(([n]) => n.startsWith(t));
    if (!x) fallo(`no está la tarea «${t}…»`, ".\\instalar.ps1 -Equipo <nombre>");
    else if (t === "Canal IAs - oficina" && x[1] === "Ready" && oficinaViva()) bien(`tarea «${x[0]}»: lista; la oficina corre fuera de la tarea desde su último estreno (sin corte)`);
    else if (x[1] === "Disabled" || (debe && x[1] !== debe)) ojo(`tarea «${x[0]}»: ${ESTADO[x[1]] || x[1]}`, `Start-ScheduledTask '${x[0]}'`);
    else bien(`tarea «${x[0]}»: ${ESTADO[x[1]] || x[1]}`);
  }
  // oficina
  try {
    const r = await fetch(`http://127.0.0.1:${PUERTO}/api/estado`, { signal: AbortSignal.timeout(10e3) }); const j = await r.json();
    if (!j.listo) ojo("la oficina responde pero aún no tiene datos (tarda unos segundos al arrancar)");
    else {
      let ar = ""; try { ar = (fs.readFileSync(path.join(LOGS, "oficina-envios.log"), "utf8").match(/arranque: lista en [\d.]+ s/g) || []).pop() || ""; } catch (e) {}
      const sg = +((ar.match(/[\d.]+/) || [])[0] || 0);
      if (sg > 30) ojo(`la oficina tardó ${sg} s en arrancar la última vez (lento: ¿el equipo muy cargado, o sin red?)`); else if (sg) bien(`la oficina tardó ${sg} s en arrancar la última vez`);
      const errs = Object.entries(j.errores || {}); errs.length ? ojo("oficina con avisos: " + errs.map(([k, v]) => `${k}: ${String(v).slice(0, 80)}`).join(" · ")) : bien(`oficina en http://127.0.0.1:${PUERTO}: ${j.hilos.length} temas, sin errores`);
      if (j.turno && j.turno.equipo && j.turno.mio === false) bien("oficina en solo lectura (sin turno), como debe");
      const re = j.rendimiento;
      if (re && re.cpu != null) {
        const txt = `la oficina gasta un ${re.cpu} % de un núcleo` + (re.bloqueoMax >= 1000 ? `; se ha quedado bloqueada hasta ${(re.bloqueoMax / 1000).toFixed(1)} s (${re.bloqueoFase})` : "")
          + (re.vuelta ? `; cada vuelta, ${(re.vuelta.mediana / 1000).toFixed(1)} s (la peor ${(re.vuelta.max / 1000).toFixed(1)} s)` : "")
          + (re.lento && re.lento.ms > 1000 ? `; lo más lento: ${re.lento.que}, ${(re.lento.ms / 1000).toFixed(1)} s` : "") + " en los últimos 5 min";   // v517
        (re.cpu > 40 || re.bloqueoMax > 3000) ? ojo(txt + ": va cargada (¿muchas cosas abiertas en el equipo?)") : bien(txt);
        // v565: qué fuente (Slack, procesos, Cursor) tarda en contestar, y cuántas veces la vuelta siguió sin esperarla
        const fu = Object.entries(re.fuentes || {}).filter(([, x]) => x.sueltas || x.max > 5000);
        if (fu.length) ojo("la oficina leyó con retraso en los últimos 5 min: " + fu.map(([k, x]) => `${k}, hasta ${(x.max / 1000).toFixed(1)} s` + (x.sueltas ? ` (${x.sueltas} ${x.sueltas === 1 ? "vez" : "veces"} siguió sin esperarlo)` : "")).join(" · ") + " (no frena la página: sigue con lo último leído)");
      }
    }
  } catch (e) { fallo(`la oficina no responde en http://127.0.0.1:${PUERTO}`, "reinicia la tarea «Canal IAs - oficina» (SETUP.md, paso 4b)"); }
  // escucha
  const esc = cola(path.join(LOGS, "escucha-slack.log"), 400);
  const ult = (re) => { const l = [...esc].reverse().find((x) => re.test(x)); return l ? Date.parse(l.split(" ")[0]) : 0; };
  const conectado = ult(/ conectado$/), noEscucho = ult(/no escucho|dejo de escuchar/), evento = ult(/ evento /);
  let cx = null; try { cx = require(path.join(__dirname, "..", "oficina", "server.js")).estadoEscucha(esc); } catch {}
  const pidE = +((cola(path.join(LOGS, "escucha-slack.log"), 3000).reverse().find((l) => / arranco \(pid \d+\)\s*$/.test(l)) || "").match(/pid (\d+)/) || [])[1] || 0;
  const viveE = pidE && (() => { try { process.kill(pidE, 0); return true; } catch (e) { return e.code === "EPERM"; } })();
  if (pidE && !viveE) fallo(`la escucha no está en marcha (su último proceso, pid ${pidE}, ya no existe)`, "Start-ScheduledTask 'Canal IAs - escucha Slack' (la oficina la levanta sola en 1-2 min si está en marcha)");
  else if (!esc.length) fallo("la escucha no ha dejado log (~/.canal-logs/escucha-slack.log)", "reinicia la tarea «Canal IAs - escucha Slack»");
  else if (equipo && turno && turno !== equipo) bien(`escucha en espera (el turno es de «${turno}»)${noEscucho ? ", lo dijo hace " + hace(noEscucho) : ""}`);
  else if (cx && cx.estado === "caida") fallo(`la escucha está viva pero desconectada de Slack desde hace ${hace(cx.desde)} («${cx.linea}»)`, "reinicia la tarea «Canal IAs - escucha Slack»; si sigue, mira SLACK_APP_TOKEN en canal-slack.env");
  else if (conectado && conectado >= noEscucho) bien(`escucha conectada a Slack (desde hace ${hace(conectado)}${evento ? "; último evento hace " + hace(evento) : ""})`);
  else ojo("la escucha no consta conectada", "mira las últimas líneas de ~/.canal-logs/escucha-slack.log");
  // vigía
  try {
    // v232: su latido se escribe en CADA pasada (cada 15 min, a cualquier hora; fuera de 8-20 solo vigila la oficina)
    const t = Date.parse(fs.readFileSync(path.join(LOGS, "vigia-canal.ultimo"), "utf8").trim());
    Date.now() - t < 35 * 60e3 ? bien(`vigía: última pasada hace ${hace(t)}`) : fallo(`vigía: última pasada hace ${hace(t)}`, "mira la tarea «Canal IAs - vigía» (debe repetirse cada 15 min)");
    let vo = {}; try { vo = JSON.parse(fs.readFileSync(path.join(LOGS, "vigila-oficina.json"), "utf8")); } catch (e) {}
    const arr = (vo.arranques || []).filter((x) => Date.now() - x < 24 * 3600e3);
    if (arr.length) ojo(`el vigía ha tenido que levantar la oficina ${arr.length === 1 ? "1 vez" : arr.length + " veces"} en 24 h (la última hace ${hace(Math.max(...arr))})`, "si se repite, mira el final de ~/.canal-logs/oficina-envios.log");
    // v547: la oficina caída y que no vuelve (ni con su tarea ni con el arranque directo del vigía)
    if (vo.caida && vo.caida.desde) fallo(`la oficina no vuelve: caída desde hace ${hace(vo.caida.desde)} (el vigía no consigue arrancarla, ni con su tarea ni directa)`, "doble clic en oficina\\arrancar-oficina.cmd; y mira el final de ~/.canal-logs/vigia-canal.log y relanzar-oficina.log");
  } catch (e) { ojo("el vigía aún no ha pasado en este equipo (~/.canal-logs/vigia-canal.ultimo)"); }
  // v547: el último estreno, si el relanzador no la pudo levantar (ni con el arranque directo)
  { const ls = cola(path.join(LOGS, "relanzar-oficina.log"), 20).map((l) => l.replace(/^﻿/, "")), i = ls.map((l) => /estreno \(pid/.test(l)).lastIndexOf(true);
    const u = i >= 0 ? ls.slice(i) : [], t0 = u.length ? Date.parse(u[0].slice(0, 19)) : 0;
    if (u.some((l) => /NO VUELVE/.test(l)) && Date.now() - t0 < 24 * 3600e3) fallo(`el último estreno de la oficina (hace ${hace(t0)}) no volvió: ni la tarea ni el arranque directo`, "mira ~/.canal-logs/relanzar-oficina.log (lo que contestó schtasks)");
    else if (u.some((l) => /directa/.test(l)) && Date.now() - t0 < 24 * 3600e3) ojo(`el último estreno de la oficina (hace ${hace(t0)}) volvió con el arranque directo: la tarea no arrancó`, "mira ~/.canal-logs/relanzar-oficina.log (lo que contestó schtasks)"); }
  // traspasos sin respuesta (vigía) y relanzos (oficina) de las últimas 24 h
  const tr = cola(path.join(LOGS, "traspasos.log"), 300).map((l) => l.split("\t")).filter((x) => Date.now() - Date.parse(x[0]) < 24 * 3600e3);
  const sinR = tr.filter((x) => x[1] === "SIN_RESPUESTA");
  sinR.length ? ojo(`${sinR.length} traspaso(s) sin respuesta en 24 h: ` + sinR.map((x) => `${x[2]} (${(x[5] || "").slice(0, 50)})`).join("; "), "míralos en la oficina (salen como «⚠️ no contestó»)") : bien(`traspasos: ${tr.length} en 24 h (${tr.filter((x) => x[1] === "RELANZO").length} relanzos de la oficina), ninguno sin respuesta`);

  console.log("Para trabajar");
  // v202: ¿el último Claude que se lanzó pudo entrar? (token caducado = ningún Claude arranca)
  try {
    const au = require(path.join(REPO, "oficina", "server.js")).authClaude();
    const hayLanzado = (() => { try { return fs.readdirSync(LOGS).some((f) => /^(slack-\d{8}-\d{6}\.log|claude-\d{8}-\d{6}-\w+\.log)$/.test(f) && Date.now() - fs.statSync(path.join(LOGS, f)).mtimeMs < 24 * 3600e3); } catch (e) { return false; } })();
    au ? fallo(`el último Claude (${au.f}) no pudo entrar: token no válido`, "claude setup-token y cámbialo en ~/.config/canal-slack.env (CLAUDE_CODE_OAUTH_TOKEN)")
      : hayLanzado ? bien("el último Claude lanzado entró bien (token válido)")
      : ojo("token de Claude sin comprobar: no se ha lanzado ningún Claude en las últimas 24 h", "se comprueba solo al lanzar el primero (nivel B)");
  } catch (e) { ojo("no he podido comprobar el token de Claude: " + e.message.slice(0, 80)); }
  const cli =(() => { try { const b = path.join(process.env.APPDATA || "", "Claude", "claude-code"); return fs.readdirSync(b).flatMap((v) => fs.readdirSync(path.join(b, v)).map((h) => path.join(b, v, h, "claude.exe"))).filter((f) => fs.existsSync(f)).pop(); } catch (e) { return null; } })();
  cli ? bien("CLI de Claude Code encontrado") : fallo("no encuentro el CLI de Claude Code", "abre la app de Claude y la pestaña Code una vez");
  // v276: el Git Bash con el que la escucha y la oficina lanzan a las IAs (las dos rutas que acepta el instalador)
  const gb = require("./git-bash.js").gitBash({ home: HOME });   // v356: la misma búsqueda que la escucha y la oficina
  gb ? bien(`Git Bash para lanzar a las IAs: ${gb}`) : ojo("no encuentro Git Bash (ni en %LOCALAPPDATA%\\Programs\\Git, ni en %ProgramFiles%\\Git, ni junto al git del PATH): la escucha usará el «bash» del PATH, que suele ser el de WSL", "instala Git for Windows (o pon CANAL_BASH con la ruta de bash.exe)");
  const ocaRepo = process.env.CANAL_REPO || path.join(HOME, "Documents", "Oca Global Repository", "oca-salesforce");
  fs.existsSync(ocaRepo) ? bien("repo de OCA en su sitio") : fallo("no está el repo de OCA en Documents\\Oca Global Repository\\oca-salesforce", "SETUP.md, paso 3");
  // el worktree del segundo canal solo se pide si la config tiene segundo canal
  const CONF = require("./config.js").config();   // sin config.local.json el segundo canal es solo el de ejemplo: no se pide
  for (const wt of (CONF.origen.fichero ? CONF.canalGit.canales : CONF.canalGit.canales.slice(0, 1)).map((c) => c.worktree)) {
    if (!fs.existsSync(path.join(HOME, wt))) { fallo(`falta el worktree ~/${wt}`, "SETUP.md, paso 4"); continue; }
    // v258: con cambios a medias, publicar-canal.sh no deja publicar a ninguna IA en ese canal
    const st = sh("git", ["-C", path.join(HOME, wt), "status", "--porcelain", "--untracked-files=no"]);
    st ? fallo(`el worktree ~/${wt} tiene cambios a medias: ninguna IA puede publicar en ese canal`, `git -C ~/${wt} status (y, si sobra, git -C ~/${wt} checkout -- .)`) : bien(`worktree ${wt}${st === "" ? ", limpio" : ""}`);
  }
  const tam = (() => { try { return fs.readdirSync(LOGS).reduce((a, f) => { try { return a + fs.statSync(path.join(LOGS, f)).size; } catch (e) { return a; } }, 0); } catch (e) { return 0; } })();
  tam > 200 * 1024 * 1024 ? ojo(`~/.canal-logs ocupa ${Math.round(tam / 1048576)} MB`, "la oficina rota los logs cada 24 h; si sigue creciendo, avisa") : bien(`~/.canal-logs: ${Math.round(tam / 1024)} KB`);

  try {
    const D = require(path.join(REPO, "oficina", "diario.js")), ds = D.enCarpeta(path.join(HOME, ".oficina"));
    console.log("Errores del día (diario de cada equipo)");
    if (!ds.length) console.log("  · aún no hay diario: lo escribe la oficina cuando está en marcha");
    for (const x of ds) for (const l of D.resumen(D.lee(x.ruta, x.equipo))) console.log(l.startsWith("  ") ? "  " + l : "  · " + l);
  } catch (e) {}

  console.log(`\n${mal ? "✘" : avisos ? "⚠" : "✔"} ${mal} fallo(s), ${avisos} aviso(s)`);
  process.exit(mal ? 1 : 0);
})().catch((e) => { console.error("salud.js: " + e.message); process.exit(2); });
