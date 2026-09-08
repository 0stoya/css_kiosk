# CSS Kiosk Roadmap

Updated: 8 Sep 2026

## Product intent

Build a portrait, Android-first trade-counter kiosk for the TouchWo GD238C. Customers authenticate primarily by tapping an NFC card. If the card is unknown, the kiosk asks for the customer's existing Magento email/password once, verifies the account, and links the NFC credential for future taps.

## Current checkpoint

The browser/server commerce path is now accepted through local-locker order placement.

- **K0 — device/auth foundation:** accepted; inactivity/degraded-network hardening and physical hardware inspection remain.
- **K1 — authenticated customer home/catalogue:** accepted and merged, including compact signed-in UI, initial company branding and recent order history.
- **K2 — catalogue/basket:** accepted and merged for simple, configurable, bundle and grouped products, including live search and pagination.
- **K3 — local-locker checkout:** accepted and merged through real `companycredit` order submission, Magento order correlation and asynchronous OGL status lookup.
- **K4 — Android kiosk shell:** next hardware/native milestone.
- **K5 — production serving:** planned after the physical kiosk/runtime boundary is accepted.

Physical NFC/Android and locker door/compartment control remain separate hardware/provider-adapter work; they are not prerequisites for the already accepted Magento commerce path.

## Non-negotiable Magento boundary

All kiosk customer authentication/session/catalogue/cart/checkout traffic to Magento is **GraphQL only**.

- first-time login: `generateCustomerToken`
- returning-card exchange: `css_kiosk_customer_session`
- fresh customer/company context: `customer` + `css_company_context`
- authenticated catalogue: `categoryList` + `products`
- authenticated basket: `customerCart` + cart mutations
- product option selection: configurable, bundle and grouped product GraphQL fields
- local-locker preparation: customer cart + shipping address/method GraphQL mutations
- Payment on Account: `setPaymentMethodOnCart` + `cssSubmitCreditOrder`
- company order history: `css_company_orders`
- customer-scoped locker/OGL status: `css_kiosk_locker_order_status`
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
- [x] sign-out/re-auth regression accepted through later catalogue/basket testing
- [ ] implement inactivity session reset
- [ ] implement explicit offline / degraded-network state

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

Status: accepted and merged; commercial verification and broader personalization remain

- [x] `Continue` enters authenticated customer home/catalogue
- [x] trusted `/api/catalogue` resolves the signed kiosk device and existing `css_kiosk_session`
- [x] server uses only the session-held Magento customer token for catalogue GraphQL
- [x] no Magento bearer token in browser responses, localStorage, sessionStorage or client JavaScript
- [x] customer/company identity remains visible throughout the catalogue journey
- [x] compact portrait signed-in workspace for header, search, categories, products and pagination
- [x] trade catalogue landing screen
- [x] live GraphQL product search
- [x] top-level category navigation using Magento category UIDs
- [x] customer-authorized price and stock fields returned from Magento GraphQL
- [x] clear signed-in identity and sign-out from catalogue
- [x] expired/missing kiosk session fails closed and returns to NFC authentication path
- [x] touch-first loading, empty and catalogue-unavailable states
- [x] live catalogue load/search/category accepted against EAL001
- [x] initial company-specific branding: Greener Ealing (`EAL001`) logo mapping with safe company-name fallback
- [x] `My account` customer/company details
- [x] five most recent selected-company orders through signed `/api/account/orders`
- [x] account menu outside-tap dismissal and kiosk touch-focus polish
- [ ] verify expected customer/company pricing with a known product against Magento storefront/admin evidence
- [ ] generalize company logo/branding mapping beyond the currently explicit EAL001 mapping
- [ ] favourites / common purchases foundation

### K1 request boundary

```text
browser
  → signed kiosk-device request + HttpOnly css_kiosk_session
  → css_kiosk /api/catalogue or /api/account/orders
  → resolve in-memory kiosk session
  → Magento bearer token stays server-side
  → HTTPS GraphQL
  → safe catalogue/account/order data only
  → browser
```

## K2 — catalogue and basket

Status: accepted and merged

- [x] product detail
- [x] authenticated Magento customer cart
- [x] basket quantity controls suitable for gloves/touchscreen use
- [x] add/remove/update simple products
- [x] configurable product option UI + `selected_options` implementation
- [x] bundle product option UI + `selected_options` implementation
- [x] grouped product child quantity UI + multi-line `addProductsToCart` implementation
- [x] live accept at least one configurable product
- [x] live accept at least one bundle product
- [x] live accept grouped product `CTR251/GR` or another real grouped product
- [x] Magento full-text search uses the correct dedicated `products(search: ...)` query shape
- [x] touch pagination wired to Magento `currentPage` / `totalPages`
- [x] search/category/clear-filter actions reset pagination to page 1
- [x] compact two-column portrait product cards
- [x] remote product-image failure falls back to a neutral placeholder
- [x] basic Magento stock state displayed in catalogue/product detail
- [ ] deeper filtering / faceting beyond top-level categories and search
- [ ] independently verify company product visibility against known Magento evidence
- [ ] independently verify customer/company pricing against known evidence
- [ ] richer availability/lead-time presentation if required by operations

### K2 product types

```text
SimpleProduct
  → direct quantity + addProductsToCart

ConfigurableProduct
  → choose every required configurable value
  → Magento option value UIDs in selected_options

BundleProduct
  → choose required/optional bundle options
  → Magento bundle choice UIDs in selected_options

GroupedProduct
  → choose quantity per associated child SKU
  → addProductsToCart receives selected child CartItemInput rows
```

