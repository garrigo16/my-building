#!/usr/bin/env bash
# esperar-cursor.sh - aviso de VUELTA de un recado de Cursor, sin vigía y sin modelo.
# Lo arranca lanzar-cursor.sh, desacoplado, para UN agente concreto. Pregunta a la API de Cursor por
# ESE agente cada 30 s; cuando termina:
#   - toma la nota que Cursor deja al final de su respuesta (líneas tras "NOTA:"),
#   - la publica en Slack (nota-slack.sh) con Detalle/Desde del canal,
#   - si va "para: Claude", abre un Claude nuevo (lanzar-claude.sh);
#   - si dice "Tercera lectura: sí", lanza a Grok (lanzar-grok.sh);
#   - si Cursor falla, caduca o no deja nota, avisa a Humano (@humano).
# Se cierra solo: al terminar el agente o a los 60 minutos. Log en ~/.canal-logs/.
#
# Uso: esperar-cursor.sh <principal|segundo-canal> <agentId> <sha-publicado>
set -uo pipefail
_cfg="$(dirname "${BASH_SOURCE[0]}")/config.sh"; [ -f "$_cfg" ] && . "$_cfg"   # identidad: config.local.json (ver config.js)
CANAL=${1:?canal}; ID=${2:?agentId}; DESDE=${3:?sha publicado}; RUN0=${4:-}   # v392: el run concreto (follow-up de un agente reutilizado)
case "$CANAL" in
  principal) WT=$HOME/wt-canal-claude; RAMA=${CANAL_RAMA:-canal/humano/claude-cursor} ;;
  "${CANAL2_NOMBRE:-proyecto}")       WT=$HOME/wt-${CANAL2_NOMBRE:-proyecto}-claude;   RAMA=${CANAL2_RAMA:-canal/proyecto/compartido} ;;
  *) echo "canal desconocido: $CANAL" >&2; exit 2 ;;
esac
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="$HOME/.config/canal-slack.env"; set -a; . <(tr -d '\r' < "$CFG"); set +a   # sin CR: el Bloc de notas guarda CRLF
API=https://api.cursor.com/v1/agents
if [ "${CANAL_PRUEBAS:-0}" = 1 ] && [ -n "${CURSOR_API_URL:-}" ]; then API=$CURSOR_API_URL; fi
CURLCFG=$(umask 077; mktemp); printf 'user = "%s:"\n' "$CURSOR_API_KEY" > "$CURLCFG"
trap 'rm -f "$CURLCFG"' EXIT
FIN=$(( $(date +%s) + ${ESPERA_MAX_S:-3600} ))

RUNJ=$(mktemp); RESF=$(mktemp)
trap 'rm -f "$CURLCFG" "$RUNJ" "$RESF"' EXIT

# Cursor 484 (hueco 1): el listado de runs NO trae el texto. Del listado sale el estado y el id del
# run más nuevo; el texto (result) se pide a GET /runs/{runId}. Todo va por fichero (hueco 2: un
# result largo no cabe en una variable de entorno de Windows y se perdía la NOTA final).
estado() {  # imprime: STATUS<TAB>runId
  curl -sS -m 20 -K "$CURLCFG" "$API/$ID/runs${RUN0:+/$RUN0}" 2>/dev/null | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);
      const r=j.run||(j.items||j.runs||j.data||[])[0]||j;
      process.stdout.write((r.status||"?")+"\t"+(r.id||""));}catch(x){process.stdout.write("?\t")}});'
}

while :; do
  IFS=$'\t' read -r ST RUN < <(estado)
  case "$ST" in
    FINISHED) break ;;
    ERROR|CANCELLED|EXPIRED)
      bash "$AQUI/avisar-humano.sh" "El agente de Cursor $ID ($CANAL, recado ${DESDE:0:10}) ha terminado en $ST."; exit 0 ;;
  esac
  if [ "$(date +%s)" -ge "$FIN" ]; then
    bash "$AQUI/avisar-humano.sh" "El agente de Cursor $ID ($CANAL, recado ${DESDE:0:10}) lleva más de 60 min sin terminar (estado $ST)."; exit 0
  fi
  sleep "${ESPERA_PASO_S:-8}"   # v392: cada 8 s (antes 30)
