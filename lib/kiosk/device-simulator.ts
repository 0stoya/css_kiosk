"use client";

import { DEVELOPMENT_DEVICE_ID } from "@/lib/kiosk/device-fixture";

function bytesToBase64Url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomNonce() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export interface DevelopmentKioskDeviceSigner {
  readonly deviceId: string;
  enroll(): Promise<void>;
  signedFetch(input: string, init?: RequestInit): Promise<Response>;
}

class BrowserDevelopmentKioskDeviceSigner implements DevelopmentKioskDeviceSigner {
  readonly deviceId = DEVELOPMENT_DEVICE_ID;
  private keyPair: CryptoKeyPair | null = null;

  async enroll() {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Development kiosk enrollment is disabled in production.");
    }

    this.keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      true,
      ["sign", "verify"],
    );

    const publicJwk = await crypto.subtle.exportKey("jwk", this.keyPair.publicKey);
    const response = await window.fetch("/api/dev/device/enroll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId: this.deviceId, publicJwk }),
    });

    if (!response.ok) {
      throw new Error("Development kiosk device enrollment failed.");
    }
  }

  async signedFetch(input: string, init: RequestInit = {}) {
    if (!this.keyPair) {
      throw new Error("Kiosk device signer is not enrolled.");
    }

    const method = (init.method || "GET").toUpperCase();
    const rawBody = init.body == null ? "" : init.body;
    if (typeof rawBody !== "string") {
      throw new Error("Signed kiosk simulator requests require a string body.");
    }

    const target = new URL(input, window.location.origin);
    const path = `${target.pathname}${target.search}`;
    const timestamp = Date.now().toString();
    const nonce = randomNonce();
    const bodyHash = await sha256Hex(rawBody);
    const canonical = [method, path, timestamp, nonce, bodyHash].join("\n");

    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      this.keyPair.privateKey,
      new TextEncoder().encode(canonical),
    );

    const headers = new Headers(init.headers);
    headers.set("x-css-kiosk-device-id", this.deviceId);
    headers.set("x-css-kiosk-timestamp", timestamp);
    headers.set("x-css-kiosk-nonce", nonce);
    headers.set("x-css-kiosk-signature", bytesToBase64Url(signature));

    return window.fetch(input, {
      ...init,
      method,
      body: rawBody || undefined,
      headers,
    });
  }
}

export function createDevelopmentKioskDeviceSigner(): DevelopmentKioskDeviceSigner {
  return new BrowserDevelopmentKioskDeviceSigner();
}
