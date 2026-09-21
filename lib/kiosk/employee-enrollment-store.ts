import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ENROLLMENT_TTL_MS = 5 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class EmployeeEnrollmentStoreError extends Error {
  constructor(
    message: string,
    readonly code: "INVALID_CODE" | "EXPIRED" | "ALREADY_USED" | "STORE_UNAVAILABLE",
    readonly status: number,
  ) {
    super(message);
    this.name = "EmployeeEnrollmentStoreError";
  }
}

export type PendingEmployeeEnrollment = {
  companyId: number;
  employeeId: number;
  employeeCode: string | null;
  firstName: string;
  lastName: string;
  status: "pending" | "processing" | "consumed";
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  consumedAt: string | null;
};

type EnrollmentRow = {
  company_id: number;
  employee_id: number;
  employee_code: string | null;
  first_name: string;
  last_name: string;
  status: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
  consumed_at: string | null;
};

let database: DatabaseSync | null = null;

function databasePath() {
  const configured = process.env.KIOSK_DB_PATH?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new EmployeeEnrollmentStoreError(
        "Kiosk Employee enrollment storage is not configured.",
        "STORE_UNAVAILABLE",
        503,
      );
    }
    return join(process.cwd(), ".data", "kiosk.sqlite");
  }

  return isAbsolute(configured) ? configured : resolve(process.cwd(), configured);
}

