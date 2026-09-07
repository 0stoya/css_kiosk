import { NextResponse } from "next/server";
import {
  KioskDeviceRequestError,
  verifyTrustedRequest,
} from "@/lib/kiosk/device-request";
import {
  clearKioskSessionId,
  getKioskSessionId,
} from "@/lib/kiosk/session-cookie";
import { destroyKioskSession } from "@/lib/kiosk/session-store";
import { revokeMagentoCustomerToken } from "@/lib/magento/revoke-customer-token";

export const runtime = "nodejs";

export async function POST(request: Request) {
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
  const session = sessionId ? destroyKioskSession(sessionId, device.deviceId) : null;
  await clearKioskSessionId();

  if (session) {
    await revokeMagentoCustomerToken(session.magentoToken).catch(() => false);
  }

  return NextResponse.json({ ok: true });
}
