import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type StoredArgoWebhookEvent = {
  eventId: string;
  eventType: string | null;
  bodySha256: string;
  rawBody: string;
  occurredAt: string | null;
  cartId: number | null;
  terminalId: number | null;
  projectNumber: string | null;
  vano: string | null;
  requestKey: string | null;
  badge: string | null;
  status: string | null;
  receivedAt: string;
  lastReceivedAt: string;
  deliveryCount: number;
  processingStatus: "pending" | "processed" | "failed";
};

type EventRow = {
  event_id: string;
  event_type: string | null;
  body_sha256: string;
  raw_body: string;
  occurred_at: string | null;
  cart_id: number | null;
  terminal_id: number | null;
  project_number: string | null;
  vano: string | null;
  request_key: string | null;
  badge: string | null;
  status: string | null;
  received_at: string;
  last_received_at: string;
  delivery_count: number;
  processing_status: "pending" | "processed" | "failed";
};

export class ArgoWebhookEventConflictError extends Error {
  constructor(eventId: string) {
    super(`ARGO webhook event ${eventId} was retried with a different body.`);
    this.name = "ArgoWebhookEventConflictError";
  }
}

let database: DatabaseSync | null = null;

function databasePath() {
  const configured = process.env.KIOSK_DB_PATH?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Kiosk ARGO webhook storage is not configured.");
    }
    return join(process.cwd(), ".data", "kiosk.sqlite");
  }

  return isAbsolute(configured)
    ? configured
    : resolve(process.cwd(), configured);
}

function getDatabase() {
  if (database) return database;

  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS argo_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT,
      body_sha256 TEXT NOT NULL,
      raw_body TEXT NOT NULL,
      occurred_at TEXT,
      cart_id INTEGER,
      terminal_id INTEGER,
      project_number TEXT,
      vano TEXT,
      request_key TEXT,
      badge TEXT,
      status TEXT,
      received_at TEXT NOT NULL,
      last_received_at TEXT NOT NULL,
      delivery_count INTEGER NOT NULL DEFAULT 1,
      processing_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (processing_status IN ('pending', 'processed', 'failed')),
      processed_at TEXT,
      processing_error TEXT
    );

    CREATE INDEX IF NOT EXISTS argo_webhook_events_cart_idx
      ON argo_webhook_events (cart_id, occurred_at);

    CREATE INDEX IF NOT EXISTS argo_webhook_events_processing_idx
      ON argo_webhook_events (processing_status, occurred_at);
  `);

  database = db;
  return db;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
    ? value
    : null;
}

function optionalString(value: unknown, maxLength = 500) {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result && result.length <= maxLength ? result : null;
}

function optionalScalar(value: unknown, maxLength = 500) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return optionalString(value, maxLength);
}

function eventType(payload: Record<string, unknown>) {
  for (const key of ["event", "event_type", "type"]) {
    const value = optionalString(payload[key], 100);
    if (value) return value;
  }
  return null;
}

function fromRow(row: EventRow): StoredArgoWebhookEvent {
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    bodySha256: row.body_sha256,
    rawBody: row.raw_body,
    occurredAt: row.occurred_at,
    cartId: row.cart_id,
    terminalId: row.terminal_id,
    projectNumber: row.project_number,
    vano: row.vano,
    requestKey: row.request_key,
    badge: row.badge,
    status: row.status,
    receivedAt: row.received_at,
    lastReceivedAt: row.last_received_at,
    deliveryCount: row.delivery_count,
    processingStatus: row.processing_status,
  };
}

export function recordArgoWebhookEvent(input: {
  eventId: string;
  rawBody: Buffer;
  payload: Record<string, unknown>;
}) {
  const rawBody = input.rawBody.toString("utf8");
  const bodySha256 = createHash("sha256").update(input.rawBody).digest("hex");
  const now = new Date().toISOString();
  const db = getDatabase();

  const existing = db.prepare(`
    SELECT
      event_id,
      event_type,
      body_sha256,
      raw_body,
      occurred_at,
      cart_id,
      terminal_id,
      project_number,
      vano,
      request_key,
      badge,
      status,
      received_at,
      last_received_at,
      delivery_count,
      processing_status
    FROM argo_webhook_events
    WHERE event_id = ?
  `).get(input.eventId) as EventRow | undefined;

  if (existing) {
    if (existing.body_sha256 !== bodySha256) {
      throw new ArgoWebhookEventConflictError(input.eventId);
    }

    db.prepare(`
      UPDATE argo_webhook_events
      SET
        last_received_at = ?,
        delivery_count = delivery_count + 1
      WHERE event_id = ?
    `).run(now, input.eventId);

    const duplicate = db.prepare(`
      SELECT
        event_id,
        event_type,
        body_sha256,
        raw_body,
        occurred_at,
        cart_id,
        terminal_id,
        project_number,
        request_key,
        badge,
        status,
        received_at,
        last_received_at,
        delivery_count,
        processing_status
      FROM argo_webhook_events
      WHERE event_id = ?
    `).get(input.eventId) as EventRow;

    return { stored: false, event: fromRow(duplicate) };
  }

  db.prepare(`
    INSERT INTO argo_webhook_events (
      event_id,
      event_type,
      body_sha256,
      raw_body,
      occurred_at,
      cart_id,
      terminal_id,
      project_number,
      vano,
      request_key,
      badge,
      status,
      received_at,
      last_received_at,
      delivery_count,
      processing_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending')
  `).run(
    input.eventId,
    eventType(input.payload),
    bodySha256,
    rawBody,
    optionalString(input.payload.occurred_at, 100),
    positiveInteger(input.payload.cart_id),
    positiveInteger(input.payload.terminal_id),
    optionalString(input.payload.project_number),
    optionalScalar(input.payload.vano),
    optionalString(input.payload.request_key),
    optionalString(input.payload.badge, 100),
    optionalString(input.payload.status, 100),
    now,
    now,
  );

  const inserted = db.prepare(`
    SELECT
      event_id,
      event_type,
      body_sha256,
      raw_body,
      occurred_at,
      cart_id,
      terminal_id,
      project_number,
      vano,
      request_key,
      badge,
      status,
      received_at,
      last_received_at,
      delivery_count,
      processing_status
    FROM argo_webhook_events
    WHERE event_id = ?
  `).get(input.eventId) as EventRow;

  return { stored: true, event: fromRow(inserted) };
}
