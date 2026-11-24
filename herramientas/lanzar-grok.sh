#!/usr/bin/env bash
# lanzar-grok.sh - pide la TERCERA LECTURA a Grok Bot (xAI; viene con el plan de Cursor) por el
# webhook de una de sus routines. Solo se llama cuando una nota dice "Tercera lectura: sí".
# Grok Bot no tiene API para lanzar tareas: lo que sí tiene es un webhook por routine
# (docs.x.ai/grok-bot/skills-routines-and-automations): POST a la URL con "Authorization: Bearer <key>"
# y un JSON opcional, que la Bot recibe junto con la instrucción de la routine. Un 200 = run arrancado.
#
# Uso: lanzar-grok.sh <principal|segundo-canal> <nota.txt> <sha-remoto> <sha-desde>
# Secretos (en ~/.config/canal-slack.env): GROK_WEBHOOK_URL y GROK_WEBHOOK_KEY.
# Codigos: 0 lanzado · 2 uso · 8 sin configurar (avisa a Humano) · 12 freno · 14 Grok rechazó.
set -euo pipefail
_cfg="$(dirname "${BASH_SOURCE[0]}")/config.sh"; [ -f "$_cfg" ] && . "$_cfg"   # identidad: config.local.json (ver config.js)
CANAL=${1:?canal}; NOTA=${2:?nota}; SHA=${3:?sha}; DESDE=${4:?desde}
case "$CANAL" in
  principal) RAMA=${CANAL_RAMA:-canal/humano/claude-cursor}; FICH=${CANAL_FICHERO:-CANAL_CLAUDE_CURSOR.md} ;;
  "${CANAL2_NOMBRE:-proyecto}")       RAMA=${CANAL2_RAMA:-canal/proyecto/compartido};  FICH=${CANAL2_FICHERO:-CANAL_PROYECTO.md} ;;
  *) echo "canal desconocido: $CANAL" >&2; exit 2 ;;
esac
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Interruptor de Cursor: con herramientas/cursor-apagado no se llama a la routine de Grok (gasta la cuenta de Cursor): la tercera lectura la hace Claude.
if [ -f "$AQUI/cursor-apagado" ] && { [ "${CANAL_PRUEBAS:-0}" != 1 ] || [ "${CURSOR_APAGADO_PRUEBA:-0}" = 1 ]; }; then
  mkdir -p "$HOME/.canal-logs"; echo "$(date -Is) DESVIO tercera lectura $CANAL ${SHA:0:10} a Claude (Grok apagado con Cursor)" >> "$HOME/.canal-logs/cursor-arranques.log"
  if grep -qiE '^para:.*claude' "$NOTA"; then echo "Cursor apagado: la nota ya va a Claude"; exit 0; fi
  CANAL_DESVIO_CURSOR=1 exec bash "$AQUI/lanzar-claude.sh" "$CANAL" "$NOTA" "$SHA" "$DESDE"
fi
CFG="$HOME/.config/canal-slack.env"
[ -f "$CFG" ] && { set -a; . <(tr -d '\r' < "$CFG"); set +a; }   # sin CR: el Bloc de notas guarda CRLF
if [ -z "${GROK_WEBHOOK_URL:-}" ] || [ -z "${GROK_WEBHOOK_KEY:-}" ]; then
  bash "$AQUI/avisar-humano.sh" "Se pide tercera lectura ($CANAL ${SHA:0:10}) y Grok Bot no tiene webhook configurado."
  exit 8
fi
bash "$AQUI/freno.sh" grok || { echo "$(date -Is) FRENO: no lanzo a Grok para $CANAL ${SHA:0:10}" >> "$HOME/.canal-logs/freno.log"; exit 12; }

BODYF=$(mktemp)
# ENCARGO_F (opcional): fichero con un encargo directo de Humano desde Slack (atender-grok.sh).
# Sin él, el encargo es la tercera lectura.
JSF=$(mktemp --suffix=.js)
cat > "$JSF" <<'EOF_JS'
const e=process.env, fs=require("fs"), sinCR=t=>t.split(String.fromCharCode(13)).join("");
const fin = " Termina tu bloque con una línea en blanco y la nota: «NOTA:» y debajo para:, @humano (solo si necesitas una decisión de Humano), Coinciden:, No coinciden:, Tu OK: y Tercera lectura:. Sin orgs, sin PRs, sin secretos.";
const encargo = e.ENCARGO_F
  ? "Humano te escribe desde Slack: «" + sinCR(fs.readFileSync(e.ENCARGO_F,"utf8")).trim() + "». Haz lo que pide (solo lectura de git y del repo) y responde con tu bloque al final del fichero del canal, firmado como Grok, commit con [skip ci], push a esa rama." + fin
  : "Tercera lectura: lee SOLO el tramo desde..sha de esa rama y esos bloques, di quién tiene razón y por qué, y responde en el canal con tu bloque firmado como Grok." + fin;
process.stdout.write(JSON.stringify({
  canal: e.CANAL, rama: e.RAMA, fichero: e.FICH, repo: e.CANAL_REPO_URL || "https://bitbucket.org/oca-global/oca-salesforce",
  sha: e.SHA, desde: e.DESDE,
  nota: sinCR(fs.readFileSync(e.NOTA_F,"utf8")),
  encargo
}));
EOF_JS
CANAL="$CANAL" RAMA="$RAMA" FICH="$FICH" SHA="$SHA" DESDE="$DESDE" NOTA_F="$NOTA" ENCARGO_F="${ENCARGO_F:-}" node "$JSF" > "$BODYF"
rm -f "$JSF"
CURLCFG=$(umask 077; mktemp)
printf 'url = "%s"\nheader = "Authorization: Bearer %s"\n' "$GROK_WEBHOOK_URL" "$GROK_WEBHOOK_KEY" > "$CURLCFG"
CODE=$(curl -sS -m 30 -K "$CURLCFG" -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' --data-binary "@$BODYF" || echo 000)
rm -f "$BODYF" "$CURLCFG"
if [ "$CODE" = 200 ]; then echo "GROK lanzado ($CANAL ${SHA:0:10})"; else echo "GROK NO lanzado: http $CODE" >&2; exit 14; fi
