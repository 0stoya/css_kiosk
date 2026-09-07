# K2 product detail and basket

Updated: 7 Sep 2026

This slice builds on the accepted K1 authenticated catalogue. It does not create a second customer session or expose Magento credentials to the browser.

## Transport and trust boundary

Magento remains **GraphQL only**.

```text
browser
  -> signed kiosk request + HttpOnly css_kiosk_session
  -> css_kiosk verifies trusted device signature + nonce
  -> css_kiosk resolves the in-memory session for that device
  -> Magento customer bearer token is read from server memory only
  -> Magento GraphQL customerCart / cart mutations
  -> safe basket JSON only
  -> browser
```

No cart ID, Magento bearer token, password, RSA private key or raw NFC credential is returned to browser JavaScript.

## Magento GraphQL used in this slice

- `customerCart` — load/create the signed-in customer's active cart
- `addProductsToCart` — add a product
- `updateCartItems` — change quantity
- `removeItemFromCart` — remove a line
- existing `products` query now also returns `__typename` so the kiosk knows whether a product can be safely added without option selection

The deployed custom Magento-side boundary remains only `0stoya/Fluid/Css/Commerce`; this slice uses standard Magento cart GraphQL and adds no REST endpoint.

## Browser API

`POST /api/cart` is protected by both the signed kiosk-device request and the existing `css_kiosk_session`.

Actions:

```json
{"action":"get"}
{"action":"add","sku":"SKU","quantity":1}
{"action":"update","itemUid":"opaque-cart-line-uid","quantity":2}
{"action":"remove","itemUid":"opaque-cart-line-uid"}
```

The server resolves the Magento customer cart ID internally for every operation. The browser does not receive or choose a cart ID.

## UI scope

- product cards expose `View / add`
- touch product-detail modal
- current authenticated customer price and stock state remain visible
- quantity stepper for simple, in-stock products
- add to basket
- basket count in the catalogue header
- touch basket panel
- line quantity +/- controls
- remove line
- subtotal ex VAT and current Magento grand total

Checkout/counter handoff is intentionally disabled until the basket flow is accepted.

## Product types

This first K2 cart slice deliberately adds only `SimpleProduct` directly. Magento configurable/bundle/grouped products require selected option UIDs or other structured inputs and therefore fail closed with an "options required" message instead of guessing a variant.

A following slice will add explicit configurable/bundle option selection once live product examples are inspected.

## Runtime acceptance

Run on the kiosk host:

```bash
cd /srv/css/css_kiosk
git fetch origin
git checkout feat/product-detail-basket
git reset --hard origin/feat/product-detail-basket
yarn lint
yarn typecheck
yarn build
yarn dev
```

Then:

```text
present linked card
-> Welcome
-> Continue to catalogue
-> POST /api/catalogue 200
-> POST /api/cart 200
-> open a SimpleProduct
-> choose quantity 2
-> Add to basket
-> basket count becomes 2
-> basket shows live Magento line/price
-> + / - quantity updates the Magento customer cart
-> Remove deletes the line
-> Sign out
-> present same card again
-> customer cart still reflects Magento's authenticated cart state
```

Also inspect browser network/storage: no Magento bearer token or Magento cart ID should be exposed.
