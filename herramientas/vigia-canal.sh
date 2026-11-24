#!/bin/bash
_cfg="$(dirname "${BASH_SOURCE[0]}")/config.sh"; [ -f "$_cfg" ] && . "$_cfg"   # identidad: config.local.json (ver config.js)
cd "$HOME/wt-canal-claude" || exit 2
R2=${CANAL2_RAMA:-canal/proyecto/compartido}
[ "$R2" = "-" ] && exit 0   # la config no tiene segundo canal
REF=refs/remotes/origin/$R2
cuenta() { git show $REF:CANAL_PROYECTO.md 2>/dev/null | grep -a -E '^<!-- para:' | grep -a -E 'para: [^|]*(JJ|todos)' | grep -a -vcE 'id: JJ-'; }
timeout 90 git fetch -q origin "$R2" 2>/dev/null
BASE=$(cuenta); echo "base=$BASE $(date -u -d '+1 hour' +%H:%M)"
while true; do
  sleep 900
  H=$(date -u -d '+1 hour' +%H); D=$(date -u -d '+1 hour' +%u)
  [ "$D" -gt 5 ] && continue; [ "$H" -lt 8 ] || [ "$H" -ge 20 ] && continue
  timeout 90 git fetch -q origin "$R2" 2>/dev/null
  N=$(cuenta)
  if [ -n "$N" ] && [ "$N" -gt "$BASE" ]; then
    echo "CANAL NUEVO: $BASE -> $N a las $(date -u -d '+1 hour' +%H:%M)"
    git show $REF:CANAL_PROYECTO.md | grep -a -E '^<!-- para:' | grep -a -E 'para: [^|]*(JJ|todos)' | grep -a -vE 'id: JJ-' | tail -$((N-BASE))
    exit 0
  fi
done
