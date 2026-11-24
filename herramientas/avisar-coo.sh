#!/usr/bin/env bash
set -uo pipefail
_cfg="$(dirname "${BASH_SOURCE[0]}")/config.sh"; [ -f "$_cfg" ] && . "$_cfg"   # identidad: config.local.json (ver config.js)
CH=${1:?channel}; HILO=${2:?thread_ts}; QUIEN=${3:-una IA}; TS=${4:-$HILO}; VARIAS=${5:-}
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CFG="$HOME/.config/canal-slack.env"; set -a; . <(tr -d '\r' < "$CFG"); set +a
LOGF="$HOME/.canal-logs/avisar-coo.log"
# Interruptor de Cursor: la routine de Coo gasta la misma cuenta. Con herramientas/cursor-apagado no se llama al webhook:
# el encargo pasa a Claude, desacoplado porque quien avisa no espera.
if [ -f "$AQUI/cursor-apagado" ] && { [ "${CANAL_PRUEBAS:-0}" != 1 ] || [ "${CURSOR_APAGADO_PRUEBA:-0}" = 1 ]; }; then
  mkdir -p "$HOME/.canal-logs"; echo "$(date -Is) DESVIO a Claude (Coo apagado con Cursor): hilo $HILO, de $QUIEN" >> "$LOGF"
  F=$(mktemp --suffix=.json)
  CH="$CH" HILO="$HILO" TS="$TS" Q="$QUIEN" F="$F" node -e 'const e=process.env;const humano=e.Q==="Humano";require("fs").writeFileSync(e.F,JSON.stringify({text:"[Encargo para Coo que te pasa la oficina porque Coo está apagado con Cursor. Lo pide: "+e.Q+". Lee el hilo"+(/canal git/.test(e.Q)?" y el último bloque del canal git dirigido a Coo":"")+" y hazlo tú; no se lo pases a Coo, Grok ni Cursor.]",channel:e.CH,ts:e.TS,thread_ts:e.HILO,quien:humano?"Humano":"Coo"}))' || { rm -f "$F"; exit 12; }
  nohup bash "$AQUI/atender-slack.sh" "$F" >/dev/null 2>&1 &
  disown 2>/dev/null || true
  exit 0
fi
a_humano() {
  local F Q M; F=$(mktemp)
  Q=$(Q="$QUIEN" node -e 'let t=process.env.Q;try{t=require(process.argv[1]).llano(t)}catch(e){}process.stdout.write(t)' "$AQUI/llano.js" 2>/dev/null); Q=${Q:-$QUIEN}
  M=${1:-fallo del webhook}
  case "$M" in freno*) M="ya se le había avisado varias veces en la última hora";; esac
  printf '<@%s> %s le ha pedido algo a Coo en este hilo y no he podido despertarlo (%s). Cuando puedas, menciónalo tú.' \
    "${SLACK_HUMANO_ID:?}" "${Q^}" "$M" > "$F"
  bash "$AQUI/responder-slack.sh" "$CH" "$HILO" "$F"; rm -f "$F"
}
COO_WEBHOOK_URL=${COO_WEBHOOK_URL:-${GROK_WEBHOOK_URL:-}}; COO_WEBHOOK_KEY=${COO_WEBHOOK_KEY:-${GROK_WEBHOOK_KEY:-}}
if [ -z "${COO_WEBHOOK_URL:-}" ] || [ -z "${COO_WEBHOOK_KEY:-}" ]; then a_humano "no hay webhook de Coo configurado"; exit 0; fi
if [ "$QUIEN" != "Humano" ] && ! bash "$AQUI/freno.sh" coo "${FRENO_HILO:-$HILO}" 2>/dev/null; then  # timbre: FRENO_HILO=- (hilo fijo compartido)
  echo "$(date -Is) FRENO: no llamo a Coo (hilo $HILO)" >> "$LOGF"; a_humano "freno anti ping-pong: límite de este hilo en la última hora"; exit 12
