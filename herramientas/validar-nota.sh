#!/usr/bin/env bash
# validar-nota.sh - comprueba la nota corta ANTES de publicar nada (Cursor 478, hueco 1).
# La usan publicar-canal.sh (antes del push), nota-slack.sh y lanzar-cursor.sh.
# Uso: validar-nota.sh <nota.txt>     Codigo 0 = valida; 2 = no valida (motivo por stderr).
set -euo pipefail
NOTA=${1:?nota}
[ -s "$NOTA" ] || { echo "nota vacia: $NOTA" >&2; exit 2; }
TXT=$(tr -d '\r' < "$NOTA")
for k in 'para:' 'Coinciden:' 'No coinciden:' 'Tu OK:' 'Tercera lectura:'; do
  printf '%s\n' "$TXT" | grep -q "^$k" || { echo "a la nota le falta la linea '$k'" >&2; exit 2; }
done
[ "$(printf '%s\n' "$TXT" | wc -l)" -le 8 ] || { echo "nota demasiado larga (max 8 lineas de la IA)" >&2; exit 2; }
if printf '%s\n' "$TXT" | grep -qiE '(secret|password|token|xox[bpa]-|hooks\.slack\.com)'; then
  echo "la nota parece llevar un secreto; no se envia" >&2; exit 2
fi
# Valores reales de los secretos locales: ni en la nota ni en ningun sitio (comparacion literal).
CFG="$HOME/.config/canal-slack.env"
if [ -f "$CFG" ]; then
  while IFS='=' read -r _ v; do
    [ ${#v} -ge 12 ] || continue
    if printf '%s' "$TXT" | grep -qF -- "$v"; then echo "la nota contiene un valor de $CFG; no se envia" >&2; exit 2; fi
  done < <(tr -d '\r' < "$CFG" | grep -E '^[A-Z_]+=')
fi
exit 0
