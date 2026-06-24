#!/usr/bin/with-contenv bashio
export RESIDENT_NAME="$(bashio::config 'resident_name')"
export PATH="/config/.tools/bin:$PATH"
export CLAUDE_CONFIG_DIR="/config/.tools/claude-home"
export CODEX_HOME="/config/.tools/codex-home"
cd /app
python3 daemon.py
