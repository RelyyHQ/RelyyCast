#!/bin/bash
# build-pkg.sh — builds a signed, notarized RelyyCast.pkg for macOS
#
# Usage:
#   ./build-pkg.sh [--skip-sign] [--skip-notarize]
#
# Required env vars for signing:
#   APPLE_SIGN_APP       — "Developer ID Application: Randal Herndon (8938LN7846)"
#   APPLE_SIGN_PKG       — "Developer ID Installer: Randal Herndon (8938LN7846)"
# Optional env vars for auto-importing installer cert when missing:
#   APPLE_INSTALLER_CERT_P12      — absolute path to Developer ID Installer .p12
#   APPLE_INSTALLER_CERT_PASSWORD — password for the .p12 file
#   APPLE_KEYCHAIN_PATH           — optional keychain path (defaults to login keychain)
#   APPLE_KEYCHAIN_PASSWORD       — optional keychain password for unlock/partition updates
#
# Required env vars for notarization (or stored keychain profile):
#   APPLE_ID             — your Apple ID email
#   APPLE_APP_PASSWORD   — app-specific password from appleid.apple.com
#   APPLE_TEAM_ID        — 8938LN7846
#   NOTARIZE_PROFILE     — (optional) keychain credential profile name; if unset and
#                          APPLE_ID + APPLE_APP_PASSWORD are present, this script will
#                          auto-create/use relyycast-notarization-<TEAM_ID>
#
# Outputs:
#   dist/RelyyCast.pkg

set -euo pipefail

# -----------------------------------------------------------------------
# Paths
# -----------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DIST_SRC="$REPO_ROOT/dist/relyycast"
DIST_OUT="$REPO_ROOT/dist"
STAGING="$REPO_ROOT/dist/_pkg-staging"
SCRIPTS_STAGING="$STAGING/_scripts"
PKG_RESOURCES="$STAGING/_pkg-resources"

APP_NAME="RelyyCast"
APP_VERSION="0.1.0"
APP_BUNDLE="$APP_NAME.app"
BUNDLE_ID="com.relyycast.app"
TEAM_ID="${APPLE_TEAM_ID:-8938LN7846}"

# Default signing identities (can be overridden by env)
SIGN_APP="${APPLE_SIGN_APP:-Developer ID Application: Randal Herndon ($TEAM_ID)}"
SIGN_PKG="${APPLE_SIGN_PKG:-Developer ID Installer: Randal Herndon ($TEAM_ID)}"
DEFAULT_NOTARIZE_PROFILE="relyycast-notarization-$TEAM_ID"

# -----------------------------------------------------------------------
# Flag parsing
# -----------------------------------------------------------------------
SKIP_SIGN=false
SKIP_NOTARIZE=false
SKIP_APP_SIGN=false
SKIP_PKG_SIGN=false

for arg in "$@"; do
    case "$arg" in
        --skip-sign)
            SKIP_SIGN=true
            SKIP_APP_SIGN=true
            SKIP_PKG_SIGN=true
            ;;
        --skip-notarize)  SKIP_NOTARIZE=true ;;
    esac
done

