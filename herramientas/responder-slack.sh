#!/usr/bin/env bash
# responder-slack.sh - Claude contesta a Humano en Slack, en el hilo de su mención.
# Uso: responder-slack.sh <channel> <thread_ts> <fichero-con-el-texto>
#      responder-slack.sh --reaccion <channel> <ts> <emoji>      (p. ej. eyes, white_check_mark)
# Firma: todo sale por UN solo bot, así que el texto lleva la firma de su autor. Variable AUTOR: Claude (por defecto) | Cursor | Coo |
#   Sistema (o «-»: avisos sin firma). Si el texto ya empieza por «Claude:», «*Cursor (vía CLI):*», «Coo:»… no se añade nada; si no, se
#   antepone «*<Autor>:*» + salto de línea. Si el bot tiene chat:write.customize (auth.test → x-oauth-scopes, cache 15 min en
#   ~/.canal-logs) se publica con username/icon_emoji del autor y sin cabecera. La Oficina (quien() en server.js) lee esa firma.
# Secreto: SLACK_BOT_TOKEN (xoxb-) en ~/.config/canal-slack.env. Va en config de curl, no en argv.
# Codigos: 0 ok · 2 uso · 8 sin token · 9 Slack rechazó.
set -euo pipefail
# CANAL_SIN_SLACK=1 (lo pone el vigía en las pruebas): no sale nada a Slack
[ "${CANAL_SIN_SLACK:-0}" = 1 ] && exit 0
CFG="$HOME/.config/canal-slack.env"
[ -f "$CFG" ] && { set -a; . <(tr -d '\r' < "$CFG"); set +a; }
[ -n "${SLACK_BOT_TOKEN:-}" ] || { echo "sin SLACK_BOT_TOKEN" >&2; exit 8; }
API=https://slack.com/api
if [ "${CANAL_PRUEBAS:-0}" = 1 ] && [ -n "${SLACK_API_URL:-}" ]; then API=$SLACK_API_URL; fi
BODYF=$(mktemp); CURLCFG=$(umask 077; mktemp)
trap 'rm -f "$BODYF" "$CURLCFG"' EXIT
printf 'header = "Authorization: Bearer %s"\n' "$SLACK_BOT_TOKEN" > "$CURLCFG"

if [ "${1:-}" = "--reaccion" ]; then
  CH=${2:?channel}; TS=${3:?ts}; EMO=${4:?emoji}
  CH="$CH" TS="$TS" EMO="$EMO" node -e 'const e=process.env;process.stdout.write(JSON.stringify({channel:e.CH,timestamp:e.TS,name:e.EMO}))' > "$BODYF"
  METODO=reactions.add
else
  CH=${1:?channel}; TS=${2:?thread_ts}; TXT=${3:?fichero}
  [ -s "$TXT" ] || { echo "texto vacío" >&2; exit 2; }
  # Ningún valor secreto puede salir a Slack (v141: también los del token de la oficina, MuleSoft y el calendario).
  for SEC in "$CFG" "$HOME/.config/oficina-slack.env" "$HOME/.config/mulesoft.env" "$HOME/.config/oficina-calendario.env"; do
    [ -f "$SEC" ] || continue
    while IFS='=' read -r _ v; do
      v=${v//\"/}; v=${v//\'/}
      [ ${#v} -ge 12 ] || continue
      if grep -qF -- "$v" "$TXT"; then echo "el texto contiene un secreto; no lo envío" >&2; exit 2; fi
    done < <(tr -d '\r' < "$SEC" | grep -E '^[A-Z_]+=')
  done
  # Autor: Claude | Cursor | Coo | Sistema (sin firma). Un valor desconocido = sin firma (mejor sin firma que con una falsa).
  case "$(printf '%s' "${AUTOR-Claude}" | tr 'A-Z' 'a-z')" in
    claude|"") AUT=Claude ;; cursor) AUT=Cursor ;; coo) AUT=Coo ;; *) AUT=Sistema ;;
  esac
  CUSTOM=0
  if [ "$AUT" != Sistema ]; then
    mkdir -p "$HOME/.canal-logs"
    HT=$(printf '%s' "$SLACK_BOT_TOKEN" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(require("crypto").createHash("sha256").update(s).digest("hex").slice(0,12)))')
    SCF="$HOME/.canal-logs/slack-scopes-$HT.txt"   # solo los scopes (sin secretos), clave = huella corta del token
    if [ -s "$SCF" ] && [ $(( $(date +%s) - $(stat -c %Y "$SCF") )) -lt 900 ]; then
      grep -q 'chat:write.customize' "$SCF" && CUSTOM=1
    else
      CAB=$(curl -sS -m 10 -K "$CURLCFG" -X POST -D - -o /dev/null "$API/auth.test" 2>/dev/null | tr -d '\r' | grep -i '^x-oauth-scopes:' | head -1 || true)
      if [ -n "$CAB" ]; then printf '%s\n' "${CAB#*:}" > "$SCF"; grep -q 'chat:write.customize' "$SCF" && CUSTOM=1; fi
    fi
  fi
  CH="$CH" TS="$TS" TXT="$TXT" AUT="$AUT" CUSTOM="$CUSTOM" node -e '
    const e=process.env, t=require("fs").readFileSync(e.TXT,"utf8").split(String.fromCharCode(13)).join("");
    const o={channel:e.CH, thread_ts:e.TS, text:t.slice(0,39000)};
    // misma cabecera que reconoce quien() de la Oficina (server.js)
    const firmado=/^\s*[*_]*(Claude|Cursor|Coo)[*_]*\s*(\([^)]*\))?\s*[*_]*\s*:/.test(t) || /^\s*[*_]*Cursor (no ha arrancado|sin saldo)/.test(t);
    if(e.AUT!=="Sistema"){
      if(e.CUSTOM==="1"){ o.username=e.AUT==="Coo"?"Coo · Geoffrey":e.AUT; o.icon_emoji=e.AUT==="Cursor"?":computer:":e.AUT==="Coo"?":speech_balloon:":":robot_face:"; }
      else if(!firmado) o.text=("*"+e.AUT+":*\n"+t).slice(0,39000);
    }
    process.stdout.write(JSON.stringify(o));' > "$BODYF"
  METODO=chat.postMessage
fi
ESPERA=${RESPONDER_ESPERA:-3}
for intento in 1 2 3; do
  RESP=$(curl -sS -m 20 -K "$CURLCFG" -X POST -H 'Content-Type: application/json; charset=utf-8' --data-binary "@$BODYF" "$API/$METODO" 2>/dev/null || true)
  if printf '%s' "$RESP" | grep -q '"ok": *true'; then echo "SLACK $METODO ok"; exit 0; fi
  if [ -n "$RESP" ] && ! printf '%s' "$RESP" | grep -qE '"error": *"(ratelimited|fatal_error|internal_error|service_unavailable|request_timeout)"'; then break; fi
  [ "$intento" -lt 3 ] && sleep $(( intento * ESPERA ))
done
echo "SLACK $METODO rechazado: $(printf '%s' "${RESP:-sin respuesta}" | cut -c1-200)" >&2
if [ "$METODO" = chat.postMessage ]; then
  mkdir -p "$HOME/.canal-logs"
  printf '%s NO SALIÓ hilo %s canal %s: %s · texto en %s\n' "$(date -Is)" "$TS" "$CH" "$(printf '%s' "${RESP:-sin respuesta}" | tr -d '\r\n' | cut -c1-120)" "$TXT" >> "$HOME/.canal-logs/slack-no-enviado.log"
fi
exit 9
