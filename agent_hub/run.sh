#!/usr/bin/with-contenv bashio
export RESIDENT_NAME="$(bashio::config 'resident_name')"
cd /app
python3 daemon.py
