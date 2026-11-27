#!/usr/bin/env bash
# atender-grok.sh - Humano escribe "@grok ..." en #canal-humano (Grok no es un usuario de Slack:
# lo detecta escucha-slack.js por texto). Este script:
#   1. pone 👀, lanza la routine de Grok Bot por su webhook (lanzar-grok.sh con ENCARGO_F),
#   2. espera a que Grok publique en el canal (fetch cada 60 s, máx. 45 min, solo para ESTE recado),
#   3. pega su bloque en el hilo de Humano (con su @humano si la nota lo lleva) y pone ✅.
# Uso: atender-grok.sh <fichero.json con text, channel, ts, thread_ts>
set -uo pipefail
_cfg="$(dirname "${BASH_SOURCE[0]}")/config.sh"; [ -f "$_cfg" ] && . "$_cfg"   # identidad: config.local.json (ver config.js)
J=${1:?json}
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WT=$HOME/wt-canal-claude; RAMA=${CANAL_RAMA:-canal/humano/claude-cursor}; FICH=${CANAL_FICHERO:-CANAL_CLAUDE_CURSOR.md}
# Interruptor de Cursor: con herramientas/cursor-apagado, el encargo a Grok lo hace Claude (la routine de Grok gasta la cuenta de Cursor).
if [ -f "$AQUI/cursor-apagado" ] && { [ "${CANAL_PRUEBAS:-0}" != 1 ] || [ "${CURSOR_APAGADO_PRUEBA:-0}" = 1 ]; }; then
  mkdir -p "$HOME/.canal-logs"; echo "$(date -Is) DESVIO encargo de Grok a Claude (Cursor apagado)" >> "$HOME/.canal-logs/cursor-arranques.log"
  J="$J" node -e 'const fs=require("fs"),f=process.env.J,j=JSON.parse(fs.readFileSync(f,"utf8"));j.text="[Encargo para Grok que te pasa la oficina porque Grok está apagado con Cursor: hazlo tú.]\n"+String(j.text||"");j.quien=j.quien||"Humano";fs.writeFileSync(f,JSON.stringify(j))' \
    && exec bash "$AQUI/atender-slack.sh" "$J"
  rm -f "$J"; exit 12
fi
leer() { J="$J" K="$1" node -e 'const j=JSON.parse(require("fs").readFileSync(process.env.J,"utf8"));process.stdout.write(String(j[process.env.K]||""))'; }
CH=$(leer channel); TS=$(leer ts); HILO=$(leer thread_ts)
ENC=$(mktemp); J="$J" node -e 'const j=JSON.parse(require("fs").readFileSync(process.env.J,"utf8"));
  process.stdout.write(String(j.text||"").replace(/<@[A-Z0-9]+>/g,"").replace(/(^|\s)@grok\b/ig," ").trim())' > "$ENC"
rm -f "$J"
R=$(mktemp)
trap 'rm -f "$ENC" "${NOTA:-}" "$R"' EXIT   # v330: también al salir por error (si Grok no arrancaba, quedaban en %TEMP%)
contestar() { printf '%s' "$1" > "$R"; AUTOR=Sistema bash "$AQUI/responder-slack.sh" "$CH" "$HILO" "$R" >/dev/null 2>&1 || true; }

bash "$AQUI/responder-slack.sh" --reaccion "$CH" "$TS" eyes >/dev/null 2>&1 || true
timeout 90 git -C "$WT" -c gc.auto=0 fetch -q origin "+refs/heads/$RAMA:refs/remotes/origin/$RAMA" || true
DESDE=$(git -C "$WT" rev-parse "origin/$RAMA")
NOTA=$(mktemp); printf 'para: Grok\nCoinciden: encargo directo de Humano desde Slack\nNo coinciden: nada\nTu OK: no hace falta\nTercera lectura: no\n' > "$NOTA"
if ! ENCARGO_F="$ENC" bash "$AQUI/lanzar-grok.sh" principal "$NOTA" "$DESDE" "$DESDE"; then
  contestar "No he podido lanzar a Grok (webhook o freno). Míralo en ~/.canal-logs."; exit 14
fi
contestar "Grok está en ello. Te pego aquí su respuesta cuando la publique en el canal (máx. 45 min)."

FIN=$(( $(date +%s) + ${ESPERA_GROK_S:-2700} ))
while [ "$(date +%s)" -lt "$FIN" ]; do
  sleep "${ESPERA_PASO_S:-60}"
  timeout 90 git -C "$WT" -c gc.auto=0 fetch -q origin "+refs/heads/$RAMA:refs/remotes/origin/$RAMA" || continue
  NUEVO=$(git -C "$WT" rev-parse "origin/$RAMA")
  [ "$NUEVO" = "$DESDE" ] && continue
  # Bloque nuevo firmado por Grok en el tramo
  BLOQ=$(git -C "$WT" diff "$DESDE" "$NUEVO" -- "$FICH" | sed -n 's/^+//p' | grep -v '^++' )
  if printf '%s\n' "$BLOQ" | grep -qE '^###? .*Grok|^— Grok|id: Grok'; then
    M=""; printf '%s\n' "$BLOQ" | grep -qiE '^@humano' && M="(te necesita) "
    TXT=$(printf '%s\n' "$BLOQ" | grep -v '^<!--' | head -c 3500)
    contestar "${M}Grok ha respondido (canal ${NUEVO:0:10}):
$TXT"
    if [ -n "$M" ]; then bash "$AQUI/avisar-humano.sh" "Grok necesita algo de ti: mira su respuesta en el hilo." || true; fi
    bash "$AQUI/responder-slack.sh" --reaccion "$CH" "$TS" white_check_mark >/dev/null 2>&1 || true
    rm -f "$ENC" "$NOTA" "$R"; exit 0
  fi
done
contestar "Grok no ha publicado nada en 45 min. Mira su routine en Grok Bot."
rm -f "$ENC" "$NOTA" "$R"
