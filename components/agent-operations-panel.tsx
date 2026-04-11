

import { useMemo, useState } from "react";

type PairStartResponse = {
  pairingId: string;
  pairingCode: string;
  stationId: string;
  status: string;
  expiresAt: string;
};

type PairStatusResponse = {
  status: string;
  stationId: string;
  expiresAt?: string;
  agentConfig?: {
    localPort: number;
    streamPath: string;
    healthPath: string;
    tunnelToken: string;
  };
};

type HeartbeatResponse = {
  ok: boolean;
  heartbeat: {
    stationId: string;
    agentId: string;
    status: string;
    encoderStatus: string;
    tunnelStatus: string;
    listenerCount: number;
    localPort: number;
    lastSeenAt: string;
  };
};

const CONTROL_PLANE_BASE = import.meta.env.VITE_CONTROL_PLANE_URL ?? "http://127.0.0.1:8787";

async function postJson<T>(path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${CONTROL_PLANE_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? `Request failed with status ${response.status}`);
  }

  return json;
}

export default function AgentOperationsPanel() {
  const [pairingCode, setPairingCode] = useState("");
  const [pairingStatus, setPairingStatus] = useState("idle");
  const [pairingExpiry, setPairingExpiry] = useState<string | null>(null);
  const [lastHeartbeat, setLastHeartbeat] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  const stationId = "station-dev";
  const agentId = "agent-local-dev";

  const healthLabel = useMemo(() => {
    if (!lastHeartbeat) {
      return "No heartbeat sent yet";
    }

    return `Heartbeat sent ${new Date(lastHeartbeat).toLocaleTimeString()}`;
  }, [lastHeartbeat]);

  async function startPairing() {
    setIsWorking(true);
    setLastError(null);
    try {
      const result = await postJson<PairStartResponse>("/api/desktop/pair/start", {
        stationId,
        platform: "web",
        appVersion: "0.1.0",
        deviceName: "Console UI",
      });

      setPairingCode(result.pairingCode);
      setPairingStatus(result.status);
      setPairingExpiry(result.expiresAt);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Unable to start pairing");
    } finally {
      setIsWorking(false);
    }
  }

  async function approvePairing() {
    if (!pairingCode) {
      setLastError("Start pairing first");
      return;
    }

    setIsWorking(true);
    setLastError(null);
    try {
      const result = await postJson<{ status: string }>("/api/desktop/pair/approve", { pairingCode });
      setPairingStatus(result.status);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Unable to approve pairing");
    } finally {
      setIsWorking(false);
    }
  }

  async function pollPairingStatus() {
    if (!pairingCode) {
      setLastError("Start pairing first");
      return;
    }

    setIsWorking(true);
    setLastError(null);
    try {
      const result = await postJson<PairStatusResponse>("/api/desktop/pair/status", { pairingCode });
      setPairingStatus(result.status);
      if (result.expiresAt) {
        setPairingExpiry(result.expiresAt);
      }
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Unable to poll pairing status");
    } finally {
      setIsWorking(false);
    }
  }

  async function sendHeartbeat() {
    setIsWorking(true);
    setLastError(null);
    try {
      const result = await postJson<HeartbeatResponse>("/api/desktop/heartbeat", {
        stationId,
        agentId,
        status: "online",
        encoderStatus: "running",
        tunnelStatus: "connected",
        listenerCount: Math.floor(Math.random() * 5),
        localPort: 8177,
      });

      setLastHeartbeat(result.heartbeat.lastSeenAt);
    } catch (error) {
      setLastError(error instanceof Error ? error.message : "Unable to send heartbeat");
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="space-y-2.5">
      <div className="grid gap-1.5 sm:grid-cols-2">
        <Metric label="Station" value={stationId} />
        <Metric label="Agent" value={agentId} />
        <Metric label="Pair code" value={pairingCode || "Not issued"} />
        <Metric label="Pair status" value={pairingStatus.toUpperCase()} />
      </div>

      <div className="grid gap-1.5 sm:grid-cols-2">
        <button type="button" onClick={() => void startPairing()} disabled={isWorking} className="h-8 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[11px] font-semibold hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/5">
          Start pairing
        </button>
        <button type="button" onClick={() => void approvePairing()} disabled={isWorking || !pairingCode} className="h-8 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[11px] font-semibold hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/5">
          Approve code
        </button>
        <button type="button" onClick={() => void pollPairingStatus()} disabled={isWorking || !pairingCode} className="h-8 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[11px] font-semibold hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/5">
          Poll status
        </button>
        <button type="button" onClick={() => void sendHeartbeat()} disabled={isWorking} className="h-8 rounded-sm border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] text-[11px] font-semibold hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-white/5">
          Send heartbeat
        </button>
      </div>

      <div className="rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2.5 py-2 text-[12px] leading-5 text-[hsl(var(--theme-muted))]">
        <p>API base: {CONTROL_PLANE_BASE}</p>
        <p>{healthLabel}</p>
        {pairingExpiry ? <p>Pairing expires: {new Date(pairingExpiry).toLocaleTimeString()}</p> : null}
        {lastError ? <p className="text-red-500">Error: {lastError}</p> : null}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
}: Readonly<{
  label: string;
  value: string;
}>) {
  return (
    <div className="rounded border border-[hsl(var(--theme-border))] bg-[hsl(var(--theme-surface-alt))] px-2.5 py-1.5">
      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-[hsl(var(--theme-muted))]">
        {label}
      </span>
      <p className="mt-1 break-all font-mono text-[12px] leading-5">{value}</p>
    </div>
  );
}
