import { NextResponse } from "next/server";
import { approvePairing } from "@/lib/server/desktop-agent-store";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const pairingCode = typeof body.pairingCode === "string" ? body.pairingCode.trim().toUpperCase() : "";

  if (!pairingCode) {
    return NextResponse.json(
      { error: "pairingCode is required" },
      { status: 400 },
    );
  }

  const pairing = approvePairing(pairingCode);
  if (!pairing) {
    return NextResponse.json(
      { error: "Pairing code not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    status: pairing.status,
    pairingCode: pairing.pairingCode,
    stationId: pairing.stationId,
    approvedAt: pairing.approvedAt ? new Date(pairing.approvedAt).toISOString() : null,
  });
}
