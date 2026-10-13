import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts", "approve-kiosk-device.mjs");
const CODE = "ABCDE-FGHJK";

function makeFixture({ expired = false, existingStatus = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "css-kiosk-pair-"));
  const path = join(dir, "kiosk.sqlite");
  const db = new DatabaseSync(path);
  db.exec([
    "CREATE TABLE kiosk_devices (",
    "device_id TEXT PRIMARY KEY, label TEXT NOT NULL, public_jwk TEXT NOT NULL,",
    "status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,",
    "last_seen_at TEXT, revoked_at TEXT);",
    "CREATE TABLE kiosk_device_pairings (",
    "device_id TEXT PRIMARY KEY, public_jwk TEXT NOT NULL,",
    "code_hash TEXT NOT NULL UNIQUE, requested_at TEXT NOT NULL, expires_at TEXT NOT NULL);",
  ].join(" "));

  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const key = keys.publicKey.export({ format: "jwk" });
  const publicJwk = JSON.stringify({ kty: "EC", crv: "P-256", x: key.x, y: key.y });
  const id = "browser-" + createHash("sha256")
    .update(["P-256", key.x, key.y].join("\n")).digest("hex").slice(0, 24);
  const codeHash = createHash("sha256")
    .update("css-kiosk-pairing-v1:" + CODE.replaceAll("-", ""))
    .digest("hex");
  const now = new Date();
  const expiry = new Date(now.getTime() + (expired ? -1000 : 10 * 60 * 1000));
  db.prepare(
    "INSERT INTO kiosk_device_pairings VALUES (?, ?, ?, ?, ?)",
  ).run(id, publicJwk, codeHash, now.toISOString(), expiry.toISOString());

  if (existingStatus) {
    db.prepare(
      "INSERT INTO kiosk_devices VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)",
    ).run(id, "Existing kiosk", publicJwk, existingStatus, now.toISOString(), now.toISOString());
  }

  return {
    id,
    db,
    run(command, code = CODE) {
      return spawnSync(process.execPath, [SCRIPT, command, code], {
        cwd: ROOT,
        env: { ...process.env, KIOSK_DB_PATH: path },
        encoding: "utf8",
        timeout: 10000,
      });
    },
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("code inspection is read-only; approval creates exactly one trusted identity", () => {
  const fixture = makeFixture();
  try {
    const inspected = fixture.run("inspect");
    assert.equal(inspected.status, 0, inspected.stderr);
    assert.match(inspected.stdout, /Pending browser kiosk identity/);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS n FROM kiosk_devices").get().n, 0);

    const approved = fixture.run("approve");
    assert.equal(approved.status, 0, approved.stderr);
    assert.match(approved.stdout, /APPROVED browser-/);
    const device = fixture.db.prepare(
      "SELECT device_id, status FROM kiosk_devices",
    ).get();
    assert.equal(device.device_id, fixture.id);
    assert.equal(device.status, "active");
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS n FROM kiosk_device_pairings").get().n, 0);

    const duplicate = fixture.run("approve");
    assert.notEqual(duplicate.status, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS n FROM kiosk_devices").get().n, 1);
  } finally {
    fixture.close();
  }
});

test("incorrect or expired codes cannot approve devices", () => {
  const fixture = makeFixture();
  try {
    const incorrect = fixture.run("approve", "ABCDE-FGHJL");
    assert.notEqual(incorrect.status, 0);
    assert.equal(fixture.db.prepare("SELECT COUNT(*) AS n FROM kiosk_devices").get().n, 0);
  } finally {
    fixture.close();
  }

  const expired = makeFixture({ expired: true });
  try {
    const result = expired.run("approve");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /expired/);
    assert.equal(expired.db.prepare("SELECT COUNT(*) AS n FROM kiosk_devices").get().n, 0);
  } finally {
    expired.close();
  }
});

test("a previously revoked device identity cannot be silently reactivated", () => {
  const fixture = makeFixture({ existingStatus: "revoked" });
  try {
    const result = fixture.run("approve");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /already registered/);
    const saved = fixture.db.prepare("SELECT status FROM kiosk_devices").get();
    assert.equal(saved.status, "revoked");
  } finally {
    fixture.close();
  }
});
