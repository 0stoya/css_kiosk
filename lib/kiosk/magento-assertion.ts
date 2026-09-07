import { createPrivateKey, randomBytes, sign } from "node:crypto";
import { readFileSync } from "node:fs";

const ASSERTION_TTL_SECONDS = 60;
const DEFAULT_KEY_ID = "css-kiosk-v1";
const ISSUER = "css-kiosk";
const AUDIENCE = "css-commerce";
const PURPOSE = "customer_session";

let privateKey: ReturnType<typeof createPrivateKey> | null = null;

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function assertionKey() {
  if (privateKey) return privateKey;

  const path = process.env.KIOSK_MAGENTO_ASSERTION_PRIVATE_KEY_PATH?.trim();
  if (!path) {
    throw new Error("KIOSK_MAGENTO_ASSERTION_PRIVATE_KEY_PATH is not configured.");
  }

  privateKey = createPrivateKey(readFileSync(path));
  if (privateKey.asymmetricKeyType !== "rsa") {
    privateKey = null;
    throw new Error("CSS Commerce kiosk assertion key must be a standard RSA private key.");
  }

  return privateKey;
}

export function createMagentoKioskAssertion(input: {
  customerId: number;
  deviceId: string;
}) {
  if (!Number.isInteger(input.customerId) || input.customerId <= 0) {
    throw new Error("Invalid Magento customer ID for kiosk assertion.");
  }

  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(input.deviceId)) {
    throw new Error("Invalid kiosk device ID for CSS Commerce assertion.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: process.env.KIOSK_MAGENTO_ASSERTION_KEY_ID?.trim() || DEFAULT_KEY_ID,
  };
  const payload = {
    iss: ISSUER,
    aud: AUDIENCE,
    purpose: PURPOSE,
    sub: String(input.customerId),
    device_id: input.deviceId,
    jti: randomBytes(24).toString("base64url"),
    iat: now,
    exp: now + ASSERTION_TTL_SECONDS,
  };

  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), assertionKey());

  return `${signingInput}.${signature.toString("base64url")}`;
}
