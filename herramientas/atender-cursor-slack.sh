#!/usr/bin/env bash
set -uo pipefail
_cfg="$(dirname "${BASH_SOURCE[0]}")/config.sh"; [ -f "$_cfg" ] && . "$_cfg"   # identidad: config.local.json (ver config.js)
J=${1:?json}
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$HOME/.canal-logs"
LOGF="$HOME/.canal-logs/cursor-slack-$(date +%Y%m%d-%H%M%S).log"
exec >>"$LOGF" 2>&1
CFG="$HOME/.config/canal-slack.env"; set -a; . <(tr -d '\r' < "$CFG"); set +a
leer() { J="$J" K="$1" node -e 'const j=JSON.parse(require("fs").readFileSync(process.env.J,"utf8"));process.stdout.write(String(j[process.env.K]||""))'; }
CH=$(leer channel); TS=$(leer ts); HILO=$(leer thread_ts); QUIEN=$(leer quien)
RAWTXT=$(leer text)   # v157: para saber si Humano escribió también a Coo
# Interruptor de Cursor: con herramientas/cursor-apagado no se llama a la API de Cursor; el encargo pasa a Claude (atender-slack.sh).
if [ -f "$AQUI/cursor-apagado" ] && { [ "${CANAL_PRUEBAS:-0}" != 1 ] || [ "${CURSOR_APAGADO_PRUEBA:-0}" = 1 ]; }; then
  echo "$(date -Is) DESVIO hilo $HILO a Claude (Cursor apagado)" >> "$HOME/.canal-logs/cursor-arranques.log"
  J="$J" node -e 'const fs=require("fs"),f=process.env.J,j=JSON.parse(fs.readFileSync(f,"utf8"));j.text="[Encargo para Cursor que te pasa la oficina porque Cursor está apagado: hazlo tú y no se lo pases a Cursor.]\n"+String(j.text||"");fs.writeFileSync(f,JSON.stringify(j))' \
    && exec bash "$AQUI/atender-slack.sh" "$J"
  echo "$(date -Is) no pude pasar el encargo a Claude (hilo $HILO)"; rm -f "$J"; exit 12
fi
rm -f "$J"
export AUTOR=Cursor   # sus respuestas salen firmadas como Cursor (responder-slack.sh); los avisos del sistema usan AUTOR=Sistema
# (el bloqueo «sin saldo de API» ya no va aquí: solo se aplica en el respaldo por API, si falla el CLI con la sesión OCA)
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
responder() { printf '%s' "$1" > "$TMP/r.txt"; bash "$AQUI/responder-slack.sh" "$CH" "$HILO" "$TMP/r.txt" || true; }
echo "$(date -Is) mención a Cursor de $QUIEN en $CH ($TS), hilo $HILO"

if [ "$QUIEN" != "Humano" ] && ! FRENO_POR=$(bash "$AQUI/freno.sh" cursor "$HILO" 2>&1 >/dev/null); then
  echo "$(date -Is) FRENO: no lanzo Cursor por API para $QUIEN en el hilo $HILO (${FRENO_POR:-sin motivo})" >> "$HOME/.canal-logs/freno.log"
  bash "$AQUI/responder-slack.sh" --reaccion "$CH" "$TS" no_entry_sign >/dev/null 2>&1 || true
  MARCA="$HOME/.canal-logs/freno-avisado-$HILO"
  if [ ! -f "$MARCA" ] || [ $(( $(date +%s) - $(stat -c %Y "$MARCA") )) -ge 3600 ]; then
    touch "$MARCA"; AV=$(mktemp)
    printf '🚫 Freno anti ping-pong: no abro a Cursor en este hilo ahora (límite de la última hora). Si hace falta ya, que lo pida Humano a mano: a él no se le frena.' > "$AV"
    AUTOR=Sistema bash "$AQUI/responder-slack.sh" "$CH" "$HILO" "$AV" >/dev/null 2>&1 || true; rm -f "$AV"
  fi
  exit 12
fi
[ -n "${SLACK_BOT_TOKEN:-}" ] || { echo "falta SLACK_BOT_TOKEN"; exit 8; }   # CURSOR_API_KEY solo hace falta en el respaldo por API

