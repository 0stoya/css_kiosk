#!/usr/bin/env node
/**
 * Operator-only commissioning utility. Runs on the kiosk application server,
 * never from the public browser. No public approval API exists.
 *
 * cd /srv/css/css_kiosk
 * node scripts/approve-kiosk-device.mjs inspect ABCDE-FGHJK
 * node scripts/approve-kiosk-device.mjs approve ABCDE-FGHJK
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [command, presentedCode] = process.argv.slice(2);
const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const normalized = (presentedCode || "").trim().toUpperCase().replaceAll("-", "");

function fail(message) {
  console.error("Kiosk pairing: " + message);
  process.exitCode = 1;
}

if (
  (command !== "inspect" && command !== "approve") ||
  normalized.length !== 10 ||
  !Array.from(normalized).every((character) => alphabet.includes(character))
) {
  fail("Usage: node scripts/approve-kiosk-device.mjs inspect|approve ABCDE-FGHJK");
} else {
  // Node's built-in .env reader respects values already set by the operator.
  // Match Next.js production precedence without printing any environment secrets.
  for (const name of [".env.production.local", ".env.local", ".env.production", ".env"]) {
    if (existsSync(name)) process.loadEnvFile(name);
  }

  const configured = process.env.KIOSK_DB_PATH?.trim();
  const databasePath = configured
    ? isAbsolute(configured) ? configured : resolve(process.cwd(), configured)
    : "";

  if (!databasePath || !existsSync(databasePath)) {
    fail("KIOSK_DB_PATH is not set to an existing kiosk SQLite database. No database was created.");
  } else {
    let database;
    try {
      database = new DatabaseSync(databasePath);
      database.exec("PRAGMA busy_timeout = 5000;");

      const requiredTables = ["kiosk_devices", "kiosk_device_pairings"];
      const existingTables = database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table'",
      ).all().map((row) => row.name);
      if (!requiredTables.every((name) => existingTables.includes(name))) {
        throw new Error("This database has no kiosk device pairing tables. Confirm KIOSK_DB_PATH.");
      }

      const codeHash = createHash("sha256")
        .update("css-kiosk-pairing-v1:" + normalized)
        .digest("hex");

      if (command === "approve") database.exec("BEGIN IMMEDIATE");
      const pairing = database.prepare(
        "SELECT device_id, public_jwk, requested_at, expires_at " +
        "FROM kiosk_device_pairings WHERE code_hash = ?",
      ).get(codeHash);

      if (!pairing || pairing.expires_at <= new Date().toISOString()) {
        throw new Error("Pairing code not found or expired. Ask staff to refresh the kiosk pairing screen.");
      }

      const jwk = JSON.parse(pairing.public_jwk);
      if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256" ||
          typeof jwk.x !== "string" || typeof jwk.y !== "string" || "d" in jwk) {
        throw new Error("Pending device public key is invalid.");
      }
      const fingerprint = createHash("sha256")
        .update(["P-256", jwk.x, jwk.y].join("\n"))
        .digest("hex").slice(0, 24);
      if (pairing.device_id !== "browser-" + fingerprint) {
        throw new Error("Pending kiosk device ID does not match the public key.");
      }

      const existing = database.prepare(
        "SELECT status FROM kiosk_devices WHERE device_id = ?",
      ).get(pairing.device_id);
      if (existing) {
        throw new Error("This kiosk identity is already registered; approval will not replace or re-enable it.");
      }

      if (command === "inspect") {
        console.log("Pending browser kiosk identity: " + pairing.device_id);
        console.log("Requested UTC: " + pairing.requested_at);
        console.log("Expires UTC:   " + pairing.expires_at);
        console.log("This code must have been read directly from the intended physical kiosk.");
        console.log("Approve with: node scripts/approve-kiosk-device.mjs approve " + presentedCode);
      } else {
        const timestamp = new Date().toISOString();
        database.prepare(
          "INSERT INTO kiosk_devices (" +
          "device_id, label, public_jwk, status, created_at, updated_at, last_seen_at, revoked_at" +
          ") VALUES (?, ?, ?, 'active', ?, ?, NULL, NULL)",
        ).run(
          pairing.device_id,
          "Operator-approved kiosk browser (temporary)",
          pairing.public_jwk,
          timestamp,
          timestamp,
        );
        database.prepare(
          "DELETE FROM kiosk_device_pairings WHERE device_id = ?",
        ).run(pairing.device_id);
        database.exec("COMMIT");
        console.log("APPROVED " + pairing.device_id);
        console.log("The kiosk will detect approval automatically; its existing card reader can then be used.");
      }
    } catch (error) {
      try { if (command === "approve") database?.exec("ROLLBACK"); } catch {}
      fail(error instanceof Error ? error.message : "Unexpected database error.");
    } finally {
      database?.close();
    }
  }
}
