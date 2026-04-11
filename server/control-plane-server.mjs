import http from "node:http";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.RELYY_API_PORT ?? 8787);
const HOST = process.env.RELYY_API_HOST ?? "127.0.0.1";

const pairingsByCode = new Map();
const heartbeatsByAgent = new Map();
const PAIRING_TTL_MS = 5 * 60 * 1000;

function readJsonBody(req) {
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
  });
}

function writeJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function generatePairingCode() {
  const left = randomBytes(2).toString("hex").toUpperCase();
  const right = randomBytes(1).toString("hex").toUpperCase();
  return `RLY-${left}${right}`;
}

function cleanupExpiredPairings() {
  const now = Date.now();
  for (const [code, pairing] of pairingsByCode) {
    if (pairing.expiresAt <= now && pairing.status === "pending") {
      pairingsByCode.set(code, {
        ...pairing,
        status: "expired",
      });
    }
  }
}

async function handlePairStart(req, res) {
  const body = await readJsonBody(req);

  cleanupExpiredPairings();
  let pairingCode = generatePairingCode();
  while (pairingsByCode.has(pairingCode)) {
    pairingCode = generatePairingCode();
  }

  const createdAt = Date.now();
  const record = {
    id: randomBytes(8).toString("hex"),
    pairingCode,
    stationId: typeof body.stationId === "string" && body.stationId.trim() ? body.stationId.trim() : "station-dev",
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
    approvedAt: new Date(approved.approvedAt).toISOString(),
  });
}

async function handlePairStatus(req, res) {
  const body = await readJsonBody(req);
  const pairingCode = typeof body.pairingCode === "string" ? body.pairingCode.trim().toUpperCase() : "";

  if (!pairingCode) {
    writeJson(res, 400, { error: "pairingCode is required" });
    return;
  }

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
        localPort: 8177,
        streamPath: "/live.mp3",
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
    localPort: typeof body.localPort === "number" ? body.localPort : 8177,
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

function handleHeartbeatGet(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
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

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) {
    writeJson(res, 400, { error: "invalid request" });
    return;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    writeJson(res, 200, {
      ok: true,
      pairings: pairingsByCode.size,
      agents: heartbeatsByAgent.size,
      now: new Date().toISOString(),
    });
    return;
  }

  if (req.method === "POST" && req.url === "/api/desktop/pair/start") {
    await handlePairStart(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/desktop/pair/approve") {
    await handlePairApprove(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/desktop/pair/status") {
    await handlePairStatus(req, res);
    return;
  }

  if (req.method === "POST" && req.url === "/api/desktop/heartbeat") {
    await handleHeartbeatPost(req, res);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/api/desktop/heartbeat")) {
    handleHeartbeatGet(req, res);
    return;
  }

  writeJson(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`[api] control-plane server listening on http://${HOST}:${PORT}`);
});
