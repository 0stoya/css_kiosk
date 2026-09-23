import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type AdminArgoCollectorLink = {
  companyId: number;
  companyUserId: number;
  customerId: number;
  argoEmployeeId: number;
  argoBadge: string;
  plantId: number;
  profileId: number | null;
  lastVerifiedAt: string;
  createdAt: string;
  updatedAt: string;
};

type Row = {
  company_id: number;
  company_user_id: number;
  customer_id: number;
  argo_employee_id: number;
  provider_badge: string;
  plant_id: number;
  profile_id: number | null;
  last_verified_at: string;
  created_at: string;
  updated_at: string;
};

let database: DatabaseSync | null = null;

function databasePath() {
  const configured = process.env.KIOSK_DB_PATH?.trim();
  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Kiosk admin ARGO collector storage is not configured.");
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

    CREATE TABLE IF NOT EXISTS admin_argo_collectors (
      company_id INTEGER NOT NULL,
      company_user_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      argo_employee_id INTEGER NOT NULL,
      provider_badge TEXT NOT NULL,
      plant_id INTEGER NOT NULL,
      profile_id INTEGER,
      last_verified_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (company_id, company_user_id),
      UNIQUE (plant_id, argo_employee_id),
      UNIQUE (plant_id, provider_badge)
    );
  `);

  database = db;
  return db;
}

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a safe positive integer.`);
  }
  return value;
}

function badge(value: string) {
  const result = value.trim();
  if (!/^\d{1,20}$/.test(result)) {
    throw new Error("ARGO badge must contain 1-20 digits.");
  }
  return result;
}

function fromRow(row: Row | undefined): AdminArgoCollectorLink | null {
  if (!row) return null;

  return {
    companyId: positiveInteger(row.company_id, "company_id"),
    companyUserId: positiveInteger(row.company_user_id, "company_user_id"),
    customerId: positiveInteger(row.customer_id, "customer_id"),
    argoEmployeeId: positiveInteger(row.argo_employee_id, "argo_employee_id"),
    argoBadge: badge(row.provider_badge),
    plantId: positiveInteger(row.plant_id, "plant_id"),
    profileId:
      row.profile_id === null
        ? null
        : positiveInteger(row.profile_id, "profile_id"),
    lastVerifiedAt: row.last_verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAdminArgoCollector(input: {
  companyId: number;
  companyUserId: number;
}) {
  const companyId = positiveInteger(input.companyId, "company_id");
  const companyUserId = positiveInteger(input.companyUserId, "company_user_id");
  const row = getDatabase()
    .prepare(`
      SELECT
        company_id,
        company_user_id,
        customer_id,
        argo_employee_id,
        provider_badge,
        plant_id,
        profile_id,
        last_verified_at,
        created_at,
        updated_at
      FROM admin_argo_collectors
      WHERE company_id = ? AND company_user_id = ?
    `)
    .get(companyId, companyUserId) as Row | undefined;

  return fromRow(row);
}

export function recordAdminArgoCollector(input: {
  companyId: number;
  companyUserId: number;
  customerId: number;
  argoEmployeeId: number;
  argoBadge: string;
  plantId: number;
  profileId?: number | null;
}) {
  const companyId = positiveInteger(input.companyId, "company_id");
  const companyUserId = positiveInteger(input.companyUserId, "company_user_id");
  const customerId = positiveInteger(input.customerId, "customer_id");
  const argoEmployeeId = positiveInteger(
    input.argoEmployeeId,
    "argo_employee_id",
  );
  const providerBadge = badge(input.argoBadge);
  const plantId = positiveInteger(input.plantId, "plant_id");
  const profileId =
    input.profileId === null || input.profileId === undefined
      ? null
      : positiveInteger(input.profileId, "profile_id");
  const now = new Date().toISOString();
  const db = getDatabase();
  const existing = getAdminArgoCollector({ companyId, companyUserId });

  if (
    existing &&
    (
      existing.customerId !== customerId ||
      existing.argoEmployeeId !== argoEmployeeId ||
      existing.plantId !== plantId
    )
  ) {
    throw new Error(
      "Admin ARGO collector conflicts with an existing provider mapping.",
    );
  }

  db.prepare(`
    INSERT INTO admin_argo_collectors (
      company_id,
      company_user_id,
      customer_id,
      argo_employee_id,
      provider_badge,
      plant_id,
      profile_id,
      last_verified_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(company_id, company_user_id) DO UPDATE SET
      provider_badge = excluded.provider_badge,
      profile_id = excluded.profile_id,
      last_verified_at = excluded.last_verified_at,
      updated_at = excluded.updated_at
  `).run(
    companyId,
    companyUserId,
    customerId,
    argoEmployeeId,
    providerBadge,
    plantId,
    profileId,
    now,
    now,
    now,
  );

  const stored = getAdminArgoCollector({ companyId, companyUserId });
  if (!stored) {
    throw new Error("Admin ARGO collector mapping could not be reloaded.");
  }
  return stored;
}
