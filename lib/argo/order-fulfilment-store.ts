import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type PendingArgoOrderLine = {
  sku: string;
  productId: number;
  quantity: number;
  expiryDate: string;
  expectedArrivalDate: string;
};

export type ArgoOrderFulfilmentStatus =
  | "WAITING_MAGENTO"
  | "WAITING_OGL"
  | "READY"
  | "CREATED"
  | "FAILED";

export type ArgoOrderFulfilment = {
  fulfilmentKey: string;
  creditOrderNumber: string | null;
  magentoOrderNumber: string | null;
  oglOrderNumber: string | null;
  argoEmployeeId: number;
  terminalId: number;
  lines: PendingArgoOrderLine[];
  status: ArgoOrderFulfilmentStatus;
  argoCartId: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  fulfilment_key: string;
  credit_order_number: string | null;
  magento_order_number: string | null;
  ogl_order_number: string | null;
  argo_employee_id: number;
  terminal_id: number;
  lines_json: string;
  status: string;
  argo_cart_id: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

let database: DatabaseSync | null = null;

function databasePath() {
  const configured = process.env.KIOSK_DB_PATH?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Kiosk ARGO fulfilment storage is not configured.");
    }
    return join(process.cwd(), ".data", "kiosk.sqlite");
  }
  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
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

    CREATE TABLE IF NOT EXISTS argo_order_fulfilments_v2 (
      fulfilment_key TEXT PRIMARY KEY,
      credit_order_number TEXT,
      magento_order_number TEXT UNIQUE,
      ogl_order_number TEXT,
      argo_employee_id INTEGER NOT NULL,
      terminal_id INTEGER NOT NULL,
      lines_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN (
          'WAITING_MAGENTO',
          'WAITING_OGL',
          'READY',
          'CREATED',
          'FAILED'
        )
      ),
      argo_cart_id INTEGER,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_argo_order_fulfilments_v2_credit
      ON argo_order_fulfilments_v2(credit_order_number)
      WHERE credit_order_number IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_argo_order_fulfilments_v2_status
      ON argo_order_fulfilments_v2(status);
  `);

  database = db;
  return db;
}

function requiredText(value: string, label: string) {
  const result = value.trim();
  if (!result) throw new Error(`${label} is required.`);
  return result;
}

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a safe positive integer.`);
  }
  return value;
}

function parseLines(value: string): PendingArgoOrderLine[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Stored ARGO fulfilment lines are invalid.");
  }

  return parsed.map((line, index) => {
    if (!line || typeof line !== "object") {
      throw new Error(`Stored ARGO fulfilment line ${index + 1} is invalid.`);
    }
    const row = line as Record<string, unknown>;
    if (
      typeof row.sku !== "string" ||
      typeof row.productId !== "number" ||
      typeof row.quantity !== "number" ||
      typeof row.expiryDate !== "string" ||
      typeof row.expectedArrivalDate !== "string"
    ) {
      throw new Error(`Stored ARGO fulfilment line ${index + 1} is invalid.`);
    }
    return {
      sku: row.sku,
      productId: positiveInteger(row.productId, "product_id"),
      quantity: positiveInteger(row.quantity, "quantity"),
      expiryDate: row.expiryDate,
      expectedArrivalDate: row.expectedArrivalDate,
    };
  });
}

