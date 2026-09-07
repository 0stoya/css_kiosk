# K2 configurable, bundle and grouped products

Updated: 7 Sep 2026

This slice completes the product-selection gap left after the first authenticated basket implementation.

## Magento transport

Magento remains **GraphQL only**.

The kiosk uses the existing authenticated, server-held Magento customer token and standard Magento GraphQL:

```text
products(filter: { sku })
  -> ConfigurableProduct.configurable_options
  -> BundleProduct.items/options
  -> GroupedProduct.items

addProductsToCart
  -> CartItemInput.selected_options for configurable/bundle products
  -> multiple child CartItemInput rows for grouped products
```

No kiosk-specific Magento REST endpoint is introduced. The deployed custom Magento boundary remains `0stoya/Fluid/Css/Commerce`.

## Request boundary

```text
browser
  -> signed POST /api/product-options + HttpOnly css_kiosk_session
  -> css_kiosk validates trusted device + nonce
  -> resolves device-bound kiosk session
  -> server-held Magento token
  -> Magento GraphQL product option/group lookup
  -> safe labels, SKUs and opaque option UIDs
  -> browser chooses options/quantities

browser
  -> signed POST /api/cart
  -> selected product inputs only
  -> css_kiosk session/device validation
  -> server-held Magento token
  -> Magento GraphQL addProductsToCart
  -> safe basket JSON
```

The Magento customer bearer token and cart ID remain server-side.

## Configurable products

For `ConfigurableProduct` the product dialog loads each configurable attribute and its values. The user must choose exactly one value for every attribute before the item can be added.

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

## Grouped products

A live CSS catalogue product was confirmed to be `GroupedProduct` during runtime acceptance (`CTR251/GR`, Combat Trouser Graphite c/w).

Grouped products are not a parent SKU with one option UID. Magento exposes associated child products, so the kiosk now:

```text
GroupedProduct.items
-> child SKU/name/stock
-> touch quantity control per available child
-> user chooses one or more quantities
-> signed /api/cart action add_grouped
-> addProductsToCart with one CartItemInput per selected child SKU
```

Out-of-stock grouped children cannot be selected. The product cannot be added until at least one available child has a positive quantity. The parent grouped SKU is not incorrectly submitted as a simple cart line.

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

GroupedProduct
-> open product
-> child rows load
-> set quantity on at least one child
-> Add to basket
-> selected child item(s) appear with correct quantities

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
