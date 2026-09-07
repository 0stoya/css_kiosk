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
          → signed catalogue/cart requests + css_kiosk_session
          → server-held Magento token
          → Magento GraphQL catalogue/cart operations
          → safe browser data only
```

## Magento boundary

The kiosk/Magento integration is **GraphQL only**.

```text
First-time auth         generateCustomerToken
Returning-card session  css_kiosk_customer_session
Identity/company        customer + css_company_context
Catalogue/categories    products + categoryList
Product options         ConfigurableProduct / BundleProduct / GroupedProduct fields
Basket                  customerCart + addProductsToCart/updateCartItems/removeItemFromCart
Logout/revocation       revokeCustomerToken
```

The deployed Magento-side customization boundary is:

```text
0stoya/Fluid/Css/Commerce
```

No kiosk-specific REST endpoint is part of the architecture. No Magento Admin/integration credential belongs in `css_kiosk`.

RSA and ECDSA are trust/authentication mechanisms; HTTPS GraphQL remains the Magento transport.

## Accepted milestones

### K0 — authentication and trusted kiosk session

Accepted against live Magento with:

```text
Welcome, Chris
Your trade account has been recognised.
Greener Ealing Ltd
chris@ostoya.io
Account EAL001
```

The accepted returning-card chain is:

```text
linked NFC
→ trusted signed kiosk request
→ numeric Magento customer ID
→ one-use RS256 assertion
→ GraphQL css_kiosk_customer_session
→ fresh customer/company context
→ opaque HttpOnly css_kiosk_session
```

Magento 2.4.9 opaque `customer.id` values such as `Ng==` are not used for the assertion. Numeric `css_company_context.customer_id` is the accepted identity source.

### K1 — authenticated catalogue

Accepted and merged.

```text
Welcome
→ Continue
→ signed POST /api/catalogue
→ server-held customer token
→ Magento GraphQL categoryList + products
→ live catalogue/search/category results
```

The browser never receives the Magento bearer token.

### K2 — authenticated basket

The simple-product basket slice is accepted and merged.

Implemented and accepted baseline:

- `customerCart`
- direct simple-product add
- quantity update
- remove
- product detail
- basket totals
- Magento cart persists with the customer account across kiosk sign-out/re-auth

Current completion branch:

```text
feat/configurable-bundle-products
```

Current PR adds the remaining CSS product-type flows.

#### Configurable products

```text
products(filter: { sku })
→ ConfigurableProduct.configurable_options
→ choose exactly one value per required attribute
→ Magento option value UIDs
→ addProductsToCart selected_options
```

No client-side variant SKU guessing or UID decoding.

#### Bundle products

```text
products(filter: { sku })
→ BundleProduct.items/options
→ choose required/optional choices
→ Magento bundle option UIDs
→ addProductsToCart selected_options
```

Bundle child quantities remain Magento-defined until a live bundle proves shopper-adjustable component quantity is needed.

#### Grouped products

Live acceptance identified `CTR251/GR` (Combat Trouser Graphite c/w) as a `GroupedProduct` rather than configurable/bundle.

Grouped support is now implemented on the same K2 branch:

```text
products(filter: { sku })
→ GroupedProduct.items
→ associated child SKU/name/stock
→ touch quantity per child
→ choose at least one child quantity
→ signed /api/cart add_grouped
→ addProductsToCart with one CartItemInput per selected child SKU
```

Out-of-stock child rows cannot be selected. The grouped parent SKU is not submitted as a simple cart line.

Static validation was green before grouped support was added. The grouped change now requires the same final validation again:

```bash
yarn lint
yarn typecheck
yarn build
```

Then runtime acceptance must include one live configurable, one bundle, and the live grouped product.

## Checkout boundary — local locker only

Kiosk delivery is **local locker only**.

There will be no general customer delivery-address form and no arbitrary carrier/shipping-method picker.

Target K3 boundary:

```text
trusted kiosk/device
→ server resolves this kiosk's configured local locker
→ browser cannot replace address/locker/carrier/method
→ css_kiosk applies only the trusted locker destination/method
→ Magento checkout/order GraphQL
→ safe order confirmation/reference
```

This constraint is part of the product/security model, not just UI presentation.

## Secrets/token boundary

Never persist or expose:

- Magento customer password
- Magento customer bearer token in browser-visible state
- RSA private assertion key in source control/Magento/browser/NFC
- raw NFC credential in SQLite
- arbitrary checkout destination/method supplied by browser

Allowed persistence/exposure:

- SHA-256 NFC credential hash in SQLite
- RSA public key in CSS Commerce configuration
- device public key server-side
- opaque `css_kiosk_session` cookie in the browser
- safe customer/company display metadata
- safe catalogue/category/price/stock/product-option metadata
- safe grouped child SKUs required for customer quantity selection

## Next

1. Re-run lint/typecheck/build on the grouped-support PR head.
2. Runtime-test configurable product selection.
3. Runtime-test bundle product selection.
4. Runtime-test grouped product `CTR251/GR` quantities and add.
5. Merge K2 completion once all three product types are accepted.
6. Start K3 local-locker-only checkout.
