# Employee RFID + NEXT ARGO — living next-steps tracker

Status: draft / active tracker  
Started: 20 Sep 2026  
Do not merge while this document is being used as the active implementation checkpoint.

## Why this tracker exists

The NEXT ARGO provider foundation is now accepted and the live read-only readiness check is green.

We now need to connect the physical RFID journey to the canonical CSS Employee model without losing the boundaries already established in the kiosk, Fluid and css_admin work.

This file is the living checkpoint for that work. Keep it updated as each decision, PR and live acceptance is completed.

## Accepted baseline

### Kiosk / ARGO provider

Accepted through the merged NEXT ARGO discovery + provider foundation:

- server-side NEXT ARGO client;
- API key kept out of browser/WebView code;
- database/plant/terminal discovery;
- target terminal resolved as the configured `ArgoLK DYN` / serial `LK241103S`;
- employee, product and cart reads;
- exact badge lookup;
- gated/idempotent `create_employee` helper;
- ARGO writes disabled by default;
- cart/withdrawal writes intentionally deferred until Lanzi confirms the remaining contracts.

### Physical RFID reader

The TouchWo Android shell already captures the Sycreader RFID value as an opaque numeric UID and preserves leading zeroes.

### Current kiosk credential model

The existing kiosk credential store maps a hashed RFID/NFC credential to a Magento customer/company session context.

It does **not** currently represent a canonical CSS Employee.

Do not overload that existing customer credential record with `employee_id` / `argo_employee_id` as a shortcut.

### Canonical CSS Employee

Fluid now has a real company Employee model:

```text
company_id
employee_id
employee_code
first_name
last_name
department
cost_centre
manager_company_user_id
active
```

Employees are beneficiary identities carried on cart/order lines. The current Fluid contract explicitly treats Employees separately from Magento login/company-user identities.

Employee purchase-control work is also keyed to canonical Employee identity.

## Core design goal

One physical RFID should be presented once and become the common credential for:

```text
CSS Employee identity
        +
ARGO employee badge holder
```

The employee must not be asked to enrol the same card separately at the locker.

Desired provisioning concept:

```text
employee selected / identified in CSS
        ↓
present RFID once
        ↓
raw RFID exists only transiently
        ├─ hash → CSS employee credential link
        └─ raw badge → ARGO list_employees
                         ├─ found → link ARGO employee_id
                         └─ missing → create_employee
        ↓
persist stable cross-system IDs
```

CSS should not persist the raw badge unless a later provider requirement makes that unavoidable.

## Important identity decision gate

Before wiring the card directly into the production kiosk login path, we must decide exactly **which CSS identity the RFID authenticates**.

There are two distinct models in the current platform:

### A. Magento company user/customer

This is what the kiosk authenticates today.

It provides:

- Magento customer token/session;
- selected company context;
- catalogue/pricing;
- cart;
- checkout / Payment on Account.

### B. Canonical CSS Employee

This is the newer beneficiary identity.

It provides:

- Employee purchase-control subject;
- line/order attribution;
- department / cost-centre reporting;
- employee-specific entitlement;
- no Magento login identity by design.

These are not currently the same object.

### Decision required

If the kiosk is intended for the **Employee themselves** to tap a card and order for themselves, we need a deliberate server-side bridge from:

```text
RFID → CSS Employee
```

to an authorised commerce actor/session.

Do not solve this by silently turning every Employee into a fake Magento customer/company user unless we explicitly decide to change the Employee model across Fluid/css_admin.

If the kiosk remains a company-user purchasing station where a buyer selects a beneficiary Employee, then the current customer-card session can remain and the Employee RFID can be used only for locker collection/provisioning.

This identity decision must be recorded before the production login flow is changed.

## Recommended implementation slices

### Slice 1 — Employee RFID linkage contract

Define a dedicated Employee credential link rather than reusing the existing customer credential table.

Required durable identity:

```text
company_id
employee_id
credential_hash
credential_type
status
created_at
updated_at
last_used_at
revoked_at
```

Provider linkage can be stored alongside the employee link or in a separate provider mapping:

```text
company_id
employee_id
provider = ARGO
argo_employee_id
plant_id
last_verified_at
```

Raw RFID remains transient.

The durable source of truth should be suitable for more than one kiosk/device. A kiosk-local-only mapping is not sufficient if the same Employee may use multiple kiosks.

### Slice 2 — One-scan ARGO reconciliation

When an Employee credential is being enrolled:

1. validate the numeric RFID format expected by ARGO;
2. calculate/store only the CSS credential hash;
3. call `list_employees(plant_id, badge)`;
4. if exactly one ARGO employee exists, link its `employee_id`;
5. if none exists and writes are explicitly enabled, call `create_employee`;
6. if more than one match is returned, fail closed;
7. persist only the stable ARGO employee ID/provider mapping.

For ARGO `create_employee`, populate from canonical Employee fields:

```text
badge          = presented RFID (transient)
first_name     = CSS Employee first_name
last_name      = CSS Employee last_name
plant_id       = configured plant
employee_number = stable CSS employee reference where agreed
```

Do not mirror CSS purchase-control rules into ARGO `employee_group_id`, `profile_id` or `band_id` unless a real machine-side requirement is identified.

CSS/Fluid remains authoritative for entitlement.

### Slice 3 — css_admin / Company Portal UX

