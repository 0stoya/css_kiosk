import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NfcCredential, NfcCredentialType } from "@/lib/kiosk/nfc-reader";

const PROVIDER = "ARGO";

export class EmployeeCredentialStoreError extends Error {
  constructor(
    message: string,
    readonly code:
      | "CREDENTIAL_ALREADY_LINKED"
      | "EMPLOYEE_ALREADY_LINKED"
      | "LINK_REVOKED"
      | "STORE_UNAVAILABLE",
    readonly status: number,
  ) {
    super(message);
    this.name = "EmployeeCredentialStoreError";
  }
}

export type EmployeeCredentialLink = {
  companyId: number;
  employeeId: number;
  credentialType: NfcCredentialType;
  status: "active" | "revoked";
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type EmployeeProviderLink = {
  companyId: number;
  employeeId: number;
  provider: "ARGO";
  providerEmployeeId: number;
  argoBadge: string | null;
  plantId: number;
  lastVerifiedAt: string;
  createdAt: string;
  updatedAt: string;
};

export type EmployeeCredentialResolution =
  | { status: "unlinked" }
  | { status: "revoked"; link: EmployeeCredentialLink }
  | {
      status: "linked";
      link: EmployeeCredentialLink;
      provider: EmployeeProviderLink | null;
    };

type CredentialRow = {
  credential_type: string;
  company_id: number;
  employee_id: number;
  status: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type ProviderRow = {
  company_id: number;
  employee_id: number;
  provider: string;
  provider_employee_id: number;
  provider_badge: string | null;
  plant_id: number;
  last_verified_at: string;
  created_at: string;
  updated_at: string;
};

let database: DatabaseSync | null = null;

function databasePath() {
  const configured = process.env.KIOSK_DB_PATH?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new EmployeeCredentialStoreError(
        "Kiosk Employee credential storage is not configured.",
        "STORE_UNAVAILABLE",
        503,
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

  try {
    const path = databasePath();
    mkdirSync(dirname(path), { recursive: true });

    const nextDatabase = new DatabaseSync(path);
    nextDatabase.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS employee_credentials (
        credential_hash TEXT PRIMARY KEY,
        credential_type TEXT NOT NULL,
        company_id INTEGER NOT NULL,
        employee_id INTEGER NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_employee_credentials_employee
        ON employee_credentials(company_id, employee_id);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_credentials_active_employee
        ON employee_credentials(company_id, employee_id)
        WHERE status = 'active';

      CREATE TABLE IF NOT EXISTS employee_provider_links (
        company_id INTEGER NOT NULL,
        employee_id INTEGER NOT NULL,
        provider TEXT NOT NULL,
        provider_employee_id INTEGER NOT NULL,
        provider_badge TEXT,
        plant_id INTEGER NOT NULL,
        last_verified_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (company_id, employee_id, provider),
        UNIQUE (provider, plant_id, provider_employee_id)
      );
    `);

    const providerColumns = nextDatabase
      .prepare("PRAGMA table_info(employee_provider_links)")
      .all() as Array<{ name?: string }>;
    if (!providerColumns.some((column) => column.name === "provider_badge")) {
      nextDatabase.exec(
        "ALTER TABLE employee_provider_links ADD COLUMN provider_badge TEXT",
      );
    }

    nextDatabase.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_provider_links_badge
        ON employee_provider_links(provider, plant_id, provider_badge)
        WHERE provider_badge IS NOT NULL;
    `);

    database = nextDatabase;
    return nextDatabase;
  } catch (error) {
    if (error instanceof EmployeeCredentialStoreError) throw error;
    throw new EmployeeCredentialStoreError(
      "Kiosk Employee credential storage is unavailable.",
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
    throw new EmployeeCredentialStoreError(
      `${label} must be a safe positive integer.`,
      "STORE_UNAVAILABLE",
      503,
    );
  }
  return value;
}

function argoBadge(value: string, label = "argo_badge") {
  const badge = value.trim();
  if (!/^\d{1,20}$/.test(badge)) {
    throw new EmployeeCredentialStoreError(
      `${label} must contain 1-20 digits.`,
      "STORE_UNAVAILABLE",
      503,
    );
  }
  return badge;
}

function credentialHash(credential: NfcCredential) {
  return createHash("sha256")
    .update(`${credential.type}\u0000${credential.value}`)
    .digest("hex");
}

function credentialFromRow(row: CredentialRow): EmployeeCredentialLink {
  if (row.credential_type !== "uid" && row.credential_type !== "secure-token") {
    throw new EmployeeCredentialStoreError(
      "Stored Employee credential type is invalid.",
      "STORE_UNAVAILABLE",
      503,
    );
  }
  if (row.status !== "active" && row.status !== "revoked") {
    throw new EmployeeCredentialStoreError(
      "Stored Employee credential status is invalid.",
      "STORE_UNAVAILABLE",
      503,
    );
  }

  return {
    companyId: positiveInteger(row.company_id, "company_id"),
    employeeId: positiveInteger(row.employee_id, "employee_id"),
    credentialType: row.credential_type,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

function providerFromRow(row: ProviderRow | undefined): EmployeeProviderLink | null {
  if (!row) return null;
  if (row.provider !== PROVIDER) {
    throw new EmployeeCredentialStoreError(
      "Stored Employee provider is invalid.",
      "STORE_UNAVAILABLE",
      503,
    );
  }

  return {
    companyId: positiveInteger(row.company_id, "company_id"),
    employeeId: positiveInteger(row.employee_id, "employee_id"),
    provider: PROVIDER,
    providerEmployeeId: positiveInteger(
      row.provider_employee_id,
      "provider_employee_id",
    ),
    argoBadge:
      typeof row.provider_badge === "string" && row.provider_badge.trim()
        ? argoBadge(row.provider_badge)
        : null,
    plantId: positiveInteger(row.plant_id, "plant_id"),
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function providerForEmployee(
  db: DatabaseSync,
  companyId: number,
  employeeId: number,
) {
  const row = db.prepare(`
    SELECT
      company_id,
      employee_id,
      provider,
      provider_employee_id,
      provider_badge,
      plant_id,
      last_verified_at,
      created_at,
      updated_at
    FROM employee_provider_links
    WHERE company_id = ? AND employee_id = ? AND provider = ?
  `).get(companyId, employeeId, PROVIDER) as ProviderRow | undefined;

  return providerFromRow(row);
}

export function resolveEmployeeCredential(
  credential: NfcCredential,
): EmployeeCredentialResolution {
  const db = getDatabase();
  const hash = credentialHash(credential);
  const row = db.prepare(`
    SELECT
      credential_type,
      company_id,
      employee_id,
      status,
      created_at,
      updated_at,
      last_used_at,
      revoked_at
    FROM employee_credentials
    WHERE credential_hash = ?
  `).get(hash) as CredentialRow | undefined;

  if (!row) return { status: "unlinked" };

  const link = credentialFromRow(row);
  if (link.status === "revoked") {
    return { status: "revoked", link };
  }

  const timestamp = nowIso();
  db.prepare(`
    UPDATE employee_credentials
    SET last_used_at = ?, updated_at = ?
    WHERE credential_hash = ?
  `).run(timestamp, timestamp, hash);

  return {
    status: "linked",
    link: { ...link, lastUsedAt: timestamp, updatedAt: timestamp },
    provider: providerForEmployee(db, link.companyId, link.employeeId),
  };
}

export function getEmployeeProviderLink(
  companyId: number,
  employeeId: number,
): EmployeeProviderLink | null {
  return providerForEmployee(
    getDatabase(),
    positiveInteger(companyId, "company_id"),
    positiveInteger(employeeId, "employee_id"),
  );
}

export function linkEmployeeCredentialWithArgo(input: {
  credential: NfcCredential;
  companyId: number;
  employeeId: number;
  argoEmployeeId: number;
  argoBadge: string;
  plantId: number;
}): {
  link: EmployeeCredentialLink;
  provider: EmployeeProviderLink;
} {
  const db = getDatabase();
  const companyId = positiveInteger(input.companyId, "company_id");
  const employeeId = positiveInteger(input.employeeId, "employee_id");
  const argoEmployeeId = positiveInteger(
    input.argoEmployeeId,
    "argo_employee_id",
  );
  const providerBadge = argoBadge(input.argoBadge);
  const plantId = positiveInteger(input.plantId, "plant_id");
  const hash = credentialHash(input.credential);
  const timestamp = nowIso();

  db.exec("BEGIN IMMEDIATE");
  try {
    const credentialExisting = db.prepare(`
      SELECT
        credential_type,
        company_id,
        employee_id,
        status,
        created_at,
        updated_at,
        last_used_at,
        revoked_at
      FROM employee_credentials
      WHERE credential_hash = ?
    `).get(hash) as CredentialRow | undefined;

    if (credentialExisting) {
      const existing = credentialFromRow(credentialExisting);
      if (
        existing.companyId !== companyId ||
        existing.employeeId !== employeeId
      ) {
        throw new EmployeeCredentialStoreError(
          "This RFID credential is already linked to another Employee.",
          "CREDENTIAL_ALREADY_LINKED",
          409,
        );
      }
      if (existing.status === "revoked") {
        throw new EmployeeCredentialStoreError(
          "This Employee RFID credential has been revoked.",
          "LINK_REVOKED",
          409,
        );
      }

      db.prepare(`
        UPDATE employee_credentials
        SET updated_at = ?
        WHERE credential_hash = ?
      `).run(timestamp, hash);
    } else {
      const employeeExisting = db.prepare(`
        SELECT credential_hash
        FROM employee_credentials
        WHERE company_id = ? AND employee_id = ? AND status = 'active'
        LIMIT 1
      `).get(companyId, employeeId) as { credential_hash: string } | undefined;

      if (employeeExisting) {
        throw new EmployeeCredentialStoreError(
          "This Employee already has an active RFID credential.",
          "EMPLOYEE_ALREADY_LINKED",
          409,
        );
      }

      db.prepare(`
        INSERT INTO employee_credentials (
          credential_hash,
          credential_type,
          company_id,
          employee_id,
          status,
          created_at,
          updated_at,
          last_used_at,
          revoked_at
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, NULL, NULL)
      `).run(
        hash,
        input.credential.type,
        companyId,
        employeeId,
        timestamp,
        timestamp,
      );
    }

    const providerExisting = providerForEmployee(db, companyId, employeeId);
    if (
      providerExisting &&
      (
        providerExisting.providerEmployeeId !== argoEmployeeId ||
        providerExisting.plantId !== plantId
      )
    ) {
      throw new EmployeeCredentialStoreError(
        "This Employee is already linked to a different ARGO employee.",
        "EMPLOYEE_ALREADY_LINKED",
        409,
      );
    }

    if (providerExisting) {
      db.prepare(`
        UPDATE employee_provider_links
        SET provider_badge = ?, last_verified_at = ?, updated_at = ?
        WHERE company_id = ? AND employee_id = ? AND provider = ?
      `).run(
        providerBadge,
        timestamp,
        timestamp,
        companyId,
        employeeId,
        PROVIDER,
      );
    } else {
      db.prepare(`
        INSERT INTO employee_provider_links (
          company_id,
          employee_id,
          provider,
          provider_employee_id,
          provider_badge,
          plant_id,
          last_verified_at,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        companyId,
        employeeId,
        PROVIDER,
        argoEmployeeId,
        providerBadge,
        plantId,
        timestamp,
        timestamp,
        timestamp,
      );
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  const resolved = resolveEmployeeCredential(input.credential);
  if (resolved.status !== "linked" || !resolved.provider) {
    throw new EmployeeCredentialStoreError(
      "Employee RFID link could not be reloaded.",
      "STORE_UNAVAILABLE",
      503,
    );
  }

  return { link: resolved.link, provider: resolved.provider };
}

export function rememberEmployeeProviderBadge(input: {
  companyId: number;
  employeeId: number;
  providerEmployeeId: number;
  plantId: number;
  argoBadge: string;
}) {
  const companyId = positiveInteger(input.companyId, "company_id");
  const employeeId = positiveInteger(input.employeeId, "employee_id");
  const providerEmployeeId = positiveInteger(
    input.providerEmployeeId,
    "provider_employee_id",
  );
  const plantId = positiveInteger(input.plantId, "plant_id");
  const providerBadge = argoBadge(input.argoBadge);
  const db = getDatabase();
  const existing = providerForEmployee(db, companyId, employeeId);

  if (
    !existing ||
    existing.providerEmployeeId !== providerEmployeeId ||
    existing.plantId !== plantId
  ) {
    throw new EmployeeCredentialStoreError(
      "The ARGO badge does not match the stored Employee provider link.",
      "EMPLOYEE_ALREADY_LINKED",
      409,
    );
  }

  const timestamp = nowIso();
  db.prepare(`
    UPDATE employee_provider_links
    SET provider_badge = ?, last_verified_at = ?, updated_at = ?
    WHERE company_id = ? AND employee_id = ? AND provider = ?
  `).run(
    providerBadge,
    timestamp,
    timestamp,
    companyId,
    employeeId,
    PROVIDER,
  );

  const updated = providerForEmployee(db, companyId, employeeId);
  if (!updated) {
    throw new EmployeeCredentialStoreError(
      "Employee ARGO provider link could not be reloaded.",
      "STORE_UNAVAILABLE",
      503,
    );
  }
  return updated;
}

export function revokeEmployeeCredential(input: {
  companyId: number;
  employeeId: number;
}) {
  const companyId = positiveInteger(input.companyId, "company_id");
  const employeeId = positiveInteger(input.employeeId, "employee_id");
  const timestamp = nowIso();

  const result = getDatabase().prepare(`
    UPDATE employee_credentials
    SET status = 'revoked', revoked_at = ?, updated_at = ?
    WHERE company_id = ? AND employee_id = ? AND status = 'active'
  `).run(timestamp, timestamp, companyId, employeeId);

  return Number(result.changes) > 0;
}