maybe_import_installer_cert() {
    local p12_path="${APPLE_INSTALLER_CERT_P12:-}"
    local p12_password="${APPLE_INSTALLER_CERT_PASSWORD:-}"
    local keychain_path="${APPLE_KEYCHAIN_PATH:-$HOME/Library/Keychains/login.keychain-db}"

    if [ -z "$p12_path" ] || [ -z "$p12_password" ]; then
        return 0
    fi

    if [ ! -f "$p12_path" ]; then
        echo "[pkg] WARNING: APPLE_INSTALLER_CERT_P12 points to a missing file: $p12_path"
        return 0
    fi

    echo "[pkg] INFO: Attempting to import Developer ID Installer certificate from APPLE_INSTALLER_CERT_P12"

    if [ -n "${APPLE_KEYCHAIN_PASSWORD:-}" ]; then
        security unlock-keychain -p "$APPLE_KEYCHAIN_PASSWORD" "$keychain_path" >/dev/null 2>&1 || true
    fi

    if security import "$p12_path" \
        -k "$keychain_path" \
        -P "$p12_password" \
        -T /usr/bin/productsign \
        -T /usr/bin/security \
        -T /usr/bin/codesign >/dev/null 2>&1; then
        echo "[pkg] INFO: Imported installer certificate into keychain: $keychain_path"
    else
        echo "[pkg] WARNING: Failed to import installer certificate from APPLE_INSTALLER_CERT_P12"
        return 0
    fi

    if [ -n "${APPLE_KEYCHAIN_PASSWORD:-}" ]; then
        security set-key-partition-list \
            -S apple-tool:,apple: \
            -s \
            -k "$APPLE_KEYCHAIN_PASSWORD" \
            "$keychain_path" >/dev/null 2>&1 || true
    fi
}

maybe_import_installer_cert

# Auto-skip signing if required cert identities are unavailable.
HAS_APP_SIGN_CERT=true
HAS_INSTALLER_SIGN_CERT=true

CODE_SIGN_IDENTITIES="$(security find-identity -v -p codesigning 2>/dev/null || true)"
BASIC_IDENTITIES="$(security find-identity -v -p basic 2>/dev/null || true)"

if ! printf '%s\n' "$CODE_SIGN_IDENTITIES" | grep -Fq "\"$SIGN_APP\""; then
    FALLBACK_SIGN_APP="$(printf '%s\n' "$CODE_SIGN_IDENTITIES" | sed -n "s/.*\"\(Developer ID Application:.*($TEAM_ID)\)\"/\1/p" | head -n 1)"
    if [ -n "$FALLBACK_SIGN_APP" ]; then
        SIGN_APP="$FALLBACK_SIGN_APP"
        echo "[pkg] INFO: APPLE_SIGN_APP not found exactly; using detected Team ID match: $SIGN_APP"
    fi
fi

if ! printf '%s\n' "$CODE_SIGN_IDENTITIES" | grep -Fq "\"$SIGN_APP\""; then
    HAS_APP_SIGN_CERT=false
fi

if ! printf '%s\n' "$BASIC_IDENTITIES" | grep -Fq "\"$SIGN_PKG\""; then
    FALLBACK_SIGN_PKG="$(printf '%s\n' "$BASIC_IDENTITIES" | sed -n "s/.*\"\(Developer ID Installer:.*($TEAM_ID)\)\"/\1/p" | head -n 1)"
    if [ -n "$FALLBACK_SIGN_PKG" ]; then
        SIGN_PKG="$FALLBACK_SIGN_PKG"
        echo "[pkg] INFO: APPLE_SIGN_PKG not found exactly; using detected Team ID match: $SIGN_PKG"
    fi
fi

if ! printf '%s\n' "$BASIC_IDENTITIES" | grep -Fq "\"$SIGN_PKG\""; then
    HAS_INSTALLER_SIGN_CERT=false
fi

if [ "$HAS_APP_SIGN_CERT" = false ]; then
    echo "[pkg] WARNING: Signing identity not found in keychain for APPLE_SIGN_APP"
    echo "[pkg]          expected: $SIGN_APP"
    SKIP_APP_SIGN=true
fi

if [ "$HAS_INSTALLER_SIGN_CERT" = false ]; then
    echo "[pkg] WARNING: Signing identity not found in keychain for APPLE_SIGN_PKG"
    echo "[pkg]          expected: $SIGN_PKG"
    SKIP_PKG_SIGN=true
fi

if [ "$SKIP_APP_SIGN" = true ] && [ "$SKIP_PKG_SIGN" = true ]; then
    SKIP_SIGN=true
fi

if [ "$SKIP_PKG_SIGN" = true ]; then
    SKIP_NOTARIZE=true
fi

