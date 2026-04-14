import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { chmod, cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const BUILD_ROOT = path.resolve(REPO_ROOT, "build");
const BUILD_MEDIAMTX_ROOT = path.resolve(BUILD_ROOT, "mediamtx");
const BUILD_BIN_ROOT = path.resolve(BUILD_ROOT, "bin");
const MP3_HELPER_DIST_ROOT = path.resolve(REPO_ROOT, "runtime", "bun-mp3-helper", "dist");
const MP3_HELPER_BINARY_NAME = process.platform === "win32" ? "relyy-mp3-helper.exe" : "relyy-mp3-helper";
const CLOUDFLARED_BINARY_NAME = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
const CLOUDFLARED_REPO_ROOT = path.resolve(REPO_ROOT, "cloudflared");

function getPlatformAssetFolders() {
  if (process.platform === "win32") {
    return ["win"];
  }

  if (process.platform === "darwin") {
    return ["mac"];
  }

  return [];
}

async function copyIfPresent(sourcePath, destinationPath) {
  if (!existsSync(sourcePath)) {
    return false;
  }

  try {
    await cp(sourcePath, destinationPath, { recursive: true });
  } catch (err) {
    if (err.code === "EPERM") {
      console.warn(`[build] could not copy ${path.basename(sourcePath)} (file may be locked/in-use), skipping`);
      return existsSync(destinationPath); // treat as success if dest already exists
    }
    throw err;
  }
  return true;
}

function getMp3HelperBinaryCandidates() {
  const explicitBinary = process.env.RELYY_MP3_HELPER_BINARY?.trim();
  if (explicitBinary) {
    return [path.resolve(REPO_ROOT, explicitBinary)];
  }

  return [
    path.resolve(MP3_HELPER_DIST_ROOT, "host", MP3_HELPER_BINARY_NAME),
    path.resolve(MP3_HELPER_DIST_ROOT, `${process.platform}-${process.arch}`, MP3_HELPER_BINARY_NAME),
    path.resolve(MP3_HELPER_DIST_ROOT, process.platform === "win32" ? "bun-windows-x64-modern" : "bun-linux-x64-modern", MP3_HELPER_BINARY_NAME),
    path.resolve(MP3_HELPER_DIST_ROOT, process.platform === "win32" ? "bun-windows-arm64-modern" : "bun-linux-arm64-modern", MP3_HELPER_BINARY_NAME),
    path.resolve(MP3_HELPER_DIST_ROOT, "bun-darwin-x64", MP3_HELPER_BINARY_NAME),
    path.resolve(MP3_HELPER_DIST_ROOT, "bun-darwin-arm64", MP3_HELPER_BINARY_NAME),
  ];
}

function resolveMp3HelperBinary() {
  for (const candidate of getMp3HelperBinaryCandidates()) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveCloudflaredBinary() {
  const explicitBinary = process.env.RELYY_CLOUDFLARED_BINARY?.trim();
  if (explicitBinary) {
    const p = path.resolve(REPO_ROOT, explicitBinary);
    return existsSync(p) ? p : null;
  }

  const platformFolder = process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux";
  const dir = path.resolve(CLOUDFLARED_REPO_ROOT, platformFolder);

  if (!existsSync(dir)) return null;

  const files = readdirSync(dir).filter((f) => !f.startsWith("."));
  if (!files.length) return null;

  return path.resolve(dir, files[0]);
}

async function main() {
  await mkdir(BUILD_ROOT, { recursive: true });
  try {
    await rm(BUILD_MEDIAMTX_ROOT, { recursive: true, force: true });
  } catch (err) {
    if (err.code !== "EPERM") throw err;
    console.warn("[build] could not remove mediamtx build dir (files may be locked), will overwrite in place");
  }
  await mkdir(BUILD_MEDIAMTX_ROOT, { recursive: true });
  await mkdir(BUILD_BIN_ROOT, { recursive: true });

  const copiedTargets = [];
  const configSourcePath = path.resolve(REPO_ROOT, "mediamtx", "mediamtx.yml");
  const configDestinationPath = path.resolve(BUILD_MEDIAMTX_ROOT, "mediamtx.yml");

  if (await copyIfPresent(configSourcePath, configDestinationPath)) {
    copiedTargets.push(path.relative(REPO_ROOT, configDestinationPath));
  }

  for (const folderName of getPlatformAssetFolders()) {
    const sourcePath = path.resolve(REPO_ROOT, "mediamtx", folderName);
    const destinationPath = path.resolve(BUILD_MEDIAMTX_ROOT, folderName);

    if (await copyIfPresent(sourcePath, destinationPath)) {
      copiedTargets.push(path.relative(REPO_ROOT, destinationPath));
    }
  }

  const macBinaryPath = path.resolve(BUILD_MEDIAMTX_ROOT, "mac", "mediamtx");
  if (process.platform !== "win32" && existsSync(macBinaryPath)) {
    await chmod(macBinaryPath, 0o755);
  }

  const helperSourcePath = resolveMp3HelperBinary();
  if (helperSourcePath) {
    const helperDestinationPath = path.resolve(BUILD_BIN_ROOT, MP3_HELPER_BINARY_NAME);
    await cp(helperSourcePath, helperDestinationPath);

    if (process.platform !== "win32") {
      await chmod(helperDestinationPath, 0o755);
    }

    copiedTargets.push(path.relative(REPO_ROOT, helperDestinationPath));
  } else {
    console.log(
      "[build] no Bun MP3 helper binary found to stage. Run `npm run mp3-helper:build` first.",
    );
  }

  const cloudflaredSourcePath = resolveCloudflaredBinary();
  if (cloudflaredSourcePath) {
    const cloudflaredDestinationPath = path.resolve(BUILD_BIN_ROOT, CLOUDFLARED_BINARY_NAME);
    await cp(cloudflaredSourcePath, cloudflaredDestinationPath);

    if (process.platform !== "win32") {
      await chmod(cloudflaredDestinationPath, 0o755);
    }

    copiedTargets.push(path.relative(REPO_ROOT, cloudflaredDestinationPath));
  } else {
    console.log(
      "[build] no cloudflared binary found to stage. Add it under runtime/cloudflared or set RELYY_CLOUDFLARED_BINARY.",
    );
  }

  if (!copiedTargets.length) {
    console.log("[build] no runtime assets were staged.");
    return;
  }

  console.log(`[build] staged runtime assets: ${copiedTargets.join(", ")}`);
}

main().catch((error) => {
  console.error("[build] failed to stage MediaMTX runtime assets:", error);
  process.exit(1);
});
