import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const NONCE_TTL_MS = 5 * 60 * 1000;

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
