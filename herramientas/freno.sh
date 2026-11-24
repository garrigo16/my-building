#!/usr/bin/env bash
set -euo pipefail
QUIEN=${1:?quien}; HILO=${2:--}
LOG="$HOME/.canal-lanzamientos.log"
MAX=${FRENO_MAX:-40}; MAX_HILO=${FRENO_MAX_HILO:-6}
# Cursor 484 (hueco 6): cerrojo para que dos lanzamientos a la vez no pasen los dos (mkdir es atómico).
CERROJO="$LOG.cerrojo"
# v141: el cerrojo dura milisegundos; si lleva más de 2 min es de un freno.sh que murió con él puesto (si no, todo lo de
# entre IAs se quedaría frenado para siempre).
[ -n "$(find "$CERROJO" -maxdepth 0 -mmin +2 2>/dev/null)" ] && rmdir "$CERROJO" 2>/dev/null
TENGO=0
for i in $(seq 1 300); do mkdir "$CERROJO" 2>/dev/null && { TENGO=1; break; }; sleep 0.2; done
if [ "$TENGO" = 1 ]; then trap 'rmdir "$CERROJO" 2>/dev/null' EXIT
else echo "$(date +%s) $QUIEN $HILO" >> "$LOG"; echo "freno: sin cerrojo en 60 s, dejo pasar a $QUIEN" >&2; exit 0; fi
AHORA=$(date +%s)
touch "$LOG"
NH=0; NQ=0
if [ "$HILO" != "-" ]; then
  NH=$(awk -v t=$((AHORA-3600)) -v h="$HILO" '$1>=t && $3==h' "$LOG" | wc -l)
  NQ=$(awk -v t=$((AHORA-3600)) -v h="$HILO" -v q="$QUIEN" '$1>=t && $3==h && $2==q' "$LOG" | wc -l)
  if [ "$NH" -ge "$MAX_HILO" ]; then
    echo "FRENO: $NH lanzamientos automáticos en este hilo en la última hora (máx. $MAX_HILO). No lanzo a $QUIEN." >&2
    exit 12
  fi
fi
N=$(awk -v t=$((AHORA-3600)) '$1>=t' "$LOG" | wc -l)
if [ "$N" -ge "$MAX" ] && ! { [ "$HILO" != "-" ] && [ "$NQ" -eq 0 ]; }; then
  echo "FRENO: $N lanzamientos automáticos en la última hora (máx. $MAX). No lanzo a $QUIEN." >&2
  exit 12
fi
echo "$AHORA $QUIEN $HILO" >> "$LOG"
