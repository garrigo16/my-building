#!/usr/bin/env bash
set -euo pipefail
_cfg="$(dirname "${BASH_SOURCE[0]}")/config.sh"; [ -f "$_cfg" ] && . "$_cfg"   # identidad: config.local.json (ver config.js)

CANAL=${1:?canal}; NOTA=${2:?nota}; SHA=${3:?sha remoto}; DESDE=${4:?sha desde}
case "$CANAL" in
  principal) RAMA=${CANAL_RAMA:-canal/humano/claude-cursor}; FICH=${CANAL_FICHERO:-CANAL_CLAUDE_CURSOR.md} ;;
  "${CANAL2_NOMBRE:-proyecto}")       RAMA=${CANAL2_RAMA:-canal/proyecto/compartido};  FICH=${CANAL2_FICHERO:-CANAL_PROYECTO.md} ;;
  *) echo "canal desconocido: $CANAL" >&2; exit 2 ;;
esac
[ -s "$NOTA" ] || { echo "nota vacia: $NOTA" >&2; exit 2; }
# Cursor 478 (hueco 1): la nota entra en el prompt, así que pasa el mismo filtro que la de Slack.
bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/validar-nota.sh" "$NOTA" || exit 2

# Interruptor de Cursor: con herramientas/cursor-apagado no se llama a la API de Cursor y el recado pasa a Claude.
# Se enciende creando ese fichero (vacío vale) y se apaga borrándolo. Es de cada equipo: no va en git.
AQUI_C="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$AQUI_C/cursor-apagado" ] && { [ "${CANAL_PRUEBAS:-0}" != 1 ] || [ "${CURSOR_APAGADO_PRUEBA:-0}" = 1 ]; }; then
  mkdir -p "$HOME/.canal-logs"; echo "$(date -Is) DESVIO canal $CANAL ${SHA:0:10} a Claude (Cursor apagado)" >> "$HOME/.canal-logs/cursor-arranques.log"
  # si la nota ya va para Claude, publicar-canal.sh o el vigía ya lo abren: no se abre otro
  if grep -qiE '^para:.*claude' "$NOTA"; then echo "Cursor apagado: la nota ya va a Claude"; exit 0; fi
  CANAL_DESVIO_CURSOR=1 exec bash "$AQUI_C/lanzar-claude.sh" "$CANAL" "$NOTA" "$SHA" "$DESDE"
fi

# Sin saldo de API: si en este canal Cursor ya falló con usage_limit_exceeded (y no ha arrancado después), no se le vuelve a
# llamar: se espera a que Humano lo lance a mano o vuelva el saldo (un SI en cursor-arranques.log lo desbloquea).
if AVISADO=$(node "$AQUI_C/cursor-sin-saldo.js" canal "$CANAL" 2>/dev/null); then
  mkdir -p "$HOME/.canal-logs"; echo "$(date -Is) ESPERA canal $CANAL ${SHA:0:10} sin saldo de API: ya avisado a las $AVISADO, no se relanza" >> "$HOME/.canal-logs/cursor-arranques.log"
  echo "CURSOR NO lanzado: sin saldo de API (avisado a las $AVISADO); se espera, no se relanza" >&2
  exit 10
fi

bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/freno.sh" cursor || {
  echo "$(date -Is) FRENO: no lanzo a Cursor para $CANAL ${SHA:0:10}" >> "$HOME/.canal-logs/freno.log"; exit 12; }

CFG="$HOME/.config/canal-slack.env"
if [ -z "${CURSOR_API_KEY:-}" ] && [ -f "$CFG" ]; then set -a; . <(tr -d '\r' < "$CFG"); set +a; fi   # sin CR: el Bloc de notas guarda CRLF
[ -n "${CURSOR_API_KEY:-}" ] || { echo "SIN CURSOR: no hay CURSOR_API_KEY ni en $CFG" >&2; exit 8; }

