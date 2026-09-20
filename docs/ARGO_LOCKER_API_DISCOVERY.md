# NEXT ARGO locker API discovery

Status: discovery checkpoint, 20 Sep 2026

## Purpose

Record the confirmed NEXT ARGO Customer API contract and the CSS/ARGO ownership boundary before implementing the physical locker integration.

This is a discovery document only. It does not enable live ARGO write operations.

## Confirmed integration boundary

CSS remains authoritative for:

- kiosk device trust and authenticated session;
- customer/employee identity in CSS/Magento;
- purchase controls and entitlement decisions;
- Magento basket, checkout and Payment on Account;
- Magento order and OGL order correlation;
- deciding which authenticated person may collect which order.

NEXT ARGO remains authoritative for:

- its employee/badge-holder record;
- its operational cart;
- the ArgoLK DYN terminal;
- physical slot/cell allocation;
- machine confirmation and physical withdrawal;
- withdrawal progress/status.

The kiosk must not reserve a compartment, select a slot, or issue a direct door-open command. The ARGO cart is the physical-fulfilment correlation object.

## Observed locker

The live Chelmsford account exposes one target dynamic locker:

```text
plant_id:      150
terminal_id:   42042
type:          ArgoLK DYN
serial_number: LK241103S
description:   Argo LK Pro LK241103S
```

The terminal reports 19 dynamic positions. `get_terminal` exposes `slot_summary`, `full_slots` and a `loading_plan`, but neither `list_carts` nor `get_cart` exposes a physical slot for a cart. CSS therefore must not persist or derive a compartment as an order identifier.

The durable physical identity should be the serial/type/plant configuration, with the current `terminal_id` resolved and verified through the API rather than treated as the sole identity.

Suggested server-side configuration:

```text
ARGO_API_URL
ARGO_API_KEY
ARGO_DATABASE_UUID
ARGO_PLANT_ID=150
ARGO_TERMINAL_TYPE=ArgoLK DYN
ARGO_TERMINAL_SERIAL=LK241103S
```

The API key remains server-side only and must never be exposed to browser or Android WebView JavaScript.

## Available operations relevant to CSS

Confirmed useful operations:

```text
health
describe
list_databases

list_products
get_product

list_terminals
get_terminal

list_employees
get_employee
create_employee

list_carts
get_cart
create_cart
upsert_cart_line

request_cart_withdrawal
get_withdrawal_status
```

Expected capabilities are:

- `plant_data` for read-side discovery and reconciliation;
- `employee_write` for employee provisioning;
- `cart_write` for operational-cart creation and lines;
- `cart_withdraw` for collection.

The account limit is 120 general operations per minute. Withdrawal polling must honour `Retry-After` on HTTP 429 and must stop once the withdrawal reaches a terminal state.

## One RFID enrolment

An employee should present one physical RFID card once. CSS should use that same presented numeric identifier to link both systems:

```text
RFID read
  ├─ CSS: hash credential and persist only the hash
  └─ ARGO: use raw value transiently
       → list_employees(badge=<presented badge>, plant_id=150)
          ├─ existing employee → link its ARGO employee_id
          └─ no employee       → create_employee with the same badge
```

ARGO documents badge uniqueness within a plant, so provisioning should be idempotent:

```text
0 matches → create employee
1 match   → link employee
>1        → fail closed as a reconciliation error
```

CSS should persist the stable ARGO `employee_id`, not the raw RFID value.

A real-card acceptance test is still required to prove the TouchWo/Sycreader numeric representation is identical to the badge representation expected by ARGO, including leading zero handling.

### Employee provisioning fields

The known `create_employee` contract is sufficient for the initial mapping:

```text
badge
first_name
last_name
plant_id
employee_number     optional but recommended CSS stable reference
department_id       optional
employee_group_id   optional
job_id              optional
qualification_id    optional
cost_centre_id      optional
profile_id          optional
band_id             optional
hired_on            optional
left_on             optional
```

CSS purchase-control rules remain authoritative. ARGO employee group/profile/band values may provide machine-side restrictions, but must not become a duplicate implementation of CSS commercial entitlement rules.

## Cart model

Observed ARGO carts are associated with:

```text
cart_id
terminal_id
employee_id
badge
project_id
project_number
lines
```

A populated cart can contain many product lines, while the terminal separately reports physical cell/product state. CSS should therefore use:

```text
Magento order
  ↕
OGL order
  ↕
ARGO cart_id
```

and not:

```text
OGL order
  ↕
cell_id / door / compartment
```

The exact ARGO cart ID must be persisted once created. It must be treated as an opaque identifier.

## Desired order-to-locker flow

```text
authenticated employee/customer
  → CSS purchase controls
  → Magento locker checkout
  → Magento sales order
  → OGL export / OGL order number
  → resolve/provision ARGO employee
  → create ARGO operational cart
  → persist OGL order ↔ ARGO cart_id
  → upsert ARGO cart lines
  → warehouse / ARGO loads the cart
  → ARGO owns dynamic physical location
```

