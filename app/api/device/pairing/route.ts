import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  beginBrowserKioskPairing,
  KioskDevicePairingError,
} from "@/lib/kiosk/device-store";
import {
  KioskDeviceRequestError,
  verifyKioskPairingProof,
} from "@/lib/kiosk/device-request";

export const runtime = "nodejs";

type PairingPayload = { deviceId?: unknown; publicJwk?: unknown };

function browserPublicJwk(value: unknown): JsonWebKey | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const key = value as Record<string, unknown>;
  if (
    key.kty !== "EC" || key.crv !== "P-256" ||
    typeof key.x !== "string" || typeof key.y !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(key.x) ||
    !/^[A-Za-z0-9_-]{43}$/.test(key.y) ||
    "d" in key
  ) {
    return null;
  }

  const x = Buffer.from(key.x, "base64url");
  const y = Buffer.from(key.y, "base64url");
  if (
    x.length !== 32 || y.length !== 32 ||
    x.toString("base64url") !== key.x ||
    y.toString("base64url") !== key.y
  ) {
    return null;
  }

  // Ignore untrusted JWK metadata and persist only the public EC coordinates.
  return { kty: "EC", crv: "P-256", x: key.x, y: key.y };
}

export async function POST(request: Request) {
  // Browser-key pairing is the explicitly authorised production fallback.
  // The development simulator retains its separate development-only endpoint.
  if (process.env.NODE_ENV !== "production") {
    return new NextResponse(null, { status: 404 });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength) && Number(contentLength) > 4096) {
    return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 413 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
  }
  if (Buffer.byteLength(rawBody) > 4096) {
    return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 413 });
  }

  let payload: PairingPayload;
  try {
    payload = JSON.parse(rawBody) as PairingPayload;
  } catch {
    return NextResponse.json({ ok: false, code: "INVALID_REQUEST" }, { status: 400 });
  }

  const publicJwk = browserPublicJwk(payload?.publicJwk);
  const deviceId = typeof payload?.deviceId === "string" ? payload.deviceId : "";
  if (!publicJwk || !publicJwk.x || !publicJwk.y) {
    return NextResponse.json({ ok: false, code: "INVALID_DEVICE_KEY" }, { status: 400 });
  }

  // Bind the device ID to the exact public key. No arbitrary browser-supplied ID.
  const fingerprint = createHash("sha256")
    .update(["P-256", publicJwk.x, publicJwk.y].join("\n"))
    .digest("hex")
    .slice(0, 24);
  if (deviceId !== "browser-" + fingerprint) {
    return NextResponse.json({ ok: false, code: "INVALID_DEVICE_ID" }, { status: 400 });
  }

  try {
    // Signed proof first; no public route may add a trusted kiosk device.
    verifyKioskPairingProof(request, rawBody, publicJwk, deviceId);
    const pairing = beginBrowserKioskPairing({
      deviceId,
      publicJwk: JSON.stringify(publicJwk),
      // Nginx sets X-Real-IP from the peer. Used for abuse limits, NOT authorization.
      sourceAddress: request.headers.get("x-real-ip")?.trim().slice(0, 128) || "unknown",
      nonce: request.headers.get("x-css-kiosk-nonce")?.trim() || "",
    });

    return NextResponse.json(
      { ok: true, status: "pending", code: pairing.code, expiresAt: pairing.expiresAt },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof KioskDeviceRequestError || error instanceof KioskDevicePairingError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { ok: false, code: "PAIRING_UNAVAILABLE", error: "Kiosk pairing is unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
