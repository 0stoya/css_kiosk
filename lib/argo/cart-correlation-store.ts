import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class ArgoCorrelationStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgoCorrelationStoreError";
  }
}

export type ArgoCartCorrelation = {
  projectNumber: string;
  magentoOrderNumber: string;
  argoCartId: number;
  terminalId: number;
  argoEmployeeId: number;
  providerState: string;
  createdAt: string;
  updatedAt: string;
};

export type StoredArgoWithdrawalRequest = {
  requestKey: string;
  argoCartId: number;
  terminalId: number;
  phase: string;
  status: string;
  message: string;
  createdAt: string;
  updatedAt: string;
};

type CartCorrelationRow = {
  project_number: string;
  magento_order_number: string;
  argo_cart_id: number;
  terminal_id: number;
  argo_employee_id: number;
  provider_state: string;
  created_at: string;
  updated_at: string;
};

type WithdrawalRow = {
  request_key: string;
  argo_cart_id: number;
  terminal_id: number;
  phase: string;
  status: string;
  message: string;
  created_at: string;
  updated_at: string;
};

let database: DatabaseSync | null = null;

function databasePath() {
  const configured = process.env.KIOSK_DB_PATH?.trim();

  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new ArgoCorrelationStoreError(
        "Kiosk correlation storage is not configured.",
      );
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

  const nextDatabase = new DatabaseSync(path);
  nextDatabase.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS argo_cart_correlations (
      project_number TEXT PRIMARY KEY,
      magento_order_number TEXT NOT NULL,
      argo_cart_id INTEGER NOT NULL UNIQUE,
      terminal_id INTEGER NOT NULL,
      argo_employee_id INTEGER NOT NULL,
      provider_state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_argo_cart_correlations_magento_order
      ON argo_cart_correlations(magento_order_number);

    CREATE TABLE IF NOT EXISTS argo_withdrawal_requests (
      request_key TEXT PRIMARY KEY,
      argo_cart_id INTEGER NOT NULL,
      terminal_id INTEGER NOT NULL,
      phase TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_argo_withdrawal_requests_cart
      ON argo_withdrawal_requests(argo_cart_id);
  `);

  database = nextDatabase;
  return nextDatabase;
}

function nowIso() {
  return new Date().toISOString();
}

function requiredText(value: string, label: string) {
  const result = value.trim();
  if (!result) {
    throw new ArgoCorrelationStoreError(`${label} is required.`);
  }
  return result;
}

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ArgoCorrelationStoreError(
      `${label} must be a safe positive integer.`,
    );
  }
  return value;
}

function cartFromRow(
  row: CartCorrelationRow | undefined,
): ArgoCartCorrelation | null {
  if (!row) return null;
  return {
    projectNumber: row.project_number,
    magentoOrderNumber: row.magento_order_number,
    argoCartId: row.argo_cart_id,
    terminalId: row.terminal_id,
    argoEmployeeId: row.argo_employee_id,
    providerState: row.provider_state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function withdrawalFromRow(
  row: WithdrawalRow | undefined,
): StoredArgoWithdrawalRequest | null {
  if (!row) return null;
  return {
    requestKey: row.request_key,
    argoCartId: row.argo_cart_id,
    terminalId: row.terminal_id,
    phase: row.phase,
    status: row.status,
    message: row.message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getArgoCartCorrelationByProjectNumber(
  projectNumber: string,
): ArgoCartCorrelation | null {
  const key = requiredText(projectNumber, "project_number");
  const row = getDatabase()
    .prepare(`
      SELECT
        project_number,
        magento_order_number,
        argo_cart_id,
        terminal_id,
        argo_employee_id,
        provider_state,
        created_at,
        updated_at
      FROM argo_cart_correlations
      WHERE project_number = ?
    `)
    .get(key) as CartCorrelationRow | undefined;

  return cartFromRow(row);
}

export function getArgoCartCorrelationByCartId(
  argoCartId: number,
): ArgoCartCorrelation | null {
  const cartId = positiveInteger(argoCartId, "argo_cart_id");
  const row = getDatabase()
    .prepare(`
      SELECT
        project_number,
        magento_order_number,
        argo_cart_id,
        terminal_id,
        argo_employee_id,
        provider_state,
        created_at,
        updated_at
      FROM argo_cart_correlations
      WHERE argo_cart_id = ?
    `)
    .get(cartId) as CartCorrelationRow | undefined;

  return cartFromRow(row);
}

export function recordArgoCartCreated(input: {
  projectNumber: string;
  magentoOrderNumber: string;
  argoCartId: number;
  terminalId: number;
  argoEmployeeId: number;
  providerState: string;
}): ArgoCartCorrelation {
  const projectNumber = requiredText(input.projectNumber, "project_number");
  const magentoOrderNumber = requiredText(
    input.magentoOrderNumber,
    "magento_order_number",
  );
  const argoCartId = positiveInteger(input.argoCartId, "argo_cart_id");
  const terminalId = positiveInteger(input.terminalId, "terminal_id");
  const argoEmployeeId = positiveInteger(
    input.argoEmployeeId,
    "argo_employee_id",
  );
  const providerState = requiredText(input.providerState, "provider_state");
  const db = getDatabase();
  const timestamp = nowIso();

  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db
      .prepare(`
        SELECT
          project_number,
          magento_order_number,
          argo_cart_id,
          terminal_id,
          argo_employee_id,
          provider_state,
          created_at,
          updated_at
        FROM argo_cart_correlations
        WHERE project_number = ? OR argo_cart_id = ?
        LIMIT 1
      `)
      .get(projectNumber, argoCartId) as CartCorrelationRow | undefined;

    if (existing) {
      if (
        existing.project_number !== projectNumber ||
        existing.magento_order_number !== magentoOrderNumber ||
        existing.argo_cart_id !== argoCartId ||
        existing.terminal_id !== terminalId ||
        existing.argo_employee_id !== argoEmployeeId
      ) {
        throw new ArgoCorrelationStoreError(
          "ARGO cart correlation conflicts with an existing order/cart mapping.",
        );
      }

      db.prepare(`
        UPDATE argo_cart_correlations
        SET provider_state = ?, updated_at = ?
        WHERE project_number = ?
      `).run(providerState, timestamp, projectNumber);
    } else {
      db.prepare(`
        INSERT INTO argo_cart_correlations (
          project_number,
          magento_order_number,
          argo_cart_id,
          terminal_id,
          argo_employee_id,
          provider_state,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        projectNumber,
        magentoOrderNumber,
        argoCartId,
        terminalId,
        argoEmployeeId,
        providerState,
        timestamp,
        timestamp,
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const correlation = getArgoCartCorrelationByProjectNumber(projectNumber);
  if (!correlation) {
    throw new ArgoCorrelationStoreError(
      "ARGO cart correlation could not be reloaded.",
    );
  }
  return correlation;
}

export function recordArgoWithdrawalRequested(input: {
  requestKey: string;
  argoCartId: number;
  terminalId: number;
  phase: string;
  status: string;
  message: string;
}): StoredArgoWithdrawalRequest {
  const requestKey = requiredText(input.requestKey, "request_key");
  const argoCartId = positiveInteger(input.argoCartId, "argo_cart_id");
  const terminalId = positiveInteger(input.terminalId, "terminal_id");
  const phase = requiredText(input.phase, "phase");
  const status = requiredText(input.status, "status");
  const message = input.message.trim();
  const db = getDatabase();

  const correlation = getArgoCartCorrelationByCartId(argoCartId);
  if (!correlation || correlation.terminalId !== terminalId) {
    throw new ArgoCorrelationStoreError(
      "Withdrawal request does not match a persisted ARGO cart correlation.",
    );
  }

  const timestamp = nowIso();
  const existing = db
    .prepare(`
      SELECT
        request_key,
        argo_cart_id,
        terminal_id,
        phase,
        status,
        message,
        created_at,
        updated_at
      FROM argo_withdrawal_requests
      WHERE request_key = ?
    `)
    .get(requestKey) as WithdrawalRow | undefined;

  if (existing) {
    if (
      existing.argo_cart_id !== argoCartId ||
      existing.terminal_id !== terminalId
    ) {
      throw new ArgoCorrelationStoreError(
        "ARGO withdrawal request key conflicts with another cart.",
      );
    }

    db.prepare(`
      UPDATE argo_withdrawal_requests
      SET phase = ?, status = ?, message = ?, updated_at = ?
      WHERE request_key = ?
    `).run(phase, status, message, timestamp, requestKey);
  } else {
    db.prepare(`
      INSERT INTO argo_withdrawal_requests (
        request_key,
        argo_cart_id,
        terminal_id,
        phase,
        status,
        message,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      requestKey,
      argoCartId,
      terminalId,
      phase,
      status,
      message,
      timestamp,
      timestamp,
    );
  }

  const row = db
    .prepare(`
      SELECT
        request_key,
        argo_cart_id,
        terminal_id,
        phase,
        status,
        message,
        created_at,
        updated_at
      FROM argo_withdrawal_requests
      WHERE request_key = ?
    `)
    .get(requestKey) as WithdrawalRow | undefined;

  const stored = withdrawalFromRow(row);
  if (!stored) {
    throw new ArgoCorrelationStoreError(
      "ARGO withdrawal request could not be reloaded.",
    );
  }
  return stored;
}
