#!/usr/bin/env bash
set -euo pipefail
_cfg="$(dirname "${BASH_SOURCE[0]}")/config.sh"; [ -f "$_cfg" ] && . "$_cfg"   # identidad: config.local.json (ver config.js)

CANAL=${1:?canal: principal|segundo-canal}; BLOQUE=${2:?fichero de bloque}; MSG=${3:?mensaje de commit}; shift 3
case "$CANAL" in
  principal) WT=${WT:-$HOME/wt-canal-claude}; RAMA=${CANAL_RAMA:-canal/humano/claude-cursor}; FICH=${CANAL_FICHERO:-CANAL_CLAUDE_CURSOR.md} ;;
  "${CANAL2_NOMBRE:-proyecto}")       WT=${WT:-$HOME/wt-${CANAL2_NOMBRE:-proyecto}-claude};   RAMA=${CANAL2_RAMA:-canal/proyecto/compartido};  FICH=${CANAL2_FICHERO:-CANAL_PROYECTO.md} ;;
  *) echo "canal desconocido: $CANAL" >&2; exit 2 ;;
esac
MAX=${MAX_REINTENTOS:-3}

[ -s "$BLOQUE" ] || { echo "bloque vacío: $BLOQUE" >&2; exit 2; }
grep -q '^<!-- para:' "$BLOQUE" || { echo "el bloque no tiene cabecera '<!-- para:'" >&2; exit 2; }
if tr -d '\000' < "$BLOQUE" | cmp -s - "$BLOQUE"; then :; else echo "el bloque tiene bytes nulos" >&2; exit 2; fi
# Cursor 478 (huecos 1 y 6): todo se valida ANTES del push. Si algo falla, no se publica nada.
case "$MSG" in *"[skip ci]"*) ;; *) echo "el mensaje de commit no lleva [skip ci]" >&2; exit 2 ;; esac
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${NOTA:-}" ]; then bash "$AQUI/validar-nota.sh" "$NOTA" || exit 2; fi
CFG_SEC="$HOME/.config/canal-slack.env"
if [ -f "$CFG_SEC" ]; then
  for f in "$BLOQUE" "${@%%:*}"; do
    [ -f "$f" ] || continue
    while IFS='=' read -r _ v; do
      [ ${#v} -ge 12 ] || continue
      if grep -qF -- "$v" "$f"; then echo "$f contiene un valor secreto de $CFG_SEC; no publico" >&2; exit 2; fi
    done < <(tr -d '\r' < "$CFG_SEC" | grep -E '^[A-Z_]+=')
  done
fi

cd "$WT"
git diff --quiet && git diff --cached --quiet || { echo "worktree $WT sucio; no publico" >&2; exit 3; }

traer() { timeout 90 git -c gc.auto=0 fetch -q origin "+refs/heads/$RAMA:refs/remotes/origin/$RAMA" || true; }

traer
VISTO=$(git rev-parse "origin/$RAMA")
# Lo último que esta IA leyó del canal (fichero de estado o LEIDO=<sha>). Si origin avanzó desde
# entonces, se para ANTES de publicar: el fetch de arriba no basta, lo que entró entre la última
# lectura y este fetch no se ha leído. Tras parar, el estado pasa a VISTO y se relanza tras leer.
ESTADO="$HOME/.publicar-canal-$CANAL.leido"
LEIDO=${LEIDO:-$(cat "$ESTADO" 2>/dev/null || true)}
[ -n "$LEIDO" ] && LEIDO=$(git rev-parse --verify -q "$LEIDO^{commit}" 2>/dev/null || printf '%s' "$LEIDO")
if [ -n "$LEIDO" ] && [ "$LEIDO" != "$VISTO" ] && [ "${REAPLICAR_SIN_LEER:-0}" != 1 ]; then
  echo "NO publicado: hay commits que no has leído. Léelos y vuelve a lanzar el mismo comando:" >&2
  git log --format='  %h %cd %s' --date=format:%H:%M "$LEIDO..origin/$RAMA" >&2 || true
  echo "$VISTO" > "$ESTADO"; exit 6
fi
for intento in $(seq 1 "$MAX"); do
  git checkout -q --detach "refs/remotes/origin/$RAMA"
  DESDE=$(git rev-parse HEAD)   # tip remoto sobre el que va este bloque: el "Desde:" de la nota
  ANEXOS=()
  for par in "$@"; do
    src=${par%:*}; dst=${par##*:}
    mkdir -p "$(dirname "$dst")"; tr -d '\r' < "$src" > "$dst"; ANEXOS+=("$dst")
  done
  # Git Bash en Windows no trae zoneinfo: TZ=Europe/Madrid da UTC sin avisar. Hora de Madrid a mano:
  # +2 h del último domingo de marzo al último domingo de octubre; +1 h el resto del año.
  Y=$(date -u +%Y); M=$(date -u +%m); D=$(date -u +%d)
  dom_mar=$(( 31 - $(date -u -d "$Y-03-31" +%w) )); dom_oct=$(( 31 - $(date -u -d "$Y-10-31" +%w) ))
  hoy=$((10#$M * 100 + 10#$D))
  if [ $hoy -gt $((300 + dom_mar)) ] && [ $hoy -lt $((1000 + dom_oct)) ]; then OFF=2; else OFF=1; fi
  H=$(date -u -d "+$OFF hour" +%H:%M)
  printf '\n---\n\n' >> "$FICH"
  tr -d '\r' < "$BLOQUE" | sed "s/· HORA ·/· $H ·/" >> "$FICH"
  for f in "$FICH" "${ANEXOS[@]}"; do
    if grep -q $'\r' "$f"; then echo "CR en $f" >&2; exit 4; fi
  done
  [ ${#ANEXOS[@]} -gt 0 ] && git add -- "${ANEXOS[@]}"
  git commit -q -m "$MSG

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- "$FICH" "${ANEXOS[@]}"
  PUSHERR=""
  if PUSHERR=$(git push -q origin "HEAD:refs/heads/$RAMA" 2>&1); then
    # Cursor 478 (hueco 5): si el fetch de verificación falla tras un push bueno, NO se reaplica.
    for v in 1 2 3; do
      timeout 90 git -c gc.auto=0 fetch -q origin "+refs/heads/$RAMA:refs/remotes/origin/$RAMA" && break
      [ $v -eq 3 ] && { echo "PUSH HECHO pero sin poder verificar (fetch falla). NO relances: comprueba a mano $(git rev-parse --short HEAD)" >&2; exit 11; }
      sleep 5
    done
    if [ "$(git rev-parse HEAD)" = "$(git rev-parse "origin/$RAMA")" ]; then
      git rev-parse HEAD > "$ESTADO"
      echo "PUBLICADO $(git rev-parse --short HEAD) en $RAMA (intento $intento)"
      if [ -f "$HOME/.canal-logs/oficina.pid" ]; then
        curl -s -m 2 -o /dev/null -X POST -H 'Content-Type: application/json' --data '{"git":true}' "http://127.0.0.1:${OFICINA_PORT:-4317}/api/toque" >/dev/null 2>&1 || true
      fi
      if [ -n "${NOTA:-}" ]; then
        RC=0
        bash "$AQUI/nota-slack.sh" "$CANAL" "$NOTA" "$(git rev-parse HEAD)" "$DESDE" || RC=7
        # La nota ya se validó antes del push: un fallo aquí es de entrega a Slack, no de contenido.
        # Cursor ignora menciones de apps en Slack: si la nota lo nombra, se le lanza por su API.
        if grep -qiE "^@cursor([^a-z0-9_]|$)" "$NOTA"; then
          bash "$AQUI/lanzar-cursor.sh" "$CANAL" "$NOTA" "$(git rev-parse HEAD)" "$DESDE" || RC=10
        fi
        if [ "${CODEX_ACTIVO:-}" = 1 ] && grep -qiE "^para:.*codex" "$NOTA" && [ "${CANAL_SOY_CODEX_HEADLESS:-0}" != 1 ]; then
          bash "$AQUI/lanzar-codex.sh" "$CANAL" "$NOTA" "$(git rev-parse HEAD)" "$DESDE" || RC=15
        fi
        if grep -qiE "^para:.*claude" "$NOTA" && [ "${CANAL_SOY_CLAUDE_HEADLESS:-0}" != 1 ]; then
          bash "$AQUI/lanzar-claude.sh" "$CANAL" "$NOTA" "$(git rev-parse HEAD)" "$DESDE" || RC=13
        fi
        if grep -qiE "^Tercera lectura:[[:space:]]*s[ií]" "$NOTA"; then
          bash "$AQUI/lanzar-grok.sh" "$CANAL" "$NOTA" "$(git rev-parse HEAD)" "$DESDE" || RC=14
        fi
        [ $RC -eq 0 ] || exit $RC
      else
        echo "AVISO: sin NOTA=; no sale nota en Slack (nadie se entera sin vigia)" >&2
      fi
      exit 0
    fi
  fi
  # el motivo del rechazo (hook del servidor, permisos, rama protegida) se enseña: antes se tiraba a /dev/null
  [ -z "$PUSHERR" ] || echo "git push dijo: $(printf %s "$PUSHERR" | tr -d '\015' | head -5)" >&2
  traer
  NUEVOS=$(git log --format='  %h %cd %s' --date=format:%H:%M "$VISTO..origin/$RAMA" || true)
  # Si entró algo de otra IA, se PARA: la norma es leerlo antes de publicar (no reaplicar a ciegas).
  if [ -n "$NUEVOS" ] && [ "${REAPLICAR_SIN_LEER:-0}" != 1 ]; then
    echo "NO publicado: alguien publicó antes. Lee esto y vuelve a lanzar el mismo comando:" >&2
    echo "$NUEVOS" >&2
    git checkout -q --detach "refs/remotes/origin/$RAMA"; exit 6
  fi
  echo "push fallido sin commits nuevos (intento $intento); reintento" >&2
  VISTO=$(git rev-parse "origin/$RAMA")
done
echo "NO publicado tras $MAX intentos" >&2; exit 5