CH="$CH" HILO="$HILO" OUT="$TMP/hilo.json" node -e '
(async()=>{ const e=process.env; let msgs=[], cur="";
  for (let i=0;i<10;i++) {
    const r=await fetch("https://slack.com/api/conversations.replies?"+new URLSearchParams({channel:e.CH,ts:e.HILO,limit:"200",...(cur?{cursor:cur}:{})}),{headers:{Authorization:"Bearer "+e.SLACK_BOT_TOKEN}});
    const j=await r.json(); if(!j.ok){ console.log("conversations.replies: "+j.error); break; }
    msgs.push(...(j.messages||[])); cur=j.response_metadata&&j.response_metadata.next_cursor; if(!cur) break;
  }
  require("fs").writeFileSync(e.OUT,JSON.stringify({messages:msgs}));
})().catch(x=>console.log("no he podido leer el hilo: "+String(x.message).slice(0,120)));'
NOMBRES="${SLACK_HUMANO_ID:-x}=Humano,${SLACK_CLAUDE_ID:-UCLAUDE0001}=Claude,${SLACK_COO_ID:-UCOO0000001}=Coo,${SLACK_CURSOR_ID:-UCURSOR0001}=Cursor"

POR_GIT=0; [ "$QUIEN" != "Humano" ] && POR_GIT=1
UNA=0; [ "$QUIEN" = "Humano" ] && printf "%s" "$RAWTXT" | grep -qiE "<@${SLACK_COO_ID:-UCOO0000001}>|(^|[^[:alnum:]_])@coo([^[:alnum:]_]|$)" && UNA=1
[ "$UNA" = 1 ] && POR_GIT=1
PARA_GIT=$QUIEN; [ "$UNA" = 1 ] && PARA_GIT=Coo
# Cuerpo de la petición a Cursor.
FORMATO_J=$(tr -d '\r' < "$AQUI/formato-para-humano.txt" 2>/dev/null)   # v146: la misma pauta para todas las IAs
HILO_F="$TMP/hilo.json" NOMBRES="$NOMBRES" QUIEN="$QUIEN" POR_GIT="$POR_GIT" UNA="$UNA" FORMATO_J="$FORMATO_J" node -e '
const fs=require("fs"),e=process.env;
const nom=Object.fromEntries(e.NOMBRES.split(",").map(p=>p.split("=")));
let msgs=[];try{msgs=JSON.parse(fs.readFileSync(e.HILO_F,"utf8")).messages||[]}catch(x){}
const limpio=t=>String(t||"").replace(/<@([A-Z0-9]+)>/g,(m,u)=>"@"+(nom[u]||u));
const hilo=msgs.slice(-30).map(m=>`[${nom[m.user]||m.username||m.user||"?"}] ${limpio(m.text)}`).join("\n\n");
const text=[
 `Eres Cursor. En Slack (#${e.SLACK_CANAL_NOMBRE||"canal-humano"}, OCA) te ha mencionado ${e.QUIEN}. «Humano» es como el sistema llama a la persona para la que trabajas; se llama ${e.EDIFICIO_NOMBRE||"Humano"}: al hablarle usa su nombre; en las etiquetas y marcadores escribe siempre «Humano». Su mención no despierta tu app oficial, así que te lanzan por el CLI de Cursor (sesión OCA). Es un agente nuevo: nadie lo mira; un script publica tu respuesta final (en el hilo de Slack o en el canal git, según el punto 3), firmada como Cursor.`,
 ``,`Hilo (los últimos mensajes; el último es el que te menciona):`,`-----`,hilo,`-----`,``,
 `Qué hacer:`,
 `1. Responde a lo que te piden en ese hilo. Si necesitas el código, el repo está clonado (rama del canal). Solo lectura: no hagas commits, push, PRs ni nada en ningún org de Salesforce.`,
 `1b. Si te encargan IMPLEMENTAR un cambio de código, no lo dejes en «propuesta»: escribe el cambio EXACTO (diff unificado o el método completo, con la ruta de cada fichero y los tests) y pasa el testigo a Claude, que es quien aplica, sube la rama y abre la PR con el OK de Humano: termina con [lo hace: Claude — aplicar el diff de Cursor en <rama nueva> y abrir la PR].`,
 `2. Nada de secretos ni valores de credenciales. Si propones el título de una PR: formato de OCA «LÍNEA | TICKET | Descripción» (p. ej. «INDUSTRIA | BDXN-401 | …», «TRANSVERSAL | PRJB-1296 | …»). Las PRs las abre Claude con abrir-pr.sh.`,
 e.UNA==="1"
  ? `3. Humano os ha escrito a varios (Coo incluido) y quiere UNA sola respuesta, que le da Coo: tu respuesta FINAL NO va a Slack, se publica en el CANAL GIT como bloque para Coo. Escríbela en Markdown, en español, corta y sin relleno. Escribe solo el cuerpo: sin cabecera <!-- para: -->, sin título y sin envolverla en un bloque de código (la cabecera la pone el script). Última línea, la etiqueta de estado: [lo hace: <IA> — <qué>] si sigue otra IA, o [hecho]. Si no tienes nada que aportar, responde solo: NADA.`
  : e.POR_GIT==="1"
  ? `3. Te ha despertado otra IA (${e.QUIEN}), no Humano: tu respuesta FINAL NO va a Slack, se publica en el CANAL GIT como bloque para ${e.QUIEN}. Escríbela en Markdown, en español, completa pero sin relleno (listas numeradas, rutas y líneas si hacen falta). Sin preámbulo. Escribe solo el cuerpo: sin cabecera <!-- para: -->, sin título y sin envolverla en un bloque de código (la cabecera la pone el script). Cierra con la etiqueta de estado en su propia línea: [lo hace: <IA> — <qué>] si el siguiente paso es de otra IA, o [hecho]. Si de verdad necesitas algo que solo puede decidir Humano (y ya cruzado con las otras IAs) o un OK de escritura, pon como ÚLTIMA línea, después de la etiqueta, «HUMANO: <la pregunta en una línea>». Si no te toca a ti o no hay nada que hacer, responde solo: NADA.`
  : `3. Tu respuesta FINAL es el mensaje de Slack para Humano, en español: como mucho 3 líneas (la primera, el siguiente paso) y, como ÚLTIMA línea, la etiqueta de estado: [te toca: <la pregunta exacta>], [lo hace: Claude|Cursor|Coo — <qué>] o [hecho]. Esto manda sobre el máximo de 5 líneas de la pauta de abajo. En Slack NUNCA: cabecera <!-- para: -->, títulos, tablas, bloques de código, anexos ni el detalle técnico. Si tienes detalle técnico para las otras IAs, ponlo DEBAJO de una línea que sea exactamente ---CANAL--- : lo de debajo se publica en el canal git (sin cabecera: la pone el script) y en Slack solo quedan tus líneas de arriba. ${e.FORMATO_J||"Escueto: primera línea el siguiente paso."} Si no te toca a ti o no hay nada que hacer, responde solo: NADA.`,
 `4. Regla de Humano: lo técnico entre IAs va por el canal git, no por Slack. A Humano solo le llega una decisión que únicamente puede tomar él (y ya cruzada con Coo y Claude), un OK de escritura o un resultado final en 3 líneas. Sin estados intermedios ni acuses.`
].join("\n");
process.stdout.write(JSON.stringify({prompt:{text},name:"slack "+Date.now(),
  repos:[{url:e.CANAL_REPO_URL||"https://bitbucket.org/oca-global/oca-salesforce",startingRef:e.CANAL_RAMA||"canal/humano/claude-cursor"}],
  workOnCurrentBranch:true,autoCreatePR:false,
  model:{id:e.CURSOR_MODELO||"composer-2.5"}}));' > "$TMP/body.json"

