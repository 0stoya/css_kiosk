import { NextResponse } from "next/server";
import {
  KioskDeviceRequestError,
  verifyTrustedRequest,
} from "@/lib/kiosk/device-request";
import { getKioskSessionId } from "@/lib/kiosk/session-cookie";
import { getKioskSession } from "@/lib/kiosk/session-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  let device;
  try {
    device = await verifyTrustedRequest(request);
  } catch (error) {
    if (error instanceof KioskDeviceRequestError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { ok: false, code: "DEVICE_UNAVAILABLE", error: "Kiosk device validation is unavailable." },
      { status: 503 },
    );
  }

  const sessionId = await getKioskSessionId();
  const session = sessionId ? getKioskSession(sessionId, device.deviceId) : null;

  if (!session) {
    return NextResponse.json({ ok: false, code: "SESSION_REQUIRED", error: "Kiosk session has expired." }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    customer: session.customer,
    session: {
      authenticated: true,
      expiresAt: session.expiresAt,
    },
  });
}
