#!/bin/bash
# preinstall.sh — runs as root before files are written
# Removes a previous RelyyCast.app installation so the new version installs cleanly.
set -e

APP_PATH="/Applications/RelyyCast.app"

if [ -d "$APP_PATH" ]; then
    echo "[preinstall] Removing previous installation at $APP_PATH"
    rm -rf "$APP_PATH"
fi

exit 0