function getDatabase() {
  if (database) return database;

  try {
    const path = databasePath();
    mkdirSync(dirname(path), { recursive: true });

    const nextDatabase = new DatabaseSync(path);
    nextDatabase.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS employee_enrollment_requests (
        code_hash TEXT PRIMARY KEY,
        company_id INTEGER NOT NULL,
        employee_id INTEGER NOT NULL,
        employee_code TEXT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'consumed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_employee_enrollment_expiry
        ON employee_enrollment_requests(expires_at);
    `);

    database = nextDatabase;
    return nextDatabase;
  } catch (error) {
    if (error instanceof EmployeeEnrollmentStoreError) throw error;
    throw new EmployeeEnrollmentStoreError(
      "Kiosk Employee enrollment storage is unavailable.",
      "STORE_UNAVAILABLE",
      503,
    );
  }
}

function nowIso() {
  return new Date().toISOString();
}

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new EmployeeEnrollmentStoreError(
      `${label} must be a safe positive integer.`,
      "STORE_UNAVAILABLE",
      503,
    );
  }
  return value;
}

function cleanExpired(db: DatabaseSync) {
  db.prepare("DELETE FROM employee_enrollment_requests WHERE expires_at <= ?").run(nowIso());
}

function codeHash(code: string) {
  return createHash("sha256")
    .update(`employee-enrollment\u0000${code}`)
    .digest("hex");
}

export function normalizeEmployeeEnrollmentCode(value: string) {
  const code = value.trim().toUpperCase().replace(/[\s-]+/g, "");
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) {
    throw new EmployeeEnrollmentStoreError(
      "Employee enrollment code is invalid.",
      "INVALID_CODE",
      400,
    );
  }
  return code;
}

function generateCode() {
  const bytes = randomBytes(8);
  let code = "";
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return code;
}

function rowToEnrollment(row: EnrollmentRow | undefined): PendingEmployeeEnrollment | null {
  if (!row) return null;
  if (row.status !== "pending" && row.status !== "processing" && row.status !== "consumed") {
    throw new EmployeeEnrollmentStoreError(
      "Stored Employee enrollment status is invalid.",
      "STORE_UNAVAILABLE",
      503,
    );
  }

  return {
    companyId: positiveInteger(row.company_id, "company_id"),
    employeeId: positiveInteger(row.employee_id, "employee_id"),
    employeeCode: row.employee_code?.trim() || null,
    firstName: row.first_name,
    lastName: row.last_name,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

function readByCode(db: DatabaseSync, code: string) {
  return rowToEnrollment(
    db.prepare(`
      SELECT
        company_id,
        employee_id,
        employee_code,
        first_name,
        last_name,
        status,
        created_at,
        updated_at,
        expires_at,
        consumed_at
      FROM employee_enrollment_requests
      WHERE code_hash = ?
    `).get(codeHash(code)) as EnrollmentRow | undefined,
  );
}

export function issueEmployeeEnrollment(input: {
  companyId: number;
  employeeId: number;
  employeeCode?: string | null;
  firstName: string;
  lastName: string;
}) {
  const db = getDatabase();
  cleanExpired(db);

  const companyId = positiveInteger(input.companyId, "company_id");
  const employeeId = positiveInteger(input.employeeId, "employee_id");
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const employeeCode = input.employeeCode?.trim() || null;
  if (!firstName || !lastName) {
    throw new EmployeeEnrollmentStoreError(
      "Employee first and last name are required.",
      "STORE_UNAVAILABLE",
      503,
    );
  }

  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + ENROLLMENT_TTL_MS);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode();
    const result = db.prepare(`
      INSERT OR IGNORE INTO employee_enrollment_requests (
        code_hash,
        company_id,
        employee_id,
        employee_code,
        first_name,
        last_name,
        status,
        created_at,
        updated_at,
        expires_at,
        consumed_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, NULL)
    `).run(
      codeHash(code),
      companyId,
      employeeId,
      employeeCode,
      firstName,
      lastName,
      createdAt.toISOString(),
      createdAt.toISOString(),
      expiresAt.toISOString(),
    );

    if (Number(result.changes) === 1) {
      return {
        code,
        enrollment: {
          companyId,
          employeeId,
          employeeCode,
          firstName,
          lastName,
          status: "pending" as const,
          createdAt: createdAt.toISOString(),
          updatedAt: createdAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          consumedAt: null,
        },
      };
    }
  }

  throw new EmployeeEnrollmentStoreError(
    "Employee enrollment code could not be issued.",
    "STORE_UNAVAILABLE",
    503,
  );
}

export function lookupEmployeeEnrollment(rawCode: string) {
  const db = getDatabase();
  cleanExpired(db);
  const code = normalizeEmployeeEnrollmentCode(rawCode);
  const enrollment = readByCode(db, code);

  if (!enrollment) {
    throw new EmployeeEnrollmentStoreError(
      "Employee enrollment code was not found or has expired.",
      "EXPIRED",
      410,
    );
  }
  if (enrollment.status !== "pending") {
    throw new EmployeeEnrollmentStoreError(
      "Employee enrollment code has already been used.",
      "ALREADY_USED",
      409,
    );
  }

  return enrollment;
}

export function claimEmployeeEnrollment(rawCode: string) {
  const db = getDatabase();
  cleanExpired(db);
  const code = normalizeEmployeeEnrollmentCode(rawCode);
  const timestamp = nowIso();

  const result = db.prepare(`
    UPDATE employee_enrollment_requests
    SET status = 'processing', updated_at = ?
    WHERE code_hash = ? AND status = 'pending' AND expires_at > ?
  `).run(timestamp, codeHash(code), timestamp);

  if (Number(result.changes) !== 1) {
    const existing = readByCode(db, code);
    if (!existing) {
      throw new EmployeeEnrollmentStoreError(
        "Employee enrollment code was not found or has expired.",
        "EXPIRED",
        410,
      );
    }
    throw new EmployeeEnrollmentStoreError(
      "Employee enrollment code has already been used.",
      "ALREADY_USED",
      409,
    );
  }

  const enrollment = readByCode(db, code);
  if (!enrollment || enrollment.status !== "processing") {
    throw new EmployeeEnrollmentStoreError(
      "Employee enrollment could not be claimed.",
      "STORE_UNAVAILABLE",
      503,
    );
  }
  return enrollment;
}

export function releaseEmployeeEnrollment(rawCode: string) {
  const db = getDatabase();
  const code = normalizeEmployeeEnrollmentCode(rawCode);
  const timestamp = nowIso();
  db.prepare(`
    UPDATE employee_enrollment_requests
    SET status = 'pending', updated_at = ?
    WHERE code_hash = ? AND status = 'processing' AND expires_at > ?
  `).run(timestamp, codeHash(code), timestamp);
}

export function completeEmployeeEnrollment(rawCode: string) {
  const db = getDatabase();
  const code = normalizeEmployeeEnrollmentCode(rawCode);
  const timestamp = nowIso();
  const result = db.prepare(`
    UPDATE employee_enrollment_requests
    SET status = 'consumed', updated_at = ?, consumed_at = ?
    WHERE code_hash = ? AND status = 'processing'
  `).run(timestamp, timestamp, codeHash(code));

  if (Number(result.changes) !== 1) {
    throw new EmployeeEnrollmentStoreError(
      "Employee enrollment could not be completed.",
      "ALREADY_USED",
      409,
    );
  }
}
