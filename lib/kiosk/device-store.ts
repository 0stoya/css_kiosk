import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const NONCE_TTL_MS = 5 * 60 * 1000;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class KioskDevicePairingError extends Error {
  constructor(
    message: string,
    readonly code: "DEVICE_ALREADY_REGISTERED" | "PAIRING_RATE_LIMITED" | "PAIRING_REPLAY",
    readonly status: number,
  ) {
    super(message);
    this.name = "KioskDevicePairingError";
  }
}

export type KioskDeviceStatus = "active" | "revoked";

export type KioskDevice = {
  deviceId: string;
  label: string;
  publicJwk: string;
  status: KioskDeviceStatus;
};

type KioskDeviceRow = {
  device_id: string;
  label: string;
  public_jwk: string;
  status: string;
};

let database: DatabaseSync | null = null;

function databasePath() {
  const configured = process.env.KIOSK_DB_PATH?.trim();

  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("KIOSK_DB_PATH is not configured.");
    }

    return join(process.cwd(), ".data", "kiosk.sqlite");
  }

  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

function getDatabase() {
  if (database) return database;

  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true });

  const nextDatabase = new DatabaseSync(path);
  nextDatabase.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS kiosk_devices (
      device_id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      public_jwk TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS kiosk_device_nonces (
      device_id TEXT NOT NULL,
      nonce TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (device_id, nonce)
    );

    CREATE INDEX IF NOT EXISTS idx_kiosk_device_nonces_expiry
      ON kiosk_device_nonces(expires_at);

    CREATE TABLE IF NOT EXISTS kiosk_device_pairings (
      device_id TEXT PRIMARY KEY,
      public_jwk TEXT NOT NULL,
      code_hash TEXT NOT NULL UNIQUE,
      requested_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS kiosk_device_pairing_nonces (
      device_id TEXT NOT NULL,
      nonce TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      PRIMARY KEY (device_id, nonce)
    );

    CREATE TABLE IF NOT EXISTS kiosk_device_pairing_attempts (
      source_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_kiosk_pairing_attempts_source
      ON kiosk_device_pairing_attempts(source_hash, created_at);

  `);

  database = nextDatabase;
  return nextDatabase;
}

function nowIso() {
  return new Date().toISOString();
}

function deviceFromRow(row: KioskDeviceRow | undefined): KioskDevice | null {
  if (!row) return null;
  if (row.status !== "active" && row.status !== "revoked") {
    throw new Error("Stored kiosk device status is invalid.");
  }

  return {
    deviceId: row.device_id,
    label: row.label,
    publicJwk: row.public_jwk,
    status: row.status,
  };
}

export function getKioskDevice(deviceId: string) {
  const row = getDatabase()
    .prepare(`
      SELECT device_id, label, public_jwk, status
      FROM kiosk_devices
      WHERE device_id = ?
    `)
    .get(deviceId) as KioskDeviceRow | undefined;

  return deviceFromRow(row);
}

export function registerDevelopmentKioskDevice(input: {
  deviceId: string;
  label: string;
  publicJwk: JsonWebKey;
}) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Development device enrollment is disabled in production.");
  }

  const db = getDatabase();
  const timestamp = nowIso();
  const publicJwk = JSON.stringify(input.publicJwk);

  db.prepare(`
    INSERT INTO kiosk_devices (
      device_id,
      label,
      public_jwk,
      status,
      created_at,
      updated_at,
      last_seen_at,
      revoked_at
    ) VALUES (?, ?, ?, 'active', ?, ?, NULL, NULL)
    ON CONFLICT(device_id) DO UPDATE SET
      label = excluded.label,
      public_jwk = excluded.public_jwk,
      status = 'active',
      updated_at = excluded.updated_at,
      revoked_at = NULL
  `).run(
    input.deviceId,
    input.label,
    publicJwk,
    timestamp,
    timestamp,
  );

  return getKioskDevice(input.deviceId);
}

export function markKioskDeviceSeen(deviceId: string) {
  const timestamp = nowIso();
  getDatabase()
    .prepare("UPDATE kiosk_devices SET last_seen_at = ?, updated_at = ? WHERE device_id = ?")
    .run(timestamp, timestamp, deviceId);
}

export function consumeKioskDeviceNonce(deviceId: string, nonce: string) {
  const db = getDatabase();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + NONCE_TTL_MS).toISOString();

  db.prepare("DELETE FROM kiosk_device_nonces WHERE expires_at <= ?").run(now.toISOString());

  const result = db.prepare(`
    INSERT OR IGNORE INTO kiosk_device_nonces (device_id, nonce, expires_at)
    VALUES (?, ?, ?)
  `).run(deviceId, nonce, expiresAt);

  return Number(result.changes) === 1;
}

function pairingCode() {
  const value = Array.from(randomBytes(10), (byte) =>
    PAIRING_ALPHABET[byte & 31],
  ).join("");
  return `${value.slice(0, 5)}-${value.slice(5)}`;
}

export function consumeKioskPairingNonce(deviceId: string, nonce: string) {
  const db = getDatabase();
  const now = new Date();
  db.prepare("DELETE FROM kiosk_device_pairing_nonces WHERE expires_at <= ?")
    .run(now.toISOString());

  const expiry = new Date(now.getTime() + NONCE_TTL_MS).toISOString();
  const result = db.prepare(`
    INSERT OR IGNORE INTO kiosk_device_pairing_nonces (device_id, nonce, expires_at)
    VALUES (?, ?, ?)
  `).run(deviceId, nonce, expiry);

  return Number(result.changes) === 1;
}

/**
 * This creates a pending request ONLY. It does not register a trusted kiosk.
 * The operator must use scripts/approve-kiosk-device.mjs on the server.
 */
export function beginBrowserKioskPairing(input: {
  deviceId: string;
  publicJwk: string;
  sourceAddress: string;
  nonce: string;
}) {
  const db = getDatabase();
  const existing = getKioskDevice(input.deviceId);
  if (existing) {
    throw new KioskDevicePairingError(
      "This kiosk identity is already registered. Contact an administrator.",
      "DEVICE_ALREADY_REGISTERED",
      409,
    );
  }

  const now = new Date();
  const timestamp = now.toISOString();
  const windowStart = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
  db.prepare("DELETE FROM kiosk_device_pairings WHERE expires_at <= ?").run(timestamp);
  db.prepare("DELETE FROM kiosk_device_pairing_attempts WHERE created_at <= ?")
    .run(windowStart);

  // Abuse limits are not an IP allowlist: a changing mobile IP remains supported.
  const sourceHash = createHash("sha256").update(input.sourceAddress).digest("hex");
  const localCount = db.prepare(`
    SELECT COUNT(*) AS count FROM kiosk_device_pairing_attempts WHERE source_hash = ?
  `).get(sourceHash) as { count: number };
  const globalCount = db.prepare(`
    SELECT COUNT(*) AS count FROM kiosk_device_pairing_attempts
  `).get() as { count: number };
  if (localCount.count >= 15 || globalCount.count >= 750) {
    throw new KioskDevicePairingError(
      "Too many kiosk pairing attempts. Please contact an administrator.",
      "PAIRING_RATE_LIMITED",
      429,
    );
  }

  db.prepare(`
    INSERT INTO kiosk_device_pairing_attempts (source_hash, created_at)
    VALUES (?, ?)
  `).run(sourceHash, timestamp);

  if (!consumeKioskPairingNonce(input.deviceId, input.nonce)) {
    throw new KioskDevicePairingError(
      "This kiosk pairing request has already been used.",
      "PAIRING_REPLAY",
      409,
    );
  }

  const code = pairingCode();
  const normalized = code.replaceAll("-", "");
  const codeHash = createHash("sha256")
    .update("css-kiosk-pairing-v1:" + normalized)
    .digest("hex");
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString();

  db.prepare(`
    INSERT INTO kiosk_device_pairings (
      device_id, public_jwk, code_hash, requested_at, expires_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      public_jwk = excluded.public_jwk,
      code_hash = excluded.code_hash,
      requested_at = excluded.requested_at,
      expires_at = excluded.expires_at
  `).run(input.deviceId, input.publicJwk, codeHash, timestamp, expiresAt);

  return { code, expiresAt };
}
