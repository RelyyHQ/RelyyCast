export const MEDIAMTX_CONTROL_API_URL = "http://127.0.0.1:9997/v3/paths/list";
export const MEDIAMTX_HLS_MUXERS_API_URL = "http://127.0.0.1:9997/v3/hlsmuxers/list";
export const RELAY_METRICS_POLL_MS = 5000;

function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function normalizeRelayPathKey(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "").toLowerCase();
}

/**
 * Extracts ready/bytes/listener data for a specific relay path from the
 * MediaMTX paths API response. Handles both v2 (paths) and v3 (items) shapes.
 */
export function parseMediaMtxPath(payload: unknown, relayPath: string): MediaMtxPathPayload | null {
  if (!payload || typeof payload !== "object") return null;

  const src = payload as { items?: unknown; paths?: unknown };
  const items = Array.isArray(src.items)
    ? src.items
    : Array.isArray(src.paths)
      ? src.paths
      : null;
  if (!items) return null;

  const targetKey = normalizeRelayPathKey(relayPath);
  const pathItem = items.find((item) => {
    if (!item || typeof item !== "object") return false;
    const name = (item as { name?: unknown }).name;
    return typeof name === "string" && normalizeRelayPathKey(name) === targetKey;
  });
  if (!pathItem || typeof pathItem !== "object") return null;

  const c = pathItem as {
    ready?: unknown;
    sourceReady?: unknown;
    bytesReceived?: unknown;
    readers?: unknown;
    readerCount?: unknown;
    numReaders?: unknown;
    clients?: unknown;
    clientCount?: unknown;
  };

  const fromReaders = Array.isArray(c.readers) ? c.readers.length : 0;
  const fromClients = Array.isArray(c.clients) ? c.clients.length : 0;
  const listenerCount = toNumber(
    c.readerCount,
    toNumber(c.numReaders, toNumber(c.clientCount, Math.max(fromReaders, fromClients))),
  );

  return {
    ready: c.ready === true || c.sourceReady === true,
    bytesReceived: toNumber(c.bytesReceived, 0),
    listenerCount,
  };
}

export function parseMediaMtxHlsMuxerCount(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const src = payload as { itemCount?: unknown; items?: unknown; hlsMuxers?: unknown };
  const fromCount = toNumber(src.itemCount, -1);
  if (fromCount >= 0) return fromCount;
  if (Array.isArray(src.items)) return src.items.length;
  if (Array.isArray(src.hlsMuxers)) return src.hlsMuxers.length;
  return 0;
}

/**
 * Parses listener count from multiple known MP3 server health response shapes
 * (direct listenerCount, Icecast heartbeat, Icecast mounts array).
 */
export function parseMp3HealthListenerCount(payload: unknown): Mp3HealthListenerSnapshot | null {
  if (!payload || typeof payload !== "object") return null;

  const src = payload as {
    listenerCount?: unknown;
    heartbeat?: unknown;
    mounts?: unknown;
    engineReady?: unknown;
    encoderReady?: unknown;
    streamPath?: unknown;
  };

  // Encoder health payloads report two transport connections per logical client.
  const hasEncoderHealthShape =
    typeof src.engineReady === "boolean"
    && typeof src.encoderReady === "boolean"
    && typeof src.streamPath === "string"
    && !Array.isArray(src.mounts);

  const direct = toNumber(src.listenerCount, -1);
  if (direct >= 0) return { listenerCount: direct, hasEncoderHealthShape };

  if (src.heartbeat && typeof src.heartbeat === "object") {
    const fromHeartbeat = toNumber((src.heartbeat as { listenerCount?: unknown }).listenerCount, -1);
    if (fromHeartbeat >= 0) return { listenerCount: fromHeartbeat, hasEncoderHealthShape };
  }

  if (Array.isArray(src.mounts)) {
    let total = 0;
    let found = false;
    for (const mount of src.mounts) {
      if (!mount || typeof mount !== "object") continue;
      const count = toNumber((mount as { listenerCount?: unknown }).listenerCount, -1);
      if (count >= 0) {
        total += count;
        found = true;
      }
    }
    if (found) return { listenerCount: total, hasEncoderHealthShape };
  }

  return null;
}

export function normalizeMp3ListenerCount(
  snapshot: Mp3HealthListenerSnapshot | null,
  ffmpegIngestRunning: boolean,
): number {
  if (!snapshot) return 0;
  // Subtract the ingest process itself from the listener count.
  const adjusted = Math.max(0, snapshot.listenerCount - (ffmpegIngestRunning ? 1 : 0));
  // Encoder health payloads count each client as two transport connections.
  return snapshot.hasEncoderHealthShape ? Math.ceil(adjusted / 2) : adjusted;
}