function fromRow(row: Row | undefined): ArgoOrderFulfilment | null {
  if (!row) return null;
  if (
    row.status !== "WAITING_MAGENTO" &&
    row.status !== "WAITING_OGL" &&
    row.status !== "READY" &&
    row.status !== "CREATED" &&
    row.status !== "FAILED"
  ) {
    throw new Error("Stored ARGO fulfilment status is invalid.");
  }

  return {
    fulfilmentKey: row.fulfilment_key,
    creditOrderNumber: row.credit_order_number,
    magentoOrderNumber: row.magento_order_number,
    oglOrderNumber: row.ogl_order_number,
    argoEmployeeId: positiveInteger(row.argo_employee_id, "argo_employee_id"),
    terminalId: positiveInteger(row.terminal_id, "terminal_id"),
    lines: parseLines(row.lines_json),
    status: row.status,
    argoCartId: row.argo_cart_id,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function selectBy(column: "fulfilment_key" | "magento_order_number", value: string) {
  const row = getDatabase()
    .prepare(`
      SELECT
        fulfilment_key,
        credit_order_number,
        magento_order_number,
        ogl_order_number,
        argo_employee_id,
        terminal_id,
        lines_json,
        status,
        argo_cart_id,
        last_error,
        created_at,
        updated_at
      FROM argo_order_fulfilments_v2
      WHERE ${column} = ?
    `)
    .get(value) as Row | undefined;
  return fromRow(row);
}

export function getArgoOrderFulfilmentByKey(fulfilmentKey: string) {
  return selectBy(
    "fulfilment_key",
    requiredText(fulfilmentKey, "fulfilment_key"),
  );
}

export function getArgoOrderFulfilmentByMagentoOrder(
  magentoOrderNumber: string,
) {
  return selectBy(
    "magento_order_number",
    requiredText(magentoOrderNumber, "magento_order_number"),
  );
}

export function recordArgoOrderFulfilment(input: {
  creditOrderNumber?: string | null;
  magentoOrderNumber?: string | null;
  oglOrderNumber?: string | null;
  argoEmployeeId: number;
  terminalId: number;
  lines: PendingArgoOrderLine[];
}) {
  const creditOrderNumber = input.creditOrderNumber?.trim() || null;
  const magentoOrderNumber = input.magentoOrderNumber?.trim() || null;
  const oglOrderNumber = input.oglOrderNumber?.trim() || null;
  if (!creditOrderNumber && !magentoOrderNumber) {
    throw new Error(
      "ARGO fulfilment requires a credit or Magento order reference.",
    );
  }
  if (!input.lines.length) throw new Error("ARGO fulfilment requires lines.");

  const fulfilmentKey = magentoOrderNumber
    ? `magento:${magentoOrderNumber}`
    : `credit:${creditOrderNumber}`;
  const status: ArgoOrderFulfilmentStatus = !magentoOrderNumber
    ? "WAITING_MAGENTO"
    : oglOrderNumber
      ? "READY"
      : "WAITING_OGL";
  const argoEmployeeId = positiveInteger(
    input.argoEmployeeId,
    "argo_employee_id",
  );
  const terminalId = positiveInteger(input.terminalId, "terminal_id");
  const now = new Date().toISOString();
  const db = getDatabase();

  db.prepare(`
    INSERT INTO argo_order_fulfilments_v2 (
      fulfilment_key,
      credit_order_number,
      magento_order_number,
      ogl_order_number,
      argo_employee_id,
      terminal_id,
      lines_json,
      status,
      argo_cart_id,
      last_error,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
    ON CONFLICT(fulfilment_key) DO UPDATE SET
      credit_order_number = excluded.credit_order_number,
      magento_order_number = excluded.magento_order_number,
      ogl_order_number = COALESCE(excluded.ogl_order_number, ogl_order_number),
      status = CASE
        WHEN argo_order_fulfilments_v2.status = 'CREATED'
          THEN argo_order_fulfilments_v2.status
        ELSE excluded.status
      END,
      last_error = CASE
        WHEN argo_order_fulfilments_v2.status = 'CREATED'
          THEN argo_order_fulfilments_v2.last_error
        ELSE NULL
      END,
      updated_at = excluded.updated_at
  `).run(
    fulfilmentKey,
    creditOrderNumber,
    magentoOrderNumber,
    oglOrderNumber,
    argoEmployeeId,
    terminalId,
    JSON.stringify(input.lines),
    status,
    now,
    now,
  );

  const stored = getArgoOrderFulfilmentByKey(fulfilmentKey);
  if (!stored) throw new Error("ARGO fulfilment could not be reloaded.");

  if (
    stored.argoEmployeeId !== argoEmployeeId ||
    stored.terminalId !== terminalId ||
    JSON.stringify(stored.lines) !== JSON.stringify(input.lines)
  ) {
    throw new Error(
      "ARGO fulfilment conflicts with an existing order snapshot.",
    );
  }

  return stored;
}

export function markArgoOrderFulfilmentCreated(input: {
  magentoOrderNumber: string;
  oglOrderNumber: string;
  argoCartId: number;
}) {
  const orderNumber = requiredText(input.magentoOrderNumber, "magento_order_number");
  const oglOrderNumber = requiredText(input.oglOrderNumber, "ogl_order_number");
  const argoCartId = positiveInteger(input.argoCartId, "argo_cart_id");
  const now = new Date().toISOString();

  const result = getDatabase().prepare(`
    UPDATE argo_order_fulfilments_v2
    SET ogl_order_number = ?,
        status = 'CREATED',
        argo_cart_id = ?,
        last_error = NULL,
        updated_at = ?
    WHERE magento_order_number = ?
  `).run(oglOrderNumber, argoCartId, now, orderNumber);

  if (Number(result.changes) !== 1) {
    throw new Error("ARGO fulfilment could not be marked created.");
  }

  return getArgoOrderFulfilmentByMagentoOrder(orderNumber);
}

export function markArgoOrderFulfilmentFailed(
  magentoOrderNumber: string,
  error: string,
) {
  const orderNumber = requiredText(magentoOrderNumber, "magento_order_number");
  const now = new Date().toISOString();
  getDatabase().prepare(`
    UPDATE argo_order_fulfilments_v2
    SET status = 'FAILED', last_error = ?, updated_at = ?
    WHERE magento_order_number = ?
  `).run(error.trim().slice(0, 2000), now, orderNumber);
  return getArgoOrderFulfilmentByMagentoOrder(orderNumber);
}