At collection:

```text
employee presents same RFID
  → CSS authenticates employee/customer
  → CSS resolves the exact expected OGL order and ARGO cart_id
  → verify ARGO cart employee/terminal consistency
  → obtain/use current ARGO badge transiently
  → request_cart_withdrawal
  → ARGO machine/operator confirmation
  → poll get_withdrawal_status
  → complete / fail safely
```

A badge lookup or `list_carts` query must not be used to choose "the newest cart" for collection. One employee may have multiple carts. CSS must resolve the exact order-to-cart correlation first and use employee/badge data as an additional consistency check.

## Product correlation

ARGO cart lines use ARGO `product_id` values and may also expose `code`, `customer_code`, description and unit.

CSS must not match products by description. A deterministic product cross-reference is required, ideally using an agreed OGL/Magento stock reference mapped to ARGO `customer_code` or another stable identifier.

The ARGO catalogue can be synchronised using `list_products` / `get_product`, including `modified_since` for incremental refreshes.

The integration must tolerate a valid cart line whose product enrichment is missing or null; the ARGO `product_id` and quantity remain authoritative for that line.

## Confirmed API safety behaviour

Every request is POST to the single customer API endpoint, with the operation selected by `request_type`.

Authentication is:

```text
X-API-Key: <key_id>.<secret>
```

The key is sent in the header only.

The integration must map the documented error envelope and status codes, including:

- 400 validation/request errors;
- 401 key expired/reissued/disabled;
- 403 missing capability;
- 404 record/database not found;
- 429 rate limiting with `Retry-After`;
- 500 unexpected provider error.

Provider failures must not weaken kiosk authentication or order ownership checks.

## Open contract questions for Lanzi

The read-side discovery is sufficient. The following write/lifecycle details must be confirmed before live cart writes are enabled.

### create_cart

The documentation currently confirms the operation exists but does not expose its parameter or response schema.

CSS needs to know whether it can supply:

- target `terminal_id`;
- `employee_id` or badge;
- a CSS/OGL-owned external reference;
- preferably `project_number = <OGL order number>` if that is the intended purpose;
- an idempotency key or uniqueness rule.

The response must return the created `cart_id`.

A client-supplied external reference or idempotency mechanism is important for recovery from an ambiguous timeout after cart creation and to prevent duplicate carts.

### upsert_cart_line

CSS needs the exact parameter and response schema, including:

- `cart_id`;
- product identifier;
- quantity;
- any required attribute/outcome fields;
- the key used for upsert identity;
- whether repeated identical calls are idempotent;
- how a line is removed/corrected;
- whether lines can be changed after the cart has been loaded/materialised.

### Cart lifecycle

Confirm:

- how CSS/warehouse can determine that a cart is loaded and ready;
- whether cart cancellation/deletion is supported;
- how an OGL cancellation should be represented after cart creation;
- whether `outcome_id` values are lifecycle/status values and the meaning of observed value `6`.

### Withdrawal lifecycle

Confirm:

- the response schema from `request_cart_withdrawal`;
- all values/states returned by `get_withdrawal_status`;
- which states are retryable versus terminal;
- whether duplicate withdrawal requests are idempotent or rejected;
- expected polling interval.

### Employee lifecycle

`create_employee` covers provisioning, but production also needs a defined path for:

- lost/replacement RFID;
- employee deactivation/leaver;
- suspended locker access;
- updated employee metadata.

An `update_employee` or explicit deactivate/change-badge operation would avoid manual duplicate administration in ARGO.

## Implementation split

### Safe to build now

Without waiting for the remaining Lanzi answers, CSS can implement:

- an ARGO server-side HTTP client/provider boundary;
- configuration and secret handling;
- typed error mapping, rate-limit handling and retry policy;
- `health`, `describe`, database/plant/terminal discovery;
- deterministic terminal resolution by configured serial/type/plant;
- read-side `list/get employee`, `list/get cart` and product synchronisation;
- one-RFID employee matching logic;
- persistence schema for CSS/OGL ↔ ARGO employee/cart correlation;
- provider fixtures and tests;
- write methods behind a disabled feature flag/dry-run boundary.

No browser code should receive the ARGO API key, raw provider credentials, or authority to choose an arbitrary terminal/cart.

### Wait for Lanzi before enabling live writes

Do not enable production:

- `create_cart`;
- `upsert_cart_line`;
- automated employee writes against live data;
- `request_cart_withdrawal`;

until the corresponding write payloads, lifecycle semantics and agreed test data are confirmed.

## Acceptance target

The first end-to-end physical acceptance should prove:

```text
one RFID
→ CSS authenticated employee
→ same badge resolves to one ARGO employee
→ known OGL order maps to one ARGO cart
→ cart is loaded on the configured ArgoLK DYN terminal
→ employee presents the same RFID
→ CSS authorises that exact collection
→ request_cart_withdrawal
→ ARGO performs physical collection flow
→ get_withdrawal_status reaches completed
```

No direct slot, compartment or door-management API should be required.
