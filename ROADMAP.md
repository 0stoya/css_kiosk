# CSS Kiosk Roadmap

Updated: 7 Sep 2026

## Product intent

Build a portrait, Android-first trade-counter kiosk for the TouchWo GD238C. Customers authenticate primarily by tapping an NFC card. If the card is unknown, the kiosk asks for the customer's existing Magento email/password once, verifies the account, and links the NFC credential for future taps.

## Non-negotiable Magento boundary

All kiosk customer authentication/session/catalogue traffic to Magento is **GraphQL only**.

- first-time login: `generateCustomerToken`
- returning-card exchange: `css_kiosk_customer_session`
- fresh customer/company context: `customer` + `css_company_context`
- authenticated catalogue: `categoryList` + `products`
- logout/token revocation: `revokeCustomerToken`

The deployed Commerce-side implementation belongs only to `0stoya/Fluid/Css/Commerce`. Do not introduce a kiosk-specific Magento REST endpoint or depend on any other Magento repository.

## K0 — device and authentication foundation

Status: accepted; final hardening items remain

- [x] standalone `css_kiosk` repository
- [x] Next.js / React / TypeScript baseline aligned with CSS Admin runtime versions
- [x] 1080 x 1920 portrait-first touch shell
- [x] CSS brand tokens and touch-sized controls
- [x] real CSS logo used across kiosk auth states
- [x] NFC authentication state model
- [x] development-only NFC reader simulator behind the `NfcReader` boundary
- [x] deterministic hardware fixtures: ready / unavailable / registered / unknown / revoked / read error
- [x] deterministic Magento-auth fixtures: success / invalid credentials / unavailable
- [x] passive NFC target: card reads arrive as external reader events, not screen taps
- [x] unknown-card email/password linking journey
- [x] explicit account-link confirmation before assigning the card
- [x] signed-in welcome and sign-out reset
- [x] simulator documented in `docs/SIMULATOR.md`
- [x] real Magento customer authentication via GraphQL `generateCustomerToken`
- [x] real authenticated customer/company lookup via GraphQL
- [x] real Magento customer authentication accepted against the live environment
- [x] server-side hashed NFC credential persistence + five-minute pending card-link proof
- [x] real Magento account linked to the persistent simulated card and confirmed durable across kiosk process restarts
- [x] signed kiosk device registration/trust model using ECDSA P-256 public keys
- [x] development simulator exercises signed device requests and nonce replay protection
- [x] signed device trust accepted against the simulator fail-closed check
- [x] trusted kiosk-to-Magento authenticated session exchange defined and implemented
- [x] server-side one-use RS256 assertion + CSS Commerce GraphQL exchange
- [x] opaque 15-minute kiosk session with Magento token kept in server memory only
- [x] fresh customer/company authorization after every returning-card exchange
- [x] live returning-card session accepted against Magento
- [x] Magento 2.4.9 opaque `customer.id` handled correctly by using numeric `css_company_context.customer_id`
- [x] legacy development card snapshots normalized to numeric Magento customer IDs on read
- [ ] complete sign-out/re-auth runtime regression after the final ID normalization patch
- [ ] implement inactivity session reset
- [ ] implement offline / degraded-network state
- [ ] inspect TouchWo GD238C Android version, SoC, NFC hardware/API and browser/WebView capabilities

### Live K0 acceptance — 7 Sep 2026

Observed returning-card result:

```text
Welcome, Chris
Your trade account has been recognised.

Greener Ealing Ltd
chris@ostoya.io
Account EAL001
```

Accepted trust chain:

```text
linked NFC fixture
→ signed trusted device request
→ persisted hashed credential lookup
→ numeric Magento customer ID
→ one-use RS256 customer_session assertion
→ GraphQL css_kiosk_customer_session
→ Magento customer token, server-side only
→ GraphQL customer + css_company_context refresh
→ opaque HttpOnly css_kiosk_session
→ Welcome
```

### K0 acceptance rules