VIA="vía API"; CLI_OK=0
# ---- Vía primaria: CLI de Cursor con la sesión OCA (apiKeySource "login"), sin CURSOR_API_KEY ----
# Solo se salta en la prueba aislada de la API falsa (CANAL_PRUEBAS=1 + CURSOR_API_URL y sin CURSOR_CLI simulado).
if ! { [ "${CANAL_PRUEBAS:-0}" = 1 ] && [ -n "${CURSOR_API_URL:-}" ] && [ -z "${CURSOR_CLI:-}" ]; }; then
  win() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }
  WORK_DIR=""
  if [ -n "${CURSOR_WORK_DIR:-}" ] && [[ "$CURSOR_WORK_DIR" != *wt-pkf101-errores* ]]; then WORK_DIR=$CURSOR_WORK_DIR
  elif [ -d "$HOME/wt-canal-claude" ]; then WORK_DIR="$HOME/wt-canal-claude"
  elif [ -n "${CANAL_REPO:-}" ] && [[ "$CANAL_REPO" != *wt-pkf101-errores* ]] && [ -d "$CANAL_REPO" ]; then WORK_DIR=$CANAL_REPO
  else WORK_DIR=$TMP; fi
  [ -d "$WORK_DIR" ] || WORK_DIR=$TMP
  bash "$AQUI/responder-slack.sh" --reaccion "$CH" "$TS" hourglass_flowing_sand >/dev/null 2>&1 || true
  BODY="$TMP/body.json" OUT="$TMP/prompt.txt" node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(process.env.BODY,"utf8"));fs.writeFileSync(process.env.OUT,String((j.prompt&&j.prompt.text)||""))'
  rm -f "$TMP/res.txt" "$TMP/sid.txt"
  CLI_PS1=$(win "$AQUI/cursor-cli.ps1"); PROMPT_WIN=$(win "$TMP/prompt.txt"); WD_WIN=$(win "$WORK_DIR")
  MAP_WIN=$(win "$HOME/.canal-logs/cursor-cli-chats.json"); RES_WIN=$(win "$TMP/res.txt"); SID_WIN=$(win "$TMP/sid.txt")
  CURSOR_API_KEY= powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$CLI_PS1" -PromptFile "$PROMPT_WIN" -WorkDir "$WD_WIN" \
    -Hilo "$HILO" -MappingPath "$MAP_WIN" -OutFile "$RES_WIN" -SessionOutFile "$SID_WIN" </dev/null 2>"$TMP/cli.err"
  CLI_RC=$?
  if [ "$CLI_RC" = 0 ] && [ -s "$TMP/res.txt" ]; then
    OUT="$TMP/res.txt" node -e '
      const fs=require("fs");let r=fs.readFileSync(process.env.OUT,"utf8");
      r=r.replace(/<@([A-Z0-9]+)>/g,"@$1").replace(/<!(here|channel|everyone)>/g,"@$1").trim();
      fs.writeFileSync(process.env.OUT,r);'
    SID=$(tr -d '\r\n' < "$TMP/sid.txt" 2>/dev/null)
    echo "$(date -Is) SI hilo $HILO cli-login ${SID:-ok}" >> "$HOME/.canal-logs/cursor-arranques.log"
    echo "Cursor lanzado por CLI (sesión OCA)${SID:+: $SID}"
    CLI_OK=1; VIA="vía CLI"
  else
    echo "Cursor CLI fallo (rc=$CLI_RC): $(tr '\r\n' '  ' < "$TMP/cli.err" 2>/dev/null | cut -c1-400); paso al respaldo por API"
  fi