fi
BODY=$(mktemp); CC=$(umask 077; mktemp)
trap 'rm -f "$BODY" "$CC"' EXIT
FORMATO_J=$(tr -d '\r' < "$AQUI/formato-para-humano.txt" 2>/dev/null)   # v146: la misma pauta para todas las IAs
CH="$CH" HILO="$HILO" TS="$TS" QUIEN="$QUIEN" VARIAS="$VARIAS" OUT="$BODY" FORMATO_J="$FORMATO_J" node -e '
  const e=process.env;
  const enlace=(e.SLACK_WS_URL||"https://ocaglobal-grupo.slack.com")+"/archives/"+e.CH+"/p"+e.TS.replace(".","")+"?thread_ts="+e.HILO+"&cid="+e.CH;
  const deIA = e.QUIEN !== "Humano";
  require("fs").writeFileSync(e.OUT, JSON.stringify({ tipo: "slack", canal: e.CH, hilo: e.HILO, mensaje: e.TS, enlace, quien: e.QUIEN,
    responder_en: deIA ? "canal_git" : "slack",
    convenios: "Títulos de PR de OCA: «LÍNEA | TICKET | Descripción» (p. ej. «INDUSTRIA | BDXN-401 | …», «TRANSVERSAL | PRJB-1296 | …»; líneas TRANSVERSAL, INDUSTRIA, CERTIFICACION, INTERNACIONAL, FORMACION, DTT). Para abrir una PR, pídeselo a Claude (abrir-pr.sh) con el OK de Humano. v374: Cursor y tú sois SOLO LECTURA (ni commits, ni ramas, ni PRs): el código lo escribe y lo sube CLAUDE. Si Humano pide «arreglarlo», encarga a Cursor el diff exacto y a Claude aplicarlo, subir la rama y abrir la PR ([lo hace: Claude — …]); nunca «Cursor implementa en una rama», que no puede. v398 (Humano: «me estáis pasando cosas muy técnicas, dije que me viniera filtrado»): a Humano, UNA pregunta por asunto, en lenguaje llano y con la opción recomendada, y solo cuando el cruce esté 3/3. Si un bloque ya no vale, dilo en la cabecera (accion: correccion, responde-a: ese id) o con «X queda retenido / sustituye a X»: la oficina lo quita de «Te toca». Las tareas para una IA van bajo «Encargo a <IA>:» (no son opciones de Humano). «te toca: la persona A — …» es para la persona A, no para Humano.",
    formato: e.FORMATO_J || "",
    personas: "PROHIBIDO escribir a una persona (Slack, correo, Google Chat) desde tu app o bot, ni «de parte de Humano». Prepara el texto exacto y pide el OK con [te toca: ¿OK a enviar esto a X?]; sale siempre desde la cuenta de Humano (o se lo dejas listo para copiar).",
    instruccion: (deIA
      ? `Te despierta ${e.QUIEN}, una IA, no Humano. Regla de Humano: entre IAs se contesta SIEMPRE por el canal git (un bloque con su nota), nunca en el hilo de Slack. Escribe en Slack solo si el mensaje es para Humano (una decisión que solo puede tomar él, un OK de escritura o un resultado final en 3 líneas).`
      : "Te escribe Humano: contéstale en este hilo de Slack." + (e.VARIAS ? " Os ha escrito a VARIOS (Claude y/o Cursor también) y quiere UNA sola respuesta: la das TÚ. Ahora, solo una línea: «Lo junto con Claude y Cursor y te traigo una sola respuesta» y [lo hace: Coo — juntar la respuesta]. Ellos te pasan su parte por el canal git (te despierta el timbre); entonces das la respuesta única." : "")) + (e.FORMATO_J ? "\n" + e.FORMATO_J : "") }));'
printf 'header = "Authorization: Bearer %s"\n' "$COO_WEBHOOK_KEY" > "$CC"
CODE=$(curl -sS -m 30 -K "$CC" -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "@$BODY" "$COO_WEBHOOK_URL" 2>/dev/null || echo 000)
echo "$(date -Is) webhook de Coo (hilo $HILO, de $QUIEN): http $CODE" >> "$LOGF"
[ "${CODE:0:1}" = "2" ] || a_humano