# Cursor 478 (hueco 3): el host es fijo. CURSOR_API_URL solo vale en pruebas (CANAL_PRUEBAS=1),
# para que una variable de entorno suelta no se lleve la key a otro sitio.
API=https://api.cursor.com/v1/agents
if [ "${CANAL_PRUEBAS:-0}" = 1 ] && [ -n "${CURSOR_API_URL:-}" ]; then API=$CURSOR_API_URL; fi
REPO=${CURSOR_REPO_URL:-${CANAL_REPO_URL:-https://bitbucket.org/oca-global/oca-salesforce}}

# Windows: un -e de node con tildes llega mal (code page). El JS va a un fichero y la nota se lee con fs.
JSF=$(mktemp --suffix=.js)
cat > "$JSF" <<'EOF_JS'
const fs = require("fs");

const e = process.env;
const text = [
  `Eres Cursor, coordinador del canal "${e.CANAL}" de OCA. Te despierta una nota de Claude: no hay vigía y nadie te volverá a llamar para este recado.`,
  ``,
  `Nota que la ha disparado:`,
  fs.readFileSync(e.NOTA_F,"utf8").split(String.fromCharCode(13)).join("").trimEnd(),
  ``,
  `Qué hacer:`,
  `1. Trabaja en la rama ${e.RAMA}, fichero ${e.FICH}. Haz UN único fetch y lee solo el tramo nuevo: git log ${e.DESDE.slice(0,10)}..${e.SHA.slice(0,10)} y el diff de ${e.FICH} en ese tramo, más los anexos que esos bloques citen.`,
  `2. Responde en ${e.FICH} con el protocolo del propio canal: añade tu bloque al final (append-only), con la cabecera <!-- para: ... --> y tu firma; el commit lleva [skip ci]; push a ${e.RAMA} y comprueba que local y remoto coinciden. Si otro ha publicado antes, rehaz el bloque encima.`,
  `2b. En la cabecera, al final, el estado: «| estado: lo hace: <IA> — <qué>» (el vigía despierta a esa IA), «| estado: te toca: <pregunta a Humano>» o «| estado: hecho». En el título, la etiqueta del tema entre corchetes, la misma que el bloque al que contestas (p. ej. [FACTURACION · ABC-123]).`,
  `3. Prohibido: secretos o valores de credenciales, desplegar, validar o escribir en cualquier org, abrir PRs, tocar otras ramas. El OK final es de Humano.`,
  `3b. Si te encargan IMPLEMENTAR código (un fix, una rama nueva): no puedes hacer commits fuera de ${e.RAMA}, así que no lo dejes en «propuesta». Escribe en tu bloque el cambio EXACTO (diff unificado o métodos completos, con ruta de cada fichero, y los tests) y cierra con «| estado: lo hace: Claude — aplicar el diff de Cursor en <rama nueva> y abrir la PR». Claude lo aplica y abre la PR con el OK de Humano.`,
  `4. Si no puedes leer la rama o no tienes acceso al repo, no inventes nada: dilo en tu respuesta final y termina.`,
  `5. Hablad entre vosotros (Claude, Cursor, Grok). A Humano solo se le molesta cuando hace falta una decisión o un OK suyo.`,
  `5b. Si propones el título de una PR: formato de OCA «LÍNEA | TICKET | Descripción» (p. ej. «INDUSTRIA | BDXN-401 | …», «TRANSVERSAL | PRJB-1296 | …»; líneas TRANSVERSAL, INDUSTRIA, CERTIFICACION, INTERNACIONAL, FORMACION, DTT). Las PRs las abre Claude con abrir-pr.sh.`,
  `5c. A Slack solo llega la NOTA del punto 6 (máx. 8 líneas; un script la valida): lo técnico (el bloque, tablas, anexos, cabecera <!-- para: -->) va SOLO en ${e.FICH}. No lo repitas en la nota.`,
  `6. Termina SIEMPRE tu respuesta final con la nota corta, así, sin nada detrás (un script la publica en Slack y abre a quien toque):`,
  `NOTA:`,
  `para: <Claude | Grok | ...: a quién va; Humano no por defecto>`,
  `@humano   <- esta línea SOLO si necesitas una decisión u OK de Humano`,
  `Coinciden: <una línea>`,
  `No coinciden: <nada, o el punto>`,
  `Tu OK: <qué hace falta, o no hace falta>`,
  `Tercera lectura: <no | sí si Claude y tú no coincidís en algo importante>`
].join("\n");
process.stdout.write(JSON.stringify({
  prompt: { text },
  name: `canal ${e.CANAL} ${e.SHA.slice(0,10)}`,
  repos: [{ url: e.REPO, startingRef: e.RAMA }],
  workOnCurrentBranch: true,
  autoCreatePR: false,
  // El modelo se cambia con CURSOR_MODELO.
  model: { id: e.CURSOR_MODELO || "composer-2.5" }
}))
EOF_JS
BODYF=$(mktemp); CANAL="$CANAL" RAMA="$RAMA" FICH="$FICH" SHA="$SHA" DESDE="$DESDE" REPO="$REPO" NOTA_F="$NOTA" CURSOR_MODELO="${CURSOR_MODELO:-}" node "$JSF" > "$BODYF"   # a fichero: un argv de Windows rompe las tildes
rm -f "$JSF"

# Cursor 478 (hueco 2): la key va en un fichero de config de curl (600), no en el argv.
CURLCFG=$(umask 077; mktemp); printf 'user = "%s:"\n' "$CURSOR_API_KEY" > "$CURLCFG"
# v148: error de curl aparte (iba pegado al código http) y hasta 3 intentos si la API no responde o da 5xx
CERR=$(mktemp)
RUN0=""; REUSO=$(CURSOR_API_KEY="$CURSOR_API_KEY" CURSOR_REUSO_H=2 node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cursor-agente.js" reusa "canal:$CANAL" "$BODYF" 2>/dev/null) || REUSO=""
if [ -n "$REUSO" ]; then
  RUN0=${REUSO#*$'\t'}; CODE=200; JSON="{\"agent\":{\"id\":\"${REUSO%%$'\t'*}\"}}"; echo "Cursor: sigo con el agente ${REUSO%%$'\t'*} (follow-up, sin clonar)"
fi
[ -z "$REUSO" ] && for ESPERA in 20 60 0; do
  RESP=$(curl -sS -m 30 -K "$CURLCFG" -w '\n%{http_code}' -H 'Content-Type: application/json' \
         --data-binary "@$BODYF" "$API" 2>"$CERR" || true)
  CODE=${RESP##*$'\n'}; JSON=${RESP%$'\n'*}; [ -s "$CERR" ] && JSON="$JSON $(tr '\n' ' ' < "$CERR")"
  case "$CODE" in 5*|000|'') [ "$ESPERA" -gt 0 ] && { echo "API de Cursor http ${CODE:-?}: reintento en $ESPERA s" >&2; sleep "$ESPERA"; continue; } ;; esac
  break
done
rm -f "$CURLCFG" "$CERR"
rm -f "$BODYF"
mkdir -p "$HOME/.canal-logs"
if [ "${CODE:0:1}" = "2" ]; then echo "$(date -Is) SI canal $CANAL ${SHA:0:10}" >> "$HOME/.canal-logs/cursor-arranques.log"
else
  # http 400 con error.code usage_limit_exceeded = sin saldo de API: se apunta así para no volver a lanzarlo (cursor-sin-saldo.js)
  SIN_SALDO=""; [ "${CODE:-}" = 400 ] && SIN_SALDO=$(JSON="$JSON" node -e 'const s=process.env.JSON;let c="";try{const j=JSON.parse(s);c=(j.error&&j.error.code)||j.code||""}catch(x){const m=s.match(/"code"\s*:\s*"([^"]+)"/);c=m?m[1]:""}process.stdout.write(c==="usage_limit_exceeded"?"1":"")')
  echo "$(date -Is) NO canal $CANAL ${SHA:0:10} http ${CODE:-?}${SIN_SALDO:+ sin saldo de API (usage_limit_exceeded)} $(printf '%s' "$JSON" | tr -d '\n' | cut -c1-160)" >> "$HOME/.canal-logs/cursor-arranques.log"; fi
if [ "${CODE:0:1}" = "2" ]; then
  INFO=$(JSON="$JSON" node -e 'try{const j=JSON.parse(process.env.JSON);console.log((j.agent&&j.agent.id||"?")+" "+(j.agent&&j.agent.url||""))}catch(x){console.log("? (respuesta no JSON)")}')
  echo "CURSOR lanzado ($CANAL ${SHA:0:10}): $INFO"
  # Aviso de vuelta sin vigía: un proceso sin modelo espera a ESTE agente y se cierra solo.
  AID=${INFO%% *}
  if [ "$AID" != "?" ]; then
    mkdir -p "$HOME/.canal-logs"
    node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cursor-agente.js" apunta "canal:$CANAL" "$AID" 2>/dev/null || true   # v392
    [ -z "$RUN0" ] && RUN0=$(JSON="$JSON" node -e 'try{const j=JSON.parse(process.env.JSON);process.stdout.write((j.run&&j.run.id)||"")}catch(x){}')
    nohup bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/esperar-cursor.sh" "$CANAL" "$AID" "$SHA" "$RUN0" \
      > "$HOME/.canal-logs/esperar-$AID.log" 2>&1 & disown
    echo "  esperando su respuesta en segundo plano (log ~/.canal-logs/esperar-$AID.log)"
  fi
else
  # Sin imprimir la key: solo codigo y un trozo del cuerpo.
  echo "CURSOR NO lanzado: http ${CODE:-?} $(printf '%s' "$JSON" | tr -d '\n' | cut -c1-200)" >&2
  echo "  reintento: lanzar-cursor.sh $CANAL $NOTA $SHA $DESDE" >&2
  exit 10
fi
