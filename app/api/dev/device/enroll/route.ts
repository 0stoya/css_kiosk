import { NextResponse } from "next/server";
import {
  DEVELOPMENT_DEVICE_LABEL,
  isDevelopmentDeviceId,
} from "@/lib/kiosk/device-fixture";
import { registerDevelopmentKioskDevice } from "@/lib/kiosk/device-store";

export const runtime = "nodejs";

function isP256PublicJwk(value: unknown): value is JsonWebKey {
  if (!value || typeof value !== "object") return false;

  const jwk = value as JsonWebKey;
  return (
    jwk.kty === "EC" &&
    jwk.crv === "P-256" &&
    typeof jwk.x === "string" &&
    Boolean(jwk.x) &&
    typeof jwk.y === "string" &&
    Boolean(jwk.y) &&
    !jwk.d
  );
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  let payload: { deviceId?: unknown; publicJwk?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid development device request." }, { status: 400 });
  }

  if (!isDevelopmentDeviceId(payload.deviceId) || !isP256PublicJwk(payload.publicJwk)) {
    return NextResponse.json({ ok: false, error: "Invalid development device identity." }, { status: 400 });
  }

  try {
    const device = registerDevelopmentKioskDevice({
      deviceId: payload.deviceId,
      label: DEVELOPMENT_DEVICE_LABEL,
      publicJwk: payload.publicJwk,
    });

    return NextResponse.json({
      ok: true,
      device: device
        ? { deviceId: device.deviceId, label: device.label, status: device.status }
        : null,
    });
  } catch {
    return NextResponse.json(
      { ok: false, error: "Development kiosk enrollment is unavailable." },
      { status: 503 },
    );
  }
}