done

# El texto final, con un par de reintentos por si el run acaba de cerrarse.
for i in 1 2 3; do
  [ -n "$RUN" ] && curl -sS -m 30 -K "$CURLCFG" "$API/$ID/runs/$RUN" -o "$RUNJ" 2>/dev/null || true
  RUNJ="$RUNJ" RESF="$RESF" node -e '
    const fs=require("fs");let r="";try{const j=JSON.parse(fs.readFileSync(process.env.RUNJ,"utf8"));r=(j.run||j).result||"";}catch(x){}
    fs.writeFileSync(process.env.RESF, typeof r==="string"?r:JSON.stringify(r));'
  grep -q 'NOTA:' "$RESF" && break
  sleep "${ESPERA_PASO_S:-10}"
done

for i in 1 2 3; do
  timeout 90 git -C "$WT" -c gc.auto=0 fetch -q origin "+refs/heads/$RAMA:refs/remotes/origin/$RAMA" && break
  sleep 10
done
SHA=$(git -C "$WT" rev-parse "origin/$RAMA")
DESDE=$(git -C "$WT" rev-parse "$DESDE" 2>/dev/null || echo "$DESDE")   # sha completo para comparar
NOTAF=$(mktemp)
# La nota de Cursor: las líneas tras "NOTA:" al final de su respuesta.
RESF="$RESF" node -e '
  const t=require("fs").readFileSync(process.env.RESF,"utf8");
  const i=t.lastIndexOf("NOTA:"); if(i<0) process.exit(0);
  const l=t.slice(i+5).split("\n").map(x=>x.replace(/^[\s>*`-]+|[`\s]+$/g,"")).filter(Boolean)
    .filter(x=>/^(para:|@cursor|@humano|@claude|Coinciden:|No coinciden:|Tu OK:|Tercera lectura:)/i.test(x)).slice(0,8);
  process.stdout.write(l.join("\n")+"\n");' > "$NOTAF"

if [ "$SHA" = "$DESDE" ]; then
  bash "$AQUI/avisar-humano.sh" "Cursor ($ID) ha terminado sin publicar nada en el canal $CANAL tras ${DESDE:0:10}."
elif ! bash "$AQUI/validar-nota.sh" "$NOTAF" 2>/dev/null; then
  # Sin nota válida: se avisa entre IAs igualmente para que Claude lo lea.
  printf 'para: Claude\nCoinciden: Cursor ha respondido en el canal (sin nota propia)\nNo coinciden: ver su bloque\nTu OK: no hace falta\nTercera lectura: no\n' > "$NOTAF"
  bash "$AQUI/nota-slack.sh" "$CANAL" "$NOTAF" "$SHA" "$DESDE" || true
  bash "$AQUI/lanzar-claude.sh" "$CANAL" "$NOTAF" "$SHA" "$DESDE" || true
else
  bash "$AQUI/nota-slack.sh" "$CANAL" "$NOTAF" "$SHA" "$DESDE" || true
  if grep -qiE '^para:.*claude' "$NOTAF"; then bash "$AQUI/lanzar-claude.sh" "$CANAL" "$NOTAF" "$SHA" "$DESDE" || true; fi
  if grep -qiE '^Tercera lectura:[[:space:]]*s[ií]' "$NOTAF"; then
    # Hueco 4: si Grok no arranca, que no se pierda en silencio (sin webhook ya avisa lanzar-grok.sh).
    bash "$AQUI/lanzar-grok.sh" "$CANAL" "$NOTAF" "$SHA" "$DESDE"; RG=$?
    [ $RG -eq 0 ] || [ $RG -eq 8 ] || bash "$AQUI/avisar-humano.sh" "No he podido lanzar la tercera lectura de Grok ($CANAL ${SHA:0:10}), código $RG."
  fi
fi
rm -f "$NOTAF"
