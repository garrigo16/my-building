#!/usr/bin/env bash
set -uo pipefail
_cfg="$(dirname "${BASH_SOURCE[0]}")/config.sh"; [ -f "$_cfg" ] && . "$_cfg"   # identidad: config.local.json (ver config.js)
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SECO=0; YA=0; [ "${1:-}" = "--seco" ] && SECO=1; [ "${1:-}" = "--ya" ] && YA=1
L="$HOME/.canal-logs"; E="${VIGIA_CANAL_ESTADO:-$L}"; mkdir -p "$L" "$E"
LOG="$L/vigia-canal.log"; VISTOS="$E/vigia-canal-vistos.txt"; SHAF="$E/vigia-canal-sha.txt"
log(){ if [ $SECO = 1 ]; then echo "$*"; else echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOG"; fi; }
[ $SECO = 0 ] && date '+%Y-%m-%dT%H:%M:%S' > "$L/vigia-canal.ultimo"   # latido: la tarea está viva
# v216: la oficina de ESTE equipo contesta (a cualquier hora, con o sin turno); si no, se levanta (vigila-oficina.js)
[ $SECO = 0 ] && timeout 90 node "$AQUI/vigila-oficina.js" >/dev/null 2>&1

# 1) horario (hora local del equipo)
D=$(date +%u); H=$((10#$(date +%H)))
if [ $SECO = 0 ] && [ $YA = 0 ] && { [ "$D" -gt 5 ] || [ "$H" -lt 8 ] || [ "$H" -ge 20 ]; }; then exit 0; fi

# 2) turno: solo vigila el equipo que atiende Slack (si no, los dos abrirían un Claude por el mismo bloque)
EQF="$HOME/.config/oficina-equipo.txt"
if [ $SECO = 0 ] && [ -s "$EQF" ]; then
  EQ=$(tr -d '\r\n ' < "$EQF")
  # el Edificio no es repo git: el turno se lee (solo ls-remote, lectura) desde CANAL_REPO (config.local.json canalGit.repoLocal)
  TREPO=${CANAL_REPO:-"$AQUI/.."}
  T=$(timeout 30 git -C "$TREPO" ls-remote origin 'refs/tags/turno-*' 2>/dev/null | sed -n 's#.*refs/tags/turno-\([A-Za-z0-9_-]*\).*#\1#p' | head -1)
  if [ -z "$T" ]; then log "no puedo leer el turno (¿sin red?): esta pasada no miro"; exit 0; fi
  if [ "$T" != "$EQ" ]; then
    WTX="$HOME/wt-canal-claude"; RPX=${CANAL_RAMA:-canal/humano/claude-cursor}; RKX=${CANAL2_RAMA:-canal/proyecto/compartido}
    if ( cd "$WTX" 2>/dev/null && timeout 90 git fetch -q origin "+refs/heads/$RPX:refs/remotes/origin/$RPX" "+refs/heads/$RKX:refs/remotes/origin/$RKX" 2>/dev/null ); then
      git -C "$WTX" rev-parse "refs/remotes/origin/$RPX" > "$E/vigia-principal-sha.txt" 2>/dev/null || rm -f "$E/vigia-principal-sha.txt"
      if [ -s "$VISTOS" ]; then
        { cat "$VISTOS"; git -C "$WTX" show "refs/remotes/origin/$RKX:CANAL_PROYECTO.md" 2>/dev/null | tr -d '\r' | awk -F'|' '/^<!-- para:/ {
            for (i=1; i<=NF; i++) { f=$i; sub(/^<!-- */,"",f); sub(/ *-->.*$/,"",f); gsub(/^ +| +$/,"",f); if (f ~ /^id:/) { id=substr(f,4); gsub(/^ +| +$/,"",id); if (id != "") print id } } }'; } \
          | sort -u > "$VISTOS.n" && mv "$VISTOS.n" "$VISTOS"
        git -C "$WTX" rev-parse "refs/remotes/origin/$RKX" > "$SHAF" 2>/dev/null || true
      fi
    else rm -f "$E/vigia-principal-sha.txt"; fi
    exit 0
  fi
fi

# 3) cerrojo: si una pasada se alarga, la siguiente no se pisa con ella (uno colgado de más de 30 min se quita)
CER="$L/vigia-canal.cerrojo"
if ! mkdir "$CER" 2>/dev/null; then
  if [ -n "$(find "$CER" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then rmdir "$CER" 2>/dev/null; mkdir "$CER" 2>/dev/null || exit 0; else exit 0; fi
fi
trap 'rmdir "$CER" 2>/dev/null' EXIT

vigila_principal(){
  local WTP="$HOME/wt-canal-claude" RP=${CANAL_RAMA:-canal/humano/claude-cursor} FP=${CANAL_FICHERO:-CANAL_CLAUDE_CURSOR.md}
  local REFP=refs/remotes/origin/$RP SP="$E/vigia-principal-sha.txt"
  ( cd "$WTP" 2>/dev/null && timeout 90 git fetch -q origin "+refs/heads/$RP:$REFP" 2>/dev/null ) || { log "principal: fetch falló"; return 0; }
  local SHAP; SHAP=$(git -C "$WTP" rev-parse "$REFP" 2>/dev/null) || return 0
  local LIM; LIM=$(git -C "$WTP" rev-list -1 --before="3 hours ago" "$REFP" 2>/dev/null)
  local BASE; BASE=$(cat "$SP" 2>/dev/null); git -C "$WTP" cat-file -e "${BASE:-x}^{commit}" 2>/dev/null || BASE=""
  # v206: cuánto hace de la última pasada (la noche, el fin de semana): lo escrito desde entonces cuenta aunque pasen de 3 h
  local BMIN=-1; [ -n "$BASE" ] && BMIN=$(( ( $(date +%s) - $(stat -c %Y "$SP" 2>/dev/null || date +%s) ) / 60 ))
  [ -n "$BASE" ] || BASE=${LIM:-$SHAP}; [ -n "$LIM" ] || LIM=$BASE
  local D; D=$(mktemp -d)
  git -C "$WTP" show "$SHAP:$FP" > "$D/tip" 2>/dev/null && git -C "$WTP" show "$BASE:$FP" > "$D/base" 2>/dev/null \
    && git -C "$WTP" show "$LIM:$FP" > "$D/lim" 2>/dev/null || { log "principal: no puedo leer el canal"; rm -rf "$D"; return 0; }
  local ARGS=(--canal principal --tip "$D/tip" --base "$D/base" --lim "$D/lim" --sha "$SHAP" --desde "$BASE" --estado "$E" --base-min "$BMIN")
  [ $SECO = 1 ] && ARGS+=(--seco)
  local OUTP; OUTP=$(timeout 300 node "$AQUI/canal-pendientes.js" "${ARGS[@]}" 2>&1); local RCP=$?
  [ -n "$OUTP" ] && printf '%s\n' "$OUTP" | while IFS= read -r l; do log "principal: $l"; done
  [ $RCP -ne 0 ] && log "principal: canal-pendientes.js rc=$RCP"
  [ $SECO = 0 ] && [ $RCP -eq 0 ] && echo "$SHAP" > "$SP"
  rm -rf "$D"
}
vigila_principal

# 4) leer el canal
WT="$HOME/wt-canal-claude"; RAMA=${CANAL2_RAMA:-canal/proyecto/compartido}; REF=refs/remotes/origin/$RAMA; FICH=${CANAL2_FICHERO:-CANAL_PROYECTO.md}
[ "$RAMA" = "-" ] && exit 0   # la config no tiene segundo canal: con el principal basta
cd "$WT" 2>/dev/null || { log "ERROR: no existe $WT"; exit 2; }
if ! timeout 90 git fetch -q origin "$RAMA" 2>/dev/null; then log "ERROR: fetch de $RAMA falló"; exit 3; fi
SHA=$(git rev-parse "$REF" 2>/dev/null) || { log "ERROR: no encuentro $REF"; exit 3; }

relevantes(){
  git show "$REF:$FICH" 2>/dev/null | tr -d '\r' | awk -F'|' '
    function sale() { if (id != "") { gsub(/\t/, " ", tit); print id "\t" para "\t" acc "\t" (dudas ? "dudas" : "limpio") "\t" substr(tit, 1, 140) } id="" }
    /^<!-- para:/ {
      sale(); para=""; id=""; acc=""; tit=""; dudas=0;
      for (i=1; i<=NF; i++) { f=$i; sub(/^<!-- */,"",f); sub(/ *-->.*$/,"",f); gsub(/^ +| +$/,"",f);
        if (f ~ /^para:/) { para=substr(f,6) } else if (f ~ /^id:/) { id=substr(f,4) } else if (f ~ /^accion:/) { acc=substr(f,8) } }
      gsub(/^ +| +$/,"",para); gsub(/^ +| +$/,"",id); gsub(/^ +| +$/,"",acc);
      if (id ~ /^(JJ|Claude|CLAUDE|Coo|COO|Cursor|CURSOR|Grok|GROK|Criba|CRIBA)([ -]|$)/) id="";      # nuestro
      if (para !~ /(^|[ ,])(JJ|Claude|Cursor|Coo|todos)([ ,]|$)/) id="";                             # no va con nosotros
      next
    }
    id != "" && tit == "" && /^#{2,3} / { tit=$0; sub(/^#+ */, "", tit); next }
    id != "" { l=tolower($0); if (l ~ /\?|matiz|matices|salvo |excepto|pero |sin embargo|cambiad|corregid|revisad|ojo:/) dudas=1 }
    END { sale() }'
}
TODOS=$(relevantes)

# Primera pasada: apuntar lo que ya hay y no avisar de lo viejo
if [ ! -s "$VISTOS" ]; then
  if [ $SECO = 1 ]; then echo "primera pasada: apuntaría $(printf '%s\n' "$TODOS" | grep -c .) bloques ya existentes y no avisaría"; exit 0; fi
  printf '%s\n' "$TODOS" | cut -f1 > "$VISTOS"; echo "$SHA" > "$SHAF"
  log "primera pasada: apunto $(wc -l < "$VISTOS") bloques que ya estaban (sha ${SHA:0:10})"; exit 0
fi

NUEVOS=$(printf '%s\n' "$TODOS" | awk -F'\t' 'NR==FNR { v[$0]=1; next } $1!="" && !($1 in v)' "$VISTOS" -)
DESDE=$(cat "$SHAF" 2>/dev/null || echo "$SHA~1")
if [ -z "$NUEVOS" ]; then
  [ $SECO = 1 ] && echo "nada nuevo para nosotros (sha ${SHA:0:10})"
  [ $SECO = 0 ] && echo "$SHA" > "$SHAF"
  exit 0
fi

ES_CONF='tolower($3) ~ /^(conforme|confirmacion|confirmación)$/ && $4 == "limpio"'
CONF=$(printf '%s\n' "$NUEVOS" | awk -F'\t' "\$1 != \"\" && ($ES_CONF)")
NUEVOS_TODOS=$NUEVOS
NUEVOS=$(printf '%s\n' "$NUEVOS" | awk -F'\t' "\$1 != \"\" && !($ES_CONF)")
contestados(){
  git show "$REF:$FICH" 2>/dev/null | tr -d '\r' | awk -F'|' '
    function quien(x) { x = tolower(x); sub(/[ -].*$/, "", x); return x }
    /^<!-- para:/ { id = ""; rs = "";
      for (i=1; i<=NF; i++) { f=$i; sub(/^<!-- */,"",f); sub(/ *-->.*$/,"",f); gsub(/^ +| +$/,"",f);
        if (f ~ /^id:/) { id=substr(f,4); gsub(/^ +| +$/,"",id) } else if (f ~ /^responde-a:/) { rs=substr(f,12) } }
      if (id == "") next; au[id] = quien(id); n = split(rs, xs, ",");
      for (k=1; k<=n; k++) { x = xs[k]; gsub(/^ +| +$/,"",x); if (x != "") { np++; pc[np] = x; pq[np] = quien(id) } } }
    END { for (k=1; k<=np; k++) if ((pc[k] in au) && au[pc[k]] != pq[k]) print pc[k] }' | sort -u
}
CF=$(mktemp); contestados > "$CF"
NUEVOS=$(printf '%s\n' "$NUEVOS" | awk -F'\t' 'NR==FNR { c[$0]=1; next } $1 != "" && !($1 in c)' "$CF" -)
rm -f "$CF"
if [ -n "$CONF" ]; then
  NC=$(mktemp)
  PARA_JJ=$(printf '%s\n' "$CONF" | awk -F'\t' '$2 ~ /(^|[ ,])(JJ|todos)([ ,]|$)/ { print "si"; exit }')
  QUE=$(printf '%s\n' "$CONF" | awk -F'\t' '{ t=$5; sub(/^.*CONFORME\] */, "", t); printf "%s%s da su CONFORME: «%s»", (NR>1?" · ":""), $1, substr(t,1,90) }')
  if [ "$PARA_JJ" = si ]; then printf 'para: JJ\n@humano\nTu OK: %s. Mira si ya puedes dar el OK.\n' "$QUE" > "$NC"
  else printf 'para: Claude\nTu OK: no hace falta (%s)\n' "$QUE" > "$NC"; fi
  if [ $SECO = 1 ]; then echo "CONFORME sin abrir Claude; timbre con esta nota:"; cat "$NC"
  else
    log "CONFORME (sin Claude): $QUE (sha ${SHA:0:10})"
    bash "$AQUI/timbre.sh" "${CANAL2_NOMBRE:-proyecto}" "$NC" "$SHA" >/dev/null 2>>"$LOG" || log "timbre falló (rc=$?)"
  fi
  rm -f "$NC"
fi
if [ -z "$NUEVOS" ]; then
  [ $SECO = 0 ] && { printf '%s\n' "$NUEVOS_TODOS" | cut -f1 >> "$VISTOS"; echo "$SHA" > "$SHAF"; }
  exit 0
fi

RESUMEN=$(printf '%s\n' "$NUEVOS" | awk -F'\t' '{ printf "%s%s (para %s%s)", (NR>1?"; ":""), $1, $2, ($3!=""?", "$3:"") }')
NOTA=$(mktemp)
cat > "$NOTA" <<EOF
para: Claude
Detalle: bloque nuevo de fuera en el segundo canal: $RESUMEN
Desde: vigía del canal sin modelo (vigia-canal-timbre.sh), tramo ${DESDE:0:10}..${SHA:0:10}
Qué hacer: léelo y contesta en ese canal si nos toca. Si es una decisión solo de Humano, súbesela con @humano.
EOF
if [ $SECO = 1 ]; then echo "AVISARÍA y abriría un Claude con esta nota:"; cat "$NOTA"; rm -f "$NOTA"; exit 0; fi

log "NUEVO: $RESUMEN (sha ${SHA:0:10})"
bash "$AQUI/timbre.sh" "${CANAL2_NOMBRE:-proyecto}" "$NOTA" "$SHA" >/dev/null 2>>"$LOG" || log "timbre falló (rc=$?)"
OUT=$(bash "$AQUI/lanzar-claude.sh" "${CANAL2_NOMBRE:-proyecto}" "$NOTA" "$SHA" "$DESDE" 2>&1); RC=$?
log "lanzar-claude rc=$RC: $(printf '%s' "$OUT" | tail -1)"
if [ $RC -ne 0 ]; then
  bash "$AQUI/avisar-humano.sh" "Bloque nuevo en el segundo canal ($RESUMEN) y no he podido abrir Claude (código $RC). Míralo tú o abre Claude a mano." 2>>"$LOG" || true
fi
# Se apuntan como vistos aunque falle el Claude: si no, avisaría cada 15 minutos por lo mismo.
printf '%s\n' "$NUEVOS_TODOS" | cut -f1 >> "$VISTOS"; echo "$SHA" > "$SHAF"
rm -f "$NOTA"
exit 0
