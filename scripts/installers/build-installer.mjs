/**
 * build-installer.mjs — unified installer builder
 *
 * Usage:
 *   node scripts/installers/build-installer.mjs [--skip-sign] [--skip-notarize]
 *
 * On Windows: runs makensis to produce dist/relyycast-setup.exe
 * On macOS:   runs build-pkg.sh to produce dist/RelyyCast.pkg
 *
 * Install prerequisites:
 *   Windows — choco install nsis  OR  download from nsis.sourceforge.io
 *   macOS   — Xcode Command Line Tools (pkgbuild, productbuild, codesign, notarytool all included)
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR  = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT   = path.resolve(SCRIPT_DIR, "../..");
const DIST_SRC    = path.resolve(REPO_ROOT, "dist", "relyycast");

// Forward flags to sub-scripts
const forwardArgs = process.argv.slice(2);
const SKIP_SIGN      = forwardArgs.includes("--skip-sign");
const SKIP_NOTARIZE  = forwardArgs.includes("--skip-notarize");

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

// -------------------------------------------------------------------------
// Preflight
// -------------------------------------------------------------------------
function checkDistSrc() {
  const required = [
    path.join(DIST_SRC, process.platform === "win32" ? "relyycast-win_x64.exe" : "relyycast-mac_universal"),
    path.join(DIST_SRC, "resources.neu"),
  ];
  for (const f of required) {
    if (!existsSync(f)) {
      console.error(`[installer] Missing required dist file: ${f}`);
      console.error("  Run `npm run neutralino:build` first.");
      process.exit(1);
    }
  }
}

// -------------------------------------------------------------------------
// Windows — NSIS
// -------------------------------------------------------------------------
function buildWindows() {
  const nsiScript = path.join(SCRIPT_DIR, "windows", "relyycast.nsi");

  // Detect makensis on PATH or common install locations
  const candidates = [
    "makensis",
    "C:\\Program Files (x86)\\NSIS\\makensis.exe",
    "C:\\Program Files\\NSIS\\makensis.exe",
  ];

  let makensis = null;
  for (const c of candidates) {
    try {
      execSync(`"${c}" /VERSION`, { stdio: "pipe" });
      makensis = c;
      break;
    } catch {
      // not found, try next
    }
  }

  if (!makensis) {
    console.log("[installer] makensis not found — attempting auto-install via winget...");
    try {
      execSync("winget install NSIS.NSIS --silent --accept-package-agreements --accept-source-agreements", { stdio: "inherit" });
      console.log("[installer] NSIS installed. Retrying...");
    } catch {
      console.error("[installer] winget install failed.");
      console.error("  Install NSIS manually: https://nsis.sourceforge.io/Download");
      console.error("  Or: choco install nsis");
      process.exit(1);
    }

    // Retry after install
    for (const c of candidates) {
      try {
        execSync(`"${c}" /VERSION`, { stdio: "pipe" });
        makensis = c;
        break;
      } catch {
        // still not found
      }
    }

    if (!makensis) {
      console.error("[installer] makensis still not found after install. Try opening a new terminal and re-running.");
      process.exit(1);
    }
  }

  const mp3HelperPath = path.join(DIST_SRC, "build", "bin", "relyy-mp3-helper.exe");
  const skipMp3Flag   = existsSync(mp3HelperPath) ? "" : "/DSKIP_MP3_HELPER";

  run(`"${makensis}" /V3 ${skipMp3Flag} "${nsiScript}"`.trim());

  console.log("\n[installer] Windows installer: dist\\relyycast-setup.exe");
}

// -------------------------------------------------------------------------
// macOS — build-pkg.sh
// -------------------------------------------------------------------------
function buildMac() {
  const buildPkg = path.join(SCRIPT_DIR, "mac", "build-pkg.sh");

  // Ensure shell script is executable
  run(`chmod +x "${buildPkg}"`);

  const flags = [
    SKIP_SIGN     ? "--skip-sign"      : "",
    SKIP_NOTARIZE ? "--skip-notarize"  : "",
  ].filter(Boolean).join(" ");

  run(`bash "${buildPkg}" ${flags}`.trimEnd());

  console.log("\n[installer] macOS installer: dist/RelyyCast.pkg");
}

// -------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------
console.log("[installer] Checking dist source files...");
checkDistSrc();

if (process.platform === "win32") {
  console.log("[installer] Building Windows installer (NSIS)...");
  buildWindows();
} else if (process.platform === "darwin") {
  console.log("[installer] Building macOS installer (.pkg)...");
  buildMac();
} else {
  console.error(`[installer] Unsupported platform: ${process.platform}`);
  process.exit(1);
}
