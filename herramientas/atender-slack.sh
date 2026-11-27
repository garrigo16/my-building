#!/usr/bin/env bash
set -uo pipefail
_cfg="$(dirname "${BASH_SOURCE[0]}")/config.sh"; [ -f "$_cfg" ] && . "$_cfg"   # identidad: config.local.json (ver config.js)
J=${1:?json}
export AUTOR=Claude   # lo que contesta este Claude sale firmado «*Claude:*» (responder-slack.sh); los avisos del sistema usan AUTOR=Sistema
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO=${CANAL_REPO:-"$HOME/Documents/Oca Global Repository/oca-salesforce"}
mkdir -p "$HOME/.canal-logs"
leer() { J="$J" K="$1" node -e 'const j=JSON.parse(require("fs").readFileSync(process.env.J,"utf8"));process.stdout.write(String(j[process.env.K]||""))'; }
CH=$(leer channel); TS=$(leer ts); HILO=$(leer thread_ts); QUIEN=$(leer quien); QUIEN=${QUIEN:-Humano}
SOLO_PR=$(leer solo_pr)
SOLO_PRIV=$(leer solo_priv)   # v135: ídem para contestar por privado: solo responder-privado.sh
DESDE_OFICINA=$(leer oficina); ESCRITURA_OFI=$(leer escritura)   # v142: marca explícita de la oficina (ver más abajo)
OK_REENV=$(leer ok_reenviado)   # v155: la escucha reenvía a Claude tu OK a una pregunta de Coo cuyo trabajo hace Claude
MIRADA=0; [ "$(leer mirada)" = "true" ] && [ "$(leer oficina)" = "true" ] && [ "$QUIEN" != "Humano" ] && MIRADA=1
NORMAL_TXT=""; [ "$MIRADA" = 1 ] && NORMAL_TXT=$(leer normal)
CON_COO=0; leer text | grep -qiE "<@${SLACK_COO_ID:-UCOO0000001}>|(^|[^[:alnum:]_])@coo([^[:alnum:]_]|\$)" && CON_COO=1
TXTF=$(mktemp)
J="$J" node -e 'const j=JSON.parse(require("fs").readFileSync(process.env.J,"utf8"));
  process.stdout.write(String(j.text||"").replace(/<@[A-Z0-9]+>/g,"").trim())' > "$TXTF"
