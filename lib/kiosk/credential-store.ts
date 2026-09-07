import { createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NfcCredential, NfcCredentialType } from "@/lib/kiosk/nfc-reader";
import type { VerifiedKioskCustomer } from "@/lib/magento/customer-context";

const PENDING_LINK_TTL_MS = 5 * 60 * 1000;

export class NfcCredentialStoreError extends Error {
  constructor(
    message: string,
    readonly code:
      | "CARD_ALREADY_REGISTERED"
      | "CARD_REVOKED"
      | "PENDING_LINK_EXPIRED"
      | "STORE_UNAVAILABLE",
    readonly status: number,
  ) {
    super(message);
    this.name = "NfcCredentialStoreError";
  }
}

type StoredCredentialRow = {
  status: string;
  customer_id: unknown;
  customer_json: string;
};

type PendingLinkRow = {
  credential_hash: string;
  credential_type: NfcCredentialType;
  customer_id: unknown;
  customer_json: string;
  expires_at: string;
};

export type NfcCredentialResolution =
  | { status: "unregistered" }
  | { status: "revoked" }
  | { status: "registered"; customer: VerifiedKioskCustomer };

let database: DatabaseSync | null = null;

function databasePath() {
  const configured = process.env.KIOSK_DB_PATH?.trim();

  if (!configured) {
    if (process.env.NODE_ENV === "production") {
      throw new NfcCredentialStoreError(
        "Kiosk credential storage is not configured.",
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

  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true });

  const nextDatabase = new DatabaseSync(path);
  nextDatabase.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS nfc_credentials (
      credential_hash TEXT PRIMARY KEY,
      credential_type TEXT NOT NULL,
      customer_id INTEGER NOT NULL,
      customer_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      revoked_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_nfc_credentials_customer_id
      ON nfc_credentials(customer_id);

    CREATE TABLE IF NOT EXISTS pending_nfc_links (
      proof_hash TEXT PRIMARY KEY,
      credential_hash TEXT NOT NULL,
      credential_type TEXT NOT NULL,
      customer_id INTEGER NOT NULL,
      customer_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_pending_nfc_links_credential_hash
      ON pending_nfc_links(credential_hash);
  `);

  database = nextDatabase;
  return nextDatabase;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function credentialHash(credential: NfcCredential) {
  return sha256(`${credential.type}\u0000${credential.value}`);
}

function proofHash(proof: string) {
  return sha256(`pending-link\u0000${proof}`);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeCustomerId(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^[1-9]\d*$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isSafeInteger(parsed)) return parsed;
    }

    if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) {
      try {
        const decoded = Buffer.from(trimmed, "base64").toString("utf8").trim();
        if (/^[1-9]\d*$/.test(decoded)) {
          const parsed = Number(decoded);
          if (Number.isSafeInteger(parsed)) return parsed;
        }
      } catch {
        // Fall through to the store error below.
      }
    }
  }

  throw new NfcCredentialStoreError(
    "Stored kiosk customer data is invalid.",
    "STORE_UNAVAILABLE",
    503,
  );
}

function normalizeCustomer(value: unknown): VerifiedKioskCustomer {
  if (!value || typeof value !== "object") {
    throw new NfcCredentialStoreError(
      "Stored kiosk customer data is invalid.",
      "STORE_UNAVAILABLE",
      503,
    );
  }

  const customer = value as VerifiedKioskCustomer & { customerId: unknown };
  return {
    ...customer,
    customerId: normalizeCustomerId(customer.customerId),
  };
}

function customerFromJson(value: string) {
  try {
    return normalizeCustomer(JSON.parse(value));
  } catch (error) {
    if (error instanceof NfcCredentialStoreError) throw error;
    throw new NfcCredentialStoreError(
      "Stored kiosk customer data is invalid.",
      "STORE_UNAVAILABLE",
      503,
    );
  }
}

function cleanExpiredPendingLinks(db: DatabaseSync) {
  db.prepare("DELETE FROM pending_nfc_links WHERE expires_at <= ?").run(nowIso());
}

export function parseNfcCredential(value: unknown): NfcCredential | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as { type?: unknown; value?: unknown };
  if (candidate.type !== "secure-token" && candidate.type !== "uid") return null;
  if (typeof candidate.value !== "string") return null;

  const credentialValue = candidate.value.trim();
  if (!credentialValue || credentialValue.length > 512) return null;

  return {
    type: candidate.type,
    value: credentialValue,
  };
}

export function resolveNfcCredential(credential: NfcCredential): NfcCredentialResolution {
  const db = getDatabase();
  const hash = credentialHash(credential);
  const row = db
    .prepare("SELECT status, customer_id, customer_json FROM nfc_credentials WHERE credential_hash = ?")
    .get(hash) as StoredCredentialRow | undefined;

  if (!row) return { status: "unregistered" };
  if (row.status === "revoked") return { status: "revoked" };
  if (row.status !== "active") {
    throw new NfcCredentialStoreError(
      "Stored kiosk card status is invalid.",
      "STORE_UNAVAILABLE",
      503,
    );
  }

  const customer = customerFromJson(row.customer_json);
  const timestamp = nowIso();
  db.prepare(`
    UPDATE nfc_credentials
    SET customer_id = ?, customer_json = ?, last_used_at = ?, updated_at = ?
    WHERE credential_hash = ?
  `).run(customer.customerId, JSON.stringify(customer), timestamp, timestamp, hash);

  return {
    status: "registered",
    customer,
  };
}

export function createPendingNfcLink(
  credential: NfcCredential,
  customer: VerifiedKioskCustomer,
) {
  const db = getDatabase();
  const normalizedCustomer = normalizeCustomer(customer);
  const hash = credentialHash(credential);
  const existing = db
    .prepare("SELECT status, customer_id, customer_json FROM nfc_credentials WHERE credential_hash = ?")
    .get(hash) as StoredCredentialRow | undefined;

  if (existing?.status === "revoked") {
    throw new NfcCredentialStoreError(
      "This card has been revoked. Please ask a member of staff for help.",
      "CARD_REVOKED",
      409,
    );
  }

  if (existing) {
    throw new NfcCredentialStoreError(
      "This card is already registered. Return to the card screen and try again.",
      "CARD_ALREADY_REGISTERED",
      409,
    );
  }

  cleanExpiredPendingLinks(db);
  db.prepare("DELETE FROM pending_nfc_links WHERE credential_hash = ?").run(hash);

  const proof = randomBytes(32).toString("base64url");
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + PENDING_LINK_TTL_MS);

  db.prepare(`
    INSERT INTO pending_nfc_links (
      proof_hash,
      credential_hash,
      credential_type,
      customer_id,
      customer_json,
      created_at,
      expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    proofHash(proof),
    hash,
    credential.type,
    normalizedCustomer.customerId,
    JSON.stringify(normalizedCustomer),
    createdAt.toISOString(),
    expiresAt.toISOString(),
  );

  return proof;
}

export function confirmPendingNfcLink(proof: string): VerifiedKioskCustomer {
  const db = getDatabase();
  cleanExpiredPendingLinks(db);

  const hashedProof = proofHash(proof);
  const pending = db
    .prepare(`
      SELECT credential_hash, credential_type, customer_id, customer_json, expires_at
      FROM pending_nfc_links
      WHERE proof_hash = ?
    `)
    .get(hashedProof) as PendingLinkRow | undefined;

  if (!pending || pending.expires_at <= nowIso()) {
    if (pending) {
      db.prepare("DELETE FROM pending_nfc_links WHERE proof_hash = ?").run(hashedProof);
    }
    throw new NfcCredentialStoreError(
      "This card-link request has expired. Tap the card and sign in again.",
      "PENDING_LINK_EXPIRED",
      410,
    );
  }

  const customer = customerFromJson(pending.customer_json);
  const existing = db
    .prepare("SELECT status, customer_id, customer_json FROM nfc_credentials WHERE credential_hash = ?")
    .get(pending.credential_hash) as StoredCredentialRow | undefined;

  if (existing?.status === "revoked") {
    throw new NfcCredentialStoreError(
      "This card has been revoked. Please ask a member of staff for help.",
      "CARD_REVOKED",
      409,
    );
  }

  if (existing) {
    const existingCustomer = customerFromJson(existing.customer_json);
    if (existing.status === "active" && existingCustomer.customerId === customer.customerId) {
      db.prepare("DELETE FROM pending_nfc_links WHERE proof_hash = ?").run(hashedProof);
      return existingCustomer;
    }

    throw new NfcCredentialStoreError(
      "This card is already registered to another customer. Please ask a member of staff for help.",
      "CARD_ALREADY_REGISTERED",
      409,
    );
  }

  const timestamp = nowIso();

  db.exec("BEGIN IMMEDIATE");
  try {
    const raceCheck = db
      .prepare("SELECT status, customer_id FROM nfc_credentials WHERE credential_hash = ?")
      .get(pending.credential_hash) as { status: string; customer_id: unknown } | undefined;

    if (raceCheck) {
      throw new NfcCredentialStoreError(
        "This card was registered while the link was being confirmed. Return to the card screen and try again.",
        "CARD_ALREADY_REGISTERED",
        409,
      );
    }

    db.prepare(`
      INSERT INTO nfc_credentials (
        credential_hash,
        credential_type,
        customer_id,
        customer_json,
        status,
        created_at,
        updated_at,
        last_used_at,
        revoked_at
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, NULL)
    `).run(
      pending.credential_hash,
      pending.credential_type,
      customer.customerId,
      JSON.stringify(customer),
      timestamp,
      timestamp,
      timestamp,
    );

    db.prepare("DELETE FROM pending_nfc_links WHERE proof_hash = ?").run(hashedProof);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return customer;
}

export function cancelPendingNfcLink(proof: string) {
  const db = getDatabase();
  db.prepare("DELETE FROM pending_nfc_links WHERE proof_hash = ?").run(proofHash(proof));
}
