# NFC credential persistence

This slice keeps the physical Android NFC reader simulated, but makes the card-to-customer association real and server-side.

## Storage

The kiosk uses Node's built-in SQLite driver (`node:sqlite`). No extra runtime dependency is required.

Development defaults to:

```text
.data/kiosk.sqlite
```

Production must explicitly set:

```text
KIOSK_DB_PATH=/srv/css-kiosk/data/kiosk.sqlite
```

The database path must live outside an immutable application release so card registrations survive deploys and reboots.

## Credential handling

The raw NFC credential is never written to the database.

The server stores:

```text
SHA-256(credential type + credential value)
```

along with:

- credential type (`secure-token` or `uid`)
- Magento customer ID
- a safe customer/company snapshot
- status (`active` or `revoked`)
- created / updated / last-used timestamps

One customer may have multiple cards. One card may map to only one customer. Existing or revoked cards cannot be silently reassigned.

## Unknown-card registration flow

```text
card presented
  -> POST /api/nfc/resolve
  -> unregistered
  -> email/password
  -> Magento customer authentication
  -> authenticated customer/company lookup
  -> create five-minute pending link
  -> HttpOnly pending-link cookie
  -> explicit Link this card confirmation
  -> POST /api/nfc/link
  -> persist hashed card credential
```

The pending-link cookie contains only a random opaque proof. The proof is hashed in SQLite and bound server-side to the card hash and verified Magento customer.

Cancelling or returning to the card screen deletes the pending proof. Pending links also expire after five minutes.

## Registered-card flow

```text
card presented
  -> POST /api/nfc/resolve
  -> hash credential
  -> active mapping found
  -> return safe stored customer/company summary
  -> welcome screen
```

This proves durable card recognition. It does **not** yet create a fresh authenticated Magento catalogue session. The next authentication slice must define the trusted kiosk-to-Magento token/session exchange rather than storing a customer password.

## Development fixtures

The deterministic `Registered card` and `Revoked card` simulator fixtures remain available only outside production. The `Unknown / linkable card` fixture uses the real SQLite store, so after a successful real Magento link the same simulated card becomes registered on its next presentation.

## Security boundary

- no Magento password is stored;
- no raw NFC credential is stored;
- no Magento customer bearer token is stored in SQLite or returned to the browser;
- pending link proofs are random, HttpOnly, short-lived and stored hashed server-side;
- production fails closed if `KIOSK_DB_PATH` is not configured;
- card reassignment requires a future explicit staff/admin workflow.
