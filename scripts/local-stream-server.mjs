import http from "node:http";

const PORT = Number(process.env.RELYY_STREAM_PORT ?? 8177);
const HOST = process.env.RELYY_STREAM_HOST ?? "127.0.0.1";

const listeners = new Set();

const streamState = {
  startedAt: Date.now(),
  bytesIn: 0,
  chunkCount: 0,
  lastChunkAt: 0,
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function handleHealth(_req, res) {
  writeJson(res, 200, {
    ok: true,
    uptimeSeconds: Math.floor((Date.now() - streamState.startedAt) / 1000),
    listenerCount: listeners.size,
    bytesIn: streamState.bytesIn,
    chunkCount: streamState.chunkCount,
    lastChunkAt: streamState.lastChunkAt ? new Date(streamState.lastChunkAt).toISOString() : null,
  });
}

function handleLive(_req, res) {
  res.writeHead(200, {
    ...corsHeaders(),
    "Content-Type": "audio/mpeg",
    "Transfer-Encoding": "chunked",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Content-Type-Options": "nosniff",
  });

  listeners.add(res);

  res.on("close", () => {
    listeners.delete(res);
  });
}

function fanOutChunk(chunk) {
  streamState.bytesIn += chunk.length;
  streamState.chunkCount += 1;
  streamState.lastChunkAt = Date.now();

  for (const listener of listeners) {
    if (listener.destroyed) {
      listeners.delete(listener);
      continue;
    }

    const writeSucceeded = listener.write(chunk);
    if (!writeSucceeded) {
      // Keep behavior simple for v1 scaffold: slow consumers are dropped.
      listener.destroy();
      listeners.delete(listener);
    }
  }
}

function handleIngest(req, res) {
  req.on("data", (chunk) => {
    fanOutChunk(chunk);
  });

  req.on("end", () => {
    writeJson(res, 202, {
      ok: true,
      listenerCount: listeners.size,
      bytesIn: streamState.bytesIn,
    });
  });

  req.on("error", () => {
    writeJson(res, 500, {
      ok: false,
      error: "ingest stream error",
    });
  });
}

const server = http.createServer((req, res) => {
  if (!req.url || !req.method) {
    writeJson(res, 400, { ok: false, error: "invalid request" });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    handleHealth(req, res);
    return;
  }

  if (req.method === "GET" && req.url === "/live.mp3") {
    handleLive(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/ingest") {
    handleIngest(req, res);
    return;
  }

  writeJson(res, 404, { ok: false, error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`[stream] listening on http://${HOST}:${PORT}`);
  console.log("[stream] endpoints: GET /health, GET /live.mp3, POST /ingest");
});

process.on("SIGINT", () => {
  for (const listener of listeners) {
    listener.end();
  }
  server.close(() => process.exit(0));
});
