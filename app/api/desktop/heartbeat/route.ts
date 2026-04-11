import { NextResponse } from "next/server";
import { getHeartbeat, upsertHeartbeat } from "@/lib/server/desktop-agent-store";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  const stationId = typeof body.stationId === "string" ? body.stationId.trim() : "";
  const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";

  if (!stationId || !agentId) {
    return NextResponse.json(
      { error: "stationId and agentId are required" },
      { status: 400 },
    );
  }

  const heartbeat = upsertHeartbeat({
    stationId,
    agentId,
    status: body.status,
    encoderStatus: body.encoderStatus,
    tunnelStatus: body.tunnelStatus,
    listenerCount: typeof body.listenerCount === "number" ? body.listenerCount : undefined,
    localPort: typeof body.localPort === "number" ? body.localPort : undefined,
  });

  return NextResponse.json({
    ok: true,
    heartbeat: {
      ...heartbeat,
      lastSeenAt: new Date(heartbeat.lastSeenAt).toISOString(),
    },
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId")?.trim();

  if (!agentId) {
    return NextResponse.json(
      { error: "agentId query param is required" },
      { status: 400 },
    );
  }

  const heartbeat = getHeartbeat(agentId);
  if (!heartbeat) {
    return NextResponse.json(
      { error: "No heartbeat found for agent" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    heartbeat: {
      ...heartbeat,
      lastSeenAt: new Date(heartbeat.lastSeenAt).toISOString(),
    },
  });
}
