import { createHash, createPublicKey, verify } from "node:crypto";
import {
  consumeKioskDeviceNonce,
  getKioskDevice,
  markKioskDeviceSeen,
  type KioskDevice,
} from "@/lib/kiosk/device-store";

const REQUEST_WINDOW_MS = 90 * 1000;

export class KioskDeviceRequestError extends Error {
  constructor(
    message: string,
    readonly code:
      | "DEVICE_REQUIRED"
      | "DEVICE_UNTRUSTED"
      | "DEVICE_REVOKED"
      | "DEVICE_REQUEST_EXPIRED"
      | "DEVICE_REPLAY"
      | "DEVICE_SIGNATURE_INVALID"
      | "INVALID_REQUEST",
    readonly status: number,
  ) {
    super(message);
    this.name = "KioskDeviceRequestError";
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requestPath(request: Request) {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
}

function canonicalRequest(
  request: Request,
  timestamp: string,
  nonce: string,
  rawBody: string,
) {
  return [
    request.method.toUpperCase(),
    requestPath(request),
    timestamp,
    nonce,
    sha256(rawBody),
  ].join("\n");
}

export function verifyKioskDeviceRequest(request: Request, rawBody: string): KioskDevice {
  const deviceId = request.headers.get("x-css-kiosk-device-id")?.trim() || "";
  const timestamp = request.headers.get("x-css-kiosk-timestamp")?.trim() || "";
  const nonce = request.headers.get("x-css-kiosk-nonce")?.trim() || "";
  const signature = request.headers.get("x-css-kiosk-signature")?.trim() || "";

  if (!deviceId || !timestamp || !nonce || !signature) {
    throw new KioskDeviceRequestError(
      "This kiosk is not registered for secure customer access.",
      "DEVICE_REQUIRED",
      401,
    );
  }

  if (deviceId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(deviceId)) {
    throw new KioskDeviceRequestError(
      "This kiosk device identity is invalid.",
      "DEVICE_UNTRUSTED",
      401,
    );
  }

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber) || Math.abs(Date.now() - timestampNumber) > REQUEST_WINDOW_MS) {
    throw new KioskDeviceRequestError(
      "This kiosk request has expired. Please try again.",
      "DEVICE_REQUEST_EXPIRED",
      401,
    );
  }

  if (nonce.length < 16 || nonce.length > 128 || !/^[A-Za-z0-9_-]+$/.test(nonce)) {
    throw new KioskDeviceRequestError(
      "This kiosk request could not be verified.",
      "DEVICE_SIGNATURE_INVALID",
      401,
    );
  }

  const device = getKioskDevice(deviceId);
  if (!device) {
    throw new KioskDeviceRequestError(
      "This kiosk is not registered for customer access.",
      "DEVICE_UNTRUSTED",
      401,
    );
  }

  if (device.status === "revoked") {
    throw new KioskDeviceRequestError(
      "This kiosk has been disabled. Please ask a member of staff for help.",
      "DEVICE_REVOKED",
      403,
    );
  }

  let validSignature = false;
  try {
    const publicKey = createPublicKey({
      key: JSON.parse(device.publicJwk),
      format: "jwk",
    });

    validSignature = verify(
      "sha256",
      Buffer.from(canonicalRequest(request, timestamp, nonce, rawBody)),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(signature, "base64url"),
    );
  } catch {
    validSignature = false;
  }

  if (!validSignature) {
    throw new KioskDeviceRequestError(
      "This kiosk request could not be verified.",
      "DEVICE_SIGNATURE_INVALID",
      401,
    );
  }

  if (!consumeKioskDeviceNonce(device.deviceId, nonce)) {
    throw new KioskDeviceRequestError(
      "This kiosk request has already been used.",
      "DEVICE_REPLAY",
      409,
    );
  }

  markKioskDeviceSeen(device.deviceId);
  return device;
}

export async function readTrustedJsonRequest<T>(request: Request) {
  const rawBody = await request.text();
  const device = verifyKioskDeviceRequest(request, rawBody);

  try {
    return {
      device,
      payload: JSON.parse(rawBody) as T,
    };
  } catch {
    throw new KioskDeviceRequestError(
      "Invalid kiosk request body.",
      "INVALID_REQUEST",
      400,
    );
  }
}

export async function verifyTrustedRequest(request: Request) {
  const rawBody = await request.text();
  return verifyKioskDeviceRequest(request, rawBody);
}