- Runs at portrait 1080 x 1920 without horizontal scrolling.
- All customer actions are comfortably touchable.
- Known-card and unknown-card journeys can be exercised without physical NFC hardware.
- Reader unavailable, card read error, invalid Magento credentials and Magento service outage all fail closed in the simulator.
- Prototype controls are unavailable in a production build.
- Production cannot create a fake NFC read or accept simulated Magento authentication.
- Magento integration is GraphQL-only.
- Real Magento verification returns only safe customer/company data to the browser; the customer token is not returned or persisted client-side.
- Raw NFC credentials are not stored; only a SHA-256 credential hash is persisted server-side.
- Pending card links are short-lived, HttpOnly-bound and require explicit confirmation.
- A linked card cannot silently move to another customer account.
- Protected NFC/customer routes require a signed active kiosk device identity.
- Device request signatures cover method, path, timestamp, nonce and exact body hash; nonces are single-use.
- Production stores only the device public key; the future Android private key stays in Android Keystore.
- Returning linked cards require a fresh one-use server assertion before Magento issues a customer token.
- CSS Commerce accepts only numeric Magento customer IDs in the signed assertion `sub`.
- Magento token remains server-side; the browser receives only an opaque HttpOnly kiosk session ID and safe customer/session metadata.
- A fresh Magento customer/company lookup must still match the linked NFC context before the kiosk session is created.
- Replacing/signing out a kiosk session destroys the in-memory session and revokes its Magento token best-effort.
- No password, Magento token or reusable customer credential is persisted client-side.

## K1 — authenticated customer home and catalogue entry

Status: implemented on `feat/authenticated-catalogue-home`; live runtime acceptance pending

The existing `css_kiosk_session` is already authenticated. K1 makes `Continue` use it for customer-facing commerce rather than creating a second browser authentication mechanism.

- [x] `Continue` enters authenticated customer home/catalogue
- [x] trusted `/api/catalogue` resolves the signed kiosk device and existing `css_kiosk_session`
- [x] server uses only the session-held Magento customer token for catalogue GraphQL
- [x] no Magento bearer token in browser responses, localStorage, sessionStorage or client JavaScript
- [x] customer/company identity remains visible throughout the catalogue journey
- [x] trade catalogue landing screen
- [x] live GraphQL product search
- [x] top-level category navigation using Magento category UIDs
- [x] customer-authorized price and stock fields returned from Magento GraphQL
- [x] clear signed-in identity and sign-out from catalogue
- [x] expired/missing kiosk session fails closed and returns to NFC authentication path
- [x] touch-first loading, empty and catalogue-unavailable states
- [ ] live accept catalogue load/search/category against EAL001
- [ ] verify expected customer/company pricing with a known product against Magento storefront/admin evidence
- [ ] company-specific branding beyond the current company/account identity
- [ ] favourites / common purchases foundation

### K1 request boundary

```text
browser
  → signed kiosk-device request + HttpOnly css_kiosk_session
  → css_kiosk /api/catalogue
  → resolve in-memory kiosk session
  → Magento bearer token stays server-side
  → HTTPS GraphQL categoryList + products
  → safe catalogue/category/price/stock data only
  → browser
```

## K2 — catalogue and basket

- product detail
- deeper filtering / pagination
- verified company product visibility
- verified customer/company pricing
- detailed stock/availability presentation
- basket
- quantity controls suitable for gloves/touchscreen use

## K3 — checkout / trade-counter handoff

Exact scope to be agreed after Magento order and counter workflows are inspected.

## K4 — Android kiosk shell

- boot on power
- immersive portrait fullscreen
- keep-awake policy
- native NFC bridge
- connectivity monitoring
- watchdog / recovery
- remote version visibility
- secure device identity

## K5 — production serving

- `kiosk.csscdn.co.uk`
- dedicated runtime identity
- loopback-only application listener
- PM2/systemd persistence
- nginx HTTPS boundary
- logs / rotation / runbook
- reboot acceptance

## Security rules

1. Never store a customer's Magento password.
2. Never write a Magento access token onto an NFC card.
3. Prefer a random opaque NFC credential; store only its hash server-side.
4. Card UID support is a fallback pending hardware inspection.
5. A linked card cannot silently move to another customer account.
6. Lost/revoked cards fail closed.
7. Kiosk sessions are short-lived and reset automatically on inactivity.
8. The kiosk device must never contain Magento Admin credentials.
9. Production NFC trust decisions belong to the server, not browser state.
10. Production kiosk devices use asymmetric signing; only the public key is stored server-side.
11. Magento customer tokens stay server-side and are never returned to kiosk browser JavaScript.
12. Magento customer authentication/session/catalogue transport is GraphQL only.
13. The RSA private assertion key stays outside source control and outside Magento; Magento stores only the public key.
14. Browser catalogue requests must be both trusted-device signed and bound to the opaque kiosk session.
