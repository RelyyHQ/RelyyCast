import { NextResponse } from "next/server";
import { createPairing } from "@/lib/server/desktop-agent-store";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const stationId = typeof body.stationId === "string" && body.stationId.trim().length > 0
    ? body.stationId.trim()
    : "station-dev";

  const pairing = createPairing({
    stationId,
    deviceName: typeof body.deviceName === "string" ? body.deviceName : undefined,
    platform: typeof body.platform === "string" ? body.platform : undefined,
    appVersion: typeof body.appVersion === "string" ? body.appVersion : undefined,
  });

  return NextResponse.json({
    pairingId: pairing.id,
    pairingCode: pairing.pairingCode,
    stationId: pairing.stationId,
    status: pairing.status,
    expiresAt: new Date(pairing.expiresAt).toISOString(),
  });
}