# -----------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------
log() { echo "[pkg] $*"; }

ensure_notary_profile() {
    if [ -n "${NOTARIZE_PROFILE:-}" ]; then
        echo "[pkg] Using NOTARIZE_PROFILE=$NOTARIZE_PROFILE" >&2
        printf '%s\n' "$NOTARIZE_PROFILE"
        return 0
    fi

    if [ -z "${APPLE_ID:-}" ] || [ -z "${APPLE_APP_PASSWORD:-}" ]; then
        return 1
    fi

    local profile_name="$DEFAULT_NOTARIZE_PROFILE"
    local store_output
    store_output="$(mktemp /tmp/relyycast-notary-store.XXXXXX)"

    if xcrun notarytool store-credentials "$profile_name" \
        --apple-id "$APPLE_ID" \
        --team-id "$TEAM_ID" \
        --password "$APPLE_APP_PASSWORD" >"$store_output" 2>&1; then
        echo "[pkg] Stored notary keychain profile: $profile_name" >&2
    elif grep -qi "already exists" "$store_output"; then
        echo "[pkg] Using existing notary keychain profile: $profile_name" >&2
    else
        echo "[pkg] ERROR: Failed to store notary credentials profile '$profile_name'"
        cat "$store_output"
        rm -f "$store_output"
        exit 1
    fi

    rm -f "$store_output"
    printf '%s\n' "$profile_name"
}

require_file() {
    if [ ! -e "$1" ]; then
        echo "[pkg] ERROR: Required file not found: $1"
        exit 1
    fi
}

sign_binary() {
    local binary="$1"
    local entitlements="${2:-}"
    if $SKIP_APP_SIGN; then return 0; fi

    # Remove any existing signature first so re-signing is deterministic.
    codesign --remove-signature "$binary" >/dev/null 2>&1 || true

    if [ -n "$entitlements" ]; then
        codesign --force --options runtime --entitlements "$entitlements" \
            --sign "$SIGN_APP" --timestamp "$binary"
    else
        codesign --force --options runtime \
            --sign "$SIGN_APP" --timestamp "$binary"
    fi
    log "  signed: $(basename "$binary")"
}

sign_resource() {
    local resource="$1"
    if $SKIP_APP_SIGN; then return 0; fi
    codesign --force --sign "$SIGN_APP" --timestamp "$resource"
    log "  signed resource: $(basename "$resource")"
}

# -----------------------------------------------------------------------
# Preflight checks
# -----------------------------------------------------------------------
log "Checking source files..."
require_file "$DIST_SRC/relyycast-mac_universal"
require_file "$DIST_SRC/resources.neu"
require_file "$DIST_SRC/build/mediamtx/mac/mediamtx"
require_file "$DIST_SRC/build/mediamtx/mediamtx.yml"
require_file "$DIST_SRC/build/bin/cloudflared"

# -----------------------------------------------------------------------
# Clean staging
# -----------------------------------------------------------------------
log "Preparing staging directory..."
rm -rf "$STAGING"
mkdir -p "$STAGING"

# -----------------------------------------------------------------------
# Build .app bundle structure
# -----------------------------------------------------------------------
log "Building $APP_BUNDLE..."

MACOS_DIR="$STAGING/$APP_BUNDLE/Contents/MacOS"
mkdir -p "$MACOS_DIR/build/mediamtx/mac"
mkdir -p "$MACOS_DIR/build/bin"
mkdir -p "$STAGING/$APP_BUNDLE/Contents/Resources"

# Main binary (rename to clean name inside the bundle)
cp "$DIST_SRC/relyycast-mac_universal" "$MACOS_DIR/relyycast"
chmod +x "$MACOS_DIR/relyycast"

# Neutralino resources
cp "$DIST_SRC/resources.neu" "$MACOS_DIR/resources.neu"

