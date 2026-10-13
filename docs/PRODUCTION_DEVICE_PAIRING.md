# CSS Kiosk production browser-device pairing (temporary)

This is the production-compatible recovery path for the existing Android 0.1.0
shell. The installed Sycreader hardware already emits a numeric UID event into
the WebView. That APK does **not** expose Android Keystore signing to JavaScript.

The fallback below uses a persistent, non-exportable **WebCrypto** P-256 private
key in the kiosk WebView's IndexedDB. It is not equivalent to hardware-backed
device identity or remote attestation. Replace it with native Android Keystore
signing when the APK can be updated.

## Security invariants

- Device authentication is required for RFID, catalogue, basket and checkout.
- No card UID, Magento password, customer bearer token, or device private key is
  written to the pairing database or exposed in the pairing code.
- Public POST /api/device/pairing records only a **pending** public key and
  a domain-separated SHA-256 hash of a ten-character random pairing code. The request
  must be signed by the candidate browser key. Replay nonces and rate limits
  apply before a pending request is accepted.
- **Only the local Ubuntu CLI** can move a pending public key into the trusted
  kiosk_devices table. There is no public pairing approval endpoint.
- A revoked device cannot be re-enabled by a pairing request or CLI approval.
- The actual physical kiosk screen must be the source of the pairing code.
  Never approve a code received from an unknown caller, website, or email.
- No fixed-IP allowlisting; the kiosk is on changing mobile data. The server
  remains publicly reachable, including independently authenticated ARGO
  webhooks and CSS Admin integrations.
- Development fixtures / automatic dev enrollment remain blocked when
  NODE_ENV=production.
- Employee RFID enrollment is hidden from the idle screen, not removed from
  the authenticated backend.
- Physical RFID scanned before pairing is **not** replayed automatically
  after approval. The customer must tap the card again.

## Before deployment

From an isolated Git worktree, use Node 24:

    yarn install --frozen-lockfile
    yarn lint
    yarn typecheck
    yarn test:pairing
    yarn build

Back up the existing SQLite kiosk DB safely before deployment. Verify the
configured KIOSK_DB_PATH points to the same **existing database** in production
and in the approval utility. Do not clear .data, app storage or device keys.

The new tables are created lazily on the first kiosk-device request. Neither
the pairing endpoint nor the approval utility migrates Magento or ARGO data.

## One-time pairing with staff who have no developer access

1. Deploy the validated production build with the unchanged Nginx hostname,
   the existing Magento/ARGO environment, and PM2 running next start.
2. Ask staff to reopen the CSS Kiosk app if it has not refreshed yet. Its
   card-only login screen displays a code such as ABCDE-FGHJK under
   "One-time kiosk setup".
3. Staff read the code to the CSS administrator through a trusted channel.
   They do not need Android settings, USB/ADB, SSH or developer tools.
4. On **Ubuntu**, in the deployed kiosk checkout, run:

       node scripts/approve-kiosk-device.mjs inspect ABCDE-FGHJK

   This checks the pending device, the exact fingerprint, and expiration.
   Confirm the code was read from the physical kiosk, then run:

       node scripts/approve-kiosk-device.mjs approve ABCDE-FGHJK

5. The browser checks signed GET /api/device/status about every 5 seconds.
   When the server returns 200, the code disappears and the ordinary
   "Tap your card to sign in" screen is ready.
6. Staff tap an existing registered card. Verify Nginx access log shows
   POST /api/nfc/resolve, followed by the normal Welcome/catalogue journey.
   Never request that staff read aloud the raw RFID number.

Codes expire after ten minutes. The browser automatically requests a fresh
code if still waiting for approval. Ask staff for the **current** displayed
code if the CLI reports expiration.

The CLI uses KIOSK_DB_PATH from the parent environment, or reads
.env.production.local, .env.local, .env.production and .env (in that precedence).
It refuses to create a missing SQLite database. Run it from the kiosk repo,
on the actual production host; it never prints environment secrets.

## Checks and recovery

- POST /api/dev/device/enroll must continue to return 404 in production.
- POST /api/device/pairing without a valid key signature must fail.
- GET /api/device/status is 401 for pending devices and 200 after approval.
- GET /api/device/status remains 403 for revoked devices.
- If an approved kiosk loses its IndexedDB data, a **new** key is generated
  and requires **new manual approval**. It is not automatically trusted.
- If pairing fails unexpectedly, the existing "Retry kiosk connection" button
  reloads the kiosk page without modifying customer card registrations.
- Keep the browser-origin scripts and kiosk domain tightly controlled. Browser
  cryptographic keys are non-extractable, but same-origin malicious code could
  still request signatures; this is the reason for the native hardening step.

## Follow-up: permanent Android trust

The production APK update should provide a tightly scoped JavaScript/native
bridge for signing the exact method, pathname/search, timestamp, nonce and
SHA256(body) canonical request with Android Keystore. Do not expose raw private
keys to JavaScript. Convert Android's DER ECDSA signature to the current
IEEE-P1363 wire format (or explicitly add a separately versioned verifier).
Commission its public key through an authorised process, verify replay
protection, and revoke the temporary browser device identity only **after**
native card-login acceptance has passed. No Fluid/Magento schema change is
expected.
