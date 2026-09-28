import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_HEX_LENGTH = 64;

export class ArgoWebhookConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgoWebhookConfigError";
  }
}

function webhookSecret() {
  const secret = process.env.ARGO_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new ArgoWebhookConfigError("ARGO_WEBHOOK_SECRET is not configured.");
  }
  return secret;
}

function signatureBytes(value: string) {
  const signature = value.trim().toLowerCase();
  if (
    signature.length !== SIGNATURE_HEX_LENGTH ||
    !/^[0-9a-f]+$/.test(signature)
  ) {
    return null;
  }
  return Buffer.from(signature, "hex");
}

export function verifyArgoWebhookSignature(
  rawBody: Buffer,
  suppliedSignature: string,
) {
  const supplied = signatureBytes(suppliedSignature);
  if (!supplied) return false;

  const expectedHex = createHmac("sha256", webhookSecret())
    .update(rawBody)
    .digest("hex");
  const expected = Buffer.from(expectedHex, "hex");

  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function argoWebhookEventId(value: string | null) {
  const eventId = value?.trim() || "";
  if (!eventId || eventId.length > 200 || /[\u0000-\u001f\u007f]/.test(eventId)) {
    return null;
  }
  return eventId;
}
