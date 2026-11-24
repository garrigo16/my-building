#!/usr/bin/env bash
set -uo pipefail
CANAL=${1:?canal}; NOTA=${2:?nota}; SHA=${3:?sha}
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="$HOME/.config/canal-slack.env"; set -a; . <(tr -d '\r' < "$CFG"); set +a
CH=${SLACK_CANAL_ID:-CCANAL00001}
L="$HOME/.canal-logs"; mkdir -p "$L"; TSF="$L/timbre-hilo.txt"
NT=$(tr -d '\r' < "$NOTA")
PARA=$(printf '%s\n' "$NT" | sed -n 's/^para:[[:space:]]*//p' | head -1)
OKJ=$(printf '%s\n' "$NT" | sed -n 's/^Tu OK:[[:space:]]*//p' | head -1)
B=$(mktemp); CCFG=$(umask 077; mktemp); trap 'rm -f "$CCFG" "$B"' EXIT
printf 'header = "Authorization: Bearer %s"\n' "$SLACK_BOT_TOKEN" > "$CCFG"
# Hilo fijo: se crea la primera vez y su ts se guarda en timbre-hilo.txt.
if [ ! -s "$TSF" ]; then
  CH="$CH" node -e 'process.stdout.write(JSON.stringify({channel:process.env.CH,text:"🔔 *Timbre del canal git.* Aquí solo hay avisos de una línea para despertar a una IA. Lo técnico está en el canal git; a Humano solo se le menciona cuando hay una decisión de verdad."}))' > "$B"
  curl -sS -m 20 -K "$CCFG" -H 'Content-Type: application/json; charset=utf-8' --data-binary "@$B" https://slack.com/api/chat.postMessage \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);if(j.ok)process.stdout.write(j.ts)}catch(e){}})' > "$TSF"
  [ -s "$TSF" ] || { echo "timbre: no he podido crear el hilo fijo" >&2; rm -f "$TSF"; exit 9; }
fi
HILO=$(cat "$TSF")
# Nombres en texto plano, sin mención real: así la escucha no lanza a nadie dos veces (ya lo hace la nota).
LINEA="🔔 para ${PARA:-?} · bloque en el canal ${CANAL} (sha ${SHA:0:10})"
if printf '%s\n' "$NT" | grep -qiE '^@humano([^a-z0-9_]|$)' && [ "${LLEVAR_A_SLACK:-}" != "1" ]; then
  OKJL=$(OKJ="${OKJ:-}" node -e 'let t=process.env.OKJ;try{t=require(process.argv[1]).llano(t)}catch(e){}process.stdout.write(t)' "$AQUI/llano.js" 2>/dev/null)
  LINEA="<@${SLACK_HUMANO_ID}> decisión tuya: ${OKJL:-mira el bloque}"$'\n'"_${LINEA}_"
fi
F=$(mktemp); printf '%s' "$LINEA" > "$F"
bash "$AQUI/responder-slack.sh" "$CH" "$HILO" "$F" >/dev/null; RC=$?; rm -f "$F"
echo "$(date -Is) timbre ($CANAL ${SHA:0:10}) para: ${PARA:-?} rc=$RC" >> "$L/timbre.log"
# Coo no tiene lanzador propio: si el bloque es para Coo, se le despierta por su routine con este hilo.
if printf '%s' "$PARA" | grep -qi 'coo'; then
  FRENO_HILO=- bash "$AQUI/avisar-coo.sh" "$CH" "$HILO" "el canal git ($CANAL, sha ${SHA:0:10})" >/dev/null 2>&1 &
fi
exit $RC
