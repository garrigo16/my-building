#!/usr/bin/env bash
set -euo pipefail
_cfg="$(dirname "${BASH_SOURCE[0]}")/config.sh"; [ -f "$_cfg" ] && . "$_cfg"   # identidad: config.local.json (ver config.js)
CANAL=${1:?canal}; NOTA=${2:?nota}; SHA=${3:?sha}; DESDE=${4:?desde}
case "$CANAL" in   # Cursor 484 (hueco 5): el worktree cambia con el canal
  principal) RAMA=${CANAL_RAMA:-canal/humano/claude-cursor}; FICH=${CANAL_FICHERO:-CANAL_CLAUDE_CURSOR.md}; WT=$HOME/wt-canal-claude ;;
  "${CANAL2_NOMBRE:-proyecto}")       RAMA=${CANAL2_RAMA:-canal/proyecto/compartido};  FICH=${CANAL2_FICHERO:-CANAL_PROYECTO.md};  WT=$HOME/wt-${CANAL2_NOMBRE:-proyecto}-claude ;;
  *) echo "canal desconocido: $CANAL" >&2; exit 2 ;;
esac
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO=${CANAL_REPO:-"$HOME/Documents/Oca Global Repository/oca-salesforce"}

# CLI: la versión más nueva que trae la app de escritorio (la ruta cambia con cada actualización).
CLI=${CLAUDE_CLI:-$(ls -d $HOME/AppData/Roaming/Claude/claude-code/*/*/claude.exe 2>/dev/null | sort -V | tail -1)}
[ -x "$CLI" ] || { echo "no encuentro el CLI de Claude Code" >&2; exit 13; }

# Auth sin interfaz: el CLI que trae la app de escritorio no comparte su sesión. Hace falta un token
# largo (`claude.exe setup-token`, una vez) guardado como CLAUDE_CODE_OAUTH_TOKEN en canal-slack.env.
# Solo se exporta esa variable: el resto de secretos los lee publicar-canal.sh por su cuenta.
CFG="$HOME/.config/canal-slack.env"
if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && [ -f "$CFG" ]; then
  CLAUDE_CODE_OAUTH_TOKEN=$(tr -d '\r' < "$CFG" | sed -n 's/^CLAUDE_CODE_OAUTH_TOKEN=//p' | tail -1 | tr -d "\"' ")
fi
gitbash() { local p; for p in "$HOME/AppData/Local/Programs/Git/bin/bash.exe" "$(cygpath -u "${PROGRAMFILES:-C:\\Program Files}")/Git/bin/bash.exe"; do
  [ -f "$p" ] && { cygpath -w "$p"; return; }; done; cygpath -w "$(command -v bash)"; }
export CLAUDE_CODE_GIT_BASH_PATH=${CLAUDE_CODE_GIT_BASH_PATH:-$(gitbash)}
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  export CLAUDE_CODE_OAUTH_TOKEN
elif [ "${CANAL_PRUEBAS:-0}" != 1 ] && ! timeout 30 "$CLI" auth status 2>/dev/null | grep -q '"loggedIn": *true'; then
  bash "$AQUI/avisar-humano.sh" "Hay que abrir un Claude para $CANAL ${SHA:0:10} y el CLI no tiene sesión: falta 'claude.exe auth login'."; exit 8
fi

if grep -qiE '^No coinciden:[[:space:]]*(nada|ninguno|-)?[[:space:].]*$' "$NOTA" && grep -qiE '^Tu OK:[[:space:]]*no hace falta' "$NOTA"; then
  echo "$(date -Is) nota de confirmación ($CANAL ${SHA:0:10}): no abro Claude" >> "$HOME/.canal-logs/freno.log"; exit 0
fi
bash "$AQUI/freno.sh" claude || { echo "$(date -Is) FRENO: no abro Claude para $CANAL ${SHA:0:10}" >> "$HOME/.canal-logs/freno.log"; exit 12; }

mkdir -p "$HOME/.canal-logs"
LOGF="$HOME/.canal-logs/claude-$(date +%Y%m%d-%H%M%S)-${SHA:0:10}.log"
NOTA_TXT=$(tr -d '\r' < "$NOTA")
PROMPTF=$(mktemp)
cat > "$PROMPTF" <<EOF
Eres Claude, uno de los coordinadores del canal "$CANAL" de OCA. Te ha abierto un recado del canal: no hay vigía, nadie te volverá a llamar para esto y nadie está mirando esta sesión.

