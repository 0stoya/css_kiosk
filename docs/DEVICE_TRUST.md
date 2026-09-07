# Kiosk device trust

The kiosk must prove which physical device is making customer/NFC requests before the backend will resolve cards, verify Magento credentials, or confirm a card link.

## Trust model

Production devices use an asymmetric ECDSA P-256 key pair.

- the private key belongs to the Android kiosk and is intended to live in Android Keystore;
- the private key must never be returned to the browser or kiosk backend;
- the kiosk backend stores only the public JWK plus device metadata/status;
- a revoked or unknown device fails closed.

Each protected request carries:

```text
x-css-kiosk-device-id
x-css-kiosk-timestamp
x-css-kiosk-nonce
x-css-kiosk-signature
```

The signature covers the exact canonical request:

```text
METHOD
/path?query
TIMESTAMP_MS
NONCE
SHA256(EXACT_REQUEST_BODY)
```

The server verifies the device is active, accepts only a short timestamp window, verifies the ECDSA signature, consumes the nonce once, and records `last_seen_at`.

A captured signed request cannot simply be replayed because the nonce is persisted and may be used only once.

## Development simulator

Until the TouchWo GD238C is available, the browser simulator generates a temporary P-256 key pair with Web Crypto.

`POST /api/dev/device/enroll` exists only when `NODE_ENV !== production`. It accepts only the fixed development simulator identity and stores its public key in the local kiosk SQLite database.

After enrollment the simulator signs the same requests that the Android shell will sign later. The simulator panel should show:

```text
Device trust: Trusted
```

The development private key is intentionally ephemeral and is regenerated on page reload. That is acceptable for the simulator; production Android keys are expected to be durable and non-exportable.

## Protected routes

The following routes now require a valid signed device request:

- `GET /api/device/status`
- `POST /api/nfc/resolve`
- `POST /api/auth/verify-customer`
- `POST /api/nfc/link`
- `DELETE /api/nfc/link`

Requests without a valid device identity fail before customer/card processing.

## Production enrollment boundary

There is deliberately no public production enrollment endpoint in this slice.

When the physical kiosk is available, enrollment should be an authorised commissioning action:

1. Android shell generates a non-exportable P-256 key in Android Keystore.
2. Staff authorise the kiosk in CSS Admin / a controlled commissioning workflow.
3. Only the public key, device ID, label and status are stored server-side.
4. The Android shell retains the private key and signs requests.
5. Revoking the server-side device immediately blocks protected kiosk APIs.

The later Magento kiosk-session exchange must require this trusted device identity as one of its inputs; it must not use a generic Magento Admin credential or a customer ID alone.

## Manual acceptance

Run the development build and confirm:

1. simulator reaches `Device trust: Trusted` before `Present card` is enabled;
2. registered / unknown / revoked NFC scenarios still work;
3. real Magento unknown-card verification still succeeds on the trusted simulator;
4. card linking still persists;
5. an unsigned request such as `curl -i -X POST http://localhost:3000/api/nfc/resolve -H 'content-type: application/json' --data '{"credential":{"type":"secure-token","value":"test"}}'` returns a device-trust failure;
6. restart/reload causes the development simulator to enroll a new ephemeral public key and continue working;
7. `yarn lint`, `yarn typecheck`, and `yarn build` remain green.