fi

if [ "$CLI_OK" != 1 ]; then
# ---- Vía de respaldo: API de prepago ----
# Sin saldo de API: si en este hilo Cursor ya falló con usage_limit_exceeded (y no ha arrancado después), ya se avisó UNA vez:
# no se llama a la API ni se publica otro aviso; se espera a que Humano lo lance a mano o vuelva el saldo (un SI lo desbloquea).
if AVISADO=$(node "$AQUI/cursor-sin-saldo.js" hilo "$HILO" 2>/dev/null); then
  echo "$(date -Is) no relanzo Cursor en el hilo $HILO: sin saldo de API (avisado a las $AVISADO); se espera"
  echo "$(date -Is) ESPERA hilo $HILO sin saldo de API: ya avisado a las $AVISADO, no se relanza ($QUIEN)" >> "$HOME/.canal-logs/cursor-arranques.log"
  exit 10
fi
if [ -z "${CURSOR_API_KEY:-}" ]; then
  echo "$(date -Is) NO hilo $HILO sin CURSOR_API_KEY de respaldo" >> "$HOME/.canal-logs/cursor-arranques.log"
  responder "*Cursor no ha arrancado (el CLI con la sesión OCA ha fallado y no hay clave de API de respaldo).* Si corre prisa, menciónalo a mano en su app."
  exit 10
