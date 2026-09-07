# CSS Kiosk

Customer-facing trade-counter kiosk for Chelmsford Safety Supplies.

## Product boundary

- Target hardware: TouchWo GD238C
- Target platform: Android
- Primary orientation: portrait
- Primary design canvas: 1080 x 1920
- Public kiosk URL: `https://kiosk.csscdn.co.uk` (planned)
- Customer authentication: NFC-first, with Magento email/password used once to link an unregistered card
- Admin and kiosk remain separate applications and security boundaries
- Deployed Magento-side kiosk contract lives only in `0stoya/Fluid/Css/Commerce`

## Magento transport rule: GraphQL only

All `css_kiosk` customer authentication and session traffic to Magento uses HTTPS GraphQL.

- first-time email/password authentication: Magento `generateCustomerToken`
- returning linked-card exchange: CSS Commerce `css_kiosk_customer_session`
- fresh customer/company authorization: `customer` + `css_company_context`
- logout/token invalidation: Magento `revokeCustomerToken`

There is no kiosk-specific Magento REST endpoint and no Magento Admin/integration credential in this application.

RSA/ECDSA signatures authenticate trust boundaries; they do not replace GraphQL as transport.

## Current foundation

The kiosk can be developed and accepted before physical NFC hardware is available. The current K0 foundation includes:

- 1080 x 1920 touch-first portrait UI and CSS branding
- development-only deterministic NFC/device simulator
- registered, unknown, revoked and reader-failure journeys
- real first-time Magento authentication through GraphQL
- explicit card-link confirmation before durable assignment
- SHA-256-only NFC credential persistence; raw card values are not stored
- signed kiosk-device requests with ECDSA P-256, timestamps and nonce replay protection
- one-use RS256 kiosk-to-Commerce customer-session assertions
- Magento customer tokens held server-side only
- opaque, HttpOnly 15-minute kiosk browser session
- fresh Magento customer/company authorization on every returning-card session
- sign-out/token-revocation path

### Live returning-card acceptance

Accepted against the live Magento environment on 7 Sep 2026:

```text
registered linked card
→ trusted simulated kiosk device
→ one-use RS256 assertion
→ GraphQL css_kiosk_customer_session
→ fresh customer + css_company_context
→ opaque kiosk session
→ Welcome, Chris
→ Greener Ealing Ltd
→ Account EAL001
```

Magento 2.4.9 exposes `customer.id` as an opaque GraphQL ID (for example `Ng==`). Kiosk authorization therefore uses the numeric `css_company_context.customer_id` as the Magento entity ID required by the signed assertion contract. Legacy stored development snapshots are normalized on read.

The next slice is **authenticated catalogue use**: `Continue` will enter catalogue/search/navigation using the existing server-side kiosk session while keeping the Magento bearer token out of browser-visible storage and responses.

## Security boundary

```text
NFC credential
  → hashed server-side link
  → signed trusted kiosk-device request
  → one-use RS256 customer assertion
  → CSS Commerce GraphQL
  → Magento customer token (server memory only)
  → fresh GraphQL customer/company context
  → opaque HttpOnly css_kiosk_session cookie
```

The browser never receives the Magento customer token. The RSA private key remains outside the repository on the kiosk application host; Magento receives only the corresponding public key.

See:

- `ROADMAP.md` — delivery progress and next slices
- `docs/NFC_AUTH.md` — NFC linking/security model
- `docs/DEVICE_TRUST.md` — signed kiosk-device trust
- `docs/MAGENTO_KIOSK_SESSION.md` — GraphQL customer-session exchange
- `docs/PROGRESS.md` — accepted milestones and current handoff state

## Local development

Requires Node 22 or newer and Yarn 1.x.

```bash
yarn install
yarn dev
```

Development simulation is intentionally disabled in production builds. Real production NFC input will come from the Android reader bridge.

## Validation

```bash
yarn lint
yarn typecheck
yarn build
```
