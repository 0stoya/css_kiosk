# CSS Kiosk progress

Updated: 7 Sep 2026

This document records the accepted state of `css_kiosk` and the current implementation slice so work can continue without re-discovering security, transport or deployment boundaries.

## Current architecture

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
          → Continue
          → signed /api/catalogue request + css_kiosk_session
          → server-held Magento token
          → Magento GraphQL categoryList + products
          → safe catalogue data only
```

## Magento boundary

The kiosk/Magento integration is **GraphQL only**.

```text
First-time auth         generateCustomerToken
Returning-card session  css_kiosk_customer_session
Identity/company        customer + css_company_context
Catalogue/categories    products + categoryList
Logout/revocation       revokeCustomerToken
```

The deployed Magento-side customization boundary is:

```text
0stoya/Fluid/Css/Commerce
```

No kiosk-specific REST endpoint is part of the architecture. No Magento Admin/integration credential belongs in `css_kiosk`.

RSA and ECDSA are trust/authentication mechanisms; HTTPS GraphQL remains the Magento transport.

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

## Live K0 acceptance evidence

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

## K1 — authenticated catalogue home

Current branch:

```text
feat/authenticated-catalogue-home
```

Implemented:

- `Continue to catalogue` now uses the existing authenticated kiosk session
- new trusted `POST /api/catalogue` route
- every catalogue request must pass signed kiosk-device verification
- route also resolves the HttpOnly `css_kiosk_session`
- Magento customer bearer token is taken only from server session memory
- browser never receives the bearer token
- authenticated Magento `categoryList` supplies top-level category navigation
- authenticated Magento `products` supplies product search, customer-authorized price range, stock status and images
- category filtering uses Magento category UIDs
- default product landing query uses a valid `price >= 0` GraphQL filter so the core `products` resolver always receives `search` or `filter`
- 8-product touch-first catalogue grid
- live search box
- top-level category chips
- signed-in company/account context remains visible
- loading / empty / service-unavailable states
- session expiry fails closed and returns to the NFC authentication path
- sign out remains available from catalogue
- basket is deliberately disabled/placeholder until K2

### K1 request boundary

```text
browser
  → signed POST /api/catalogue
  → HttpOnly css_kiosk_session sent automatically
  → css_kiosk validates device signature + nonce
  → css_kiosk resolves in-memory session for that device
  → server reads Magento token from session memory
  → HTTPS GraphQL categoryList + products
  → safe product/category/price/stock JSON
  → browser
```

The browser-visible catalogue response contains only display-safe catalogue and customer context. It never contains the Magento bearer token or RSA private key material.

### K1 live acceptance still required

On the kiosk host:

```bash
cd /srv/css/css_kiosk
git fetch origin
git checkout feat/authenticated-catalogue-home
git reset --hard origin/feat/authenticated-catalogue-home
yarn lint
yarn typecheck
yarn build
yarn dev
```

Then with simulator `Device trust: Trusted` and `Magento auth: Real Magento`:

```text
present linked card
→ Welcome, Chris / Greener Ealing Ltd / EAL001
→ Continue to catalogue
→ POST /api/catalogue 200
→ category strip visible
→ product cards visible
→ search known SKU/name returns results
→ select category returns category products
→ sign out
→ same card signs in again
```

Also inspect browser network/storage and confirm no Magento bearer token is visible. The only customer session credential in the browser should be the HttpOnly `css_kiosk_session` cookie.

Before calling customer/company pricing accepted, compare at least one known product price against expected Magento/customer evidence for EAL001.

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
- safe catalogue/category/price/stock metadata

## Next after K1 acceptance

### K2 — product detail and basket

- touch-first product detail
- quantity controls
- add-to-basket
- server-side customer cart through Magento GraphQL
- verified company/customer pricing and product visibility
- stock/availability detail
- basket persistence bound to the authenticated customer session

The same rule continues: the browser talks only to `css_kiosk`; Magento bearer tokens remain server-side and Magento integration remains GraphQL-only.

## Later work

- inactivity-driven session reset
- offline/degraded network state
- favourites/common purchases
- checkout/trade-counter handoff
- physical TouchWo/NFC hardware inspection
- Android kiosk shell
- production serving/hardening at `kiosk.csscdn.co.uk`
