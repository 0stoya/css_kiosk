import { createHash, randomBytes } from "node:crypto";
import type { VerifiedKioskCustomer } from "@/lib/magento/customer-context";
import { revokeMagentoCustomerToken } from "@/lib/magento/revoke-customer-token";

const SESSION_TTL_MS = 15 * 60 * 1000;

export type KioskSession = {
  deviceId: string;
  magentoToken: string;
  customer: VerifiedKioskCustomer;
  createdAt: string;
  expiresAt: string;
};

type KioskSessionRegistry = Map<string, KioskSession>;
type KioskSessionTimerRegistry = Map<string, ReturnType<typeof setTimeout>>;

type KioskGlobal = typeof globalThis & {
  __cssKioskSessions?: KioskSessionRegistry;
  __cssKioskSessionTimers?: KioskSessionTimerRegistry;
};

const kioskGlobal = globalThis as KioskGlobal;
const sessions = kioskGlobal.__cssKioskSessions ?? new Map<string, KioskSession>();
const timers = kioskGlobal.__cssKioskSessionTimers ?? new Map<string, ReturnType<typeof setTimeout>>();
kioskGlobal.__cssKioskSessions = sessions;
kioskGlobal.__cssKioskSessionTimers = timers;

function sessionHash(sessionId: string) {
  return createHash("sha256").update(`kiosk-session\u0000${sessionId}`).digest("hex");
}

function expireSession(key: string) {
  const session = sessions.get(key) ?? null;
  sessions.delete(key);

  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);

  if (session) {
    void revokeMagentoCustomerToken(session.magentoToken).catch(() => false);
  }
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (Date.parse(session.expiresAt) <= now) expireSession(key);
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

  const key = sessionHash(sessionId);
  sessions.set(key, session);
  timers.set(key, setTimeout(() => expireSession(key), SESSION_TTL_MS));

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
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);

  return session;
}
