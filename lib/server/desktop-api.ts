import type { IncomingMessage, ServerResponse } from "node:http";
import {
  approvePairing,
  consumePairing,
  createPairing,
  getHeartbeat,
  getPairingByCode,
  upsertHeartbeat,
} from "./desktop-agent-store";

type JsonBody = Record<string, unknown>;
type MiddlewareResult = Promise<boolean>;

function normalizePath(urlValue: string | undefined) {
  const url = new URL(urlValue ?? "/", "http://127.0.0.1");
  const path = url.pathname.endsWith("/") && url.pathname.length > 1
    ? url.pathname.slice(0, -1)
    : url.pathname;
  return { path, searchParams: url.searchParams };
}

function toText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toUpperText(value: unknown) {
  return toText(value).toUpperCase();
}

function sendJson(response: ServerResponse, statusCode: number, payload: object) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

async function readJson(request: IncomingMessage): Promise<JsonBody> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as JsonBody;
        resolve(parsed);
      } catch {
        resolve({});
      }
    });
    request.on("error", () => resolve({}));
  });
}

async function handlePairStart(request: IncomingMessage, response: ServerResponse): MiddlewareResult {
  const body = await readJson(request);
  const stationId = toText(body.stationId) || "station-dev";

  const pairing = createPairing({
    stationId,
    deviceName: toText(body.deviceName) || undefined,
    platform: toText(body.platform) || undefined,
    appVersion: toText(body.appVersion) || undefined,
  });

  sendJson(response, 200, {
    pairingId: pairing.id,
    pairingCode: pairing.pairingCode,
    stationId: pairing.stationId,
    status: pairing.status,
    expiresAt: new Date(pairing.expiresAt).toISOString(),
  });
  return true;
}

async function handlePairApprove(request: IncomingMessage, response: ServerResponse): MiddlewareResult {
  const body = await readJson(request);
  const pairingCode = toUpperText(body.pairingCode);
  if (!pairingCode) {
    sendJson(response, 400, { error: "pairingCode is required" });
    return true;
  }

  const pairing = approvePairing(pairingCode);
  if (!pairing) {
    sendJson(response, 404, { error: "Pairing code not found" });
    return true;
  }

  sendJson(response, 200, {
    status: pairing.status,
    pairingCode: pairing.pairingCode,
    stationId: pairing.stationId,
    approvedAt: pairing.approvedAt ? new Date(pairing.approvedAt).toISOString() : null,
  });
  return true;
}

async function handlePairStatus(request: IncomingMessage, response: ServerResponse): MiddlewareResult {
  const body = await readJson(request);
  const pairingCode = toUpperText(body.pairingCode);
  if (!pairingCode) {
    sendJson(response, 400, { error: "pairingCode is required" });
    return true;
  }

  const pairing = getPairingByCode(pairingCode);
  if (!pairing) {
    sendJson(response, 404, { error: "Pairing code not found" });
    return true;
  }

  if (pairing.status === "approved") {
    const consumed = consumePairing(pairingCode) ?? pairing;
    sendJson(response, 200, {
      status: "approved",
      stationId: consumed.stationId,
      agentConfig: {
        localPort: 8177,
        streamPath: "/live.mp3",
        healthPath: "/health",
        tunnelToken: "dev-token-placeholder",
      },
    });
    return true;
  }

  sendJson(response, 200, {
    status: pairing.status,
    stationId: pairing.stationId,
    expiresAt: new Date(pairing.expiresAt).toISOString(),
  });
  return true;
}

async function handleHeartbeatPost(request: IncomingMessage, response: ServerResponse): MiddlewareResult {
  const body = await readJson(request);
  const stationId = toText(body.stationId);
  const agentId = toText(body.agentId);

  if (!stationId || !agentId) {
    sendJson(response, 400, { error: "stationId and agentId are required" });
    return true;
  }

  const heartbeat = upsertHeartbeat({
    stationId,
    agentId,
    status: body.status as "online" | "degraded" | "offline" | undefined,
    encoderStatus: body.encoderStatus as "running" | "stopped" | "error" | undefined,
    tunnelStatus: body.tunnelStatus as "connected" | "disconnected" | "error" | undefined,
    listenerCount: typeof body.listenerCount === "number" ? body.listenerCount : undefined,
    localPort: typeof body.localPort === "number" ? body.localPort : undefined,
  });

  sendJson(response, 200, {
    ok: true,
    heartbeat: {
      ...heartbeat,
      lastSeenAt: new Date(heartbeat.lastSeenAt).toISOString(),
    },
  });
  return true;
}

function handleHeartbeatGet(
  response: ServerResponse,
  searchParams: URLSearchParams,
): boolean {
  const agentId = searchParams.get("agentId")?.trim();
  if (!agentId) {
    sendJson(response, 400, { error: "agentId query param is required" });
    return true;
  }

  const heartbeat = getHeartbeat(agentId);
  if (!heartbeat) {
    sendJson(response, 404, { error: "No heartbeat found for agent" });
    return true;
  }

  sendJson(response, 200, {
    heartbeat: {
      ...heartbeat,
      lastSeenAt: new Date(heartbeat.lastSeenAt).toISOString(),
    },
  });
  return true;
}

export async function handleDesktopApiRequest(
  request: IncomingMessage,
  response: ServerResponse,
): MiddlewareResult {
  const method = request.method?.toUpperCase();
  const { path, searchParams } = normalizePath(request.url);

  if (method === "POST" && path === "/api/desktop/pair/start") {
    return handlePairStart(request, response);
  }

  if (method === "POST" && path === "/api/desktop/pair/approve") {
    return handlePairApprove(request, response);
  }

  if (method === "POST" && path === "/api/desktop/pair/status") {
    return handlePairStatus(request, response);
  }

  if (method === "POST" && path === "/api/desktop/heartbeat") {
    return handleHeartbeatPost(request, response);
  }

  if (method === "GET" && path === "/api/desktop/heartbeat") {
    return handleHeartbeatGet(response, searchParams);
  }

  return false;
}