# MediaMTX
cp "$DIST_SRC/build/mediamtx/mac/mediamtx" "$MACOS_DIR/build/mediamtx/mac/mediamtx"
cp "$DIST_SRC/build/mediamtx/mediamtx.yml"  "$MACOS_DIR/build/mediamtx/mediamtx.yml"
chmod +x "$MACOS_DIR/build/mediamtx/mac/mediamtx"

# Cloudflare Tunnel
cp "$DIST_SRC/build/bin/cloudflared" "$MACOS_DIR/build/bin/cloudflared"
chmod +x "$MACOS_DIR/build/bin/cloudflared"

# Info.plist
cp "$SCRIPT_DIR/Info.plist" "$STAGING/$APP_BUNDLE/Contents/Info.plist"

# App icon (convert favicon.ico → icns if iconutil is available, else copy as-is)
FAVICON="$REPO_ROOT/public/favicon.ico"
if [ -f "$FAVICON" ]; then
    cp "$FAVICON" "$STAGING/$APP_BUNDLE/Contents/Resources/AppIcon.icns" 2>/dev/null || true
fi

# -----------------------------------------------------------------------
# Sign binaries
# -----------------------------------------------------------------------
log "Signing binaries..."
CHILD_ENTITLEMENTS="$SCRIPT_DIR/child-entitlements.plist"
APP_ENTITLEMENTS="$SCRIPT_DIR/entitlements.plist"

sign_binary "$MACOS_DIR/build/mediamtx/mac/mediamtx"  "$CHILD_ENTITLEMENTS"
sign_binary "$MACOS_DIR/build/bin/cloudflared"          "$CHILD_ENTITLEMENTS"
# resources.neu lives beside the app executable and is treated as a nested
# signed component by codesign. Sign it explicitly before signing relyycast.
sign_resource "$MACOS_DIR/resources.neu"
# mediamtx.yml is also inside Contents/MacOS and must be signed as a blob.
sign_resource "$MACOS_DIR/build/mediamtx/mediamtx.yml"
sign_binary "$MACOS_DIR/relyycast"                      "$APP_ENTITLEMENTS"

if ! $SKIP_APP_SIGN; then
    log "Signing .app bundle..."
    codesign --force --deep --options runtime \
        --entitlements "$APP_ENTITLEMENTS" \
        --sign "$SIGN_APP" --timestamp \
        "$STAGING/$APP_BUNDLE"
    codesign --verify --deep --strict "$STAGING/$APP_BUNDLE"
    log "  .app bundle signature valid"
fi

# -----------------------------------------------------------------------
# Build pkg-scripts staging
# -----------------------------------------------------------------------
mkdir -p "$SCRIPTS_STAGING/core"
cp "$SCRIPT_DIR/preinstall.sh"  "$SCRIPTS_STAGING/core/preinstall"
cp "$SCRIPT_DIR/postinstall.sh" "$SCRIPTS_STAGING/core/postinstall"
chmod +x "$SCRIPTS_STAGING/core/preinstall" "$SCRIPTS_STAGING/core/postinstall"

# -----------------------------------------------------------------------
# pkgbuild: core component pkg
# -----------------------------------------------------------------------
CORE_PKG="$STAGING/RelyyCast-core.pkg"
log "Building core component package..."

# Stage root: the app bundle ends up at /Applications/RelyyCast.app
APP_ROOT="$STAGING/_app-root"
mkdir -p "$APP_ROOT"
cp -R "$STAGING/$APP_BUNDLE" "$APP_ROOT/$APP_BUNDLE"

pkgbuild \
    --root "$APP_ROOT" \
    --identifier "${BUNDLE_ID}" \
    --version "$APP_VERSION" \
    --install-location "/Applications" \
    --scripts "$SCRIPTS_STAGING/core" \
    "$CORE_PKG"

log "  core pkg: $CORE_PKG"

# -----------------------------------------------------------------------
# pkgbuild: uninstall helper component pkg
# -----------------------------------------------------------------------
UNINSTALL_PKG="$STAGING/RelyyCast-uninstall.pkg"
log "Building uninstall helper component package..."

