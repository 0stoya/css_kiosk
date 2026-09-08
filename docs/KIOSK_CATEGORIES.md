# Kiosk merchandising categories

The kiosk catalogue uses a dedicated Magento category branch instead of mirroring the storefront's normal navigation or introducing a second product multiselect attribute.

## Magento structure

Create one hidden parent category under the store root:

```text
Default Category
└── Kiosk Categories
    ├── Gloves
    ├── Footwear
    ├── Workwear
    └── PPE
```

Recommended rules:

- keep the `Kiosk Categories` parent out of the normal storefront menu;
- keep kiosk-facing categories as direct children of that parent;
- set each child category name, image and position in Magento Admin;
- assign products to one or more kiosk child categories as required;
- do not rely on category `product_count` for customer authorization decisions;
- keep existing Fluid company/role catalogue restrictions in force.

The child category position controls the tile order on the kiosk.

## Kiosk configuration

Copy the Magento GraphQL UID of the hidden parent category into the kiosk runtime environment:

```text
KIOSK_MAGENTO_CATEGORY_ROOT_UID=<Magento category UID>
```

The kiosk fails closed if this variable is missing when the authenticated catalogue is requested.

## Request flow

```text
signed browser request
  → /api/catalogue
  → trusted kiosk device + css_kiosk_session
  → server-held Magento customer token
  → categories(parent_category_uid = configured kiosk root)
  → direct child UID/name/image/position set
  → validate requested category UID against that set
  → products(filter category_uid = selected child)
     or products(filter category_uid in all kiosk children)
  → optional full-text search stays inside the same category filter
  → safe category/product JSON
  → browser
```

A browser cannot make the kiosk browse an arbitrary Magento category by posting a different UID. Any requested UID must be one of the current direct children returned beneath the configured kiosk root.

## Images

The category GraphQL `image` value is normalized server-side:

- absolute `http`/`https` image URLs are passed through;
- `media/...` paths are resolved against `MAGENTO_BASE_URL`;
- bare filenames are resolved below `/media/catalog/category/`.

The browser still validates the final URL as `http`/`https` before using it. Categories without an image get a neutral initial-letter fallback tile.

## Search scope

The normal Magento full-text `products(search: ...)` query remains in use, but it always receives a real kiosk-category product filter:

```graphql
products(
  search: $search
  filter: { category_uid: { in: $kioskCategoryUids } }
)
```

When one kiosk category is active, `eq` is used for that selected UID instead.

This prevents the kiosk search box from surfacing otherwise-visible Magento products that have not been merchandised into the kiosk branch.

## Magento / Fluid boundary

No new Magento REST endpoint is required and no new Fluid GraphQL resolver is required for this slice. Core Magento GraphQL supplies:

- `categories` with `parent_category_uid` filtering;
- category `uid`, `name`, `image`, `position` and `product_count`;
- `products` with `category_uid` filtering;
- full-text `search` combined with a real product filter.

Fluid remains responsible for the existing authenticated company/customer catalogue restrictions and commerce rules.

## Acceptance

Before enabling the new kiosk catalogue in an environment:

1. Create the hidden `Kiosk Categories` parent.
2. Create at least three direct child categories.
3. Add an image to each test child and set their positions.
4. Assign known test products to the children, including one product assigned to two kiosk categories.
5. Set `KIOSK_MAGENTO_CATEGORY_ROOT_UID` on the kiosk host.
6. Restart the kiosk runtime.
7. Sign in with the accepted test company account.
8. Confirm only direct kiosk child categories appear and tile order matches Magento position.
9. Confirm category images render, including the fallback for one deliberately image-less category.
10. Select each category and verify only its assigned products appear.
11. Clear the category and confirm the catalogue is the union of all kiosk categories without duplicate product cards.
12. Search for a product inside the kiosk category set and confirm it appears.
13. Search for a known Magento product not assigned to any kiosk category and confirm it does not appear.
14. POST an arbitrary non-kiosk category UID to `/api/catalogue` using a valid signed kiosk request and confirm it fails closed.
15. Re-run basket, product-option and local-locker checkout smoke tests to confirm downstream commerce remains unchanged.

Static validation:

```bash
yarn lint
yarn typecheck
yarn build
```
