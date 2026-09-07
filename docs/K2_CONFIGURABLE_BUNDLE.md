# K2 configurable and bundle products

Updated: 7 Sep 2026

This slice completes the product-selection gap left after the first authenticated basket implementation.

## Magento transport

Magento remains **GraphQL only**.

The kiosk uses the existing authenticated, server-held Magento customer token and standard Magento GraphQL:

```text
products(filter: { sku })
  -> ConfigurableProduct.configurable_options
  -> BundleProduct.items/options

addProductsToCart
  -> CartItemInput.selected_options
```

No kiosk-specific Magento REST endpoint is introduced. The deployed custom Magento boundary remains `0stoya/Fluid/Css/Commerce`.

## Request boundary

```text
browser
  -> signed POST /api/product-options + HttpOnly css_kiosk_session
  -> css_kiosk validates trusted device + nonce
  -> resolves device-bound kiosk session
  -> server-held Magento token
  -> Magento GraphQL product option lookup
  -> safe option labels + opaque option UIDs
  -> browser chooses options

browser
  -> signed POST /api/cart
  -> sku + quantity + selected Magento option UIDs
  -> css_kiosk session/device validation
  -> server-held Magento token
  -> Magento GraphQL addProductsToCart
  -> safe basket JSON
```

The Magento customer bearer token and cart ID remain server-side.

## Configurable products

For `ConfigurableProduct` the product dialog now loads each configurable attribute and its values. The user must choose exactly one value for every attribute before the item can be added.

The Magento-provided value UIDs are submitted as `selected_options`; the kiosk does not attempt to invent variant SKUs or decode configurable identifiers.

## Bundle products

For `BundleProduct` the product dialog loads bundle groups and choices.

- required groups must be completed before add
- optional groups may remain empty
- radio/select-style groups are single choice
- checkbox groups support multiple choices
- out-of-stock child choices are disabled when Magento reports them as out of stock
- Magento default bundle choices are preselected
- each selected bundle choice uses Magento's opaque option UID through `selected_options`

Bundle child quantities currently follow the quantities encoded/configured by Magento in the returned option UID. If a live CSS bundle exposes shopper-changeable child quantities, that exact product must be runtime-tested before adding a quantity override rather than reconstructing Magento option identifiers in the browser.

## Checkout boundary confirmed

Kiosk checkout is **local-locker only**.

The later checkout slice must not expose a general customer delivery-address flow or arbitrary shipping-method selection.

Target boundary:

```text
trusted kiosk/device
  -> server resolves its configured local locker
  -> css_kiosk applies only that locker destination/method
  -> Magento GraphQL checkout
```

The browser must not be able to submit an arbitrary delivery address, locker, carrier, or shipping method.

## Runtime acceptance

Test at least one real product of each type:

```text
SimpleProduct
-> add still works

ConfigurableProduct
-> open product
-> option groups load
-> choose every required value
-> Add to basket
-> correct configured item appears

BundleProduct
-> open product
-> bundle groups load
-> choose required options
-> Add to basket
-> correct bundle appears

Sign out
-> same card signs in again
-> Magento customer basket persists
```

Also confirm:

```text
POST /api/product-options 200
POST /api/cart 200
```

and that no Magento bearer token or cart ID appears in browser-visible responses/storage.
