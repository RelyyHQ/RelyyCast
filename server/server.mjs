import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const HOST = "127.0.0.1";
const PORT = Number(process.env.RELYY_SERVER_PORT ?? process.env.RELYY_STREAM_PORT ?? 8177);

const DEFAULT_MOUNT = normalizeMountPath(process.env.RELYY_STREAM_DEFAULT_MOUNT ?? "/live.mp3") ?? "/live.mp3";
const SOURCE_METHOD = (process.env.RELYY_STREAM_SOURCE_METHOD ?? "SOURCE").toUpperCase();
const SOURCE_USER = process.env.RELYY_STREAM_SOURCE_USER ?? "source";
const SOURCE_PASSWORD = process.env.RELYY_STREAM_SOURCE_PASSWORD ?? "";
const ALLOW_ANON_SOURCE =
  String(process.env.RELYY_STREAM_ALLOW_ANON_SOURCE ?? "").toLowerCase() === "true" ||
  process.env.RELYY_STREAM_ALLOW_ANON_SOURCE === "1";
const KEEP_LISTENERS_ON_SOURCE_END =
  String(process.env.RELYY_STREAM_KEEP_LISTENERS_ON_SOURCE_END ?? "").toLowerCase() === "true" ||
  process.env.RELYY_STREAM_KEEP_LISTENERS_ON_SOURCE_END === "1";
const ICY_META_INT = Math.max(256, Number(process.env.RELYY_STREAM_ICY_METAINT ?? 16000));

const PAIRING_TTL_MS = 5 * 60 * 1000;
const FFMPEG_RESTART_BACKOFF_MS = 2000;
const SAMPLE_RATE = process.env.RELYY_STREAM_SAMPLE_RATE ?? "44100";
const CHANNELS = process.env.RELYY_STREAM_CHANNELS ?? "2";
const CONFIG_FILE_PATH = path.resolve(process.cwd(), ".tmp", "relyy-config.json");

const DEFAULT_CONFIG = Object.freeze({
  inputUrl: "http://127.0.0.1:4850/live.mp3",
  stationName: "RelyyCast Dev Stream",
  genre: "Various",
  description: "Local FFmpeg test source",
  bitrate: "128k",
  ffmpegPath: "",
});

// Step 1: API compatibility is intentionally locked during the merge.
const API_COMPATIBILITY = Object.freeze({
  pairStart: ["/api/pair/start", "/api/desktop/pair/start"],
  pairApprove: ["/api/pair/approve", "/api/desktop/pair/approve"],
  pairStatus: ["/api/pair/status", "/api/desktop/pair/status"],
  heartbeat: ["/api/heartbeat", "/api/desktop/heartbeat"],
  mountListing: ["/mounts", "/api/mounts"],
  metadataUpdate: ["/metadata", "/admin/metadata"],
});

const mountMap = new Map();
const pairingsByCode = new Map();
const heartbeatsByAgent = new Map();
const startedAt = Date.now();

let configFromFile = { ...DEFAULT_CONFIG };
let ffmpegProc = null;
let ingestReq = null;
let shuttingDown = false;
let restartRequested = false;
let suppressRestartOnce = false;
let restartTimer = null;

await initializeConfigFile();

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, SOURCE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Icy-MetaData",
  };
}

function writeJson(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    ...extraHeaders,
  });
  res.end(body);
}

function normalizeExecutablePath(value) {
  if (!value || typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/^"(.*)"$/, "$1");
}

function normalizeMountPath(rawPath) {
  if (typeof rawPath !== "string") {
    return null;
  }

  const mount = rawPath.trim();
  if (!mount || mount === "/") {
    return null;
  }

  if (!mount.startsWith("/") || mount.includes("..") || mount.includes("?")) {
    return null;
  }

  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]+$/.test(mount)) {
    return null;
  }
  return mount;
}

function isReservedPath(pathname) {
  return (
    pathname === "/health" ||
    pathname === "/mounts" ||
    pathname === "/api/mounts" ||
    pathname === "/metadata" ||
    pathname === "/admin/metadata" ||
    pathname === "/api/config" ||
    pathname.startsWith("/api/")
  );
}

