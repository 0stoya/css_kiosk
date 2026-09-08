# Kiosk merchandising categories

The kiosk catalogue uses a dedicated Magento category branch instead of mirroring the storefront's normal navigation or introducing a second product multiselect attribute.

The category branch is a merchandising/navigation layer, not a second catalogue-permission boundary. Magento/Fluid company visibility remains authoritative. A company-visible product can still appear in `All products` and normal search even when it has not been assigned to any kiosk category.

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
- assign products to one or more kiosk child categories when a category shortcut is useful;
- do not require every company-visible product to belong to a kiosk category;
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
  → no category selected:
       products(...) using normal authenticated company/customer visibility
  → category selected:
       products(filter category_uid = selected child)
  → optional full-text search follows the same rule
  → safe category/product JSON
  → browser
```

A browser cannot make the kiosk browse an arbitrary Magento category by posting a different UID. Any requested category UID must be one of the current direct children returned beneath the configured kiosk root. This validation protects the category-navigation surface without hiding otherwise-authorized products from `All products`.

## Images

The category GraphQL `image` value is normalized server-side:

- absolute `http`/`https` image URLs are passed through;
- `media/...` paths are resolved against `MAGENTO_BASE_URL`;
- bare filenames are resolved below `/media/catalog/category/`.

The browser still validates the final URL as `http`/`https` before using it. Categories without an image get a neutral initial-letter fallback tile.

## Browse and search scope

With no kiosk category selected, browse and search use the normal authenticated Magento product query. This means the existing Fluid company/customer catalogue policy decides which products are visible, including products that have not yet been placed into a kiosk category.

When a kiosk category is selected, the product query adds that category filter:

```graphql
products(
  filter: { category_uid: { eq: $selectedKioskCategoryUid } }
)
```

Search behaves the same way:

```graphql
products(
  search: $search
  filter: { category_uid: { eq: $selectedKioskCategoryUid } }
)
```

When no category is selected, the category filter is omitted entirely. This preserves the full company-visible catalogue while keeping the kiosk category tiles useful as curated shortcuts.

## Magento / Fluid boundary

No new Magento REST endpoint is required and no new Fluid GraphQL resolver is required for this slice. Core Magento GraphQL supplies:

- `categories` with `parent_category_uid` filtering;
- category `uid`, `name`, `image`, `position` and `product_count`;
- `products` with optional `category_uid` filtering;
- full-text `search` with or without a selected category filter.

Fluid remains responsible for the existing authenticated company/customer catalogue restrictions and commerce rules.

## Acceptance

Before enabling the new kiosk catalogue in an environment:

1. Create the hidden `Kiosk Categories` parent.
2. Create at least three direct child categories.
3. Add an image to each test child and set their positions.
4. Assign known test products to the children, including one product assigned to two kiosk categories.
5. Keep one known company-visible test product deliberately outside all kiosk categories.
6. Set `KIOSK_MAGENTO_CATEGORY_ROOT_UID` on the kiosk host.
7. Restart the kiosk runtime.
8. Sign in with the accepted test company account.
9. Confirm only direct kiosk child categories appear and tile order matches Magento position.
10. Confirm category images render, including the fallback for one deliberately image-less category.
11. Select each category and verify only its assigned products appear.
12. Clear the category and confirm the full company-visible catalogue returns.
13. Confirm the deliberately uncategorized company-visible product appears in `All products`.
14. Search for that uncategorized product with no category active and confirm it appears.
15. Select a kiosk category that does not contain that product, repeat the search, and confirm it is correctly excluded by the active category filter.
16. POST an arbitrary non-kiosk category UID to `/api/catalogue` using a valid signed kiosk request and confirm it fails closed.
17. Re-run basket, product-option and local-locker checkout smoke tests to confirm downstream commerce remains unchanged.

Static validation:

```bash
yarn lint
yarn typecheck
yarn build
```
