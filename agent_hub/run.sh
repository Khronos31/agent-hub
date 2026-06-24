#!/bin/bash
set -euo pipefail

# --- アドオン options 読み込み（HAベースイメージを使わないので bashio 非依存）---
export RESIDENT_NAME
RESIDENT_NAME=$(python3 -c "import json; print(json.load(open('/data/options.json')).get('resident_name','ユーザー'))" 2>/dev/null || echo "ユーザー")

# --- CLI ランタイムへの PATH ---
#   /config/.tools/bin          … codex / agy
#   /config/.tools/node/bin     … node（codex.js / claude が env node で必要）
#   /config/.tools/npm-global/bin … claude
export PATH="/config/.tools/bin:/config/.tools/node/bin:/config/.tools/npm-global/bin:$PATH"
export CLAUDE_CONFIG_DIR="/config/.tools/claude-home"
export CODEX_HOME="/config/.tools/codex-home"

echo "[agent-hub] resident=${RESIDENT_NAME}"
cd /app
exec python3 daemon.py
