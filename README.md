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

All `css_kiosk` customer authentication, session and catalogue traffic to Magento uses HTTPS GraphQL.

- first-time email/password authentication: Magento `generateCustomerToken`
- returning linked-card exchange: CSS Commerce `css_kiosk_customer_session`
- fresh customer/company authorization: `customer` + `css_company_context`
- authenticated catalogue: `categories` + `products`
- logout/token invalidation: Magento `revokeCustomerToken`

There is no kiosk-specific Magento REST endpoint and no Magento Admin/integration credential in this application.

RSA/ECDSA signatures authenticate trust boundaries; they do not replace GraphQL as transport.

## Current foundation

The kiosk can be developed and accepted before physical NFC hardware is available. The current foundation includes:

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
- authenticated catalogue entry using that same kiosk session
- server-side kiosk merchandising categories with authenticated company-visible product browse/search
- authenticated basket and local-locker checkout/order confirmation
- company-gated CSS locker delivery with Payment on Account submission
- customer-scoped Magento/OGL locker-order correlation
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

## Authenticated catalogue boundary

`Continue to catalogue` does not create a second browser authentication mechanism. It reuses the existing `css_kiosk_session`:

```text
browser
  → signed POST /api/catalogue + HttpOnly css_kiosk_session
  → css_kiosk verifies kiosk device and session
  → server-held Magento customer token
  → Magento GraphQL categories under the configured kiosk root
  → server validates any selected category against those direct children
  → Magento GraphQL products using the authenticated company/customer visibility
  → optional selected kiosk category narrows the product query
  → safe category/product/price/stock data
  → browser
```

The browser never receives the Magento bearer token. Product visibility remains authoritative in Magento/Fluid through the authenticated customer token. Kiosk categories are navigation and merchandising only: a product that the company can see remains available in `All products` and unfiltered search even if it has not been assigned to a kiosk category. A browser-supplied category UID is still rejected unless it is one of the server-returned kiosk categories.

## Kiosk merchandising categories

The kiosk does not mirror the storefront's normal top-level navigation. Magento owns a dedicated hidden category branch for kiosk merchandising:

```text
Default Category
└── Kiosk Categories
    ├── Gloves
    ├── Footwear
    ├── Workwear
    └── PPE
```

Configure the UID of `Kiosk Categories` with:

```text
KIOSK_MAGENTO_CATEGORY_ROOT_UID=<Magento category UID>
```

Each direct child owns its normal Magento category name, image and position. Products may be assigned to one or more of those children. The kiosk reads those child categories with the authenticated customer token and renders their images as touch tiles. Selecting a tile narrows the catalogue to that category; clearing the tile returns to the full company-visible catalogue, including products not assigned to any kiosk category.

See `docs/KIOSK_CATEGORIES.md` for the Magento setup and acceptance flow.

## Signed-in catalogue UI checkpoint

The current UI branch uses a compact kiosk workspace rather than stacking large account and catalogue hero panels:

```text
CSS logo | customer logo       My account | Basket
Search
Image-backed kiosk categories
Products
Pagination
```

For Greener Ealing (`EAL001`) the existing `public/greener-ealing-logo.svg` is shown beside the CSS logo; other companies fall back safely to their company name until an explicit logo mapping exists.

Product cards are optimized for the portrait kiosk as compact horizontal image/information cards with a full-width `View / add` action. Magento full-text search remains unfiltered across the authenticated company-visible catalogue unless a kiosk category is actively selected, in which case search stays inside that selected category.

A signed `/api/account/orders` endpoint shows recent selected-company order history through `css_company_orders` using the same server-held Magento token and trusted kiosk session; no order/customer token is exposed to the browser.

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
  → trusted catalogue / basket / checkout APIs
  → Magento GraphQL
```

The RSA private key remains outside the repository on the kiosk application host; Magento receives only the corresponding public key.

See:

- `ROADMAP.md` — delivery progress and next slices
- `docs/NFC_AUTH.md` — NFC linking/security model
- `docs/DEVICE_TRUST.md` — signed kiosk-device trust
- `docs/MAGENTO_KIOSK_SESSION.md` — GraphQL customer-session exchange
- `docs/KIOSK_CATEGORIES.md` — kiosk category merchandising and image setup
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