## K3 — local-locker checkout

Status: accepted and merged

Kiosk delivery is **local locker only**. The kiosk does not expose a general delivery-address form or an arbitrary carrier/shipping-method picker.

Accepted trust boundary:

```text
trusted kiosk/device
  → css_kiosk resolves this kiosk's configured local locker server-side
  → basket/order remains bound to authenticated customer/company session
  → css_kiosk applies only the configured locker destination/method
  → Magento checkout/order operations over GraphQL only
  → Payment on Account / cssSubmitCreditOrder
  → Magento sales order when placed
  → Fluid OGL export queue
  → OGL ordno / locker-order status when available
```

- [x] server-side kiosk → locker configuration
- [x] no arbitrary delivery address accepted from browser input
- [x] no arbitrary carrier or method accepted from browser input
- [x] Magento cart receives only the trusted local-locker destination/method
- [x] CSS locker shipping method (`csslocker / locker`) is verified before selection
- [x] order review shows the configured locker clearly before confirmation
- [x] confirm re-runs trusted locker preparation before destructive submission
- [x] `companycredit` / Payment on Account availability is verified and selected server-side
- [x] order is submitted through existing GraphQL `cssSubmitCreditOrder`
- [x] safe Fluid credit-order reference and Magento order number returned when available
- [x] real local-locker order confirmation accepted before merge
- [x] asynchronous OGL export is treated as a later lifecycle step rather than an order failure
- [x] customer-scoped `css_kiosk_locker_order_status` lookup correlates eligible locker orders with OGL `ordno`
- [x] just-placed orders can show an explicit waiting-for-OGL-export state
- [x] recent My Account history enriches locker orders with exported/waiting OGL state while leaving normal orders visible
- [x] checkout validation fails closed without exposing Magento bearer token, cart ID, arbitrary locker address, shipping method or payment method to the browser

### K3 accepted lifecycle

```text
confirmed kiosk locker cart
→ cssSubmitCreditOrder
→ Magento sales order when placed
→ Fluid_OglOrder queue
→ OGL ordno
→ sales_order.ogl_id
→ css_kiosk_locker_order_status
→ later locker assignment / pickup
```

Physical locker assignment, compartment selection and door control are intentionally outside this accepted commerce milestone and remain provider/hardware integration work.

## K4 — Android kiosk shell and physical hardware

Status: next hardware/native milestone

- [ ] inspect TouchWo GD238C Android version, SoC, NFC hardware/API and browser/WebView capabilities
- [ ] confirm physical NFC reader behaviour and credential format
- [ ] provision production device identity with non-exportable Android Keystore private key
- [ ] native NFC bridge into the kiosk application boundary
- [ ] boot on power
- [ ] immersive portrait fullscreen
- [ ] keep-awake policy
- [ ] connectivity monitoring tied to the kiosk degraded-network UX
- [ ] watchdog / recovery
- [ ] remote version visibility
- [ ] secure native ↔ web/application bridge
- [ ] define/implement the physical locker provider adapter for assignment, compartment and door-control operations
- [ ] complete an office hardware acceptance pass on the TouchWo and locker equipment

## K5 — production serving

Status: planned

- [ ] `kiosk.csscdn.co.uk`
- [ ] dedicated runtime identity
- [ ] loopback-only application listener
- [ ] PM2/systemd persistence
- [ ] nginx HTTPS boundary
- [ ] logs / rotation / runbook
- [ ] reboot acceptance

## Immediate next work

The remaining work is now concentrated rather than another catalogue rewrite:

1. K0 hardening: inactivity reset and explicit degraded-network behaviour.
2. Commercial verification: known customer/company pricing and product-visibility evidence.
3. K4 hardware: inspect the TouchWo, prove physical NFC, provision Android device identity and establish the native kiosk shell.
4. Physical locker integration: provider adapter for assignment/compartment/door control after the API/hardware contract is confirmed.
5. K5 production runtime once the physical-device boundary is accepted.

Optional customer-experience work such as generalized company branding, favourites/common purchases and richer filtering can proceed independently where it does not duplicate the hardware path.

## Security rules

1. Never store a customer's Magento password.
2. Never write a Magento access token onto an NFC card.
3. Prefer a random opaque NFC credential; store only its hash server-side.
4. Card UID support is a fallback pending hardware inspection.
5. A linked card cannot silently move to another customer account.
6. Lost/revoked cards fail closed.
7. Kiosk sessions are short-lived; automatic inactivity reset remains required before production acceptance.
8. The kiosk device must never contain Magento Admin credentials.
9. Production NFC trust decisions belong to the server, not browser state.
10. Production kiosk devices use asymmetric signing; only the public key is stored server-side and the Android private key must remain non-exportable.
11. Magento customer tokens stay server-side and are never returned to kiosk browser JavaScript.
12. Magento customer authentication/session/catalogue/cart/checkout transport is GraphQL only.
13. The RSA private assertion key stays outside source control and outside Magento; Magento stores only the public key.
14. Browser commerce requests must be both trusted-device signed and bound to the opaque kiosk session.
15. Locker destination and shipping method are trusted kiosk/server configuration, not arbitrary browser input.
16. OGL export/status correlation must remain customer-scoped and must not turn a successfully placed Magento order into a browser-visible failure solely because asynchronous OGL export is still pending.
