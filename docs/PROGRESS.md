# CSS Kiosk progress

Updated: 7 Sep 2026

This document records the accepted state of `css_kiosk` so the next implementation slice can start from a stable security/transport boundary rather than re-discovering earlier decisions.

## Current accepted architecture

```text
TouchWo / simulator NFC event
        ↓
NfcReader abstraction
        ↓
signed kiosk-device request (ECDSA P-256)
        ↓
server resolves SHA-256 NFC credential hash
        ↓
known card?
  ├─ no → Magento GraphQL generateCustomerToken
  │       → fresh customer + css_company_context
  │       → explicit card-link confirmation
  │       → durable hashed NFC mapping
  │
  └─ yes → one-use RS256 customer_session assertion
          → CSS Commerce GraphQL css_kiosk_customer_session
          → Magento customer token, server memory only
          → fresh customer + css_company_context
          → opaque HttpOnly css_kiosk_session
          → Welcome
```

## Magento boundary

The kiosk/Magento integration is **GraphQL only**.

```text
First-time auth         generateCustomerToken
Returning-card session  css_kiosk_customer_session
Identity/company        customer + css_company_context
Logout/revocation       revokeCustomerToken
```

The deployed Magento-side customization boundary is:

```text
0stoya/Fluid/Css/Commerce
```

No kiosk-specific REST endpoint is part of the architecture. No Magento Admin/integration credential belongs in `css_kiosk`.

## Completed milestones

### Foundation

- standalone Next.js/React/TypeScript kiosk repository
- portrait 1080 x 1920 touch-first shell
- CSS branding/logo
- NFC auth-state model
- Android/native-facing `NfcReader` interface

### Hardware-independent simulation

- deterministic NFC simulator
- registered / unknown / revoked / reader unavailable / read-error scenarios
- deterministic device trust simulation
- development-only controls excluded from production behavior

### First-time customer linking

- real Magento email/password authentication through GraphQL `generateCustomerToken`
- current customer/company resolution
- explicit confirmation before card assignment
- password never persisted
- SHA-256 NFC credential persistence
- five-minute pending link proof
- multiple-card-per-customer-compatible data model

### Kiosk device trust

- ECDSA P-256 signed requests
- device ID, timestamp and nonce headers
- canonical method/path/body-hash signature
- 90-second request freshness
- nonce replay protection
- unknown/revoked/invalid devices fail closed
- production private key intended for Android Keystore

### Returning-card Magento session

- kiosk-side RS256 assertion signing
- 60-second assertion lifetime
- `iss=css-kiosk`
- `aud=css-commerce`
- `kid=css-kiosk-v1`
- numeric Magento customer ID in `sub`
- trusted kiosk device ID in `device_id`
- random single-use `jti`
- CSS Commerce assertion verification + replay table
- Magento customer token issued server-side only
- current customer/company re-read after token issuance
- 15-minute opaque kiosk session
- HttpOnly + SameSite=Strict browser cookie
- server restart intentionally destroys active sessions while durable NFC links survive
- sign-out/replacement revokes Magento token best-effort

## Magento 2.4.9 customer ID compatibility

During live acceptance Magento returned:

```text
customer.id = Ng==
```

The standard `customer.id` is an opaque GraphQL ID, not the numeric entity ID required by the CSS Commerce assertion contract.

The accepted fix is to use:

```text
css_company_context.customer_id
```

for `VerifiedKioskCustomer.customerId`, durable card linkage and assertion `sub`.

Legacy development snapshots containing the opaque ID are normalized/repaired on read.

## Live acceptance evidence

Accepted on 7 Sep 2026 against live Magento and the deployed `Fluid/Css/Commerce` contract.

### Trust/config checks

```text
RSA private key: valid standard RSA
Magento GraphQL: reachable
Magento kiosk exchange: enabled
issuer: css-kiosk
audience: css-commerce
key id: css-kiosk-v1
max ttl: 60
clock skew: 15
public key fingerprint: matched kiosk key pair
Magento KioskAssertionVerifier: accepted fresh assertion
```

### End-to-end returning-card result

```text
Welcome, Chris
Your trade account has been recognised.

Greener Ealing Ltd
chris@ostoya.io
Account EAL001
```

This proves the returning-card path reached fresh Magento customer/company authorization rather than stopping at a stored NFC snapshot.

## Secrets/token boundary

Never persist or expose:

- Magento customer password
- Magento customer bearer token in browser-visible state
- RSA private assertion key in source control/Magento/browser/NFC
- raw NFC credential in SQLite

Allowed persistence/exposure:

- SHA-256 NFC credential hash in SQLite
- RSA public key in CSS Commerce configuration
- device public key server-side
- opaque `css_kiosk_session` cookie in the browser
- safe customer/company display metadata

## Current open PR

`#10 Use numeric Magento customer ID for kiosk assertions`

The PR contains the Magento 2.4.9 opaque-ID fix plus this documentation update. Runtime returning-card acceptance is green on the branch.

Before merge, run:

```bash
cd /srv/css/css_kiosk
yarn lint
yarn typecheck
yarn build
```

Then complete one final sign-out → same-card sign-in regression.

## Next implementation slice

### K1 — authenticated catalogue entry

`Continue` must use the already-established `css_kiosk_session`; it must not create a second browser authentication system.

Target request model:

```text
browser
  → opaque css_kiosk_session cookie
  → css_kiosk server
  → resolve in-memory session
  → Magento token remains server-side
  → Magento GraphQL catalogue/customer/company requests
  → safe catalogue data returned to browser
```

Initial acceptance for K1:

- Continue enters authenticated catalogue/customer home
- expired/missing session returns to NFC screen
- customer/company identity remains visible
- sign out is available from authenticated catalogue pages
- no Magento bearer token appears in browser network responses, localStorage or sessionStorage
- Magento catalogue/customer calls remain GraphQL-only
- company/customer context is preserved for subsequent pricing/catalogue work

## Later work

- inactivity-driven session reset
- offline/degraded network state
- catalogue/search/categories
- company-specific visibility/pricing/stock
- basket and checkout/handoff
- physical TouchWo/NFC hardware inspection
- Android kiosk shell
- production serving/hardening at `kiosk.csscdn.co.uk`