Nota que lo ha disparado:
$NOTA_TXT
${CANAL_DESVIO_CURSOR:+
Este recado iba para Cursor o Grok, que están apagados: hazlo tú y no se lo pases a Cursor, Coo ni Grok (no pongas @cursor, «lo hace: Cursor», «lo hace: Coo» ni «Tercera lectura: sí»).
}
Qué hacer:
1. CLAUDE.md y el índice de la memoria (MEMORY.md) ya te llegan cargados al arrancar: NO los releas con herramientas (gasta cuota del curro). Abre solo las memorias concretas que necesites.
2. Canal: rama $RAMA, fichero $FICH, worktree $WT. Tu shell es la herramienta Bash (Git Bash). Haz UN fetch y lee solo el tramo nuevo: git log ${DESDE:0:10}..${SHA:0:10} y el diff de $FICH en ese tramo, más los anexos que esos bloques citen.
3. Haz lo que te piden, solo en lectura de git y del repo. Responde en el canal SIEMPRE con:
   LEIDO=<sha leído> NOTA=<fichero de nota> bash $AQUI/publicar-canal.sh $CANAL <bloque.md> "[skip ci] Canal: ..."
   Formato de la nota y del bloque: mira la cabecera de $AQUI/nota-slack.sh y los últimos bloques del canal.
   - Cabecera del bloque con su estado al final (punto 7 de $AQUI/formato-para-humano.txt): «| estado: lo hace: Cursor — <qué>», «| estado: te toca: <pregunta a Humano>» o «| estado: hecho». Título con la etiqueta del tema entre corchetes, la misma que el bloque al que contestas.
   - "para:" lleva las IAs a las que va (Cursor, Claude, Coo). Humano NO va por defecto. Con "Coo" en para:, a Coo lo despierta su routine.
   - Pon "@cursor" solo si Cursor tiene que hacer algo (se le lanza solo).
   - Pon "@humano" SOLO si es una decisión que únicamente puede tomar él y ya la habéis cruzado los tres (Coo, Cursor y tú) en el canal, o si es un OK de escritura. Con "@humano", "Tu OK:" es la pregunta en una línea. Si no, no le molestes: os lo resolvéis entre vosotros.
   - Si Cursor y tú no coincidís en algo importante, "Tercera lectura: sí".
   - Si no hay nada que responder (un HECHO sin pregunta), no publiques nada y termina.
4. Prohibido: tocar orgs (ni sf, ni powershell.exe, ni pwsh desde Bash), desplegar, validar, crear o aprobar PRs, hacer push a cualquier rama que no sea $RAMA, escribir secretos. Las acciones con efecto necesitan el OK de Humano: pídelo con "@humano". Si propones una PR, su título va con el formato de OCA «LÍNEA | TICKET | Descripción» (p. ej. «INDUSTRIA | BDXN-401 | …»).
5. Si la tarea es grande, reparte con subagentes (herramienta Agent): Haiku para lo mecánico y Sonnet para revisar. Nunca Opus en un subagente.
6. Al terminar, escribe en una línea qué has publicado (sha) o por qué no.
EOF

cd "$REPO"
export CANAL_SOY_CLAUDE_HEADLESS=1
# Desacoplado: el que lo lanza no espera. El prompt entra por stdin (las tildes no sobreviven al argv de Windows).
# Relevo de cuenta (relevo-claude.js): empresa (Team) por defecto; si agota la ventana de 5 h o el cupo semanal, UN relevo a la
# personal (Pro) con CLAUDE_CONFIG_DIR=~/.claude-personal y sin el token de empresa; si paran las dos, aviso y no se lanza.
nohup bash -c '
  REL="$3/relevo-claude.js"; CTA=empresa; HAY=0
  [ -f "$REL" ] && command -v node >/dev/null 2>&1 && HAY=1
  avisa() { [ -n "$1" ] && [ -f "$3/avisar-humano.sh" ] && bash "$3/avisar-humano.sh" "$1" >/dev/null 2>&1; return 0; }
  if [ "$HAY" = 1 ]; then
    D=$(node "$REL" decidir --lineas 2>/dev/null) || D=""
    CTA=$(printf "%s\n" "$D" | sed -n 1p | tr -d "\r"); CTA=${CTA:-empresa}; avisa "$(printf "%s\n" "$D" | sed -n 2p | tr -d "\r")" "" "$3"
  fi
  [ "$CTA" = parar ] && { rm -f "$1"; exit 0; }
  pasa_a_personal() { export CLAUDE_CONFIG_DIR="${USERPROFILE:-$HOME}/.claude-personal"; unset CLAUDE_CODE_OAUTH_TOKEN; }
  lanza() {
    "$CLI" -p --model claude-sonnet-5-5 --effort medium --permission-mode acceptEdits --strict-mcp-config \
         --tools "Bash,Read,Grep,Glob,Edit,Write,Agent" --disable-slash-commands \
         --allowedTools "Bash Read Grep Glob Edit Write Agent" \
         --disallowedTools "PowerShell" "Bash(powershell*)" "Bash(pwsh*)" "Bash(sf *)" "Bash(*powershell.exe*)" \
         --max-budget-usd 3 < "$1" > "$2" 2>&1
  }
  CLI=$0
  [ "$CTA" = personal ] && pasa_a_personal
  lanza "$1" "$2"
  if [ "$HAY" = 1 ]; then
    F=$(node "$REL" fallo "$2" "$CTA" --lineas 2>/dev/null) || F=""
    if [ "$(printf "%s\n" "$F" | sed -n 3p | tr -d "\r")" = cuota ]; then
      avisa "$(printf "%s\n" "$F" | sed -n 2p | tr -d "\r")" "" "$3"
      if [ "$CTA" = empresa ] && [ "$(printf "%s\n" "$F" | sed -n 1p | tr -d "\r")" = personal ]; then   # el unico relevo
        pasa_a_personal; lanza "$1" "${2%.log}-personal.log"
        F=$(node "$REL" fallo "${2%.log}-personal.log" personal --lineas 2>/dev/null) || F=""   # si tambien falla: aviso y no hay mas
        avisa "$(printf "%s\n" "$F" | sed -n 2p | tr -d "\r")" "" "$3"
      fi
    fi
  fi
  rm -f "$1"
' "$CLI" "$PROMPTF" "$LOGF" "$AQUI" >/dev/null 2>&1 &
disown
echo "CLAUDE lanzado ($CANAL ${SHA:0:10}); log: $LOGF"
