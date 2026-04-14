#!/bin/bash
# postinstall.sh — runs as root after core files are written
# Sets executable permissions and removes quarantine on bundled binaries.
set -e

MACOS_DIR="/Applications/RelyyCast.app/Contents/MacOS"

# Executable permissions for all binaries
chmod +x "$MACOS_DIR/relyycast"                              2>/dev/null || true
chmod +x "$MACOS_DIR/build/mediamtx/mac/mediamtx"           2>/dev/null || true
chmod +x "$MACOS_DIR/build/bin/cloudflared"                  2>/dev/null || true
chmod +x "$MACOS_DIR/build/bin/relyy-mp3-helper"             2>/dev/null || true

# Remove quarantine from the entire .app bundle.
# Only needed for dev / unsigned builds — notarized builds are already clear.
xattr -dr com.apple.quarantine "/Applications/RelyyCast.app" 2>/dev/null || true

exit 0
