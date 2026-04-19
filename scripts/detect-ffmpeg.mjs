import path from "node:path";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

function normalize(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/^"(.*)"$/, "$1");
}

function firstOutputLine(output) {
  if (typeof output !== "string") {
    return "";
  }
  const lines = output.split(/\r?\n/g);
  for (const line of lines) {
    const normalized = normalize(line);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function commandExists(command, args) {
  const result = spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return "";
  }
  return firstOutputLine(result.stdout ?? "");
}

function detectFromEnv() {
  const candidates = [
    process.env.RELYY_SERVER_FFMPEG_PATH,
    process.env.FFMPEG_BIN,
    process.env.RELYY_RADIO_FFMPEG_PATH,
  ];
  for (const candidate of candidates) {
    const normalized = normalize(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function detectFromCommonPaths() {
  const isWindows = process.platform === "win32";
  const candidates = isWindows
    ? [
      path.resolve(process.cwd(), "bin", "ffmpeg.exe"),
      "C:\\ffmpeg\\bin\\ffmpeg.exe",
      "C:\\ffmpeg\\ffmpeg.exe",
      "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
    ]
    : [
      path.resolve(process.cwd(), "bin", "ffmpeg"),
      "/usr/local/bin/ffmpeg",
      "/opt/homebrew/bin/ffmpeg",
      "/usr/bin/ffmpeg",
    ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return "";
}

function detectFfmpeg() {
  const envPath = detectFromEnv();
  if (envPath) {
    return { available: true, path: envPath, source: "env" };
  }

  if (process.platform === "win32") {
    const wherePath = commandExists("where", ["ffmpeg"]);
    if (wherePath) {
      return { available: true, path: wherePath, source: "where" };
    }
  } else {
    const whichPath = commandExists("which", ["ffmpeg"]);
    if (whichPath) {
      return { available: true, path: whichPath, source: "which" };
    }
  }

  const commonPath = detectFromCommonPaths();
  if (commonPath) {
    return { available: true, path: commonPath, source: "common-path" };
  }

  return { available: false, path: "", source: "none" };
}

try {
  const detection = detectFfmpeg();
  if (detection.available) {
    console.log(`[ffmpeg-detect] available (${detection.source}): ${detection.path}`);
  } else {
    console.log("[ffmpeg-detect] unavailable");
  }
  console.log(JSON.stringify(detection));
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log("[ffmpeg-detect] unavailable");
  console.log(JSON.stringify({ available: false, path: "", source: "error", message }));
  process.exit(0);
}
