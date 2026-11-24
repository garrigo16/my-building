#!/usr/bin/env bash
# avisar-humano.sh - mensaje corto a #canal-humano con mención a Humano, para cuando algo
# automático se para (freno, error de Cursor, Grok sin configurar). No pasa por validar-nota.
# Uso: avisar-humano.sh "<texto de una línea>"
set -euo pipefail
TXT=${1:?texto}
CFG="$HOME/.config/canal-slack.env"
[ -f "$CFG" ] && { set -a; . <(tr -d '\r' < "$CFG"); set +a; }   # sin CR: el Bloc de notas guarda CRLF
[ -n "${SLACK_WEBHOOK_CANAL:-}" ] || { echo "sin webhook: $TXT" >&2; exit 8; }
M="@humano"; [ -n "${SLACK_HUMANO_ID:-}" ] && M="<@$SLACK_HUMANO_ID>"
TXF=$(mktemp); printf '%s %s' "$M" "$TXT" > "$TXF"
BODYF=$(mktemp); TXF="$TXF" node -e 'process.stdout.write(JSON.stringify({text:require("fs").readFileSync(process.env.TXF,"utf8")}))' > "$BODYF"
CURLCFG=$(umask 077; mktemp); printf 'url = "%s"\n' "$SLACK_WEBHOOK_CANAL" > "$CURLCFG"
RESP=$(curl -sS -m 20 -K "$CURLCFG" -X POST -H 'Content-Type: application/json' --data-binary "@$BODYF" || true)
rm -f "$TXF" "$BODYF" "$CURLCFG"
# Cursor 484 (hueco 3): si Slack no lo acepta, el que llama tiene que saberlo.
if [ "$RESP" != "ok" ]; then
  echo "AVISO A HUMANO NO ENTREGADO (${RESP:-sin respuesta}): $TXT" >&2
  echo "$(date '+%d/%m %H:%M') NO ENTREGADO: $TXT" >> "$HOME/.canal-logs/avisos-no-entregados.log" 2>/dev/null || true
  exit 9
fi
