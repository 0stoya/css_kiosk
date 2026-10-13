"use client";

/**
 * Temporary browser-key device identity for the existing Android 0.1.0 WebView.
 * Only manual server-side pairing makes this key trusted. The private key is
 * non-extractable WebCrypto material persisted through IndexedDB.
 *
 * Replace this with Android Keystore signing once an updated APK can be installed.
 */
const DB_NAME = "css-kiosk-browser-identity-v1";
const STORE = "device";
const ENTRY = "current";

type SavedIdentity = {
  deviceId: string;
  privateKey: CryptoKey;
  publicJwk: JsonWebKey;
};

export type BrowserPairing = { code: string; expiresAt: string };

export interface BrowserKioskDeviceSigner {
  readonly deviceId: string;
  signedFetch(input: string, init?: RequestInit): Promise<Response>;
  beginPairing(): Promise<BrowserPairing>;
}

function bytesToBase64Url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Hex(value: string) {
  const buffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function nonce() {
  const buffer = new Uint8Array(18);
  crypto.getRandomValues(buffer);
  return bytesToBase64Url(buffer);
}

function openIdentityDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onerror = () => reject(request.error || new Error("Kiosk identity storage unavailable."));
    request.onsuccess = () => resolve(request.result);
  });
}

async function storedIdentity(): Promise<SavedIdentity> {
  const db = await openIdentityDatabase();

  try {
    const existing = await new Promise<SavedIdentity | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(ENTRY);
      request.onerror = () => reject(request.error || new Error("Kiosk device key read failed."));
      request.onsuccess = () => resolve((request.result as SavedIdentity | undefined) || null);
    });

    if (existing) {
      if (
        !/^browser-[a-f0-9]{24}$/.test(existing.deviceId) ||
        !existing.privateKey ||
        existing.privateKey.type !== "private" ||
        existing.privateKey.extractable ||
        existing.privateKey.algorithm.name !== "ECDSA" ||
        !existing.publicJwk?.x || !existing.publicJwk?.y
      ) {
        throw new Error("Stored kiosk device identity is invalid. Ask an administrator for help.");
      }
      const fingerprint = await sha256Hex(
        ["P-256", existing.publicJwk.x, existing.publicJwk.y].join("\n"),
      );
      if (existing.deviceId !== "browser-" + fingerprint.slice(0, 24)) {
        throw new Error("Stored kiosk device identity does not match its public key.");
      }
      return existing;
    }

    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false, // The private key may be used for signing, never exported as JWK.
      ["sign", "verify"],
    );
    const exported = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    if (!exported.x || !exported.y) {
      throw new Error("The kiosk could not create its device public key.");
    }

    const publicJwk: JsonWebKey = {
      kty: "EC", crv: "P-256", x: exported.x, y: exported.y,
    };
    const fingerprint = await sha256Hex(["P-256", exported.x, exported.y].join("\n"));
    const identity: SavedIdentity = {
      deviceId: "browser-" + fingerprint.slice(0, 24),
      privateKey: keyPair.privateKey,
      publicJwk,
    };

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Kiosk identity storage failed."));
      tx.onabort = () => reject(tx.error || new Error("Kiosk identity storage aborted."));
      tx.objectStore(STORE).put(identity, ENTRY);
    });
    return identity;
  } finally {
    db.close();
  }
}

class PersistentBrowserSigner implements BrowserKioskDeviceSigner {
  readonly deviceId: string;

  constructor(private readonly identity: SavedIdentity) {
    this.deviceId = identity.deviceId;
  }

  async signedFetch(input: string, init: RequestInit = {}) {
    const target = new URL(input, window.location.origin);
    if (target.origin !== window.location.origin) {
      throw new Error("Signed kiosk requests must remain on the kiosk origin.");
    }

    const method = (init.method || "GET").toUpperCase();
    const rawBody = init.body == null ? "" : init.body;
    if (typeof rawBody !== "string") {
      throw new Error("Signed kiosk requests require a string request body.");
    }

    const timestamp = Date.now().toString();
    const requestNonce = nonce();
    const canonical = [
      method,
      target.pathname + target.search,
      timestamp,
      requestNonce,
      await sha256Hex(rawBody),
    ].join("\n");

    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      this.identity.privateKey,
      new TextEncoder().encode(canonical),
    );

    const headers = new Headers(init.headers);
    headers.set("x-css-kiosk-device-id", this.deviceId);
    headers.set("x-css-kiosk-timestamp", timestamp);
    headers.set("x-css-kiosk-nonce", requestNonce);
    headers.set("x-css-kiosk-signature", bytesToBase64Url(signature));

    return window.fetch(target.pathname + target.search, {
      ...init,
      method,
      body: rawBody || undefined,
      headers,
      cache: "no-store",
    });
  }

  async beginPairing(): Promise<BrowserPairing> {
    const response = await this.signedFetch("/api/device/pairing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId: this.deviceId,
        publicJwk: this.identity.publicJwk,
      }),
    });
    const body = await response.json() as {
      ok?: boolean;
      code?: string;
      expiresAt?: string;
      error?: string;
    };
    if (!response.ok || !body.ok || !body.code || !body.expiresAt) {
      throw new Error(body.error || "Kiosk pairing could not be started.");
    }
    return { code: body.code, expiresAt: body.expiresAt };
  }
}

export async function createBrowserKioskDeviceSigner(): Promise<BrowserKioskDeviceSigner> {
  return new PersistentBrowserSigner(await storedIdentity());
}
