import { NextResponse } from "next/server";
import { consumePairing, getPairingByCode } from "@/lib/server/desktop-agent-store";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const pairingCode = typeof body.pairingCode === "string" ? body.pairingCode.trim().toUpperCase() : "";

  if (!pairingCode) {
    return NextResponse.json(
      { error: "pairingCode is required" },
      { status: 400 },
    );
  }

  const pairing = getPairingByCode(pairingCode);
  if (!pairing) {
    return NextResponse.json(
      { error: "Pairing code not found" },
      { status: 404 },
    );
  }

  if (pairing.status === "approved") {
    const consumed = consumePairing(pairingCode) ?? pairing;
    return NextResponse.json({
      status: "approved",
      stationId: consumed.stationId,
      agentConfig: {
        localPort: 8177,
        streamPath: "/live.mp3",
        healthPath: "/health",
        tunnelToken: "dev-token-placeholder",
      },
    });
  }

  return NextResponse.json({
    status: pairing.status,
    stationId: pairing.stationId,
    expiresAt: new Date(pairing.expiresAt).toISOString(),
  });
}
