import { getMagentoConfig } from "@/lib/config";

const BOUND_ENVELOPE_PREFIX = "cssks2.";

export type MagentoBoundKioskSession = {
  token: string;
  sessionProof: string;
  expiresAt: string;
  customerId: number;
  companyId: number;
  companyUserId: number;
  deviceId: string;
  storeCode: string;
};

type BoundEnvelopePayload = {
  version?: unknown;
  token?: unknown;
  session_proof?: unknown;
  expires_at?: unknown;
  customer_id?: unknown;
  company_id?: unknown;
  company_user_id?: unknown;
  device_id?: unknown;
  store_code?: unknown;
};

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function decodeEnvelopePayload(value: string): BoundEnvelopePayload {
  if (!value.startsWith(BOUND_ENVELOPE_PREFIX)) {
    throw new Error("Magento did not return a bound kiosk session.");
  }

  const encoded = value.slice(BOUND_ENVELOPE_PREFIX.length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error("Magento returned an invalid bound kiosk session.");
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid payload");
    }
    return parsed as BoundEnvelopePayload;
  } catch {
    throw new Error("Magento returned an invalid bound kiosk session.");
  }
}

export function parseMagentoBoundKioskSession(value: string): MagentoBoundKioskSession {
  const payload = decodeEnvelopePayload(value.trim());
  const customerId = positiveInteger(payload.customer_id);
  const companyId = positiveInteger(payload.company_id);
  const companyUserId = positiveInteger(payload.company_user_id);
  const token = typeof payload.token === "string" ? payload.token.trim() : "";
  const sessionProof =
    typeof payload.session_proof === "string" ? payload.session_proof.trim() : "";
  const expiresAt = typeof payload.expires_at === "string" ? payload.expires_at.trim() : "";
  const deviceId = typeof payload.device_id === "string" ? payload.device_id.trim() : "";
  const storeCode = typeof payload.store_code === "string" ? payload.store_code.trim() : "";
  const expiresAtMs = Date.parse(expiresAt);

  if (
    payload.version !== 2 ||
    customerId === null ||
    companyId === null ||
    companyUserId === null ||
    !/^cssks2_[A-Za-z0-9_-]{43}$/.test(token) ||
    !/^[A-Za-z0-9_-]{43}$/.test(sessionProof) ||
    !Number.isFinite(expiresAtMs) ||
    expiresAtMs <= Date.now() ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(deviceId) ||
    !/^[A-Za-z0-9_-]{1,32}$/.test(storeCode)
  ) {
    throw new Error("Magento returned an invalid bound kiosk session.");
  }

  return {
    token,
    sessionProof,
    expiresAt,
    customerId,
    companyId,
    companyUserId,
    deviceId,
    storeCode,
  };
}

export function assertExpectedMagentoBoundKioskSession(
  value: string,
  expected: {
    customerId: number;
    companyId: number;
    companyUserId: number;
    deviceId: string;
    storeCode: string;
  },
) {
  const session = parseMagentoBoundKioskSession(value);

  if (
    session.customerId !== expected.customerId ||
    session.companyId !== expected.companyId ||
    session.companyUserId !== expected.companyUserId ||
    session.deviceId !== expected.deviceId ||
    session.storeCode !== expected.storeCode
  ) {
    throw new Error("Magento returned a kiosk session for the wrong customer context.");
  }

  return session;
}

export function getMagentoCustomerGraphQlHeaders(credential: string): Record<string, string> {
  const value = credential.trim();
  if (!value) {
    throw new Error("Magento customer credential is missing.");
  }

  const { storeCode } = getMagentoConfig();
  if (!value.startsWith(BOUND_ENVELOPE_PREFIX)) {
    return {
      Authorization: `Bearer ${value}`,
      Store: storeCode,
    };
  }

  const session = parseMagentoBoundKioskSession(value);
  if (session.storeCode !== storeCode) {
    throw new Error("Magento kiosk session store does not match kiosk configuration.");
  }

  return {
    Authorization: `Bearer ${session.token}`,
    Store: session.storeCode,
    "X-Css-Kiosk-Device-Id": session.deviceId,
    "X-Css-Kiosk-Session-Proof": session.sessionProof,
  };
}
