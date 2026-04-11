import { randomBytes } from "node:crypto";

export type PairingStatus = "pending" | "approved" | "expired" | "consumed";

export type PairingRecord = {
  id: string;
  pairingCode: string;
  stationId: string;
  deviceName: string;
  platform: string;
  appVersion: string;
  createdAt: number;
  expiresAt: number;
  approvedAt?: number;
  consumedAt?: number;
  status: PairingStatus;
};

export type HeartbeatRecord = {
  stationId: string;
  agentId: string;
  status: "online" | "degraded" | "offline";
  encoderStatus: "running" | "stopped" | "error";
  tunnelStatus: "connected" | "disconnected" | "error";
  listenerCount: number;
  localPort: number;
  lastSeenAt: number;
};

const PAIRING_TTL_MS = 5 * 60 * 1000;
const pairingsByCode = new Map<string, PairingRecord>();
const heartbeatsByAgent = new Map<string, HeartbeatRecord>();

function now() {
  return Date.now();
}

function generatePairingCode() {
  const left = randomBytes(2).toString("hex").toUpperCase();
  const right = randomBytes(1).toString("hex").toUpperCase();
  return `RLY-${left}${right}`;
}

function cleanupExpiredPairings() {
  const current = now();
  for (const [code, pairing] of pairingsByCode) {
    if (pairing.expiresAt <= current && pairing.status === "pending") {
      pairingsByCode.set(code, {
        ...pairing,
        status: "expired",
      });
    }
  }
}

export function createPairing(input: {
  stationId: string;
  deviceName?: string;
  platform?: string;
  appVersion?: string;
}) {
  cleanupExpiredPairings();

  let pairingCode = generatePairingCode();
  while (pairingsByCode.has(pairingCode)) {
    pairingCode = generatePairingCode();
  }

  const createdAt = now();
  const record: PairingRecord = {
    id: randomBytes(8).toString("hex"),
    pairingCode,
    stationId: input.stationId,
    deviceName: input.deviceName ?? "Unknown device",
    platform: input.platform ?? "unknown",
    appVersion: input.appVersion ?? "0.0.0",
    createdAt,
    expiresAt: createdAt + PAIRING_TTL_MS,
    status: "pending",
  };

  pairingsByCode.set(pairingCode, record);
  return record;
}

export function getPairingByCode(pairingCode: string) {
  cleanupExpiredPairings();
  return pairingsByCode.get(pairingCode);
}

export function approvePairing(pairingCode: string) {
  const existing = getPairingByCode(pairingCode);
  if (!existing) {
    return undefined;
  }

  if (existing.status !== "pending") {
    return existing;
  }

  const approved = {
    ...existing,
    status: "approved" as const,
    approvedAt: now(),
  };

  pairingsByCode.set(pairingCode, approved);
  return approved;
}

export function consumePairing(pairingCode: string) {
  const existing = getPairingByCode(pairingCode);
  if (!existing) {
    return undefined;
  }

  const consumed = {
    ...existing,
    status: "consumed" as const,
    consumedAt: now(),
  };

  pairingsByCode.set(pairingCode, consumed);
  return consumed;
}

export function upsertHeartbeat(input: {
  stationId: string;
  agentId: string;
  status?: "online" | "degraded" | "offline";
  encoderStatus?: "running" | "stopped" | "error";
  tunnelStatus?: "connected" | "disconnected" | "error";
  listenerCount?: number;
  localPort?: number;
}) {
  const record: HeartbeatRecord = {
    stationId: input.stationId,
    agentId: input.agentId,
    status: input.status ?? "online",
    encoderStatus: input.encoderStatus ?? "running",
    tunnelStatus: input.tunnelStatus ?? "connected",
    listenerCount: input.listenerCount ?? 0,
    localPort: input.localPort ?? 8177,
    lastSeenAt: now(),
  };

  heartbeatsByAgent.set(record.agentId, record);
  return record;
}

export function getHeartbeat(agentId: string) {
  return heartbeatsByAgent.get(agentId);
}
