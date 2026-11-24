#!/usr/bin/env bash
set -euo pipefail

CANAL=${1:?canal}; NOTA=${2:?nota}; SHA=${3:?sha remoto}; DESDE=${4:?sha desde}
if [ "${NOTA_SLACK:-0}" != 1 ]; then
  mkdir -p "$HOME/.canal-logs"
  { echo "$(date -Is) nota NO publicada en Slack ($CANAL ${SHA:0:10}):"; tr -d '\r' < "$NOTA"; } >> "$HOME/.canal-logs/notas-sin-publicar.log"
  bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/timbre.sh" "$CANAL" "$NOTA" "$SHA" || exit 9
  exit 0
fi
case "$CANAL" in principal|"${CANAL2_NOMBRE:-proyecto}") ;; *) echo "canal desconocido: $CANAL" >&2; exit 2 ;; esac
[ -s "$NOTA" ] || { echo "nota vacia: $NOTA" >&2; exit 2; }

CFG="$HOME/.config/canal-slack.env"
if [ -z "${SLACK_WEBHOOK_CANAL:-}" ] && [ -f "$CFG" ]; then
  # shellcheck disable=SC1090
  set -a; . <(tr -d '\r' < "$CFG"); set +a   # sin CR: el Bloc de notas guarda CRLF
fi
[ -n "${SLACK_WEBHOOK_CANAL:-}" ] || { echo "SIN NOTA: no hay SLACK_WEBHOOK_CANAL ni $CFG" >&2; exit 8; }

bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/validar-nota.sh" "$NOTA" || exit 2
TXT=$(tr -d '\r' < "$NOTA")

FULL=$(printf '%s\nDetalle: %s sha %s\nDesde: %s\n' "$TXT" "$CANAL" "${SHA:0:10}" "${DESDE:0:10}")

# JSON con node (no hay jq ni python en esta maquina). @cursor -> mencion real si hay Id.
TXF=$(mktemp); printf "%s" "$FULL" > "$TXF"
JSF=$(mktemp --suffix=.js)
cat > "$JSF" <<'EOF_JS'
let t = require("fs").readFileSync(process.env.TXF, "utf8");
if (process.env.CID) t = t.replace(/^@cursor(?![a-z0-9_])/mi, "<@" + process.env.CID + ">");
// @humano solo cuando se le necesita: entonces Slack le avisa de verdad.
if (process.env.JID) t = t.replace(/^@humano(?![a-z0-9_])/mi, "<@" + process.env.JID + ">");
process.stdout.write(JSON.stringify({ text: t }));
EOF_JS
BODYF=$(mktemp); TXF="$TXF" CID="${SLACK_CURSOR_ID:-}" JID="${SLACK_HUMANO_ID:-}" node "$JSF" > "$BODYF"   # a fichero: un argv de Windows rompe las tildes
rm -f "$JSF" "$TXF"

# Cursor 478 (hueco 2): la URL del webhook va en un fichero de config de curl (600), no en el argv.
CURLCFG=$(umask 077; mktemp); printf 'url = "%s"\n' "$SLACK_WEBHOOK_CANAL" > "$CURLCFG"
RESP=$(curl -sS -m 20 -K "$CURLCFG" -X POST -H 'Content-Type: application/json' --data-binary "@$BODYF" || true)
rm -f "$BODYF" "$CURLCFG"
if [ "$RESP" = "ok" ]; then
  echo "NOTA SLACK enviada ($CANAL ${SHA:0:10})"
else
  echo "NOTA SLACK rechazada: ${RESP:-sin respuesta}. El bloque SI esta publicado; reintenta con:" >&2
  echo "  nota-slack.sh $CANAL $NOTA $SHA $DESDE" >&2
  exit 9
fi