fi
CCFG=$(umask 077; mktemp -p "$TMP"); printf 'user = "%s:"\n' "$CURSOR_API_KEY" > "$CCFG"
API=https://api.cursor.com/v1/agents
# el host es fijo: CURSOR_API_URL solo vale en pruebas (CANAL_PRUEBAS=1), como en lanzar-cursor.sh y cursor-agente.js
if [ "${CANAL_PRUEBAS:-0}" = 1 ] && [ -n "${CURSOR_API_URL:-}" ]; then API=$CURSOR_API_URL; fi
RUN0=""; REUSO=$(CURSOR_API_KEY="$CURSOR_API_KEY" node "$AQUI/cursor-agente.js" reusa "slack:$HILO" "$TMP/body.json" 2>/dev/null) || REUSO=""
if [ -n "$REUSO" ]; then
  ID=${REUSO%%$'\t'*}; RUN0=${REUSO#*$'\t'}; CODE=200; JSON="{\"agent\":{\"id\":\"$ID\"}}"
  echo "Cursor: sigo con el agente $ID (follow-up, sin clonar)"
fi
[ -z "$REUSO" ] && for ESPERA in 20 60 0; do
  RESP=$(curl -sS -m 30 -K "$CCFG" -w '\n%{http_code}' -H 'Content-Type: application/json' --data-binary "@$TMP/body.json" "$API" 2>"$TMP/curl.err" || true)
  CODE=${RESP##*$'\n'}; JSON=${RESP%$'\n'*}; [ -s "$TMP/curl.err" ] && JSON="$JSON $(tr '\n' ' ' < "$TMP/curl.err")"
  case "$CODE" in 5*|000|'') [ "$ESPERA" -gt 0 ] && { echo "API de Cursor http ${CODE:-?}: reintento en $ESPERA s"; sleep "$ESPERA"; continue; } ;; esac
  break
done
ID=$(JSON="$JSON" node -e 'try{const j=JSON.parse(process.env.JSON);process.stdout.write((j.agent&&j.agent.id)||j.id||"")}catch(x){}')
if [ "${CODE:0:1}" != "2" ] || [ -z "$ID" ]; then
  # http 400 con error.code usage_limit_exceeded = Cursor sin saldo de API (no es que la API no responda; no se reintenta)
  SIN_SALDO=""
  [ "$CODE" = 400 ] && SIN_SALDO=$(JSON="$JSON" node -e 'const s=process.env.JSON;let c="";try{const j=JSON.parse(s);c=(j.error&&j.error.code)||j.code||""}catch(x){const m=s.match(/"code"\s*:\s*"([^"]+)"/);c=m?m[1]:""}process.stdout.write(c==="usage_limit_exceeded"?"1":"")')
  echo "Cursor NO lanzado: http ${CODE:-?}${SIN_SALDO:+ sin saldo de API} $(printf '%s' "$JSON" | tr -d '\n' | cut -c1-200)"
  echo "$(date -Is) NO hilo $HILO http ${CODE:-?}${SIN_SALDO:+ sin saldo de API (usage_limit_exceeded)} $(printf '%s' "$JSON" | tr -d '\n' | cut -c1-160)" >> "$HOME/.canal-logs/cursor-arranques.log"
  if [ -n "$SIN_SALDO" ]; then
    responder "*Cursor sin saldo de API: recarga en tu facturación de Cursor.* Si corre prisa, menciónalo a mano en su app."
  else
    responder "*Cursor no ha arrancado (la API no responde, http ${CODE:-?}, 3 intentos).* Si corre prisa, menciónalo a mano en su app."
  fi
  exit 10
fi
echo "$(date -Is) SI hilo $HILO agente $ID${REUSO:+ (follow-up)}" >> "$HOME/.canal-logs/cursor-arranques.log"
node "$AQUI/cursor-agente.js" apunta "slack:$HILO" "$ID" 2>/dev/null || true
[ -z "$RUN0" ] && RUN0=$(JSON="$JSON" node -e 'try{const j=JSON.parse(process.env.JSON);process.stdout.write((j.run&&j.run.id)||"")}catch(x){}')
echo "Cursor lanzado: agente $ID"
bash "$AQUI/responder-slack.sh" --reaccion "$CH" "$TS" hourglass_flowing_sand >/dev/null 2>&1 || true

# Espera a ESE agente (igual que esperar-cursor.sh: el listado da estado y run; el texto, /runs/{id}).
FIN=$(( $(date +%s) + 3600 )); ST="?"; RUN=""
while :; do
  # v392: con el id del run (follow-up o nuevo) se pregunta por ESE run (tras un follow-up el listado aún podía dar el anterior)
  IFS=$'\t' read -r ST RUN < <(curl -sS -m 20 -K "$CCFG" "$API/$ID/runs${RUN0:+/$RUN0}" 2>/dev/null | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);
      const r=j.run||(j.items||j.runs||j.data||[])[0]||j;process.stdout.write((r.status||"?")+"\t"+(r.id||""));}catch(x){process.stdout.write("?\t")}});')
  case "$ST" in FINISHED|ERROR|CANCELLED|EXPIRED) break ;; esac
  [ "$(date +%s)" -ge "$FIN" ] && break
  sleep "${CURSOR_PASO_S:-8}"   # v392: cada 8 s (antes 30: hasta medio minuto de espera de más por recado)
