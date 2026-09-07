import { createHash, randomBytes } from "node:crypto";
import type { VerifiedKioskCustomer } from "@/lib/magento/customer-context";

const SESSION_TTL_MS = 15 * 60 * 1000;

export type KioskSession = {
  deviceId: string;
  magentoToken: string;
  customer: VerifiedKioskCustomer;
  createdAt: string;
  expiresAt: string;
};

type KioskSessionRegistry = Map<string, KioskSession>;

type KioskGlobal = typeof globalThis & {
  __cssKioskSessions?: KioskSessionRegistry;
};

const kioskGlobal = globalThis as KioskGlobal;
const sessions = kioskGlobal.__cssKioskSessions ?? new Map<string, KioskSession>();
kioskGlobal.__cssKioskSessions = sessions;

function sessionHash(sessionId: string) {
  return createHash("sha256").update(`kiosk-session\u0000${sessionId}`).digest("hex");
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (Date.parse(session.expiresAt) <= now) sessions.delete(key);
  }
}

export function createKioskSession(input: {
  deviceId: string;
  magentoToken: string;
  customer: VerifiedKioskCustomer;
}) {
  cleanupExpiredSessions();

  const sessionId = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);
  const session: KioskSession = {
    deviceId: input.deviceId,
    magentoToken: input.magentoToken,
    customer: input.customer,
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  sessions.set(sessionHash(sessionId), session);

  return { sessionId, session };
}

export function getKioskSession(sessionId: string, deviceId: string) {
  cleanupExpiredSessions();
  if (!sessionId) return null;

  const session = sessions.get(sessionHash(sessionId)) ?? null;
  if (!session || session.deviceId !== deviceId) return null;
  return session;
}

export function destroyKioskSession(sessionId: string, deviceId: string) {
  cleanupExpiredSessions();
  if (!sessionId) return null;

  const key = sessionHash(sessionId);
  const session = sessions.get(key) ?? null;
  if (!session || session.deviceId !== deviceId) return null;

  sessions.delete(key);
  return session;
}
