#!/bin/bash
# uninstall-relyycast.sh — remove RelyyCast from macOS
#
# Usage:
#   sudo ./scripts/installers/mac/uninstall-relyycast.sh
#
# Flags:
#   --dry-run                   Print actions without deleting anything.
#   --yes                       Skip interactive confirmation and choice prompts.
#   --keep-app                  Keep /Applications/RelyyCast.app.
#   --keep-receipts             Keep package receipts (skip pkgutil --forget).
#   --keep-data                 Keep RelyyCast user data/config files.
#   --remove-cloudflare-config  Remove local app Cloudflare config under app data.
#   --keep-cloudflare-config    Keep local app Cloudflare config under app data.
#   --remove-cloudflared-home   Remove ~/.cloudflared (global cloudflared cert/creds).
#   --keep-cloudflared-home     Keep ~/.cloudflared (default).
#   -h, --help                  Show help.

set -euo pipefail

APP_PATH="/Applications/RelyyCast.app"
PKG_IDS=(
  "com.relyycast.app"
)

DRY_RUN=false
ASSUME_YES=false
REMOVE_APP=true
FORGET_RECEIPTS=true
REMOVE_USER_DATA=true
REMOVE_CLOUDFLARE_APP_CONFIG=true
REMOVE_CLOUDFLARED_HOME=false

usage() {
  cat <<'EOF'
RelyyCast macOS uninstaller

Usage:
  sudo ./scripts/installers/mac/uninstall-relyycast.sh [options]

Options:
  --dry-run                   Print actions without deleting anything.
  --yes                       Skip interactive confirmation and choice prompts.
  --keep-app                  Keep /Applications/RelyyCast.app.
  --keep-receipts             Keep installer receipts (skip pkgutil --forget).
  --keep-data                 Keep RelyyCast user data/config files in ~/Library.
  --remove-cloudflare-config  Remove local app Cloudflare config under app data.
  --keep-cloudflare-config    Keep local app Cloudflare config under app data.
  --remove-cloudflared-home   Remove ~/.cloudflared (global cloudflared cert/creds).
  --keep-cloudflared-home     Keep ~/.cloudflared (default).
  -h, --help                  Show this help message.
EOF
}

log() {
  echo "[uninstall] $*"
}

run_cmd() {
  if $DRY_RUN; then
    printf '[dry-run] '
    printf '%q ' "$@"
    printf '\n'
    return 0
  fi
  "$@"
}

remove_path() {
  local path="$1"
  if [ -e "$path" ] || [ -L "$path" ]; then
    run_cmd rm -rf "$path"
    log "removed: $path"
  else
    log "not found: $path"
  fi
}

stop_process_if_running() {
  local pattern="$1"
  if pgrep -f "$pattern" >/dev/null 2>&1; then
    if $DRY_RUN; then
      printf '[dry-run] pkill -f %q\n' "$pattern"
    else
      pkill -f "$pattern" >/dev/null 2>&1 || true
    fi
    log "stopped process match: $pattern"
  fi
}

prompt_yes_no() {
  local question="$1"
  local default_yes="$2"
  local reply=""
  local suffix="[y/N]"

  if $default_yes; then
    suffix="[Y/n]"
  fi

  read -r -p "$question $suffix " reply

  if [ -z "$reply" ]; then
    if $default_yes; then
      return 0
    fi
    return 1
  fi

  case "$reply" in
    y|Y|yes|YES)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