done
echo "estado final: $ST"
if [ "$ST" != "FINISHED" ]; then responder "Cursor (vía API): el agente $ID ha terminado en $ST sin respuesta."; exit 0; fi
for i in 1 2 3; do
  [ -n "$RUN" ] && curl -sS -m 30 -K "$CCFG" "$API/$ID/runs/$RUN" -o "$TMP/run.json" 2>/dev/null
  RUNJ="$TMP/run.json" OUT="$TMP/res.txt" node -e '
    const fs=require("fs");let r="";try{const j=JSON.parse(fs.readFileSync(process.env.RUNJ,"utf8"));r=(j.run||j).result||"";}catch(x){}
    r=typeof r==="string"?r:JSON.stringify(r);
    r=r.replace(/<@([A-Z0-9]+)>/g,"@$1").replace(/<!(here|channel|everyone)>/g,"@$1").trim();
    fs.writeFileSync(process.env.OUT,r);'
  [ -s "$TMP/res.txt" ] && break; sleep 10
done
if [ ! -s "$TMP/res.txt" ]; then responder "Cursor (vía API): el agente $ID terminó pero no he podido leer su respuesta."; exit 0; fi
fi   # fin del respaldo por API (CLI_OK != 1)
[ "$(tr -d '[:space:]' < "$TMP/res.txt")" = "NADA" ] && { echo "Cursor: NADA"; exit 0; }
cat > "$TMP/partir.js" <<'EOF_JS'
const fs=require("fs"),path=require("path"),e=process.env,O=(f)=>path.join(e.OUT,f);
const MAX_SLACK=6;   // más líneas que esto (sin la etiqueta) y sin [te toca:] = es detalle técnico, no un mensaje para Humano
let msgs=[];try{msgs=JSON.parse(fs.readFileSync(e.HILO_F,"utf8")).messages||[]}catch(x){}
const raiz=String((msgs[0]||{}).text||"").replace(/<[^>]*>/g,"").replace(/[*_`]/g,"").split("\n")[0].replace(/^Hilo:\s*/i,"").trim().slice(0,90)||"hilo de Slack";
const linea=(s)=>String(s).replace(/\s*\n\s*/g," ").replace(/\|/g,"/").replace(/-->/g,"→").trim();   // un valor de cabecera
let res=fs.readFileSync(e.RES,"utf8").replace(/\r/g,"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").trim();
const FENCE=/^[ \t]*```[\w-]*[ \t]*$/;
// un bloque de código que envuelve una cabecera de canal no es código: es el bloque entero metido en ``` (lo de las 09:10)
res=res.replace(/^[ \t]*```[\w-]*[ \t]*\n([\s\S]*?<!--\s*para:[\s\S]*?)\n[ \t]*```[ \t]*$/gm,"$1").trim();
let pregunta="";
if(e.MODO==="git"){ const m=res.match(/\n?HUMANO:\s*(.+)\s*$/); if(m){ pregunta=m[1].trim().slice(0,200); res=res.slice(0,m.index).trim(); } }
// la etiqueta de estado: las de la última línea que lleve alguna
const RE_TAG=/\[\s*(te toca|lo hace|hecho|espera)\b[^\]\n]*\]/gi;   // v399: + [espera: persona — …]
let tags=[]; { const ls=res.split("\n");
  for(let i=ls.length-1;i>=0;i--){ const m=ls[i].match(RE_TAG); if(m){ tags=m.map((s)=>s.trim()); ls[i]=ls[i].replace(RE_TAG,"").trim(); break; } }
  res=ls.join("\n").trim(); }
// «---CANAL---»: lo de arriba, a Slack; lo de abajo, al canal git
let arriba=res, abajo="";
const sep=res.match(/^[ \t]*-{3,}[ \t]*CANAL[ \t]*-{3,}[ \t]*$/im);
if(sep){ arriba=res.slice(0,sep.index).trim(); abajo=res.slice(sep.index+sep[0].length).trim(); }
const teToca=tags.some((t)=>/^\[\s*te toca/i.test(t));
const nLineas=(t)=>t.split("\n").filter((l)=>l.trim()).length;
const tabla=(t)=>/^[ \t]*\|.*\|[ \t]*$/m.test(t)&&/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*\|/m.test(t);
const pareceCanal=(t)=>/^[ \t]*<!--\s*para:/im.test(t)||tabla(t)||/^[ \t]*```/m.test(t)||/^[ \t]*#{1,4}[ \t]/m.test(t)||(nLineas(t)>MAX_SLACK&&!teToca);
if(e.MODO!=="git"&&pareceCanal(arriba)){ abajo=[arriba,abajo].filter(Boolean).join("\n\n"); arriba=""; }
// la cabecera que haya escrito Cursor: de ahí, para quién es y el estado (si no puso la etiqueta)
const cab=((arriba+"\n"+abajo).match(/<!--\s*para:[\s\S]*?-->/i)||[""])[0];
if(!tags.length){ const m=cab.match(/\|\s*estado:\s*([^|]*?)\s*(?=\||-->)/i);
  if(m) tags=m[1].split(";").map((s)=>s.trim()).filter((s)=>/^(te toca|lo hace|hecho|espera)\b/i.test(s)).map((s)=>`[${s}]`); }
const nombres=(t)=>["Claude","Coo","Grok"].filter((n)=>new RegExp("\\b"+n+"\\b","i").test(t));
const limpiar=(t)=>{ let x=t.replace(/^[ \t]*<!--[\s\S]*?-->[ \t]*$/gm,"").trim();
  const ls=x.split("\n"); if(ls.length>1&&FENCE.test(ls[0])&&FENCE.test(ls[ls.length-1])) x=ls.slice(1,-1).join("\n").trim();
  return x.replace(/\n[ \t]*[—–-]{1,2}[ \t]*Cursor\b[^\n]*$/i,"").replace(/\n{3,}/g,"\n\n").trim(); };
const resumen=(t)=>t.split("\n").map((l)=>l.trim())
  .filter((l)=>l&&!/^(```|\||#|<!--|>|[—–-]{1,2}\s*Cursor\b|\**Anexos)/i.test(l)&&!/^[-*_]{3,}$/.test(l))
  .slice(0,2).map((l)=>{ if(l.length<=200) return l; const p=l.lastIndexOf(". ",200); return p>=60?l.slice(0,p+1):l.slice(0,200).replace(/\s+\S*$/,"")+"…"; }).join("\n");
const git=e.MODO==="git";
let canalTxt, slackTxt;
if(git){ canalTxt=limpiar([arriba,abajo].filter(Boolean).join("\n\n"))||"(sin más detalle)"; slackTxt=sep?limpiar(arriba):resumen(canalTxt); }
else { canalTxt=limpiar(abajo); slackTxt=arriba?limpiar(arriba):resumen(canalTxt); }
fs.writeFileSync(O("slack.txt"),slackTxt.replace(/\*\*([^*\n]+)\*\*/g,"*$1*"));   // en Slack la negrita es *así*
fs.writeFileSync(O("tag.txt"),tags.join(" "));
if(canalTxt){
  const estado=[...tags.map((t)=>t.replace(/^\[\s*|\s*\]$/g,"")),...(pregunta&&!teToca?[`te toca: ${pregunta}`]:[])].map(linea).join("; ");
  const url=(e.SLACK_WS_URL||"https://ocaglobal-grupo.slack.com")+"/archives/"+e.CH+"/p"+e.HILO.replace(".","");
  const hoy=new Date().toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit",timeZone:"Europe/Madrid"});
  const id="Cursor-slack-"+Date.now().toString(36);
  const para=git?e.QUIEN:([...new Set([...nombres(tags.filter((t)=>/^\[\s*lo hace/i.test(t)).join(" ")),...nombres((cab.match(/para:([^|]*)/i)||["",""])[1])])].join(", ")||"Coo");
  fs.writeFileSync(O("bloque.md"),[`<!-- para: ${para} | cc: JJ | responde-a: Slack (hilo «${linea(raiz)}») | id: ${id} | accion: ${git?"informa":"info"}${estado?` | estado: ${estado}`:""} -->`,
    git?`### Cursor · ${hoy} · HORA · [SLACK→CANAL] Respuesta a ${e.QUIEN} · «${raiz}»`:`### Cursor · ${hoy} · HORA · [SLACK→CANAL] Detalle técnico de su respuesta a Humano · «${raiz}»`,
    `Hilo de Slack: ${url}`,``,canalTxt,``,pregunta?`**Para Humano:** ${pregunta}`:"",``,`— Cursor (${e.VIA||"vía API"}) ·`,``].join("\n"));
  if(git){ let tapaV=(s)=>String(s).replace(/\S{20,}/g,"…");try{tapaV=require(path.join(e.AQUI_W,"tapar-secretos.js")).tapaSecretos}catch(x){}   // primero el valor del secreto, después la palabra
    const limpio=(s)=>tapaV(s,{largos:false}).replace(/(secret|password|token)/gi,"…");   // la nota despierta a quien preguntó; con «HUMANO:», avisa a Humano
    fs.writeFileSync(O("nota.txt"),[`para: ${e.QUIEN}`,...(pregunta?["@humano"]:[]),`Coinciden: respuesta de Cursor a lo que pidió ${e.QUIEN} en Slack («${limpio(raiz).slice(0,60)}»)`,
      `No coinciden: nada`,`Tu OK: ${pregunta?limpio(pregunta).slice(0,140):"no hace falta"}`,`Tercera lectura: no`].join("\n")+"\n"); }
}
EOF_JS
MODO=slack; [ "$POR_GIT" = 1 ] && MODO=git
if ! VIA="$VIA" HILO_F="$TMP/hilo.json" RES="$TMP/res.txt" MODO="$MODO" QUIEN="$PARA_GIT" HILO="$HILO" CH="$CH" OUT="$TMP" AQUI_W="$(cygpath -w "$AQUI" 2>/dev/null || echo "$AQUI")" node "$TMP/partir.js"; then
  echo "partir.js ha fallado: a Slack van solo las 3 primeras líneas"
  head -n 3 "$TMP/res.txt" > "$TMP/slack.txt"; : > "$TMP/tag.txt"; rm -f "$TMP/bloque.md" "$TMP/nota.txt"
fi
EST="$HOME/.publicar-canal-principal.leido"
NOTAF=""; [ -s "$TMP/nota.txt" ] && NOTAF="$TMP/nota.txt"   # solo con otra IA: despierta a quien preguntó
# códigos 7 (falló la nota), 10 (falló lanzar a Cursor) y 11 (falló la verificación) = el bloque YA está publicado
publica() { local prev rc; prev=$(cat "$EST" 2>/dev/null || true)
  NOTA="$NOTAF" REAPLICAR_SIN_LEER=1 bash "$AQUI/publicar-canal.sh" principal "$TMP/bloque.md" "$1"; rc=$?
  [ -n "$prev" ] && printf '%s\n' "$prev" > "$EST"
  case $rc in 0|7|10|11) return 0 ;; *) echo "publicar-canal.sh salió con $rc"; return 1 ;; esac; }
OKG=0; AVISO=""
if [ -s "$TMP/bloque.md" ]; then
  MSGC="[skip ci] Canal: Cursor ($VIA) responde a $QUIEN desde Slack"
  [ "$POR_GIT" = 1 ] || MSGC="[skip ci] Canal: Cursor ($VIA), detalle técnico de su respuesta a Humano en Slack"
  publica "$MSGC" && OKG=1 || { sleep "${CURSOR_REINTENTO_S:-15}"; publica "$MSGC" && OKG=1; }
  if [ "$OKG" = 0 ]; then
    GUARDA="$HOME/.canal-logs/cursor-sin-publicar-$(date +%Y%m%d-%H%M%S).md"; cp "$TMP/bloque.md" "$GUARDA"
    echo "no he podido publicar en el canal git: el bloque queda en $GUARDA"
  fi
fi
if [ "$POR_GIT" = 1 ]; then
  if [ "$OKG" = 1 ]; then
    bash "$AQUI/responder-slack.sh" --reaccion "$CH" "$TS" white_check_mark >/dev/null 2>&1 || true
    echo "respuesta publicada en el canal git (para $PARA_GIT)"; exit 0
  fi
  AVISO="📎 Mi respuesta era para $PARA_GIT por el canal git, que no ha respondido: queda guardada en este equipo."
elif [ -s "$TMP/bloque.md" ]; then
  if [ "$OKG" = 1 ]; then AVISO="📎 El detalle técnico, para las IAs, está en el canal git."
  else AVISO="📎 El detalle técnico no ha podido ir al canal git: queda guardado en este equipo."; fi
fi
# a Slack: firma, las líneas para Humano, el aviso del canal y, la última, la etiqueta de estado (sin salto final)
PARTES=("*Cursor ($VIA):*")
[ -s "$TMP/slack.txt" ] && PARTES+=("$(head -c 3300 "$TMP/slack.txt")")
[ -n "$AVISO" ] && PARTES+=("$AVISO")
[ -s "$TMP/tag.txt" ] && PARTES+=("$(cat "$TMP/tag.txt")")
( IFS=$'\n'; printf '%s' "${PARTES[*]}" ) > "$TMP/r2.txt"
bash "$AQUI/responder-slack.sh" "$CH" "$HILO" "$TMP/r2.txt" || true
echo "respuesta publicada en Slack$([ "$OKG" = 1 ] && echo ' (y el detalle en el canal git)')"
