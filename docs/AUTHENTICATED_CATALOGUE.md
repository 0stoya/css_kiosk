# Authenticated catalogue

K1 connects the accepted NFC/customer session to Magento catalogue browsing without exposing the Magento customer bearer token to browser JavaScript.

## Transport rule

Magento traffic remains **HTTPS GraphQL only**.

This slice uses core Magento GraphQL:

```text
categoryList
products
```

There is no kiosk-specific catalogue REST endpoint in Magento. The browser calls only `css_kiosk`.

## Request chain

```text
Continue to catalogue
        ↓
browser has HttpOnly css_kiosk_session
        ↓
browser signs POST /api/catalogue with kiosk-device key
        ↓
css_kiosk verifies ECDSA request + nonce
        ↓
css_kiosk resolves session for that exact device
        ↓
Magento customer bearer token read from server memory
        ↓
Magento HTTPS GraphQL categoryList + products
        ↓
safe catalogue data returned to browser
```

Both trust checks are required:

1. an active, signed kiosk device request;
2. a valid opaque kiosk session bound to that same device.

A valid device without a customer session cannot read the authenticated catalogue. A stolen/copied kiosk session cookie presented from another device ID does not resolve the in-memory session.

## Browser-safe response

The catalogue API may return:

- safe customer/company display context;
- category UID/name/product count;
- product UID, SKU, name and URL key;
- Magento product image URL/label;
- stock status;
- final and regular price values/currency;
- result count/paging metadata.

It must never return:

- Magento bearer token;
- RSA assertion/private key material;
- raw NFC credentials;
- Magento password.

## Catalogue query

The first K1 query requests the default category tree and a small product result page. Magento core `products` requires `search` or `filter`, so the landing page uses a broad valid price filter (`price >= 0`) when neither text search nor category filtering is active.

Text search:

```graphql
products(search: $search, ...)
```

Category browsing:

```graphql
products(filter: { category_uid: { eq: $categoryUid } }, ...)
```

The Magento customer token is sent in the server-side `Authorization: Bearer ...` header, never from the browser.

## Pricing boundary

The query is authenticated with the current Magento customer token, so Magento resolves product visibility and price in customer context. K1 must still be live-accepted against known EAL001 product evidence before company/customer-specific pricing is considered verified.

Do not hard-code prices or customer group logic in `css_kiosk`.

## UI scope

K1 provides:

- signed-in account/company header;
- live search;
- top-level category strip;
- two-column touch-first product cards;
- price and stock summary;
- loading, empty and unavailable states;
- sign out;
- session-expired fail-closed path.

Basket controls are intentionally disabled until K2.

## Runtime acceptance

```text
1. Device trust: Trusted
2. Magento auth: Real Magento
3. present linked card
4. Welcome shows Greener Ealing Ltd / EAL001
5. Continue to catalogue
6. POST /api/catalogue returns 200
7. categories and products render
8. search a known product name or SKU
9. select a category and confirm results change
10. compare one known price against expected EAL001 Magento evidence
11. inspect browser network/storage: no Magento bearer token
12. Sign out
13. same linked card establishes a fresh session again
```

If the kiosk session has expired, `/api/catalogue` returns `SESSION_REQUIRED` and the UI returns to the NFC authentication journey.