remove_children_except() {
  local root="$1"
  local keep_name="$2"

  if [ ! -d "$root" ]; then
    log "not found: $root"
    return 0
  fi

  if [ ! -d "$root/$keep_name" ]; then
    remove_path "$root"
    return 0
  fi

  shopt -s nullglob dotglob
  local entry
  for entry in "$root"/*; do
    if [ "$(basename "$entry")" = "$keep_name" ]; then
      continue
    fi
    remove_path "$entry"
  done
  shopt -u nullglob dotglob
  log "kept: $root/$keep_name"
}

print_plan() {
  local target_home="$1"
  echo
  echo "Planned actions:"
  if $REMOVE_APP; then
    echo "- Remove app bundle: $APP_PATH"
  else
    echo "- Keep app bundle: $APP_PATH"
  fi

  if $FORGET_RECEIPTS; then
    echo "- Forget installer receipts: ${PKG_IDS[*]}"
  else
    echo "- Keep installer receipts"
  fi

  if $REMOVE_USER_DATA; then
    if $REMOVE_CLOUDFLARE_APP_CONFIG; then
      echo "- Remove all RelyyCast user data in: $target_home/Library"
    else
      echo "- Remove RelyyCast user data in: $target_home/Library (keep app Cloudflare config)"
    fi
  else
    echo "- Keep RelyyCast user data"
    if $REMOVE_CLOUDFLARE_APP_CONFIG; then
      echo "- Remove only app Cloudflare config: $target_home/Library/Application Support/relyycast/cloudflare"
    fi
  fi

  if $REMOVE_CLOUDFLARED_HOME; then
    echo "- Remove global cloudflared dir: $target_home/.cloudflared"
  else
    echo "- Keep global cloudflared dir: $target_home/.cloudflared"
  fi
  echo
}

while (($#)); do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      ;;
    --yes)
      ASSUME_YES=true
      ;;
    --keep-app)
      REMOVE_APP=false
      ;;
    --keep-receipts)
      FORGET_RECEIPTS=false
      ;;
    --keep-data)
      REMOVE_USER_DATA=false
      REMOVE_CLOUDFLARE_APP_CONFIG=false
      ;;
    --remove-cloudflare-config)
      REMOVE_CLOUDFLARE_APP_CONFIG=true
      ;;
    --keep-cloudflare-config)
      REMOVE_CLOUDFLARE_APP_CONFIG=false
      ;;
    --remove-cloudflared-home)
      REMOVE_CLOUDFLARED_HOME=true
      ;;
    --keep-cloudflared-home)
      REMOVE_CLOUDFLARED_HOME=false
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

TARGET_USER="${SUDO_USER:-${USER:-}}"
if [ -z "$TARGET_USER" ] || [ "$TARGET_USER" = "root" ]; then
  TARGET_USER="$(id -un)"
fi

TARGET_HOME="$(dscl . -read "/Users/$TARGET_USER" NFSHomeDirectory 2>/dev/null | awk '{print $2}' || true)"
if [ -z "$TARGET_HOME" ]; then
  TARGET_HOME="$HOME"
fi

APP_SUPPORT_ROOT="$TARGET_HOME/Library/Application Support/relyycast"
APP_CLOUDFLARE_DIR="$APP_SUPPORT_ROOT/cloudflare"
GLOBAL_CLOUDFLARED_DIR="$TARGET_HOME/.cloudflared"

USER_PATHS_NON_RELYYCAST_ROOT=(
  "$TARGET_HOME/Library/Application Support/com.relyycast.app"
  "$TARGET_HOME/Library/Caches/com.relyycast.app"
  "$TARGET_HOME/Library/Preferences/com.relyycast.app.plist"
  "$TARGET_HOME/Library/Saved Application State/com.relyycast.app.savedState"
)

log "target user: $TARGET_USER"
log "target home: $TARGET_HOME"
log "app path: $APP_PATH"

if ! $ASSUME_YES; then
  print_plan "$TARGET_HOME"

  if ! prompt_yes_no "Continue?" true; then
    log "cancelled"
    exit 0
  fi

  if prompt_yes_no "Remove app bundle?" "$REMOVE_APP"; then
    REMOVE_APP=true
  else
    REMOVE_APP=false
  fi

  if prompt_yes_no "Forget installer receipts?" "$FORGET_RECEIPTS"; then
    FORGET_RECEIPTS=true
  else
    FORGET_RECEIPTS=false
  fi

  if prompt_yes_no "Remove RelyyCast user data in ~/Library?" "$REMOVE_USER_DATA"; then
    REMOVE_USER_DATA=true
  else
    REMOVE_USER_DATA=false
  fi

  if prompt_yes_no "Remove app Cloudflare config (relyycast/cloudflare)?" "$REMOVE_CLOUDFLARE_APP_CONFIG"; then
    REMOVE_CLOUDFLARE_APP_CONFIG=true
  else
    REMOVE_CLOUDFLARE_APP_CONFIG=false
  fi

  if prompt_yes_no "Remove global ~/.cloudflared cert/credentials?" "$REMOVE_CLOUDFLARED_HOME"; then
    REMOVE_CLOUDFLARED_HOME=true
  else
    REMOVE_CLOUDFLARED_HOME=false
  fi

  print_plan "$TARGET_HOME"
  if ! prompt_yes_no "Run uninstall with these choices?" true; then
    log "cancelled"
    exit 0
  fi
fi

NEEDS_ROOT=false
if $REMOVE_APP || $FORGET_RECEIPTS; then
  NEEDS_ROOT=true
fi

if ! $DRY_RUN && $NEEDS_ROOT && [ "$(id -u)" -ne 0 ]; then
  echo "sudo is required for selected actions (app removal and/or receipt cleanup)." >&2
  echo "Try: sudo $0 --yes" >&2
  exit 1
fi

log "Stopping running RelyyCast processes..."
stop_process_if_running "/Applications/RelyyCast.app/Contents/MacOS/relyycast"
stop_process_if_running "/Applications/RelyyCast.app/Contents/MacOS/build/mediamtx/mac/mediamtx"
stop_process_if_running "/Applications/RelyyCast.app/Contents/MacOS/build/bin/cloudflared"

if $REMOVE_APP; then
  log "Removing app bundle..."
  remove_path "$APP_PATH"
else
  log "Keeping app bundle."
fi

if $FORGET_RECEIPTS; then
  log "Forgetting package receipts..."
  for pkg_id in "${PKG_IDS[@]}"; do
    if pkgutil --pkg-info "$pkg_id" >/dev/null 2>&1; then
      if $DRY_RUN; then
        printf '[dry-run] pkgutil --forget %q\n' "$pkg_id"
      else
        pkgutil --forget "$pkg_id" >/dev/null
      fi
      log "forgot receipt: $pkg_id"
    else
      log "receipt not found: $pkg_id"
    fi
  done
else
  log "Keeping installer receipts."
fi

if $REMOVE_USER_DATA; then
  log "Removing user data/config files..."
  if $REMOVE_CLOUDFLARE_APP_CONFIG; then
    remove_path "$APP_SUPPORT_ROOT"
  else
    remove_children_except "$APP_SUPPORT_ROOT" "cloudflare"
  fi
  for path in "${USER_PATHS_NON_RELYYCAST_ROOT[@]}"; do
    remove_path "$path"
  done
elif $REMOVE_CLOUDFLARE_APP_CONFIG; then
  log "Removing only app Cloudflare config..."
  remove_path "$APP_CLOUDFLARE_DIR"
else
  log "Keeping user data/config files."
fi

if $REMOVE_CLOUDFLARED_HOME; then
  log "Removing global cloudflared cert/credentials..."
  remove_path "$GLOBAL_CLOUDFLARED_DIR"
else
  log "Keeping global cloudflared cert/credentials."
fi

log "Uninstall complete."
