#!/usr/bin/env bash
set -euo pipefail
_cfg="$(dirname "${BASH_SOURCE[0]}")/config.sh"; [ -f "$_cfg" ] && . "$_cfg"   # identidad: config.local.json (ver config.js)
CANAL=${1:?canal}; NOTA=${2:?nota}; SHA=${3:?sha}; DESDE=${4:?desde}
case "$CANAL" in
  principal) RAMA=${CANAL_RAMA:-canal/humano/claude-cursor}; FICH=${CANAL_FICHERO:-CANAL_CLAUDE_CURSOR.md}; WT=$HOME/wt-canal-claude ;;
  "${CANAL2_NOMBRE:-proyecto}") RAMA=${CANAL2_RAMA:-canal/proyecto/compartido}; FICH=${CANAL2_FICHERO:-CANAL_PROYECTO.md}; WT=$HOME/wt-${CANAL2_NOMBRE:-proyecto}-claude ;;
  *) echo "canal desconocido: $CANAL" >&2; exit 2 ;;
esac
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CLI=${CODEX_CLI:-$(command -v codex 2>/dev/null || true)}
[ -n "$CLI" ] && [ -e "$CLI" ] || { echo "no encuentro el CLI de Codex (instálalo o pon CODEX_CLI)" >&2; exit 13; }

# Una nota que solo confirma no abre un Codex (sería un acuse de cortesía). Y si salta el freno, se apunta, sin molestar.
mkdir -p "$HOME/.canal-logs"
if grep -qiE '^No coinciden:[[:space:]]*(nada|ninguno|-)?[[:space:].]*$' "$NOTA" && grep -qiE '^Tu OK:[[:space:]]*no hace falta' "$NOTA"; then
  echo "$(date -Is) nota de confirmación ($CANAL ${SHA:0:10}): no abro Codex" >> "$HOME/.canal-logs/freno.log"; exit 0
fi
bash "$AQUI/freno.sh" codex || { echo "$(date -Is) FRENO: no abro Codex para $CANAL ${SHA:0:10}" >> "$HOME/.canal-logs/freno.log"; exit 12; }

LOGF="$HOME/.canal-logs/codex-$(date +%Y%m%d-%H%M%S)-${SHA:0:10}.log"
NOTA_TXT=$(tr -d '\r' < "$NOTA")
PROMPTF=$(mktemp)
cat > "$PROMPTF" <<EOF
Eres Codex, una de las IAs del canal "$CANAL". Te ha abierto un recado del canal git: nadie te volverá a llamar para esto y nadie está mirando esta sesión. «Humano» es como el sistema llama a la persona para la que trabajas; se llama ${EDIFICIO_NOMBRE:-Humano}.

Nota que lo ha disparado:
$NOTA_TXT

Qué hacer:
1. Canal: rama $RAMA, fichero $FICH, worktree $WT (estás en él). Haz UN fetch y lee solo el tramo nuevo: git log ${DESDE:0:10}..${SHA:0:10} y el diff de $FICH en ese tramo, más los anexos que esos bloques citen.
2. Haz lo que te piden, solo en lectura de git y del repo. Responde en el canal SIEMPRE con:
   LEIDO=<sha leído> NOTA=<fichero de nota> bash $AQUI/publicar-canal.sh $CANAL <bloque.md> "[skip ci] Canal: ..."
   Formato de la nota y del bloque: mira la cabecera de $AQUI/nota-slack.sh y los últimos bloques del canal.
   - Cabecera del bloque con su estado al final (punto 7 de $AQUI/formato-para-humano.txt): «| estado: lo hace: Claude — <qué>», «| estado: te toca: <pregunta a Humano>» o «| estado: hecho». Título con la etiqueta del tema entre corchetes, la misma que el bloque al que contestas. Tu id de bloque empieza por «Codex».
   - "para:" lleva las IAs a las que va (Claude, Cursor, Coo). Humano NO va por defecto.
   - Pon "@humano" SOLO si es una decisión que únicamente puede tomar él y ya la habéis cruzado en el canal, o si es un OK de escritura. Si no, no le molestes.
   - Si no hay nada que responder (un HECHO sin pregunta), no publiques nada y termina.
3. Prohibido: tocar orgs, desplegar, validar, crear o aprobar PRs, hacer push a cualquier rama que no sea $RAMA, escribir secretos, escribir a personas. Las acciones con efecto necesitan el OK de Humano: pídelo con "@humano".
4. Al terminar, escribe en una línea qué has publicado (sha) o por qué no.
EOF

cd "$WT" 2>/dev/null || { echo "no existe el worktree $WT (SETUP.md, paso 4)" >&2; rm -f "$PROMPTF"; exit 2; }
export CANAL_SOY_CODEX_HEADLESS=1
MODELO=${CODEX_MODELO:-}
nohup bash -c '
  cli=$1; prompt=$2; log=$3; modelo=$4; shift 4
  if [ -n "${CODEX_ARGS:-}" ]; then
    # shellcheck disable=SC2086
    "$cli" exec $CODEX_ARGS - < "$prompt" > "$log" 2>&1
  else
    "$cli" exec --skip-git-repo-check --sandbox workspace-write -c sandbox_workspace_write.network_access=true ${modelo:+--model "$modelo"} - < "$prompt" > "$log" 2>&1
  fi
  rm -f "$prompt"
' _ "$CLI" "$PROMPTF" "$LOGF" "$MODELO" >/dev/null 2>&1 &
disown
echo "CODEX lanzado ($CANAL ${SHA:0:10}); log: $LOGF"
