# CSS Kiosk progress

Updated: 7 Sep 2026

This document records the accepted state of `css_kiosk` and the active implementation slice so work can continue without re-discovering security, transport or deployment boundaries.

## Non-negotiable Magento boundary

The kiosk/Magento integration is **HTTPS GraphQL only**.

```text
First-time auth         generateCustomerToken
Returning-card session  css_kiosk_customer_session
Identity/company        customer + css_company_context
Catalogue/categories    products + categoryList
Customer basket         customerCart + cart mutations
Logout/revocation       revokeCustomerToken
```

The deployed custom Magento-side boundary is only:

```text
0stoya/Fluid/Css/Commerce
```

No kiosk-specific REST endpoint is part of the architecture. RSA/ECDSA signatures authenticate trust boundaries; GraphQL remains the Magento transport.

## Accepted trust/session architecture

```text
NFC event
  -> NfcReader
  -> signed kiosk-device request (ECDSA P-256)
  -> SHA-256 NFC credential lookup
  -> known card
  -> one-use RS256 customer_session assertion
  -> Css/Commerce GraphQL css_kiosk_customer_session
  -> Magento customer token, server memory only
  -> fresh customer + css_company_context
  -> opaque HttpOnly css_kiosk_session
  -> authenticated kiosk UI
```

Unknown cards use Magento GraphQL `generateCustomerToken` once, then explicit card-link confirmation. Passwords are never persisted. Raw NFC credentials are never stored.

## K0 — authentication foundation — accepted

Live returning-card acceptance on 7 Sep 2026:

```text
Welcome, Chris
Greener Ealing Ltd
chris@ostoya.io
Account EAL001
```

Accepted controls include:

- ECDSA P-256 signed kiosk requests with timestamp + nonce replay protection
- SHA-256-only NFC credential persistence
- RS256 one-use kiosk-to-Commerce customer assertions
- matching Magento public-key fingerprint/config
- numeric Magento customer ID from `css_company_context.customer_id`
- Magento 2.4.9 opaque `customer.id` compatibility (`Ng==` is not used as assertion `sub`)
- 15-minute opaque `css_kiosk_session`
- Magento bearer token held server-side only
- fresh Magento customer/company authorization after returning-card exchange
- sign-out/replacement revokes Magento token best-effort

## K1 — authenticated catalogue — accepted and merged

Merged PR:

```text
#11 Add authenticated GraphQL catalogue home
```

Live acceptance completed on 7 Sep 2026. The accepted request path is:

```text
browser
  -> signed POST /api/catalogue + HttpOnly css_kiosk_session
  -> css_kiosk verifies device + nonce
  -> resolves in-memory session bound to device
  -> reads Magento token from server memory
  -> Magento GraphQL categoryList + products
  -> safe catalogue/category/price/stock JSON
  -> browser
```

Accepted runtime behavior:

- linked card -> Welcome -> Continue to catalogue
- live catalogue loads successfully
- live search works
- category filtering works
- authenticated company/account identity remains visible
- customer-authorized price/stock data renders
- sign out -> same card -> new kiosk session -> catalogue works again
- no Magento bearer token is returned to browser JavaScript

## K2 — product detail and basket — in progress

Active branch / PR:

```text
feat/product-detail-basket
#12 Add product detail and authenticated basket
```

This slice adds:

- touch product detail modal
- Magento product `__typename` awareness
- quantity stepper
- direct add for in-stock `SimpleProduct`
- live basket count
- authenticated Magento customer basket
- +/- line quantity controls
- remove line
- subtotal ex VAT + current Magento grand total

Server boundary:

```text
browser
  -> signed POST /api/cart + HttpOnly css_kiosk_session
  -> css_kiosk resolves trusted device + session
  -> Magento token stays in server memory
  -> GraphQL customerCart / addProductsToCart / updateCartItems / removeItemFromCart
  -> safe basket JSON only
```

The Magento cart ID is resolved server-side and is not exposed to the browser.

### Product-type rule

The first K2 basket slice adds only `SimpleProduct` directly. Configurable, bundle and grouped products require explicit option selection and therefore fail closed as "options required" rather than guessing a variant.

See `docs/K2_PRODUCT_BASKET.md` for the exact contract and runtime acceptance.

## Secrets/token boundary

Never persist or expose:

- Magento customer password
- Magento customer bearer token in browser-visible state
- RSA private assertion key in source control/Magento/browser/NFC
- raw NFC credential in SQLite

Allowed persistence/exposure:

- SHA-256 NFC credential hash in SQLite
- RSA public key in CSS Commerce configuration
- kiosk device public key server-side
- opaque HttpOnly `css_kiosk_session` cookie
- safe customer/company display metadata
- safe catalogue/category/price/stock metadata
- safe basket line/totals metadata

## Remaining after current K2 slice

- configurable/bundle product option selection
- deeper product detail / availability
- pagination/filtering
- basket acceptance and checkout/counter-handoff design
- inactivity-driven session reset
- offline/degraded network state
- favourites/common purchases
- physical TouchWo/NFC hardware inspection
- Android kiosk shell
- production serving/hardening at `kiosk.csscdn.co.uk`