The Employee workspace should expose a compact RFID / locker status, for example:

```text
RFID
  Linked / Not linked / Revoked

Locker
  ARGO linked
  Employee ID 1999
  Plant Chelmsford
  Last verified ...
```

Admin actions should be explicit:

- start RFID enrolment;
- replace/revoke RFID;
- re-sync ARGO employee;
- show reconciliation errors.

Do not display the raw RFID value by default.

### Slice 4 — Kiosk enrolment handshake

Prefer a short-lived, explicit enrolment flow rather than allowing an arbitrary card scan to attach itself to an Employee.

Possible contract:

```text
css_admin / authorised portal
  → choose Employee
  → issue short-lived enrolment token

trusted kiosk
  → enter enrolment mode with token
  → Employee presents RFID
  → server verifies token + trusted kiosk
  → link credential hash to exact Employee
  → reconcile same raw RFID with ARGO
  → finish enrolment
```

This avoids requiring the RFID reader to be connected to an admin workstation and keeps raw card handling on the commissioned kiosk.

The exact mechanism may change, but the enrolment must be explicit, short-lived and company/employee-scoped.

### Slice 5 — Employee kiosk authentication

Only after the identity decision gate is resolved:

```text
tap RFID
  → resolve credential hash
  → active Employee
  → active company
  → obtain authorised commerce context
  → kiosk session contains explicit Employee identity
```

The kiosk session should carry enough server-side context to ensure:

- cart lines are assigned to the authenticated Employee where the business model requires it;
- Employee purchase controls are evaluated;
- an Employee cannot change to another Employee through browser input;
- the ARGO employee mapping is available later without exposing the raw badge.

### Slice 6 — Locker order/cart correlation

Still blocked on the final Lanzi write contract.

Expected future durable relationship:

```text
Magento order
↕
OGL order
↕
ARGO cart_id
↕
CSS Employee / ARGO employee_id
```

Do not persist a physical compartment/door as the correlation key.

ARGO owns dynamic physical location.

### Slice 7 — Collection

When Lanzi confirms the request/response and status semantics:

```text
Employee taps RFID
  → CSS authenticates Employee
  → resolve exact ready OGL order
  → resolve persisted ARGO cart_id
  → verify cart terminal + ARGO employee
  → obtain current badge transiently where required
  → request_cart_withdrawal
  → poll get_withdrawal_status
  → complete / fail safely
```

Never select "latest cart for badge" as the authoritative collection.

The exact CSS order → ARGO cart mapping must be known first.

## Lanzi blockers still open

Do not enable live cart/withdrawal writes until these are confirmed:

### create_cart

Need:

- exact payload schema;
- how employee/terminal are associated;
- response containing new `cart_id`;
- whether `project_number` or another external reference can carry the OGL order number;
- idempotency / duplicate-prevention behaviour.

### upsert_cart_line

Need:

- exact payload;
- product identifier;
- quantity/update key;
- delete/correction semantics;
- idempotency;
- mutability after loading.

### withdrawal

Need:

- `request_cart_withdrawal` response;
- `get_withdrawal_status` state list;
- retryable vs terminal states;
- expected polling interval;
- duplicate request behaviour.

### employee lifecycle

Need provider support/answer for:

- badge replacement;
- deactivation/leaver;
- update metadata.

## Data/security rules

1. Never expose the ARGO API key to browser or Android WebView JavaScript.
2. Never accept authoritative `employee_id`, `cart_id`, terminal or OGL order IDs directly from browser input for a physical withdrawal.
3. Keep raw RFID transient where possible; persist a credential hash for CSS identity.
4. Preserve leading zeroes in the presented RFID.
5. Fail closed on duplicate provider badge matches.
6. Do not infer an Employee from name/description.
7. Do not use ARGO slot/cell state as order ownership.
8. CSS/Fluid purchase controls remain authoritative; ARGO machine profiles are not a second commercial rules engine.
9. Employee deactivation must revoke future kiosk use while preserving historical order attribution.
10. Provider mapping must be company-scoped.

## Immediate next actions

- [ ] Confirm whether the kiosk card should authenticate a canonical Employee or continue authenticating a Magento company user who selects an Employee.
- [ ] Decide the durable Employee RFID/provider-link storage location and schema.
- [ ] Add the Fluid contract/storage for Employee credential + ARGO provider linkage if Employee authentication is selected.
- [ ] Add css_admin Employee RFID/Locker status and enrolment initiation.
- [ ] Add trusted kiosk enrolment handshake.
- [ ] Live-test one physical card against both Sycreader and ARGO badge lookup.
- [ ] Enable/test `create_employee` only against agreed test data when appropriate.
- [ ] Update this tracker with Lanzi's cart/withdrawal reply.
- [ ] Implement OGL ↔ ARGO cart correlation after the write contract is confirmed.
- [ ] Implement physical withdrawal only after the status lifecycle is confirmed.

## Progress log

### 20 Sep 2026

- NEXT ARGO discovery completed.
- Target locker confirmed as `ArgoLK DYN`, serial `LK241103S`.
- Provider foundation merged.
- Real API key configured outside source control.
- Lint/typecheck/build/readiness acceptance reported green.
- Existing Fluid canonical Employee and Employee purchase-control model confirmed.
- Important identity split recorded: current kiosk RFID maps to Magento customer; canonical Employee is a separate beneficiary identity.
