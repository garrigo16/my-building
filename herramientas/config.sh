_cfg_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
eval "$(node "$_cfg_dir/config.js" --sh 2>/dev/null || true)"
unset _cfg_dir
