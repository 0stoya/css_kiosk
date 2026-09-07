import { NextResponse } from "next/server";
import {
  KioskDeviceRequestError,
  verifyTrustedRequest,
} from "@/lib/kiosk/device-request";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const device = await verifyTrustedRequest(request);
    return NextResponse.json({
      ok: true,
      device: {
        deviceId: device.deviceId,
        label: device.label,
        status: device.status,
      },
    });
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
}
