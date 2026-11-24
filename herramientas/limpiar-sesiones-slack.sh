#!/usr/bin/env bash
set -uo pipefail
DIAS=${DIAS:-7}; SECO=0; [ "${1:-}" = "--dry-run" ] && SECO=1
L="$HOME/.canal-logs"; MAPA="$L/sesiones-slack"
LOGF="$L/limpieza-slack.log"; LIMITE=$(( $(date +%s) - DIAS*86400 ))
borrar() { if [ $SECO = 1 ]; then echo "borraría $1"; else rm -f "$1"; fi; }
nS=0; nV=0
for m in "$MAPA"/*; do
  [ -f "$m" ] || continue
  case "$m" in *.reglas) continue ;; esac
  ID=$(tr -d '\r\n ' < "$m"); T=""
  [ -n "$ID" ] && T=$(ls "$HOME"/.claude/projects/*/"$ID".jsonl 2>/dev/null | head -1)
  REF="$m"; [ -n "$T" ] && REF="$T"
  if [ "$(stat -c %Y "$REF")" -lt "$LIMITE" ]; then
    [ -n "$T" ] && borrar "$T"; borrar "$m"; [ -f "$m.reglas" ] && borrar "$m.reglas"; nS=$((nS+1))
  else nV=$((nV+1)); fi
done
nL=0
for f in "$L"/slack-2*.log "$L"/cursor-slack-*.log "$L"/slack-respuesta-*.txt "$L"/freno-avisado-*; do
  [ -f "$f" ] || continue
  [ "$(stat -c %Y "$f")" -lt "$LIMITE" ] && { borrar "$f"; nL=$((nL+1)); }
done
MSG="$(date -Is) limpieza (>${DIAS} días): $nS sesiones borradas, $nV vivas, $nL logs$([ $SECO = 1 ] && echo ' [dry-run]')"
echo "$MSG"; [ $SECO = 1 ] || echo "$MSG" >> "$LOGF"
