#!/bin/bash
# Vigía del canal: termina cuando aumenta el nº de cabeceras de Coo/Codex.
_cfg="$(dirname "${BASH_SOURCE[0]}")/config.sh"; [ -f "$_cfg" ] && . "$_cfg"   # identidad: config.local.json (ver config.js)
cd "$HOME/wt-canal-claude" || exit 2
R1=${CANAL_RAMA:-canal/humano/claude-cursor}
REF=origin/$R1
cuenta() { git show $REF:CANAL_CLAUDE_CURSOR.md 2>/dev/null | grep -a -cE '^#{2,3} \[?(Coo|Codex)|^## .*Codex'; }
BASE=$(cuenta)
echo "base=$BASE $(date -u -d '+1 hour' +%H:%M)"
while true; do
  sleep 60
  timeout 90 git fetch -q origin "$R1" 2>/dev/null
  N=$(cuenta)
  if [ -n "$N" ] && [ "$N" -gt "$BASE" ]; then
    echo "NUEVO: $BASE -> $N a las $(date -u -d '+1 hour' +%H:%M)"
    git show $REF:CANAL_CLAUDE_CURSOR.md | grep -a -nE '^#{2,3} \[?(Coo|Codex)|^## .*Codex' | tail -$((N-BASE))
    exit 0
  fi
done
