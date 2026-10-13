import assert from "node:assert/strict";
import { createHash, randomBytes, webcrypto } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const script = join(root, "scripts", "approve-kiosk-device.mjs");

async function unusedLocalPort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}

async function signed(key, id, path, method = "GET", body = "") {
  const time = Date.now().toString();
  const nonce = randomBytes(18).toString("base64url");
  const canonical = [method, path, time, nonce,
    createHash("sha256").update(body).digest("hex")].join("\n");
  const signature = Buffer.from(await webcrypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key,
    new TextEncoder().encode(canonical),
  )).toString("base64url");
  return {
    method,
    headers: {
      "x-css-kiosk-device-id": id,
      "x-css-kiosk-timestamp": time,
      "x-css-kiosk-nonce": nonce,
      "x-css-kiosk-signature": signature,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body } : {}),
  };
}

test("production pairing -> local approval -> signed NFC lookup", { timeout: 30000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "css-kiosk-http-"));
  const dbPath = join(dir, "kiosk.sqlite");
  const port = await unusedLocalPort();
  const base = "http://127.0.0.1:" + port;
  const proc = spawn(process.execPath, [
    "node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1",
    "--port", String(port),
  ], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production", KIOSK_DB_PATH: dbPath },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  proc.stdout.on("data", (data) => { logs += data.toString(); });
  proc.stderr.on("data", (data) => { logs += data.toString(); });

  try {
    let ready = false;
    for (let i = 0; i < 80; i += 1) {
      if (proc.exitCode !== null) break;
      try {
        if ((await fetch(base + "/api/health")).ok) { ready = true; break; }
      } catch {
        // The isolated localhost server may still be starting.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 150));
    }
    assert.equal(ready, true, "Next test server unavailable: " + logs.slice(-4000));

    const dev = await fetch(base + "/api/dev/device/enroll", { method: "POST" });
    assert.equal(dev.status, 404);

    const keys = await webcrypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"],
    );
    const exported = await webcrypto.subtle.exportKey("jwk", keys.publicKey);
    const publicJwk = { kty: "EC", crv: "P-256", x: exported.x, y: exported.y };
    const deviceId = "browser-" + createHash("sha256")
      .update(["P-256", exported.x, exported.y].join("\n")).digest("hex").slice(0, 24);
    const statusPath = "/api/device/status";
    const pairingPath = "/api/device/pairing";

    const before = await fetch(base + statusPath, await signed(
      keys.privateKey, deviceId, statusPath,
    ));
    assert.equal(before.status, 401);
    assert.equal((await before.json()).code, "DEVICE_UNTRUSTED");

    const pairBody = JSON.stringify({ deviceId, publicJwk });
    const pairInit = await signed(keys.privateKey, deviceId, pairingPath, "POST", pairBody);
    const response = await fetch(base + pairingPath, pairInit);
    assert.equal(response.status, 200);
    const pending = await response.json();
    assert.match(pending.code, /^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);

    const replay = await fetch(base + pairingPath, pairInit);
    assert.equal(replay.status, 409);

    const cli = spawnSync(process.execPath, [script, "approve", pending.code], {
      cwd: root, env: { ...process.env, KIOSK_DB_PATH: dbPath },
      encoding: "utf8", timeout: 10000,
    });
    assert.equal(cli.status, 0, cli.stderr);

    const after = await fetch(base + statusPath, await signed(
      keys.privateKey, deviceId, statusPath,
    ));
    assert.equal(after.status, 200);
    assert.equal((await after.json()).device.deviceId, deviceId);

    const card = JSON.stringify({ credential: { type: "uid", value: "912345678" } });
    const lookupPath = "/api/nfc/resolve";
    const lookup = await fetch(base + lookupPath, await signed(
      keys.privateKey, deviceId, lookupPath, "POST", card,
    ));
    assert.equal(lookup.status, 200);
    assert.equal((await lookup.json()).status, "unregistered");

    const invalid = await signed(keys.privateKey, deviceId, statusPath);
    invalid.headers["x-css-kiosk-signature"] = "invalid";
    assert.equal((await fetch(base + statusPath, invalid)).status, 401);
  } finally {
    proc.kill("SIGTERM");
    if (proc.exitCode === null) {
      await Promise.race([
        new Promise((done) => proc.once("exit", done)),
        new Promise((done) => setTimeout(done, 4000)),
      ]);
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