function sanitizeMetadataValue(value, maxLength = 240) {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/[\r\n]/g, " ").slice(0, maxLength).trim();
}

function sanitizeIcyField(value) {
  return sanitizeMetadataValue(value).replace(/'/g, "\\'").replace(/;/g, ",");
}

function normalizeConfig(input) {
  return {
    inputUrl: sanitizeMetadataValue(String(input.inputUrl ?? DEFAULT_CONFIG.inputUrl), 500) || DEFAULT_CONFIG.inputUrl,
    stationName: sanitizeMetadataValue(String(input.stationName ?? DEFAULT_CONFIG.stationName), 120) || DEFAULT_CONFIG.stationName,
    genre: sanitizeMetadataValue(String(input.genre ?? DEFAULT_CONFIG.genre), 120) || DEFAULT_CONFIG.genre,
    description: sanitizeMetadataValue(String(input.description ?? DEFAULT_CONFIG.description), 180) || DEFAULT_CONFIG.description,
    bitrate: sanitizeMetadataValue(String(input.bitrate ?? DEFAULT_CONFIG.bitrate), 24) || DEFAULT_CONFIG.bitrate,
    ffmpegPath: normalizeExecutablePath(input.ffmpegPath ?? DEFAULT_CONFIG.ffmpegPath),
  };
}

function applyEnvOverrides(baseConfig) {
  const envInputUrl = process.env.RELYY_SERVER_INPUT_URL ?? process.env.RELYY_STREAM_INPUT_URL;
  const envStationName = process.env.RELYY_SERVER_STATION_NAME ?? process.env.RELYY_STREAM_ICE_NAME;
  const envGenre = process.env.RELYY_SERVER_GENRE ?? process.env.RELYY_STREAM_ICE_GENRE;
  const envDescription = process.env.RELYY_SERVER_DESCRIPTION ?? process.env.RELYY_STREAM_ICE_DESCRIPTION;
  const envBitrate = process.env.RELYY_SERVER_BITRATE ?? process.env.RELYY_STREAM_BITRATE;
  const envFfmpegPath =
    process.env.RELYY_SERVER_FFMPEG_PATH ??
    process.env.FFMPEG_BIN ??
    process.env.RELYY_RADIO_FFMPEG_PATH;

  return normalizeConfig({
    ...baseConfig,
    ...(envInputUrl ? { inputUrl: envInputUrl } : {}),
    ...(envStationName ? { stationName: envStationName } : {}),
    ...(envGenre ? { genre: envGenre } : {}),
    ...(envDescription ? { description: envDescription } : {}),
    ...(envBitrate ? { bitrate: envBitrate } : {}),
    ...(envFfmpegPath ? { ffmpegPath: envFfmpegPath } : {}),
  });
}

function getRuntimeConfig() {
  return applyEnvOverrides(configFromFile);
}

async function initializeConfigFile() {
  const configDir = path.dirname(CONFIG_FILE_PATH);
  if (!existsSync(configDir)) {
    await mkdir(configDir, { recursive: true });
  }

  if (!existsSync(CONFIG_FILE_PATH)) {
    configFromFile = { ...DEFAULT_CONFIG };
    await writeFile(CONFIG_FILE_PATH, `${JSON.stringify(configFromFile, null, 2)}\n`, "utf8");
    return;
  }

  try {
    const raw = await readFile(CONFIG_FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    configFromFile = normalizeConfig({ ...DEFAULT_CONFIG, ...(parsed && typeof parsed === "object" ? parsed : {}) });
  } catch {
    configFromFile = { ...DEFAULT_CONFIG };
    await writeFile(CONFIG_FILE_PATH, `${JSON.stringify(configFromFile, null, 2)}\n`, "utf8");
  }
}

async function persistConfig(patch) {
  const next = normalizeConfig({ ...configFromFile, ...patch });
  configFromFile = next;
  await writeFile(CONFIG_FILE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

async function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        resolve(parsed && typeof parsed === "object" ? parsed : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

function parseBasicAuthorization(headerValue) {
  if (!headerValue || typeof headerValue !== "string" || !headerValue.startsWith("Basic ")) {
    return null;
  }
  try {
    const decoded = Buffer.from(headerValue.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator === -1) {
      return null;
    }
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function isSourceAuthorized(req) {
  if (ALLOW_ANON_SOURCE || !SOURCE_PASSWORD) {
    return true;
  }
  const auth = parseBasicAuthorization(req.headers.authorization);
  return Boolean(auth && auth.username === SOURCE_USER && auth.password === SOURCE_PASSWORD);
}

function createMount(mountPath) {
  const cfg = getRuntimeConfig();
  return {
    path: mountPath,
    listeners: new Set(),
    source: null,
    bytesIn: 0,
    chunkCount: 0,
    startedAt: Date.now(),
    lastChunkAt: 0,
    contentType: "audio/mpeg",
    metadata: {
      name: cfg.stationName,
      description: cfg.description,
      genre: cfg.genre,
      url: "",
      song: "",
      updatedAt: Date.now(),
    },
  };
}

function getOrCreateMount(mountPath) {
  let mount = mountMap.get(mountPath);
  if (!mount) {
    mount = createMount(mountPath);
    mountMap.set(mountPath, mount);
  }
  return mount;
}

function getTotalListenerCount() {
  let count = 0;
  for (const mount of mountMap.values()) {
    count += mount.listeners.size;
  }
  return count;
}

function summarizeMount(mount) {
  return {
    path: mount.path,
    sourceConnected: Boolean(mount.source),
    listenerCount: mount.listeners.size,
    bytesIn: mount.bytesIn,
    chunkCount: mount.chunkCount,
    lastChunkAt: mount.lastChunkAt ? new Date(mount.lastChunkAt).toISOString() : null,
    metadata: {
      ...mount.metadata,
      updatedAt: mount.metadata.updatedAt ? new Date(mount.metadata.updatedAt).toISOString() : null,
    },
  };
}

function buildIcyMetadataBlock(mount) {
  const title = sanitizeIcyField(mount.metadata.song);
  const url = sanitizeIcyField(mount.metadata.url);

  if (!title && !url) {
    return Buffer.from([0]);
  }

  const fields = [`StreamTitle='${title}';`];
  if (url) {
    fields.push(`StreamUrl='${url}';`);
  }

  const payload = Buffer.from(fields.join(""), "utf8");
  const lengthByte = Math.ceil(payload.length / 16);
  const block = Buffer.alloc(1 + lengthByte * 16);
  block[0] = lengthByte;
  payload.copy(block, 1);
  return block;
}

function removeListener(mount, listener) {
  mount.listeners.delete(listener);
}

function writeToListenerOrDrop(mount, listener, chunk) {
  if (listener.res.destroyed || listener.res.writableEnded) {
    removeListener(mount, listener);
    return false;
  }

  const ok = listener.res.write(chunk);
  if (!ok) {
    listener.res.destroy();
    removeListener(mount, listener);
    return false;
  }
  return true;
}

function fanOutChunkToMount(mount, chunk) {
  mount.bytesIn += chunk.length;
  mount.chunkCount += 1;
  mount.lastChunkAt = Date.now();

  for (const listener of mount.listeners) {
    if (!listener.wantsIcyMetadata) {
      writeToListenerOrDrop(mount, listener, chunk);
      continue;
    }

    let offset = 0;
    while (offset < chunk.length) {
      const bytesToWrite = Math.min(listener.bytesUntilMetadata, chunk.length - offset);
      const slice = chunk.subarray(offset, offset + bytesToWrite);
      const wroteAudio = writeToListenerOrDrop(mount, listener, slice);
      if (!wroteAudio) {
        break;
      }

      offset += bytesToWrite;
      listener.bytesUntilMetadata -= bytesToWrite;
      if (listener.bytesUntilMetadata === 0) {
        const metadataBlock = buildIcyMetadataBlock(mount);
        const wroteMetadata = writeToListenerOrDrop(mount, listener, metadataBlock);
        if (!wroteMetadata) {
          break;
        }
        listener.bytesUntilMetadata = ICY_META_INT;
      }
    }
  }
}

function endMountListeners(mount, reason) {
  for (const listener of mount.listeners) {
    if (!listener.res.writableEnded && !listener.res.destroyed) {
      listener.res.end();
    }
  }
  mount.listeners.clear();
  if (reason) {
    console.log(`[stream] mount ${mount.path} listeners closed (${reason})`);
  }
}

function getListenerHeaders(mount, wantsIcyMetadata) {
  const headers = {
    ...corsHeaders(),
    "Content-Type": mount.contentType,
    "Transfer-Encoding": "chunked",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
  };

  if (wantsIcyMetadata) {
    headers["icy-metaint"] = String(ICY_META_INT);
    headers["icy-name"] = mount.metadata.name || `RelyyCast ${mount.path}`;
    headers["icy-description"] = mount.metadata.description || "";
    headers["icy-genre"] = mount.metadata.genre || "";
    headers["icy-url"] = mount.metadata.url || "";
  }
  return headers;
}

function handleListener(req, res, mountPath) {
  const mount = getOrCreateMount(mountPath);
  const wantsIcyMetadata = String(req.headers["icy-metadata"] ?? "") === "1";
  const headers = getListenerHeaders(mount, wantsIcyMetadata);

  if (req.method === "HEAD") {
    res.writeHead(200, headers);
    res.end();
    return;
  }

  res.writeHead(200, headers);

  const listener = {
    res,
    wantsIcyMetadata,
    bytesUntilMetadata: ICY_META_INT,
  };
  mount.listeners.add(listener);

  res.on("close", () => {
    removeListener(mount, listener);
  });
}

function syncMountMetadataFromConfig(config) {
  const mount = mountMap.get(DEFAULT_MOUNT);
  if (!mount) {
    return;
  }
  mount.metadata.name = config.stationName;
  mount.metadata.description = config.description;
  mount.metadata.genre = config.genre;
  mount.metadata.updatedAt = Date.now();
}

function handleSource(req, res, mountPath) {
  if (!isSourceAuthorized(req)) {
    writeJson(
      res,
      401,
      { ok: false, error: "source authorization failed" },
      { "WWW-Authenticate": 'Basic realm="RelyyCast Source"' },
    );
    return;
  }

  const mount = getOrCreateMount(mountPath);
  if (mount.source) {
    writeJson(res, 409, { ok: false, error: `source already connected on ${mountPath}` });
    return;
  }

  if (mountPath === DEFAULT_MOUNT) {
    const cfg = getRuntimeConfig();
    mount.metadata.name = cfg.stationName;
    mount.metadata.description = cfg.description;
    mount.metadata.genre = cfg.genre;
    mount.metadata.updatedAt = Date.now();
  }

  mount.source = {
    connectedAt: Date.now(),
    remoteAddress: req.socket.remoteAddress ?? null,
    userAgent: String(req.headers["user-agent"] ?? ""),
  };

  const contentType = sanitizeMetadataValue(String(req.headers["content-type"] ?? ""), 80);
  if (contentType.startsWith("audio/")) {
    mount.contentType = contentType;
  }

  if (!res.headersSent) {
    res.writeHead(200, {
      ...corsHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
  }

  req.on("data", (chunk) => {
    fanOutChunkToMount(mount, chunk);
  });

  const closeSource = (reason) => {
    mount.source = null;
    if (!KEEP_LISTENERS_ON_SOURCE_END) {
      endMountListeners(mount, reason);
    }
  };

  req.on("end", () => {
    closeSource("source ended");
    if (!res.writableEnded) {
      res.end("ok\n");
    }
  });

  req.on("error", () => {
    closeSource("source error");
    if (!res.writableEnded) {
      res.end("source stream error\n");
    }
  });

  req.on("close", () => {
    if (mount.source) {
      closeSource("source disconnected");
      if (!res.writableEnded) {
        res.end();
      }
    }
  });
}

function handleHealth(res) {
  const mounts = Array.from(mountMap.values()).map((mount) => summarizeMount(mount));

  let bytesIn = 0;
  let chunkCount = 0;
  let lastChunkAt = 0;
  for (const mount of mountMap.values()) {
    bytesIn += mount.bytesIn;
    chunkCount += mount.chunkCount;
    if (mount.lastChunkAt > lastChunkAt) {
      lastChunkAt = mount.lastChunkAt;
    }
  }

  writeJson(res, 200, {
    ok: true,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    listenerCount: getTotalListenerCount(),
    mountCount: mounts.length,
    bytesIn,
    chunkCount,
    lastChunkAt: lastChunkAt ? new Date(lastChunkAt).toISOString() : null,
    mounts,
  });
}

function handleMountListing(res) {
  writeJson(res, 200, {
    ok: true,
    mounts: Array.from(mountMap.values()).map((mount) => summarizeMount(mount)),
  });
}

function handleMetadataUpdate(url, res) {
  const mountPath = normalizeMountPath(url.searchParams.get("mount") ?? "");
  if (!mountPath) {
    writeJson(res, 400, { ok: false, error: "mount query param is required" });
    return;
  }

  const mount = getOrCreateMount(mountPath);
  const titleCandidate = url.searchParams.get("song") ?? url.searchParams.get("title");

  if (titleCandidate !== null) {
    mount.metadata.song = sanitizeMetadataValue(titleCandidate);
  }
  if (url.searchParams.get("name") !== null) {
    mount.metadata.name = sanitizeMetadataValue(url.searchParams.get("name"), 120);
  }
  if (url.searchParams.get("description") !== null) {
    mount.metadata.description = sanitizeMetadataValue(url.searchParams.get("description"), 180);
  }
  if (url.searchParams.get("genre") !== null) {
    mount.metadata.genre = sanitizeMetadataValue(url.searchParams.get("genre"), 120);
  }
  if (url.searchParams.get("url") !== null) {
    mount.metadata.url = sanitizeMetadataValue(url.searchParams.get("url"), 180);
  }
  mount.metadata.updatedAt = Date.now();

  writeJson(res, 200, {
    ok: true,
    mount: summarizeMount(mount),
  });
}

function cleanupExpiredPairings() {
  const now = Date.now();
  for (const [code, pairing] of pairingsByCode) {
    if (pairing.expiresAt <= now && pairing.status === "pending") {
      pairingsByCode.set(code, { ...pairing, status: "expired" });
    }
  }
}

function generatePairingCode() {
  return `RLY-${randomBytes(3).toString("hex").toUpperCase()}`;
}

async function handlePairStart(req, res) {
  const body = await readJsonBody(req);
  const stationId = typeof body.stationId === "string" && body.stationId.trim() ? body.stationId.trim() : "station-dev";

  cleanupExpiredPairings();
  let pairingCode = generatePairingCode();
  while (pairingsByCode.has(pairingCode)) {
    pairingCode = generatePairingCode();
  }

  const createdAt = Date.now();
  const record = {
    id: randomBytes(8).toString("hex"),
    pairingCode,
    stationId,
    deviceName: typeof body.deviceName === "string" ? body.deviceName : "Unknown device",
    platform: typeof body.platform === "string" ? body.platform : "unknown",
    appVersion: typeof body.appVersion === "string" ? body.appVersion : "0.0.0",
    createdAt,
    expiresAt: createdAt + PAIRING_TTL_MS,
    status: "pending",
  };

  pairingsByCode.set(record.pairingCode, record);
  writeJson(res, 200, {
    pairingId: record.id,
    pairingCode: record.pairingCode,
    stationId: record.stationId,
    status: record.status,
    expiresAt: new Date(record.expiresAt).toISOString(),
  });
}

async function handlePairApprove(req, res) {
  const body = await readJsonBody(req);
  const pairingCode = typeof body.pairingCode === "string" ? body.pairingCode.trim().toUpperCase() : "";
  if (!pairingCode) {
    writeJson(res, 400, { error: "pairingCode is required" });
    return;
  }

  cleanupExpiredPairings();
  const existing = pairingsByCode.get(pairingCode);
  if (!existing) {
    writeJson(res, 404, { error: "Pairing code not found" });
    return;
  }

  const approved = {
    ...existing,
    status: existing.status === "pending" ? "approved" : existing.status,
    approvedAt: Date.now(),
  };
  pairingsByCode.set(pairingCode, approved);

  writeJson(res, 200, {
    pairingCode,
    status: approved.status,
    approvedAt: approved.approvedAt ? new Date(approved.approvedAt).toISOString() : null,
  });
}

function readPairingCodeFromQuery(url) {
  const raw = url.searchParams.get("pairingCode");
  return raw ? raw.trim().toUpperCase() : "";
}

async function readPairingCodeFromBody(req) {
  const body = await readJsonBody(req);
  return typeof body.pairingCode === "string" ? body.pairingCode.trim().toUpperCase() : "";
}

function writePairStatusResponse(res, pairingCode) {
  cleanupExpiredPairings();
  const pairing = pairingsByCode.get(pairingCode);
  if (!pairing) {
    writeJson(res, 404, { error: "Pairing code not found" });
    return;
  }

  if (pairing.status === "approved") {
    pairingsByCode.set(pairingCode, {
      ...pairing,
      status: "consumed",
      consumedAt: Date.now(),
    });

    writeJson(res, 200, {
      status: "approved",
      stationId: pairing.stationId,
      agentConfig: {
        localPort: PORT,
        streamPath: DEFAULT_MOUNT,
        healthPath: "/health",
        tunnelToken: "dev-token-placeholder",
      },
    });
    return;
  }

  writeJson(res, 200, {
    status: pairing.status,
    stationId: pairing.stationId,
    expiresAt: new Date(pairing.expiresAt).toISOString(),
  });
}

async function handlePairStatus(req, res, url) {
  const pairingCode =
    req.method === "GET"
      ? readPairingCodeFromQuery(url)
      : await readPairingCodeFromBody(req);

  if (!pairingCode) {
    writeJson(res, 400, { error: "pairingCode is required" });
    return;
  }
  writePairStatusResponse(res, pairingCode);
}

async function handleHeartbeatPost(req, res) {
  const body = await readJsonBody(req);
  const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
  const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";

  if (!stationId || !agentId) {
    writeJson(res, 400, { error: "stationId and agentId are required" });
    return;
  }

  const heartbeat = {
    stationId,
    agentId,
    status: typeof body.status === "string" ? body.status : "online",
    encoderStatus: typeof body.encoderStatus === "string" ? body.encoderStatus : "running",
    tunnelStatus: typeof body.tunnelStatus === "string" ? body.tunnelStatus : "connected",
    listenerCount: typeof body.listenerCount === "number" ? body.listenerCount : 0,
    localPort: typeof body.localPort === "number" ? body.localPort : PORT,
    lastSeenAt: Date.now(),
  };

  heartbeatsByAgent.set(agentId, heartbeat);
  writeJson(res, 200, {
    ok: true,
    heartbeat: {
      ...heartbeat,
      lastSeenAt: new Date(heartbeat.lastSeenAt).toISOString(),
    },
  });
}

function handleHeartbeatGet(res, url) {
  const agentId = url.searchParams.get("agentId")?.trim();
  if (!agentId) {
    writeJson(res, 400, { error: "agentId query param is required" });
    return;
  }

  const heartbeat = heartbeatsByAgent.get(agentId);
  if (!heartbeat) {
    writeJson(res, 404, { error: "No heartbeat found for agent" });
    return;
  }

  writeJson(res, 200, {
    heartbeat: {
      ...heartbeat,
      lastSeenAt: new Date(heartbeat.lastSeenAt).toISOString(),
    },
  });
}

function resolveFfmpegPath(config) {
  const configPath = normalizeExecutablePath(config.ffmpegPath);
  if (configPath) {
    return configPath;
  }

  const ffmpegBin = normalizeExecutablePath(process.env.FFMPEG_BIN);
  if (ffmpegBin) {
    return ffmpegBin;
  }

  const relyyRadioFfmpegPath = normalizeExecutablePath(process.env.RELYY_RADIO_FFMPEG_PATH);
  if (relyyRadioFfmpegPath) {
    return relyyRadioFfmpegPath;
  }

  if (process.platform === "win32") {
    const windowsCandidates = [
      path.resolve(process.cwd(), "bin", "ffmpeg.exe"),
      "C:\\ffmpeg\\bin\\ffmpeg.exe",
      "C:\\ffmpeg\\ffmpeg.exe",
      "C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe",
    ];

    for (const candidate of windowsCandidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

function buildFfmpegArgs(config) {
  return [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "2",
    "-i",
    config.inputUrl,
    "-vn",
    "-ac",
    CHANNELS,
    "-ar",
    SAMPLE_RATE,
    "-b:a",
    config.bitrate,
    "-f",
    "mp3",
    "pipe:1",
  ];
}

function clearRestartTimer() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
}

function scheduleRestart() {
  if (shuttingDown || restartTimer) {
    return;
  }
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startFfmpeg();
  }, FFMPEG_RESTART_BACKOFF_MS);
}

function destroyIngestRequest() {
  if (ingestReq) {
    ingestReq.destroy();
    ingestReq = null;
  }
}

function createIngestRequest(config) {
  const sourceAuth = SOURCE_PASSWORD
    ? Buffer.from(`${SOURCE_USER}:${SOURCE_PASSWORD}`, "utf8").toString("base64")
    : null;

  const request = http.request(
    {
      hostname: HOST,
      port: PORT,
      path: DEFAULT_MOUNT,
      method: SOURCE_METHOD,
      headers: {
        "Content-Type": "audio/mpeg",
        "Transfer-Encoding": "chunked",
        Connection: "keep-alive",
        "User-Agent": "relyycast-ffmpeg-source/1.0",
        "Ice-Name": config.stationName,
        "Ice-Genre": config.genre,
        "Ice-Description": config.description,
        ...(sourceAuth ? { Authorization: `Basic ${sourceAuth}` } : {}),
      },
    },
    (res) => {
      let body = "";
      res.on("data", (chunk) => {
        body += chunk.toString("utf8");
      });
      res.on("end", () => {
        if (body.trim()) {
          console.log(`[ingest] server response ${res.statusCode}: ${body.trim()}`);
        }
      });
    },
  );

  request.on("error", (error) => {
    console.error(`[ingest] request error: ${error.message}`);
    if (ffmpegProc && !ffmpegProc.killed) {
      ffmpegProc.kill("SIGINT");
    }
  });

  return request;
}

function startFfmpeg() {
  if (shuttingDown || ffmpegProc) {
    return;
  }

  clearRestartTimer();
  const config = getRuntimeConfig();
  const ffmpegPath = resolveFfmpegPath(config);
  const args = buildFfmpegArgs(config);

  console.log(`[ingest] spawning ${ffmpegPath} ${args.join(" ")}`);
  console.log(`[ingest] self-ingest target ${SOURCE_METHOD} http://${HOST}:${PORT}${DEFAULT_MOUNT}`);

  ffmpegProc = spawn(ffmpegPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  ffmpegProc.on("spawn", () => {
    ingestReq = createIngestRequest(config);
  });

  ffmpegProc.on("error", (error) => {
    if (error && error.code === "ENOENT") {
      console.error(`[ingest] ffmpeg not found at "${ffmpegPath}"`);
      console.error("[ingest] install FFmpeg or set config.ffmpegPath / RELYY_SERVER_FFMPEG_PATH / FFMPEG_BIN.");
    } else {
      console.error(`[ingest] failed to start ffmpeg: ${error.message}`);
    }
  });

  ffmpegProc.stdout.on("data", (chunk) => {
    if (!ingestReq) {
      return;
    }

    const ok = ingestReq.write(chunk);
    if (!ok) {
      ffmpegProc.stdout.pause();
      ingestReq.once("drain", () => {
        if (ffmpegProc?.stdout) {
          ffmpegProc.stdout.resume();
        }
      });
    }
  });

  ffmpegProc.stderr.on("data", (chunk) => {
    const line = chunk.toString("utf8").trim();
    if (line) {
      console.log(`[ffmpeg] ${line}`);
    }
  });

  ffmpegProc.on("close", (code) => {
    const shouldRestartFromFailure = !shuttingDown && !suppressRestartOnce && code !== 0;
    const shouldStartAfterRequestedRestart = restartRequested && !shuttingDown;

    suppressRestartOnce = false;
    restartRequested = false;
    ffmpegProc = null;

    if (ingestReq) {
      ingestReq.end();
      ingestReq = null;
    }

    console.log(`[ingest] ffmpeg exited with code ${code ?? "unknown"}`);

    if (shouldStartAfterRequestedRestart) {
      startFfmpeg();
      return;
    }

    if (shouldRestartFromFailure) {
      scheduleRestart();
    }
  });
}

function restartFfmpeg(reason) {
  if (shuttingDown) {
    return;
  }

  console.log(`[ingest] restart requested (${reason})`);
  clearRestartTimer();

  if (!ffmpegProc) {
    startFfmpeg();
    return;
  }

  restartRequested = true;
  suppressRestartOnce = true;
  ffmpegProc.kill("SIGINT");
}

async function stopFfmpeg() {
  shuttingDown = true;
  clearRestartTimer();
  destroyIngestRequest();

  if (!ffmpegProc) {
    return;
  }

  await new Promise((resolve) => {
    const proc = ffmpegProc;
    proc.once("close", () => resolve());
    proc.kill("SIGINT");
  });
}

function pathMatches(pathname, options) {
  return options.includes(pathname);
}

async function handleRequest(req, res) {
  if (!req.url || !req.method) {
    writeJson(res, 400, { ok: false, error: "invalid request" });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
  const method = req.method.toUpperCase();
  const pathname = url.pathname;

  if (method === "GET" && pathname === "/health") {
    handleHealth(res);
    return;
  }

  if (method === "GET" && pathMatches(pathname, API_COMPATIBILITY.mountListing)) {
    handleMountListing(res);
    return;
  }

  if ((method === "GET" || method === "POST") && pathMatches(pathname, API_COMPATIBILITY.metadataUpdate)) {
    handleMetadataUpdate(url, res);
    return;
  }

  if (method === "GET" && pathname === "/api/config") {
    writeJson(res, 200, getRuntimeConfig());
    return;
  }

  if (method === "POST" && pathname === "/api/config") {
    const body = await readJsonBody(req);
    await persistConfig(body);
    syncMountMetadataFromConfig(getRuntimeConfig());
    restartFfmpeg("config update");
    writeJson(res, 200, getRuntimeConfig());
    return;
  }

  if (method === "POST" && pathMatches(pathname, API_COMPATIBILITY.pairStart)) {
    await handlePairStart(req, res);
    return;
  }

  if (method === "POST" && pathMatches(pathname, API_COMPATIBILITY.pairApprove)) {
    await handlePairApprove(req, res);
    return;
  }

  if ((method === "GET" || method === "POST") && pathMatches(pathname, API_COMPATIBILITY.pairStatus)) {
    await handlePairStatus(req, res, url);
    return;
  }

  if (method === "POST" && pathMatches(pathname, API_COMPATIBILITY.heartbeat)) {
    await handleHeartbeatPost(req, res);
    return;
  }

  if (method === "GET" && pathMatches(pathname, API_COMPATIBILITY.heartbeat)) {
    handleHeartbeatGet(res, url);
    return;
  }

  const mountPath = normalizeMountPath(pathname);
  if (!mountPath || isReservedPath(mountPath)) {
    writeJson(res, 404, { ok: false, error: "not found" });
    return;
  }

  if (method === "GET" || method === "HEAD") {
    handleListener(req, res, mountPath);
    return;
  }

  if (method === "SOURCE" || method === "PUT" || method === "POST") {
    handleSource(req, res, mountPath);
    return;
  }

  writeJson(res, 405, { ok: false, error: "method not allowed" });
}

const server = http.createServer((req, res) => {
  void handleRequest(req, res).catch((error) => {
    console.error("[server] unhandled request error:", error);
    if (!res.headersSent) {
      writeJson(res, 500, { ok: false, error: "internal server error" });
      return;
    }
    res.end();
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[server] unified server listening on http://${HOST}:${PORT}`);
  console.log(`[server] source endpoint: ${SOURCE_METHOD}|PUT|POST ${DEFAULT_MOUNT}`);
  console.log("[server] listener endpoint: GET /<mount>");
  startFfmpeg();
});

process.on("SIGINT", async () => {
  console.log("[server] shutting down...");
  for (const mount of mountMap.values()) {
    endMountListeners(mount, "shutdown");
  }

  await stopFfmpeg();
  server.close(() => {
    process.exit(0);
  });
});
