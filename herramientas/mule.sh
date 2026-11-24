#!/usr/bin/env bash
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$(cygpath -w "$AQUI/mule.js" 2>/dev/null || echo "$AQUI/mule.js")" "$@"