rm -f "$J"
PRIMERA=$(grep -m1 -v '^[[:space:]]*$' "$TXTF" || true)
ES_OK=0; printf '%s\n' "$PRIMERA" | grep -qiE '^[[:space:]]*(@[[:alnum:]_.-]+[[:space:],:]*)*(ok|okey|okay)([[:space:][:punct:]]|$)' && ES_OK=1
OK_INICIO=0; printf '%s\n' "$PRIMERA" | grep -qiE '^[[:space:]]*(@[[:alnum:]_.-]+[[:space:],:]*)*((s(i|í)|vale)[[:space:],]+)?(ok|okey|okay|adelante)([[:space:][:punct:]]|$)' && OK_INICIO=1
SINMENC=$(printf '%s' "$PRIMERA" | sed -E 's/(^|[[:space:]])@[[:alnum:]_.-]+[,:]?//g; s/^[[:space:]]+//')
OK_CORTO=0
if [ "$(grep -cv '^[[:space:]]*$' "$TXTF")" -le 1 ] && [ ${#SINMENC} -le 80 ] && ! printf '%s' "$SINMENC" | grep -q '?' \
   && printf '%s\n' "$SINMENC" | grep -qiE '(^|[^[:alpha:]])(ok|okey|okay|vale|adelante|dale|hazlo|s(i|í)|env(i|í)alo|m(a|á)ndalo|s(u|ú)belo|(a|á)brel(a|o))([^[:alpha:]]|$)' \
   && ! printf '%s\n' "$SINMENC" | grep -qiE '(^|[^[:alpha:]])(no|espera|cancela|todav(i|í)a|a(u|ú)n)([^[:alpha:]]|$)'; then OK_CORTO=1; fi
[ "$OK_CORTO" = 1 ] && { ES_OK=1; OK_INICIO=1; }
# v153: el OK de Humano vale para lo que Claude propuso, sea escribir en un org, abrir la PR o contestar por privado
[ "$QUIEN" = "Humano" ] && [ "$ES_OK" = 1 ] && OK_TODO=1 || OK_TODO=0
# (desde la oficina manda su marca: el servidor ya ha decidido si el mensaje es un OK)
if [ "$DESDE_OFICINA" = "true" ]; then { [ "$ESCRITURA_OFI" = "true" ] && [ "$QUIEN" = "Humano" ]; } && OK_TODO=1 || OK_TODO=0; fi
PIDE_OPUS=0; grep -qiE '(^|[^[:alpha:]])opus([^[:alpha:]]|$)' "$TXTF" && PIDE_OPUS=1
NAVEGADOR=0; [ "$QUIEN" = "Humano" ] && grep -qiE '🌐|con (el )?navegador|usa (el )?navegador|abre (el )?navegador' "$TXTF" && NAVEGADOR=1
PIDE_MULE=0; grep -qiE 'mule|anypoint|cloudhub' "$TXTF" && PIDE_MULE=1
OK_PR=0
if [ "$QUIEN" = "Humano" ] && [ "$OK_INICIO" = 1 ] \
   && grep -qiE '(^|[^[:alpha:]])PRs?([^[:alpha:]]|$)|pull ?request' "$TXTF"; then OK_PR=1; fi
[ "$OK_TODO" = 1 ] && OK_PR=1   # v153
if [ "$DESDE_OFICINA" = "true" ]; then ES_OK=0; [ "$ESCRITURA_OFI" = "true" ] && ES_OK=1; fi
if [ "$SOLO_PR" = "true" ]; then ES_OK=0; [ "$QUIEN" = "Humano" ] && OK_PR=1; fi   # v129: desde la oficina, el ok solo abre PRs
[ "$SOLO_PRIV" = "true" ] && ES_OK=0   # v135: desde la oficina, el ok solo contesta por privado
OK_PRIV=0
if [ "$QUIEN" = "Humano" ] && [ "$OK_INICIO" = 1 ] \
   && grep -qiE 'cont(e|é)sta(le)?|resp(o|ó)nde(le)?|d(i|í)le (a|que)|por privado|por dm|escr(i|í)bele' "$TXTF"; then OK_PRIV=1; fi
[ "$OK_TODO" = 1 ] && [ "$SOLO_PR" != "true" ] && OK_PRIV=1   # v153
if [ "$OK_REENV" = "true" ] && [ "$QUIEN" = "Humano" ]; then ES_OK=1; OK_TODO=1; OK_PR=1; OK_PRIV=1; fi
INSTR_PRIV="Privados de Slack: si en este hilo se trajo la respuesta de alguien por privado («💬 X contestó por privado»), puedes contestarle en ese mismo privado con bash $AQUI/responder-privado.sh $HILO <fichero_texto> (prueba antes con --prueba). Sale con la cuenta de Humano y deja copia en el hilo. SOLO con el OK de Humano en su mensaje para ESA respuesta; si no lo hay, propón el texto y pídeselo. Tono de Humano: cercano, corto, sin firmas."
INSTR_PR="PRs en Bitbucket: bash $AQUI/abrir-pr.sh <rama-origen> <rama-destino> \"<LÍNEA | TICKET | Descripción>\" <descripcion.md> (prueba antes con --prueba). Título SIEMPRE con el formato de OCA: «LÍNEA | TICKET | Descripción», p. ej. «INDUSTRIA | BDXN-401 | …», «TRANSVERSAL | PRJB-1296 | …», «CERTIFICACION | CERTA-226 | …» (líneas: TRANSVERSAL, INDUSTRIA, CERTIFICACION, INTERNACIONAL, FORMACION, DTT; la línea es la del negocio del cambio, no siempre la del prefijo del ticket); descripción corta en español, sin repetir el ticket al final. SOLO abre la PR: nunca la apruebes, mergees ni declines. Úsala solo en un turno con el OK de Humano para ESA PR; si no lo hay, prepara título y descripción y pídeselo en una línea. Si falta el token, dile a Humano exactamente qué falta."

bash "$AQUI/responder-slack.sh" --reaccion "$CH" "$TS" eyes >/dev/null 2>&1 || true

if [ "$QUIEN" != "Humano" ] && ! bash "$AQUI/freno.sh" slack "$HILO" 2>/dev/null; then
  echo "$(date -Is) FRENO: no abro Claude para $QUIEN en el hilo $HILO" >> "$HOME/.canal-logs/freno.log"
  bash "$AQUI/responder-slack.sh" --reaccion "$CH" "$TS" no_entry_sign >/dev/null 2>&1 || true
  MARCA="$HOME/.canal-logs/freno-avisado-$HILO"
  if [ ! -f "$MARCA" ] || [ $(( $(date +%s) - $(stat -c %Y "$MARCA") )) -ge 3600 ]; then
    touch "$MARCA"; AV=$(mktemp)
    printf '🚫 Freno anti ping-pong: no abro a Claude en este hilo ahora (límite de la última hora). Si hace falta ya, que lo pida Humano a mano: a él no se le frena.' > "$AV"
    AUTOR=Sistema bash "$AQUI/responder-slack.sh" "$CH" "$HILO" "$AV" >/dev/null 2>&1 || true; rm -f "$AV"
  fi
  rm -f "$TXTF"; exit 12
fi

CERROJO_H="$HOME/.canal-logs/hilo-ocupado-$HILO"
quita_cerrojo() { rm -f "$CERROJO_H/pid" 2>/dev/null; rmdir "$CERROJO_H" 2>/dev/null; }
for i in $(seq 1 180); do
  if mkdir "$CERROJO_H" 2>/dev/null; then echo $$ > "$CERROJO_H/pid"; break; fi
  OTRO=$(cat "$CERROJO_H/pid" 2>/dev/null || true)
  if [ -n "$(find "$CERROJO_H" -maxdepth 0 -mmin +90 2>/dev/null)" ] \
     || { [ -n "$OTRO" ] && ! kill -0 "$OTRO" 2>/dev/null; } \
     || { [ -z "$OTRO" ] && [ -n "$(find "$CERROJO_H" -maxdepth 0 -mmin +1 2>/dev/null)" ]; }; then quita_cerrojo; continue; fi
  [ "$i" = 1 ] && echo "$(date -Is) hilo $HILO espera turno: ya hay un Claude en el hilo (pid ${OTRO:-?})" >> "$HOME/.canal-logs/sesiones-slack.log"
  [ "$i" = 180 ] && echo "$(date -Is) hilo $HILO sigue ocupado tras 30 min: lanzo igualmente" >> "$HOME/.canal-logs/sesiones-slack.log"
  sleep 10
done
trap 'quita_cerrojo' EXIT

EQ_AQUI=$(tr -d '\r\n ' < "$HOME/.config/oficina-equipo.txt" 2>/dev/null | tr 'A-Z' 'a-z' || true)
TOPE_VEZ=$({ tr -d '\r' < "$HOME/.config/canal-slack.env"; } 2>/dev/null | sed -n 's/^CLAUDES_A_LA_VEZ=//p' | tail -1 | tr -dc '0-9')
TOPE_VEZ=${CLAUDES_A_LA_VEZ:-${TOPE_VEZ:-$([ "$EQ_AQUI" = portatil ] && echo 2 || echo 4)}}
[ "$QUIEN" = "Humano" ] && TOPE_VEZ=$((TOPE_VEZ + 1))
HUECOS="$HOME/.canal-logs/claude-huecos"; mkdir -p "$HUECOS"; HUECO=""
quita_hueco() { [ -n "$HUECO" ] && { rm -f "$HUECO/pid" 2>/dev/null; rmdir "$HUECO" 2>/dev/null; }; HUECO=""; }
for i in $(seq 1 360); do
  for n in $(seq 1 "$TOPE_VEZ"); do
    D="$HUECOS/$n"
    if mkdir "$D" 2>/dev/null; then echo $$ > "$D/pid"; HUECO=$D; break 2; fi
    P=$(cat "$D/pid" 2>/dev/null || true)
    if [ -n "$(find "$D" -maxdepth 0 -mmin +120 2>/dev/null)" ] || { [ -n "$P" ] && ! kill -0 "$P" 2>/dev/null; } \
       || { [ -z "$P" ] && [ -n "$(find "$D" -maxdepth 0 -mmin +1 2>/dev/null)" ]; }; then rm -f "$D/pid"; rmdir "$D" 2>/dev/null; fi
  done
  [ "$i" = 1 ] && echo "$(date -Is) hilo $HILO espera hueco: ya hay $TOPE_VEZ Claude trabajando en este equipo" >> "$HOME/.canal-logs/sesiones-slack.log"
  [ "$i" = 360 ] && { echo "$(date -Is) hilo $HILO sin hueco tras 60 min: lanzo igualmente" >> "$HOME/.canal-logs/sesiones-slack.log"; break; }
  sleep 10
done
trap 'quita_hueco; quita_cerrojo' EXIT

CLI=${CLAUDE_CLI:-$(ls -d $HOME/AppData/Roaming/Claude/claude-code/*/*/claude.exe 2>/dev/null | sort -V | tail -1)}
CFG="$HOME/.config/canal-slack.env"
CLAUDE_CODE_OAUTH_TOKEN=$(tr -d '\r' < "$CFG" | sed -n 's/^CLAUDE_CODE_OAUTH_TOKEN=//p' | tail -1 | tr -d "\"' ")
[ -n "$CLAUDE_CODE_OAUTH_TOKEN" ] && export CLAUDE_CODE_OAUTH_TOKEN
# Relevo de cuenta (relevo-claude.js): empresa (Team) por defecto; ventana de 5 h o cupo semanal agotados -> UN relevo a la personal
# (Pro: CLAUDE_CONFIG_DIR=~/.claude-personal, sin el token de empresa); si paran las dos, aviso y no se lanza a nadie.
REL="$AQUI/relevo-claude.js"; CTA=empresa; HAY_REL=0
[ -f "$REL" ] && command -v node >/dev/null 2>&1 && HAY_REL=1
avisa_relevo() { [ -n "$1" ] && bash "$AQUI/avisar-humano.sh" "$1" >/dev/null 2>&1; return 0; }
pasa_a_personal() { export CLAUDE_CONFIG_DIR="${USERPROFILE:-$HOME}/.claude-personal"; unset CLAUDE_CODE_OAUTH_TOKEN; CTA=personal; }
if [ "$HAY_REL" = 1 ]; then
  D_REL=$(node "$REL" decidir --lineas 2>/dev/null) || D_REL=""
  C_REL=$(printf '%s\n' "$D_REL" | sed -n 1p | tr -d '\r'); avisa_relevo "$(printf '%s\n' "$D_REL" | sed -n 2p | tr -d '\r')"
  [ "$C_REL" = personal ] && pasa_a_personal
  if [ "$C_REL" = parar ]; then echo "$(date -Is) hilo $HILO: las dos cuentas de Claude agotadas, no lanzo" >> "$HOME/.canal-logs/sesiones-slack.log"; exit 0; fi
fi
# v276: Git Bash donde esté (%LOCALAPPDATA%\Programs\Git o %ProgramFiles%\Git, como acepta el instalador; si no, este mismo bash)
gitbash() { local p; for p in "$HOME/AppData/Local/Programs/Git/bin/bash.exe" "$(cygpath -u "${PROGRAMFILES:-C:\\Program Files}")/Git/bin/bash.exe"; do
  [ -f "$p" ] && { cygpath -w "$p"; return; }; done; cygpath -w "$(command -v bash)"; }
export CLAUDE_CODE_GIT_BASH_PATH=${CLAUDE_CODE_GIT_BASH_PATH:-$(gitbash)}

LOGF="$HOME/.canal-logs/slack-$(date +%Y%m%d-%H%M%S).log"
RESPF="$HOME/.canal-logs/slack-respuesta-$TS.txt"
SESDIR="$HOME/.canal-logs/sesiones-slack"; mkdir -p "$SESDIR"
SESF="$SESDIR/$CH-$HILO"
REANUDA=0
TOPE_CTX=${TOPE_CTX:-100000}; ROTA=0
ctx_de() { local t; t=$(ls "$HOME"/.claude/projects/*/"$1".jsonl 2>/dev/null | head -1); [ -n "$t" ] || { echo 0; return; }
  tail -c 400000 "$t" | grep '"usage"' | tail -1 | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let n=0;try{const u=JSON.parse(s).message.usage;n=(u.input_tokens||0)+(u.cache_read_input_tokens||0)+(u.cache_creation_input_tokens||0)}catch(e){}process.stdout.write(String(n))})'; }
if [ -s "$SESF" ]; then
  VIEJA=$(tr -d '\r\n ' < "$SESF"); CTX=$(ctx_de "$VIEJA")
  if [ "${CTX:-0}" -gt "$TOPE_CTX" ]; then
    echo "$(date -Is) hilo $HILO sesion_nueva ctx=$CTX vieja=$VIEJA" >> "$HOME/.canal-logs/sesiones-slack.log"
    rm -f "$SESF"; ROTA=1
  fi
fi
if [ -s "$SESF" ]; then SES=(--resume "$(cat "$SESF")"); REANUDA=1; else
  SID=$(node -e 'process.stdout.write(require("crypto").randomUUID())'); echo "$SID" > "$SESF"; SES=(--session-id "$SID"); fi
PROMPTF=$(mktemp)
RELACIONADOS=$(HILO="$HILO" F="$HOME/.canal-logs/temas-relacionados.json" node -e '
try { const j = JSON.parse(require("fs").readFileSync(process.env.F, "utf8")); const l = ((j && j.hilos) || {})[process.env.HILO] || [];
  if (l.length) process.stdout.write("CONTEXTO DEL TEMA: el mismo asunto tiene también estos hilos en #canal-humano (pueden traer el correo, el chat o el Jira que te falta). LÉELOS (conversations.replies) ANTES de contestar, pedir un OK o pararte; no te pares por falta de algo que esté ahí:\n"
    + l.slice(0, 6).map((x) => "- «" + x.titulo + "»" + (x.origen ? " (" + x.origen + ")" : "") + (x.por === "persona" ? " [misma persona]" : "") + ": ts " + x.ts + ", último mensaje " + x.hora).join("\n"));
} catch (e) {}' 2>/dev/null)
REGLA_CANAL="REGLA: lo TÉCNICO entre IAs (análisis, cifras, veredictos, encargos a Coo o a Cursor) va por el CANAL GIT, no por Slack: LEIDO=<sha> NOTA=<nota> bash $AQUI/publicar-canal.sh principal|<segundo-canal> <bloque.md> \"[skip ci] Canal: ...\" (formato de la nota en la cabecera de $AQUI/nota-slack.sh; para: Cursor/Claude/Coo y @cursor si toca a Cursor; en la cabecera del bloque, al final, «| estado: lo hace: <IA> — <qué>», «| estado: te toca: <pregunta a Humano>» o «| estado: hecho», y en el título la etiqueta del tema entre corchetes). La publicación despierta sola a quien va dirigida y deja una línea en el hilo de timbre de Slack. NO menciones a Coo ni a Cursor en Slack para hablar de trabajo. En Slack, a HUMANO solo le llega: (a) una decisión que solo puede tomar él, y ANTES cruzada con Coo y Cursor en el canal (si no la habéis hablado los tres, no es decisión suya todavía); (b) un OK de escritura; (c) el resultado final de lo que pidió, en 3 líneas como máximo. Nada de estados intermedios, acuses ni preguntas que podáis resolver entre vosotros. Si Humano te pregunta algo directamente, contéstale en el hilo, corto."
SIN_SLACK=(); REGLA_IA=""   # v250: lo propio de un mensaje de una IA, aparte de la regla fija del canal
if [ "$QUIEN" != "Humano" ]; then
  SIN_SLACK=( "Bash(*responder-slack.sh*)" "Bash(*chat.postMessage*)" "PowerShell(*slack.com*)" )
  REGLA_IA=" ESTE MENSAJE ES DE $QUIEN, UNA IA: no puedes escribir en Slack (está bloqueado). Haz el trabajo y publica el resultado en el canal git con NOTA= (para: Coo, y @cursor si Cursor tiene que revisar). Si de verdad hace falta una decisión de Humano, pon @humano en la nota y el timbre se la hará llegar. Al terminar, escribe exactamente NADA en el fichero de respuesta."
fi
# v491: en la mirada no se trabaja ni se publica (la regla de arriba es para la segunda fase, si la hay)
REGLA_IA_SIGUE=$REGLA_IA; [ "$MIRADA" = 1 ] && REGLA_IA=""
FORMATO_J=$(tr -d '\r' < "$AQUI/formato-para-humano.txt" 2>/dev/null)
REGLA_OK="OK DE HUMANO (manda sobre todo lo anterior): para pedirle un OK pregunta solo «¿Doy el OK a X?». Cualquier «ok / vale / adelante / dale / sí» suyo vale: NUNCA le pidas una frase concreta («contesta “ok perfil”»). Cuando un mensaje suyo es su OK, haz YA todo lo que propusiste (escribir en el org, abrir la PR, contestar por privado…) y contesta con el resultado; no vuelvas a preguntar lo mismo. Si aun así te falta un permiso, dilo en una línea, sin repetir la propuesta."
# ids de los bloques del canal git que originaron este despertar (BLOQUES=id1,id2 en el entorno, los pone el vigía)
BLOQUES_TXT=""
[ -n "${BLOQUES:-}" ] && BLOQUES_TXT="Bloques del canal git que originaron este despertar: ${BLOQUES}. Léelos SIEMPRE (busca su id o su título en el fichero del canal), aunque sean antiguos y no salgan en el último tramo del git log."
REGLA_UNA=""
if [ "$QUIEN" = "Humano" ] && [ "$CON_COO" = 1 ] && [ "$ES_OK" = 0 ]; then
  REGLA_UNA="UNA SOLA RESPUESTA: Humano ha escrito a varias IAs a la vez y Coo va entre ellas. NO le contestes en Slack: haz tu parte y déjasela a Coo en el canal git (bloque con NOTA y «para: Coo»); escribe exactamente NADA en el fichero de respuesta. Coo le da a Humano UNA respuesta que junta la de todos."
fi
REGLA_AHORRO="AHORRO: la lectura PESADA (recorrer muchos ficheros o metadatos, logs largos, diffs grandes, comparar orgs) no la hagas tú: encárgasela a Cursor por el canal git (para: Cursor, con @cursor) pidiéndole un resumen corto con rutas y líneas, y trabaja sobre ese resumen. Lo puntual, con un subagente Haiku. Lee por trozos (Grep, offset/limit), nunca ficheros enteros grandes."
INSTR_NAV="NAVEGADOR: en este turno tienes un navegador (herramientas mcp__navegador__*): Edge con el perfil de las IAs, donde Humano ha iniciado sesión en las webs que usáis. Úsalo SOLO para LEER (mirar, buscar, copiar datos). Prohibido pulsar nada que guarde, despliegue, borre, envíe o cambie configuración, salvo que el mensaje de Humano empiece por «ok» y sea exactamente lo que propusiste. Si una web te pide usuario, contraseña o un código, para y dile a Humano que entre él con «Navegador de las IAs.cmd». No escribas contraseñas nunca. Ver páginas gasta muchos tokens: ve directo a lo que necesitas y cierra el navegador al acabar (browser_close). Para MuleSoft, antes que el navegador, usa mule.sh."
MCP_ARGS=(); PERM_NAV=""
if [ "$NAVEGADOR" = 1 ]; then
  PERFIL_NAV=$(cygpath -w "$HOME/.oficina/navegador-ias"); SALIDA_NAV=$(cygpath -w "$HOME/.canal-logs/navegador")
  mkdir -p "$HOME/.oficina/navegador-ias" "$HOME/.canal-logs/navegador"
  MCPF="$HOME/.canal-logs/navegador-mcp.json"
  PERFIL_NAV="$PERFIL_NAV" SALIDA_NAV="$SALIDA_NAV" node -e 'const e=process.env;process.stdout.write(JSON.stringify({mcpServers:{navegador:{command:"cmd",args:["/c","npx","-y","@playwright/mcp@0.0.84","--browser","msedge","--user-data-dir",e.PERFIL_NAV,"--headless","--image-responses","omit","--output-dir",e.SALIDA_NAV]}}}))' > "$MCPF"
  MCP_ARGS=(--mcp-config "$MCPF"); PERM_NAV=" mcp__navegador"
  echo "$(date -Is) hilo $HILO navegador=1" >> "$HOME/.canal-logs/sesiones-slack.log"
fi
FIJAS_H=$(printf '%s\n' "$REGLA_CANAL" "$REGLA_AHORRO" "$FORMATO_J" "$INSTR_PR" "$INSTR_PRIV" "$REGLA_OK" | md5sum | cut -c1-16)
REGLASF="$SESF.reglas"; ENVIA_FIJAS=1
if [ "$REANUDA" = 1 ]; then
[ "$(cat "$REGLASF" 2>/dev/null)" = "$(tr -d '\r\n ' < "$SESF") $FIJAS_H" ] && ENVIA_FIJAS=0
{
printf 'Nuevo mensaje de %s en este mismo hilo (canal %s, hilo %s). Ya tienes el contexto y las reglas de antes: no releas CLAUDE.md ni la memoria. Si te hace falta, relee solo los mensajes nuevos del hilo.\n-----\n' "$QUIEN" "$CH" "$HILO"
cat "$TXTF"
if [ "$ENVIA_FIJAS" = 0 ]; then
  printf '\n-----\nReglas: las mismas que ya tienes en esta sesión (canal git con «estado:» en la cabecera, formato para Humano, OK y escrituras, PR y privados); no han cambiado: síguelas igual.\n'
else
  # (enteras, también el formato y el OK aunque escriba una IA: así la huella vale para cualquier mensaje siguiente)
  printf '\n-----\nReglas (han cambiado desde la última vez; mandan estas):\n%s\n%s\n%s\n%s\n%s\n%s\n' "$REGLA_CANAL" "$REGLA_AHORRO" "$FORMATO_J" "$INSTR_PR" "$INSTR_PRIV" "$REGLA_OK"
fi
[ -n "$REGLA_IA" ] && printf '%s\n' "${REGLA_IA# }"
[ -n "$REGLA_UNA" ] && printf '%s\n' "$REGLA_UNA"
[ -n "$RELACIONADOS" ] && printf '%s\n' "$RELACIONADOS"   # v512
[ -n "$BLOQUES_TXT" ] && printf '%s\n' "$BLOQUES_TXT"
[ "$PIDE_MULE" = 1 ] && printf 'MuleSoft en solo lectura: bash %s/mule.sh entornos | apps <entorno> | app <entorno> <app> | logs <entorno> <app> [n] [texto]. Para cambiar algo en MuleSoft, prepara los pasos y que lo haga Humano.\n' "$AQUI"
[ "$OK_PR" = 1 ] && printf 'En este mensaje Humano da su OK para ABRIR la PR que pide (solo abrirla).\n'
[ "$OK_PRIV" = 1 ] && printf 'En este mensaje Humano da su OK para CONTESTAR por privado lo que pide (solo eso).\n'
[ "$NAVEGADOR" = 1 ] && printf '%s\n' "$INSTR_NAV"
printf 'Contesta igual que antes, en el fichero %s y con: bash %s/responder-slack.sh %s %s %s (o NADA si no es para ti).\n' "$RESPF" "$AQUI" "$CH" "$HILO" "$RESPF"
[ "$ES_OK" = 1 ] && [ "$QUIEN" = "Humano" ] && printf 'Este mensaje es el «ok» de Humano: en este turno las escrituras en org están habilitadas. Ejecuta EXACTAMENTE lo que propusiste y él ha aprobado, nada más.\n'
} > "$PROMPTF"
else
{
cat <<EOF
Eres Claude. Te ha escrito $QUIEN en Slack (canal #${SLACK_CANAL_NOMBRE:-canal-humano}). «Humano» es como el sistema llama a la persona para la que trabajas; se llama ${EDIFICIO_NOMBRE:-Humano}: al hablarle usa su nombre; en las etiquetas y marcadores ([te toca: …], «Pregunta a Humano») escribe siempre «Humano». Te despiertas cuando Humano te menciona o escribe «claude», o cuando Coo o Cursor te mencionan. Hay UNA sesión tuya por hilo: si ya habías trabajado en este hilo, esta es la continuación (recuerdas lo anterior). Nadie mira esta sesión: tu respuesta llega solo por Slack. Humano quiere trabajar solo desde Slack, sin abrir el escritorio: haz tú todo lo que puedas.

Lo que te escribe $QUIEN (textual):
-----
EOF
cat "$TXTF"
cat <<EOF

-----

Cómo trabajar:
1. CLAUDE.md y el índice de la memoria (MEMORY.md) ya te llegan cargados al arrancar: NO los releas con herramientas. Abre solo las memorias concretas que necesites para esta tarea. Aplica su estilo: acción primero, corto y en listas numeradas. Gasta poco: esto sale de la cuota de Humano.
2. Lee el hilo entero antes de actuar (conversations.replies, canal $CH, ts $HILO, con SLACK_BOT_TOKEN de ~/.config/canal-slack.env; nunca muestres el token). Busca también encargos de Coo o Cursor que no hayas atendido.
$( [ -n "$RELACIONADOS" ] && printf '2b. %s' "$RELACIONADOS" )
$( [ -n "$BLOQUES_TXT" ] && printf '2c. %s' "$BLOQUES_TXT" )
3. Si el mensaje no es para ti (charla, va para otra IA, o ya lo está resolviendo otra), escribe exactamente NADA en el fichero de respuesta y no envíes nada.
4. Tienes Bash (Git Bash) y PowerShell. Los orgs se tocan con sf SOLO desde PowerShell (en Git Bash no funciona); alias: QA, UAT, PRODOCA (PROD). Las lecturas (sf data query, retrieve a una carpeta temporal, sf org list metadata) son libres. Las escrituras en un org (deploy, DML, apex anónimo, asignar permisos) están BLOQUEADAS en este turno: prepara el comando exacto, explica en una línea qué cambia y pide a Humano que conteste en el hilo empezando por «ok». Con ese ok, el siguiente turno se abre con las escrituras habilitadas y ejecutas exactamente lo propuesto, nada más. Nunca cambios en PROD en viernes.
5. $REGLA_CANAL$REGLA_IA
6. Prohibido sin un OK literal de HUMANO (no vale el de Coo ni el de Cursor): escribir en orgs, desplegar, crear, aprobar o mergear PRs, push a ramas que no sean del canal, y secretos.
4d. $INSTR_PR$( [ "$OK_PR" = 1 ] && printf ' En este mensaje Humano da su OK para ABRIR la PR que pide (solo abrirla).' )
4e. $INSTR_PRIV$( [ "$OK_PRIV" = 1 ] && printf ' En este mensaje Humano da su OK para CONTESTAR por privado lo que pide (solo eso).' )
4b. MuleSoft (Anypoint, CloudHub) en SOLO LECTURA: bash $AQUI/mule.sh entornos | apps <entorno> | app <entorno> <app> | logs <entorno> <app> [n] [texto]. Los secretos de las propiedades salen tapados: no intentes destaparlos. Para cambiar algo en MuleSoft, prepara los pasos y que lo haga Humano.
$( [ "$NAVEGADOR" = 1 ] && printf '4c. %s' "$INSTR_NAV" )
7. Si la tarea es grande, reparte con subagentes (herramienta Agent): Haiku para lo mecánico (buscar, contar, leer) y Sonnet para revisar. Nunca Opus en un subagente.
7b. $REGLA_AHORRO
$( [ "$ROTA" = 1 ] && printf '7c. Este hilo ya tenía una sesión tuya, cerrada por tamaño para ahorrar cuota: NO recuerdas lo anterior. Ponte al día leyendo el hilo (punto 2) y, si hace falta, el canal git; no repitas trabajo ya hecho.' )
7d. $FORMATO_J
$( [ -n "$REGLA_UNA" ] && printf '7f. %s' "$REGLA_UNA" )
7e. $REGLA_OK$( [ "$ES_OK" = 1 ] && [ "$QUIEN" = "Humano" ] && printf ' ESTE MENSAJE ES SU OK: las escrituras en org, abrir la PR y contestar por privado están habilitadas en este turno. Haz ya lo que propusiste y él ha aprobado, nada más.' )
8. CONTESTA SIEMPRE en Slack (salvo el punto 3, o si lo técnico ya lo has dejado en el canal y no hay nada para Humano: entonces NADA), con el formato del punto 7d: escribe tu respuesta en el fichero $RESPF y envíala con
   bash $AQUI/responder-slack.sh $CH $HILO $RESPF
   (Tu mensaje sale firmado automáticamente como «Claude»: no escribas tú ninguna firma ni cabecera de autor.)
   Si la tarea es larga, manda primero UNA línea con lo que vas a hacer y al final el resultado (también escueto).
9. ANTES DE TERMINAR, vuelve a leer el hilo: mientras trabajabas no se abre otro Claude para este hilo, así que si Humano, Coo o Cursor te han escrito algo nuevo, atiéndelo tú en tu respuesta.
EOF
} > "$PROMPTF"
fi
rm -f "$TXTF"
[ "$MIRADA" = 1 ] && printf '\nMIRADA DEL VIGILANTE (manda sobre todo lo anterior de este mensaje): en este turno SOLO miras, en lectura. No publiques nada (Slack y canal git están bloqueados) ni sigas con la tarea. En el fichero %s escribe exactamente NADA si el proceso sigue igual, o UNA línea «TERMINADO: <lo que ves>» o «FALLADO: <lo que ves>» si ha acabado.\n' "$RESPF" >> "$PROMPTF"

cd "$REPO"
export CANAL_SOY_CLAUDE_HEADLESS=1
ESCRITURA=0
if [ "$QUIEN" = "Humano" ] && [ "$ES_OK" = 1 ]; then ESCRITURA=1; fi
NO_ESCRIBIR=( "PowerShell(sf project deploy*)" "PowerShell(sf deploy*)" "PowerShell(sf data create*)" "PowerShell(sf data update*)"
  "PowerShell(sf data delete*)" "PowerShell(sf data upsert*)" "PowerShell(sf data import*)" "PowerShell(sf data bulk*)"
  "PowerShell(sf apex run*)" "PowerShell(sf org assign*)" "PowerShell(sf package install*)" "PowerShell(sf force*)"
  "PowerShell(*sfdx*)" "PowerShell(*Invoke-RestMethod*)" "PowerShell(*Invoke-WebRequest*)"
  "PowerShell(*sf project deploy*)" "PowerShell(*sf deploy*)" "PowerShell(*sf data create*)" "PowerShell(*sf data update*)"
  "PowerShell(*sf data delete*)" "PowerShell(*sf data upsert*)" "PowerShell(*sf data import*)" "PowerShell(*sf data bulk*)"
  "PowerShell(*sf apex run*)" "PowerShell(*sf org assign*)" "PowerShell(*sf package install*)" "PowerShell(*sf force*)"
  "Bash(*powershell*)" "Bash(*pwsh*)" "Bash(*cmd.exe*)" "Bash(cmd *)" "Bash(*sf.cmd*)" "Bash(*sf.exe*)" "Bash(*sfdx*)"
  "Bash(*salesforce.com*)" "Bash(*force.com*)" )
[ "$ESCRITURA" = 1 ] && NO_ESCRIBIR=()
# abrir-pr.sh solo con el OK de Humano para una PR (OK_PR, arriba)
[ "$OK_PR" = 1 ] || NO_ESCRIBIR+=( "Bash(*abrir-pr.sh*)" "PowerShell(*abrir-pr.sh*)" )
# responder-privado.sh solo con el OK de Humano para contestar (OK_PRIV); --prueba siempre bloqueado sin OK también (es igual de simple)
[ "$OK_PRIV" = 1 ] || NO_ESCRIBIR+=( "Bash(*responder-privado.sh*)" "PowerShell(*responder-privado.sh*)" )
echo "$(date -Is) hilo $HILO quien=$QUIEN sesion=${SES[*]} escritura=$ESCRITURA" >> "$HOME/.canal-logs/sesiones-slack.log"
MODELO=claude-sonnet-5-5
if [ "$QUIEN" = "Humano" ] && [ "$PIDE_OPUS" = 1 ]; then MODELO=claude-opus-5-5; fi
TOPE_USD=${TOPE_USD:-3}; [ "$MODELO" = claude-opus-5-5 ] && TOPE_USD=${TOPE_USD_OPUS:-6}
if [ "$ESCRITURA" = 1 ] && [ "$QUIEN" = "Humano" ] && [ -z "${TOPE_USD_FIJO:-}" ]; then
  if [ "$MODELO" = claude-opus-5-5 ]; then TOPE_USD=12; else TOPE_USD=8; fi
fi
# v491: la mirada, con el modelo pequeño, esfuerzo bajo y tope de 1 $; sin publicar (ni Slack ni canal git) ni escribir en orgs
MODELO_SIGUE=$MODELO; TOPE_SIGUE=$TOPE_USD; ESFUERZO=medium; BLOQ_MIRADA=()
if [ "$MIRADA" = 1 ]; then
  MODELO=${MODELO_MIRADA:-claude-haiku-5-5}; TOPE_USD=${TOPE_USD_MIRADA:-1}; ESFUERZO=low
  BLOQ_MIRADA=( "Bash(*publicar-canal.sh*)" "PowerShell(*publicar-canal.sh*)" "Bash(*responder-slack.sh*)" "PowerShell(*responder-slack.sh*)"
    "Bash(*git push*)" "PowerShell(*git push*)" "Bash(*chat.postMessage*)" "PowerShell(*slack.com*)" )
fi
echo "$(date -Is) hilo $HILO modelo=$MODELO tope=$TOPE_USD$([ "$MIRADA" = 1 ] && printf ' mirada=1')" >> "$HOME/.canal-logs/sesiones-slack.log"
llama_claude() {   # relevo: si la cuenta de empresa topa con su cuota, UNA repeticion con la personal (nunca mas)
  llama_una; local rc=$?
  if [ "$HAY_REL" = 1 ] && [ "$CTA" = empresa ]; then
    local F; F=$(node "$REL" fallo "$LOGF" empresa --lineas 2>/dev/null) || F=""
    if [ "$(printf '%s\n' "$F" | sed -n 3p | tr -d '\r')" = cuota ]; then
      avisa_relevo "$(printf '%s\n' "$F" | sed -n 2p | tr -d '\r')"
      if [ "$(printf '%s\n' "$F" | sed -n 1p | tr -d '\r')" = personal ]; then pasa_a_personal; llama_una; rc=$?
        F=$(node "$REL" fallo "$LOGF" personal --lineas 2>/dev/null) || F=""; avisa_relevo "$(printf '%s\n' "$F" | sed -n 2p | tr -d '\r')"; fi
    fi
  elif [ "$HAY_REL" = 1 ] && [ "$CTA" = personal ]; then   # ya relevada: si tambien topa, aviso con las dos horas y se acabo
    local G; G=$(node "$REL" fallo "$LOGF" personal --lineas 2>/dev/null) || G=""
    [ "$(printf '%s\n' "$G" | sed -n 3p | tr -d '\r')" = cuota ] && avisa_relevo "$(printf '%s\n' "$G" | sed -n 2p | tr -d '\r')"
  fi
  return $rc
}
llama_una() {   # (v491: la misma llamada para la mirada y para la segunda fase)
  # tope de tiempo (CLAUDE_TOPE_SEG, 1200 s por defecto): un claude -p colgado no se queda para siempre con el hilo y el hueco
  timeout -k 10 "${CLAUDE_TOPE_SEG:-1200}" "$CLI" -p "${SES[@]}" --model "$MODELO" --effort "$ESFUERZO" --permission-mode acceptEdits --strict-mcp-config "${MCP_ARGS[@]}" \
    --tools "Bash,Read,Grep,Glob,Edit,Write,Agent,PowerShell" --disable-slash-commands \
    --allowedTools "Bash Read Grep Glob Edit Write Agent PowerShell$PERM_NAV" \
    --disallowedTools "Bash(sf *)" "${NO_ESCRIBIR[@]}" "${SIN_SLACK[@]}" "${BLOQ_MIRADA[@]}" \
    --max-budget-usd "$TOPE_USD" < "$PROMPTF" > "$LOGF" 2>&1
  local rc=$?
  [ "$rc" = 124 ] && echo "$(date -Is) hilo $HILO saltó el tope de tiempo (${CLAUDE_TOPE_SEG:-1200} s): claude -p cortado (rc=124); log $LOGF" >> "$HOME/.canal-logs/sesiones-slack.log"
  return $rc
}
llama_claude
RC=$?
rm -f "$PROMPTF"
# v250: la sesión ya tiene estas reglas (solo si el Claude terminó bien: si no llegó a leerlas, se le mandan la vez siguiente)
[ "$RC" = 0 ] && [ "$ENVIA_FIJAS" = 1 ] && printf '%s %s' "$(tr -d '\r\n ' < "$SESF")" "$FIJAS_H" > "$REGLASF"

if [ "$MIRADA" = 1 ]; then
  if [ "$RC" = 0 ] && [ -s "$RESPF" ] && [ "$(tr -d '[:space:]' < "$RESPF")" = "NADA" ]; then
    echo "$(date -Is) hilo $HILO mirada ($MODELO): sigue igual" >> "$HOME/.canal-logs/sesiones-slack.log"
  else
    LINEA=$(grep -m1 -v '^[[:space:]]*$' "$RESPF" 2>/dev/null | tr -d '\r' | cut -c1-400 || true)
    QUE=""
    if [ "$RC" = 0 ] && printf '%s\n' "$LINEA" | grep -qE '^[[:space:]*_«"]*(TERMINADO|FALLADO)[[:space:]*_]*:'; then
      QUE="La mirada en lectura del vigilante (modelo pequeño) dice: «$LINEA»."
    fi
    echo "$(date -Is) hilo $HILO mirada ($MODELO, rc=$RC): ${QUE:-no se entiende o no salió} → sigue $MODELO_SIGUE" >> "$HOME/.canal-logs/sesiones-slack.log"
    rm -f "$RESPF"
    MODELO=$MODELO_SIGUE; TOPE_USD=$TOPE_SIGUE; ESFUERZO=medium; BLOQ_MIRADA=()
    SES=(--resume "$(tr -d '\r\n ' < "$SESF")"); LOGF="${LOGF%.log}-sigue.log"
    [ -n "$NORMAL_TXT" ] || NORMAL_TXT="(Vigilante de la oficina) Si el proceso ha terminado o ha fallado, sigue con lo que tocaba después (sin escrituras en orgs sin el OK de Humano) y publícalo como siempre; si sigue igual, escribe exactamente NADA en el fichero de respuesta."
    PROMPTF=$(mktemp)
    { printf 'Nuevo mensaje de %s en este mismo hilo (canal %s, hilo %s). Ya tienes el contexto y las reglas de antes: no releas CLAUDE.md ni la memoria.\n-----\n' "$QUIEN" "$CH" "$HILO"
      [ -n "$QUE" ] && printf '%s\n' "$QUE"
      printf '%s\n-----\nReglas: las mismas que ya tienes en esta sesión; síguelas igual.\n' "$NORMAL_TXT"
      [ -n "$REGLA_IA_SIGUE" ] && printf '%s\n' "${REGLA_IA_SIGUE# }"
      printf 'Contesta igual que antes, en el fichero %s (o NADA si sigue igual).\n' "$RESPF"
    } > "$PROMPTF"
    echo "$(date -Is) hilo $HILO modelo=$MODELO tope=$TOPE_USD (tras la mirada)" >> "$HOME/.canal-logs/sesiones-slack.log"
    llama_claude
    RC=$?
    rm -f "$PROMPTF"
  fi
fi

if grep -qi 'Exceeded USD budget' "$LOGF" 2>/dev/null; then
  echo "$(date -Is) hilo $HILO TOPE alcanzado ($TOPE_USD \$)" >> "$HOME/.canal-logs/sesiones-slack.log"
  if [ "$QUIEN" = "Humano" ]; then
    AV=$(mktemp); printf '⏸️ Paré al llegar al tope de %s $ por recado (ahorro de cuota). Si hace falta seguir, contesta «sigue».' "$TOPE_USD" > "$AV"
    AUTOR=Sistema bash "$AQUI/responder-slack.sh" "$CH" "$HILO" "$AV" >/dev/null 2>&1 || true; rm -f "$AV"
    bash "$AQUI/responder-slack.sh" --reaccion "$CH" "$TS" double_vertical_bar >/dev/null 2>&1 || true
    exit 0
  fi
fi

if [ -s "$RESPF" ] && [ "$(tr -d '[:space:]' < "$RESPF")" = "NADA" ]; then
  echo "$(date -Is) hilo $HILO terminó: NADA" >> "$HOME/.canal-logs/sesiones-slack.log"; exit 0; fi

# Red de seguridad: si el Claude no llegó a contestar en Slack, contesta este script.
if [ ! -s "$RESPF" ] && [ "$QUIEN" = "Humano" ]; then  # a una IA no se le contesta en Slack
  # v146: escueto también aquí (antes pegaba 1500 caracteres del log)
  { echo "*No he terminado de contestarte (código $RC): repítemelo o di «sigue».*"; echo "Lo último que dejé: «$(tail -c 400 "$LOGF" | tr '\n' ' ' | sed 's/  */ /g')»"; } > "$RESPF"
  bash "$AQUI/responder-slack.sh" "$CH" "$HILO" "$RESPF" || true
fi
bash "$AQUI/responder-slack.sh" --reaccion "$CH" "$TS" white_check_mark >/dev/null 2>&1 || true