UNINSTALL_ROOT="$STAGING/_uninstall-root"
mkdir -p "$UNINSTALL_ROOT/Applications"
cp "$SCRIPT_DIR/uninstall-relyycast.sh" "$UNINSTALL_ROOT/Applications/RelyyCast Uninstall.command"
chmod +x "$UNINSTALL_ROOT/Applications/RelyyCast Uninstall.command"

pkgbuild \
    --root "$UNINSTALL_ROOT" \
    --identifier "${BUNDLE_ID}.uninstall" \
    --version "$APP_VERSION" \
    --install-location "/" \
    "$UNINSTALL_PKG"

log "  uninstall pkg: $UNINSTALL_PKG"

# -----------------------------------------------------------------------
# productbuild: assemble distribution installer
# -----------------------------------------------------------------------
mkdir -p "$PKG_RESOURCES"
cp "$SCRIPT_DIR/welcome.html"     "$PKG_RESOURCES/welcome.html"
cp "$REPO_ROOT/LICENSE"           "$PKG_RESOURCES/LICENSE"

DIST_XML="$PKG_RESOURCES/distribution.xml"
cp "$SCRIPT_DIR/distribution.xml" "$DIST_XML"

UNSIGNED_PKG="$DIST_OUT/RelyyCast-unsigned.pkg"
FINAL_PKG="$DIST_OUT/RelyyCast.pkg"

log "Running productbuild..."

PRODUCTBUILD_ARGS=(
    --distribution "$DIST_XML"
    --resources "$PKG_RESOURCES"
    --package-path "$STAGING"
    --version "$APP_VERSION"
)

productbuild "${PRODUCTBUILD_ARGS[@]}" "$UNSIGNED_PKG"
log "  unsigned pkg: $UNSIGNED_PKG"

# -----------------------------------------------------------------------
# Sign the installer pkg
# -----------------------------------------------------------------------
if ! $SKIP_PKG_SIGN; then
    log "Signing installer package..."
    productsign --sign "$SIGN_PKG" --timestamp "$UNSIGNED_PKG" "$FINAL_PKG"
    rm -f "$UNSIGNED_PKG"
    log "  signed pkg: $FINAL_PKG"
else
    mv "$UNSIGNED_PKG" "$FINAL_PKG"
    log "  (unsigned) pkg: $FINAL_PKG"
fi

# -----------------------------------------------------------------------
# Notarization
# -----------------------------------------------------------------------
if $SKIP_PKG_SIGN || $SKIP_NOTARIZE; then
    log "Skipping notarization."
else
    log "Submitting for notarization..."

    EFFECTIVE_PROFILE=""
    if EFFECTIVE_PROFILE="$(ensure_notary_profile)"; then
        xcrun notarytool submit "$FINAL_PKG" \
            --keychain-profile "$EFFECTIVE_PROFILE" \
            --wait
    else
        echo "[pkg] WARNING: No notarization credentials found."
        echo "  Set NOTARIZE_PROFILE or APPLE_ID + APPLE_APP_PASSWORD + APPLE_TEAM_ID."
        echo "  Skipping notarization — pkg will trigger Gatekeeper warnings on first launch."
    fi

    if [ -n "$EFFECTIVE_PROFILE" ]; then
        log "Stapling notarization ticket..."
        xcrun stapler staple "$FINAL_PKG"
        log "  staple complete"
    fi
fi

# -----------------------------------------------------------------------
# Clean up staging
# -----------------------------------------------------------------------
rm -rf "$STAGING"

log ""
log "Done! Installer: $FINAL_PKG"
log ""
log "Notarization automation:"
log "  If NOTARIZE_PROFILE is unset and APPLE_ID + APPLE_APP_PASSWORD are set,"
log "  this script auto-creates/uses keychain profile: $DEFAULT_NOTARIZE_PROFILE"
