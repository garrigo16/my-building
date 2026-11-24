#!/usr/bin/env bash
# responder-slack.sh - Claude contesta a Humano en Slack, en el hilo de su mención.
# Uso: responder-slack.sh <channel> <thread_ts> <fichero-con-el-texto>
#      responder-slack.sh --reaccion <channel> <ts> <emoji>      (p. ej. eyes, white_check_mark)
# Secreto: SLACK_BOT_TOKEN (xoxb-) en ~/.config/canal-slack.env. Va en config de curl, no en argv.
# Codigos: 0 ok · 2 uso · 8 sin token · 9 Slack rechazó.
set -euo pipefail
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
  CH="$CH" TS="$TS" TXT="$TXT" node -e '
    const e=process.env, t=require("fs").readFileSync(e.TXT,"utf8").split(String.fromCharCode(13)).join("");
    process.stdout.write(JSON.stringify({channel:e.CH, thread_ts:e.TS, text:t.slice(0,39000)}));' > "$BODYF"
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
