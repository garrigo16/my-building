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
  AUTOR=Sistema bash "$AQUI/responder-slack.sh" "$CH" "$HILO" "$F"; rm -f "$F"
}
COO_WEBHOOK_URL=${COO_WEBHOOK_URL:-${GROK_WEBHOOK_URL:-}}; COO_WEBHOOK_KEY=${COO_WEBHOOK_KEY:-${GROK_WEBHOOK_KEY:-}}
if [ -z "${COO_WEBHOOK_URL:-}" ] || [ -z "${COO_WEBHOOK_KEY:-}" ]; then a_humano "no hay webhook de Coo configurado"; exit 0; fi
if [ "$QUIEN" != "Humano" ] && ! bash "$AQUI/freno.sh" coo "${FRENO_HILO:-$HILO}" 2>/dev/null; then  # timbre: FRENO_HILO=- (hilo fijo compartido)
  echo "$(date -Is) FRENO: no llamo a Coo (hilo $HILO)" >> "$LOGF"; a_humano "freno anti ping-pong: límite de este hilo en la última hora"; exit 12
fi
BODY=$(mktemp); CC=$(umask 077; mktemp)
trap 'rm -f "$BODY" "$CC"' EXIT
# El destino corta el JSON hacia los 4 KiB: el cuerpo entero va por debajo de 3584 bytes (prueba aviso-coo-body.js).
# instruccion y personas, lo primero; formato y convenios, breves y propios de este aviso (formato-para-humano.txt
# entero no cabe: la pauta completa está en el repo) y sin repetir formato dentro de instruccion.
CH="$CH" HILO="$HILO" TS="$TS" QUIEN="$QUIEN" VARIAS="$VARIAS" OUT="$BODY" node -e '
  const e=process.env;
  const enlace=(e.SLACK_WS_URL||"https://ocaglobal-grupo.slack.com")+"/archives/"+e.CH+"/p"+e.TS.replace(".","")+"?thread_ts="+e.HILO+"&cid="+e.CH;
  const deIA = e.QUIEN !== "Humano";
  const instruccion = deIA
    ? `Te despierta ${e.QUIEN}, una IA, no Humano. Regla de Humano: entre IAs se contesta SIEMPRE por el canal git (un bloque con su nota), nunca en el hilo de Slack. Escribe en Slack solo si el mensaje es para Humano (una decisión que solo puede tomar él, un OK de escritura o un resultado final en 3 líneas).`
    : "Te escribe Humano: contéstale en este hilo de Slack." + (e.VARIAS ? " Os ha escrito a VARIOS (Claude y/o Cursor también) y quiere UNA sola respuesta: la das TÚ. Ahora, solo una línea: «Lo junto con Claude y Cursor y te traigo una sola respuesta» y [lo hace: Coo — juntar la respuesta]. Ellos te pasan su parte por el canal git (te despierta el timbre); entonces das la respuesta única." : "");
  const personas = "PROHIBIDO escribir a una persona (Slack, correo, Google Chat) desde tu app o bot, ni «de parte de Humano». Prepara el texto exacto y pide el OK con [te toca: ¿OK a enviar esto a X?]; sale siempre desde la cuenta de Humano (o se lo dejas listo para copiar).";
  const formato = "A Humano, escueto: 1.ª línea en negrita (*así*), el siguiente paso (su pregunta exacta o lo que harás tú y cuándo); luego como mucho 3 puntos de una línea; sin historia ni jerga (ni shas ni ids); máx. 5 líneas. ÚLTIMA línea, UNA etiqueta: [te toca: <pregunta exacta>] · [lo hace: Claude|Cursor|Coo — <qué>] (con OK, las dos) · [espera: <persona> — <qué>] · [espera: proceso <qué> — <cómo se mira>] · [hecho]. Antes de parar, lee todo el tema (hilos de 72 h, canal git, rama o PR). Si pides OK a algo que sale (correo, chat), pega debajo el texto completo. Canal git: «estado: lo hace|te toca|espera|hecho — …» en la cabecera; un tema y una pregunta por bloque. Pauta completa: herramientas/formato-para-humano.txt.";
  const convenios = "PR: «LÍNEA | TICKET | Descripción» (TRANSVERSAL, INDUSTRIA, CERTIFICACION, INTERNACIONAL, FORMACION, DTT); la abre Claude (abrir-pr.sh) con el OK de Humano. Cursor y tú sois SOLO LECTURA: el código lo escribe y lo sube Claude ([lo hace: Claude — …]). A Humano, UNA pregunta por asunto, en llano, con la opción recomendada y el cruce 3/3. Bloque que ya no vale: accion: correccion + responde-a: <id>, o «X queda retenido». Tareas de una IA: «Encargo a <IA>:».";
  const obj = { instruccion, personas, tipo: "slack", canal: e.CH, hilo: e.HILO, mensaje: e.TS, enlace, quien: e.QUIEN,
    responder_en: deIA ? "canal_git" : "slack", formato, convenios };
  // bloque: el texto del bloque del canal git que originó el aviso (COO_BLOQUE, lo pasan timbre.sh y canal-pendientes.js).
  // Solo si no es Humano y hay bloque de verdad; secretos tapados y recortado para que el cuerpo entero quede < 3584 bytes.
  let bl = deIA ? String(e.COO_BLOQUE || "").replace(/\r/g, "").trim() : "";
  if (bl) { try { bl = require(process.argv[1]).tapaSecretos(bl); } catch (x) {} }
  if (bl) {
    const TOPE = 3584, mide = (t) => Buffer.byteLength(JSON.stringify({ ...obj, bloque: t }));
    let cs = Array.from(bl);
    if (mide(bl) >= TOPE) {
      let lo = 0, hi = cs.length;   // el prefijo más largo (con «…») que cabe
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (mide(cs.slice(0, m).join("") + "…") < TOPE) lo = m; else hi = m - 1; }
      bl = lo ? cs.slice(0, lo).join("") + "…" : "";
    }
    if (bl) obj.bloque = bl;
  }
  require("fs").writeFileSync(e.OUT, JSON.stringify(obj));' "$AQUI/tapar-secretos.js"
printf 'header = "Authorization: Bearer %s"\n' "$COO_WEBHOOK_KEY" > "$CC"
CODE=$(curl -sS -m 30 -K "$CC" -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' --data-binary "@$BODY" "$COO_WEBHOOK_URL" 2>/dev/null || echo 000)
echo "$(date -Is) webhook de Coo (hilo $HILO, de $QUIEN): http $CODE" >> "$LOGF"
[ "${CODE:0:1}" = "2" ] || a_humano
