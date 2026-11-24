#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
EQ=$(tr -d '\r\n ' < "$HOME/.config/oficina-equipo.txt" 2>/dev/null || true)
[ -n "$EQ" ] || { echo "Falta ~/.config/oficina-equipo.txt con el nombre de este equipo (portatil, casa…)."; exit 2; }
for t in $(git ls-remote origin 'refs/tags/turno-*' | sed -n 's#.*refs/tags/##p'); do
  [ "$t" = "turno-$EQ" ] && continue
  git push -q origin ":refs/tags/$t"
  git tag -d "$t" >/dev/null 2>&1 || true
done
git tag -f "turno-$EQ" >/dev/null
git push -q -f origin "refs/tags/turno-$EQ"
echo "Hecho: el turno es de «$EQ». El otro equipo deja de escuchar en 1 minuto como mucho."
node "$(pwd)/herramientas/estado-oficina.js" baja || echo "AVISO: no he podido traer el estado de la oficina del otro equipo (pausas, notas…)."
# v563: y lo que falló hoy en la oficina del otro equipo (su diario de errores viaja con el estado), para verlo aquí
echo
node "$(pwd)/herramientas/estado-oficina.js" errores || true
