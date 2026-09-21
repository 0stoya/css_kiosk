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

## Identity decision — kiosk owns Employee context

Decision recorded 20 Sep 2026:

We do **not** need a new Magento/Fluid Employee-session type.

The kiosk already owns the browser-facing session and keeps Magento credentials server-side. Extend that kiosk session to carry canonical Employee identity separately from the existing Magento commerce actor.

The split is:

```text
Kiosk session
  ├─ commerce actor
  │    → existing bound Magento customer/company session
  │    → catalogue / cart / checkout / companycredit
  │
  └─ employee
       → canonical CSS Employee
       → Employee purchase controls
       → line/order attribution
       → ARGO employee link
```

Employee remains a beneficiary identity and does not become a Magento login.

The kiosk server, not the browser, is responsible for binding the current Employee to Magento cart operations.

Fluid remains authoritative for Employee existence, company scope, active status and purchase-control enforcement, but no new assertion purpose/session model is required.

### Minimal Fluid change

The current bound-session GraphQL guard does not allow the existing Employee roots required by the kiosk.

Extend the allow-list only for the specific existing operations required by the kiosk, expected to include:

```text
css_company_employee
css_company_employees        only if needed for controlled lookup
cssAssignCartEmployee
```

The kiosk should prefer exact Employee IDs from its server-side credential mapping rather than letting browser input browse/select arbitrary Employees.

No new Magento customer token type or Employee authentication resolver is required.

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

```text
tap RFID
  → resolve Employee credential hash
  → active canonical Employee
  → resolve configured/authorised commerce actor for that company
  → establish the existing bound Magento customer/company session
  → kiosk session stores both commerce actor + Employee identity
```

No Employee ID is accepted from browser input.

For every basket mutation, the kiosk server ensures the cart is assigned to the session Employee using the existing Fluid Employee assignment contract.

The kiosk session must ensure:

- cart lines are assigned to the authenticated Employee;
- Employee purchase controls are evaluated by Fluid;
- an Employee cannot switch to another Employee through browser input;
- ARGO employee mapping is available later without exposing the raw badge;
- a newly authenticated Employee never inherits another Employee's basket.

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


## Manager/admin locker operations

New requirement recorded 20 Sep 2026:

When an authenticated manager/company administrator signs into the kiosk, the kiosk should expose a privileged locker view with live ARGO terminal state and controlled physical operations.

### Status view

This can be built from the existing ARGO read contract now:

```text
get_terminal(configured terminal)
  → slot_summary
  → full_slots
  → empty_slots
  → loading_plan
```

The kiosk may show:

- locker online/configured state;
- terminal identity;
- total positions;
- ARGO-reported full/empty/partial/unassigned/unmaterialised counts;
- full cell identifiers and current product metadata where useful for operations.

Do not relabel `unmaterialised` as "empty" until Lanzi confirms the semantic meaning. The UI should preserve provider terminology or use a neutral "available/unmaterialised" presentation until confirmed.

### Privileged access

Physical locker status may be visible only to an authenticated authorised company user.

The current Magento/Fluid company-user session already carries the management identity. css_kiosk should resolve a server-side locker capability at login and keep only safe booleans in its own kiosk session, for example:

```text
locker.can_view_status
locker.can_open
```

Do not trust a browser-provided role name such as "manager" or "admin".

Company administrators may be granted this automatically. Manager access should be based on an explicit company permission/capability rather than inferred from job title or name.

A dedicated permission is preferable for physical access, for example:

```text
Css_Commerce::locker_status_view
Css_Commerce::locker_open
```

or an equivalent existing company-role resource contract.

### Manual open API gap

The documented NEXT ARGO contract does **not** currently expose an arbitrary compartment/door-open operation.

`request_cart_withdrawal` is not a general manual-open endpoint. It requires:

```text
terminal_id
cart_id
user_badge
```

and ARGO then performs the cart withdrawal flow with operator confirmation.

Do not misuse a fake/empty cart or a guessed cell to simulate manager door opening.

To support "Open locker" from the manager view, ask Lanzi for the intended privileged/manual operation, including:

- whether it opens by `cell_id`, plate/sector/cell, or another provider identifier;
- whether only empty/full cells may be opened;
- required operator/badge identity;
- confirmation/audit requirements;
- command response/status;
- idempotency/retry behaviour.

Until that contract exists, the manager screen can safely provide read-only locker status.

### Server-side open boundary

When a provider manual-open operation exists:

```text
manager/admin session
  → signed kiosk request
  → css_kiosk revalidates locker-open capability
  → css_kiosk resolves configured terminal
  → css_kiosk validates provider cell from current ARGO state
  → provider open request
  → audit actor + terminal + cell + result
```

The browser must not be allowed to submit an arbitrary terminal ID or provider database UUID.

A cell identifier may be selected from the safe server-returned current terminal view, but the server must re-fetch/revalidate it before issuing a physical action.

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

- [x] Decide identity boundary: kiosk session carries canonical Employee + existing bound Magento commerce actor; no new Magento Employee-session type.
- [ ] Decide the durable Employee RFID/provider-link storage location and schema.
- [ ] Add the minimal Fluid bound-session allow-list support for existing Employee query/assignment operations.
- [ ] Add the Fluid contract/storage for Employee credential + ARGO provider linkage if Employee authentication is selected.
- [ ] Add css_admin Employee RFID/Locker status and enrolment initiation.
- [ ] Add trusted kiosk enrolment handshake.
- [ ] Live-test one physical card against both Sycreader and ARGO badge lookup.
- [x] Add manager/admin locker status view using the existing read-only ARGO terminal contract (draft PR #26; company-admin path first).
- [ ] Define explicit locker view/open company permissions for manager roles after the company-admin demo path is accepted.
- [ ] Ask Lanzi for the supported privileged/manual compartment-open operation; do not emulate it with cart withdrawal.
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
- Decision: keep Employee identity in the kiosk server session and reuse the existing bound Magento commerce session; do not add a new Magento Employee-session type.
- Remaining Fluid work for Employee ordering is intentionally minimal: allow the existing Employee assignment GraphQL root for kiosk-bound sessions.
- New manager/admin requirement recorded: privileged users should see live locker status and, once Lanzi supplies the correct manual-open contract, be able to open a selected locker position.
- Current ARGO API supports the status view now; it does not document a general manual-open operation.
- Fluid PR #97 opens the existing `css_company_admin` read root to the existing bound kiosk session so css_kiosk can verify company-admin capability server-side.
- css_kiosk draft PR #26 implements the privileged Locker workspace, live ARGO status, refresh, occupied-cell product enrichment, and the server-side manual-open boundary.


### 20 Sep 2026 — locker management demo slice

- Opened Fluid PR #97: allow `css_company_admin` through the existing kiosk-bound GraphQL guard.
- Opened css_kiosk draft PR #26: company-admin Locker workspace.
- Company-admin path is server-authorised from the existing bound Magento session; browser role names are not trusted.
- Live ARGO status is read-only and shows full / confirmed empty / unmaterialised separately.
- Occupied cell cards enrich product labels from ARGO.
- Manual Open button/boundary exists but stays disabled until Lanzi supplies the supported privileged cell-open API.


### 20 Sep 2026 — stale bound-token hardening

Observed Magento critical log during kiosk-bound requests:

```text
Composite reader could not read a token
```

Likely deployment/cache-clear edge case: css_kiosk can still hold its short-lived session while Magento's cached `cssks2_` bound-session record has been cleared. The next request carries a valid-looking custom token with no server binding.

Fluid PR #97 was hardened so an invalid/stale bound kiosk token no longer falls through to Magento's native token reader. It remains unauthenticated and is rejected by the existing kiosk GraphQL guard. Unit coverage asserts the native token callback is not invoked for this path.

Acceptance after deploy:

- sign out/reset the old kiosk session;
- tap the card to establish a fresh bound session;
- load catalogue/basket/Locker;
- confirm the Magento log does not emit the Composite reader critical message.


### 20 Sep 2026 — Magento 2.4.9 bound-token pre-validator fix

Observed on fresh kiosk sign-in:

```text
POST /api/nfc/resolve 503 SESSION_UNAVAILABLE
Magento: Composite reader could not read a token
```

Root cause confirmed in Magento 2.4.9: `Magento\CustomerGraphQl\Controller\HttpRequestValidator\AuthorizationRequestValidator` validates Bearer tokens before the existing kiosk `TokenUserContext` plugin. The CSS `cssks2_` bound token is not a native Magento token, so Magento rejected it before the kiosk bridge could establish customer context.

Opened Fluid PR #98:

```text
Fix Magento 2.4.9 kiosk bound-token pre-validation
```

The fix intercepts the early GraphQL bearer validator for `cssks2_` only, validates the existing CSS binding (token cache, expiry, Store, device, session proof), skips native Magento token parsing when valid, and fails closed when stale/invalid. Ordinary Magento bearer tokens remain unchanged.

Locker admin draft PR #26 should be acceptance-tested only after Fluid #98 is deployed.


### 20 Sep 2026 — manager/admin locker visibility correction

Live acceptance showed that a company role named `Admin` with broad management permissions does not necessarily set Fluid's special `is_company_admin` flag.

Opened css_kiosk PR #27 to broaden **read-only locker status** visibility using existing current-user management capabilities returned by `css_company_admin`:

```text
is_company_admin
OR can_manage_users
OR can_manage_roles
OR can_manage_catalog_visibility
OR can_manage_purchase_controls
```

The decision remains server-side and company/user IDs are cross-checked against the active bound session. Physical locker opening remains disabled pending the Lanzi manual-open contract and should later use its own explicit permission.


### 20 Sep 2026 — request_cart_withdrawal demo path

Lanzi's documented `request_cart_withdrawal` contract is sufficient to prove a real physical hand-over for a **known loaded cart**:

```text
terminal_id
cart_id
user_badge
→ request_key
→ get_withdrawal_status(request_key)
```

This is cart-centric, not a general cell/door-open operation. Keep the existing arbitrary-cell Open action disabled until Lanzi confirms a privileged manual-open API.

For a safe demo, use a known test cart that Lanzi/operations confirms is currently loaded on terminal 42042. Require the operator to present their RFID again at release time so the raw badge is used transiently and never persisted. Send `user_badge` as a string to preserve leading zeroes.

The kiosk should revalidate:

- trusted kiosk device;
- active kiosk session;
- manager/admin locker capability;
- configured terminal identity;
- exact cart exists and belongs to the configured terminal;
- presented badge resolves to the same signed-in operator/customer where applicable.

Then call `request_cart_withdrawal`, persist only the returned `request_key` for the short-lived operation, and poll `get_withdrawal_status`.

Do not infer success/failure state names until Lanzi confirms the status enumeration. For the demo, surface provider status/progress without inventing semantics.

This path can demonstrate "Release loaded cart" now. It cannot support "click any full cell and open it" because the terminal full-slot response does not expose a cart_id/cell→cart mapping.


### 20 Sep 2026 — kiosk inactivity lock

Opened css_kiosk PR #29.

Authenticated kiosk UX timing is now configurable:

```text
NEXT_PUBLIC_KIOSK_WELCOME_DELAY_SECONDS=2
NEXT_PUBLIC_KIOSK_INACTIVITY_TIMEOUT_SECONDS=90
```

The welcome screen no longer uses the previous hard-coded five-second delay. While authenticated, real pointer/touch, keyboard and wheel activity resets the inactivity timer. On timeout the kiosk uses the existing secure sign-out path and returns to the card screen. The existing 15-minute server-session TTL remains an independent upper bound.


### 21 Sep 2026 — Lanzi flow confirmation

Lanzi confirmed the intended integration boundary and physical safety model.

#### Confirmed ownership boundary

```text
CSS / kiosk
  → owns user permissions and privileges
  → keeps ARGO employee list in sync
  → creates ARGO cart records for kiosk-driven orders
  → later requests withdrawal for a named badge

Loader at machine
  → physically fills the locker
  → chooses the compartment
  → always owns the physical loading step

ARGO machine
  → owns every door
  → decides whether opening is safe
  → shows local confirmation
  → opens only after confirmation
  → reports the resulting state
```

There is no direct API-driven compartment assignment and no API operation that should be treated as an unconditional door-open command.

#### Flow B — kiosk-driven cart

Confirmed intended sequence:

```text
CSS creates cart
  → create_cart
  → project_number carries our order reference
  → returns cart_id

CSS adds lines
  → upsert_cart_line

Loader physically loads cart
  → chooses compartment at machine
  → cart becomes collectable only after this step

CSS requests collection
  → request_cart_withdrawal(
       terminal_id,
       cart_id,
       user_badge
     )
  → ARGO machine shows local confirmation
  → get_withdrawal_status(request_key)
```

A cart record existing in ARGO does not mean it is physically loaded or ready to collect.

#### Door-opening requirement clarified

Our previous "manager opens arbitrary cell" concept does not match the ARGO safety model.

The supported physical action is cart withdrawal:

```text
known loaded cart
→ authorised user/admin requests withdrawal
→ machine decides which physical compartment(s) belong to the cart
→ machine asks locally for confirmation
→ door(s) open only after confirmation
```

The manager/admin demo should therefore evolve toward:

```text
admin login
→ live locker status
→ select a known loaded cart
→ Release cart
→ ARGO local confirmation
→ physical hand-over
```

rather than "select arbitrary cell → open door".

Keep the current arbitrary-cell Open action disabled.

#### Machine-session behaviour

A withdrawal request can be refused before confirmation when:

- another user currently has an active machine session; or
- the active machine session belongs to somebody other than the requesting user.

When accepted, the machine shows:

- requesting user;
- number of doors that will open;
- confirmation timer.

If nobody confirms before timeout, nothing opens and the request is reported as cancelled/refused.

Treat withdrawal as an asynchronous request, not a direct command.

#### Employee synchronisation

Lanzi recommends CSS keeps ARGO employees aligned with kiosk employees.

Confirmed employee pattern:

```text
badge first seen
→ list_employees(badge)
  ├─ one match → persist argo_employee_id
  └─ no match  → create_employee
```

Badge requirements:

- digits only;
- maximum 20 digits;
- unique within plant;
- preserve presented digits on the CSS side even if ARGO internally stores numerically;
- create_employee creates a badge holder only, not a password/login account.

Loader users require the plant-specific loader `profile_id`. Ask Lanzi for the Chelmsford loader profile ID before automatically provisioning loader accounts.

`update_employee` is not yet available; Lanzi intends to add it.

#### Webhook opportunity

Lanzi can add callbacks for two physical events:

1. cart loaded / compartment door closed after loading;
2. withdrawal completed / door closed after collection.

This is preferable to inferring readiness from cart existence and can reduce withdrawal polling.

Proposed CSS webhook contract should be designed before giving Lanzi an endpoint.

At minimum persist events idempotently against:

```text
argo_cart_id
project_number / OGL order
event_type
provider_event_id or idempotency key
terminal_id
occurred_at
received_at
raw provider status/reference
```

Recommended events:

```text
ARGO_CART_LOADED
ARGO_WITHDRAWAL_COMPLETED
```

The callback endpoint must have provider authentication, replay/idempotency protection and must never trust a browser/device credential.

#### Important create_cart contract contradiction to clarify

Lanzi's "How a locker cart works" section says:

```text
create_cart takes no employee
API-created carts use one integration identity
request_cart_withdrawal supplies the collecting badge separately
```

but the later "Keeping your people in step" section says:

```text
create_cart user_badge names the employee the cart is for
unknown badge → badge_unknown
```

These statements conflict.

Before implementing production `create_cart`, confirm which is current:

A. `create_cart` now accepts `user_badge` and attributes ownership; or  
B. `create_cart` still has no employee owner and only `request_cart_withdrawal` takes a badge.

If A is the newly updated contract, use it and persist both `argo_employee_id` and `cart_id`. If B remains current, keep CSS as the order-owner authority and treat the collecting badge separately.

#### Items to confirm on the Lanzi call

- exact current `create_cart` payload and response;
- whether `user_badge` is now supported on `create_cart`;
- exact `upsert_cart_line` payload / upsert identity / delete semantics;
- full `get_withdrawal_status` state enumeration;
- webhook event payloads;
- webhook authentication/signing;
- webhook retry/idempotency behaviour;
- Chelmsford loader `profile_id`;
- planned `update_employee` fields and semantics.


### 21 Sep 2026 — create_cart / upsert_cart_line contract confirmed

The current Lanzi docs now resolve the previous ownership ambiguity.

#### create_cart

`create_cart` creates a cart for a named ARGO employee and now requires:

```text
terminal_id
user_badge
lines[]
project_number optional
project_id optional legacy
```

Each initial line contains:

```text
product_id
attribute_id = 0
quantity
expiry_date required
expected_arrival_date required
```

The employee badge must already exist in ARGO. CSS must therefore resolve/create the ARGO employee before cart creation.

Successful response:

```text
id            = ARGO cart_id
terminal_id
employee_id
badge
state = pending
```

`state=pending` means the cart record exists but the loader has not physically loaded it yet.

CSS should persist the returned `cart_id`, `employee_id`, badge linkage and `project_number` correlation.

Recommended order correlation:

```text
OGL order number → project_number
ARGO cart id      → durable provider identifier
```

#### upsert_cart_line

`upsert_cart_line` is defined as a replace/upsert keyed by:

```text
cart_id + product_id + attribute_id
```

Required data:

```text
cart_id
product_id
attribute_id = 0
quantity
expiry_date
expected_arrival_date
```

Calling it again for the same product + attribute replaces the existing line rather than creating a duplicate.

Only API-created carts are editable. Machine-created carts are rejected with `cart_not_editable`.

#### Date policy still required on CSS side

ARGO requires both dates on every line, even when the goods do not expire.

Before production cart creation, define:

- the CSS source for `expected_arrival_date`;
- the agreed far-future sentinel used for non-expiring goods;
- whether real product expiry dates are ever available in OGL/Magento for this flow.

Do not silently invent per-line dates without a documented CSS policy.

#### One documentation inconsistency to clarify

The `upsert_cart_line` input contract states `attribute_id` must be `0`, but the published successful response example currently shows:

```json
{"attribute_id":4}
```

Ask Lanzi whether that response example is a typo, an internal translated attribute identifier, or an intentional response value. CSS should continue sending `attribute_id: 0` unless Lanzi says otherwise.

#### Implementation readiness

The write contract is now sufficient to implement, behind the existing ARGO write gate:

```text
ensure employee by badge
→ create_cart with initial lines + project_number
→ persist cart correlation
→ optional later upsert_cart_line corrections
→ wait for loader-loaded event / readiness
→ request_cart_withdrawal
→ get_withdrawal_status
```

The next kiosk implementation PR can now add typed `create_cart` and `upsert_cart_line` provider methods and persistence scaffolding without guessing payload shape.


### 21 Sep 2026 — withdrawal request response confirmed

Lanzi now documents the successful `request_cart_withdrawal` response.

Request:

```text
terminal_id
cart_id
user_badge
```

Successful HTTP 200 response:

```text
request_key
phase = queued
status = pending
terminal_id
cart_id
badge
message
```

Important semantic:

```text
HTTP 200
≠ machine accepted
≠ door opened
≠ collection completed
```

It means only that ARGO accepted the withdrawal request for processing.

CSS must persist the returned `request_key` immediately. It is the only handle for subsequent `get_withdrawal_status` polling.

The machine may still refuse the request, including when another user has an incompatible active machine session. Nothing opens until the person at the machine confirms locally.

Recommended CSS state transition:

```text
READY
  → request_cart_withdrawal
  → WITHDRAWAL_REQUESTED
      request_key persisted
      provider phase=queued
      provider status=pending
  → poll get_withdrawal_status
  → terminal provider result
```

Do not mark an order collected from the initial HTTP 200.

#### Badge typing

The contract documents `user_badge` as a string, even though some generated curl examples show an unquoted numeric value.

CSS should always submit badges as strings to preserve leading zeroes:

```json
{"user_badge":"088793"}
```

Do not derive the canonical badge value from a numeric provider echo.

#### create_cart generated curl discrepancy

The generated docs curl currently shows:

```json
"lines":"[{\"product_id\":18,...}]"
```

which is a JSON string containing an encoded array.

The documented parameter type, however, is `array`.

The expected API-native JSON shape should therefore be confirmed as:

```json
"lines":[
  {
    "product_id":18,
    "attribute_id":0,
    "quantity":2,
    "expiry_date":"2027-06-30",
    "expected_arrival_date":"2026-10-01"
  }
]
```

Do not implement the stringified form unless Lanzi explicitly confirms that the API expects it. It is likely a docs-console/rendering artefact.

#### Write-console warning

"Disabled for write operations" in the documentation console is expected and is not evidence that the provisioned API key lacks `cart_write` / `cart_withdraw`.

Before live acceptance, verify the real key capabilities and use disposable agreed test data.

#### Remaining withdrawal contract item

The request side is now defined. The remaining provider contract required for production collection is the full successful/error response shape and terminal state enumeration for `get_withdrawal_status`.


### 21 Sep 2026 — Fluid boundary after ARGO write contract

Decision: no Fluid change is required for the core NEXT ARGO integration.

Fluid already owns and exposes the required commerce facts:

- canonical Employee attribution on quote/order lines;
- Employee purchase-control enforcement;
- Magento/credit-order lifecycle;
- locker shipping method;
- Magento order number;
- OGL export state and `ogl_order_number` through `css_kiosk_locker_order_status`.

NEXT ARGO logic remains in css_kiosk:

```text
employee/badge reconciliation
ARGO product mapping
create_cart
upsert_cart_line
OGL ↔ ARGO cart correlation
ARGO loaded/completed callbacks
request_cart_withdrawal
get_withdrawal_status
```

For the immediate/auto-approved path css_kiosk can snapshot the basket lines before submission, persist the resulting Magento order number, wait for the OGL number, then create the ARGO cart.

One future production concern exists for approval-required orders: the Magento order/OGL export may happen after the short-lived kiosk customer session is gone. Do not move ARGO writes into Fluid to solve this. Preferred options are:

1. a durable css_kiosk pending-fulfilment job plus a server-side trusted way to observe final OGL export; or
2. a small Fluid outbound event/callback when a locker Magento order receives its OGL number.

If option 2 is required, Fluid should emit only the commerce event/facts. css_kiosk should still own all ARGO calls and state.


### 21 Sep 2026 — ARGO cart write foundation started

Opened css_kiosk PR #30: **Add NEXT ARGO cart write foundation**.

Implemented behind the existing write gate:

```text
createArgoCart()
upsertArgoCartLine()
requestArgoCartWithdrawal()
```

The provider layer validates badge/date/quantity inputs, sends `create_cart.lines` as a native JSON array, preserves `request_key` semantics and does not interpret queued HTTP 200 as collection completion.

Durable SQLite storage now records:

```text
Magento order number
project_number / OGL order reference
ARGO cart_id
ARGO employee_id
terminal_id
provider cart state
withdrawal request_key / phase / status
```

Raw RFID badges are not persisted in the correlation tables.

No checkout route invokes these writes yet and `ARGO_WRITES_ENABLED=false` remains the default.

Next commerce-facing work after #30:

1. kiosk-owned canonical Employee context / cart assignment;
2. RFID → ARGO employee durable link;
3. SKU → ARGO product mapping;
4. explicit expiry/expected-arrival date policy;
5. order → ARGO cart orchestration after OGL correlation exists;
6. `get_withdrawal_status` once provider states are documented;
7. loaded/completed provider callbacks.


### 21 Sep 2026 — #30 deployed; Employee RFID linkage foundation started

css_kiosk PR #30 is merged and deployed.

Opened Fluid PR #100:

```text
Allow bound kiosk Employee assignment roots
```

It adds only:

```text
css_company_employee(employee_id)
cssAssignCartEmployee(cart_id, employee_id)
```

to the kiosk-bound allow-list. Employee directory browsing remains blocked.

Opened css_kiosk PR #31:

```text
Add Employee RFID to ARGO linkage foundation
```

It implements the agreed dedicated Employee credential model rather than overloading the existing customer credential table:

```text
employee_credentials
  → credential_hash
  → company_id
  → employee_id
  → status/timestamps

employee_provider_links
  → company_id
  → employee_id
  → ARGO employee_id
  → plant_id
  → last_verified_at
```

Raw RFID is not persisted.

The one-scan reconciliation helper now performs:

```text
exact active Fluid Employee
→ numeric RFID
→ ARGO exact badge lookup
   ├─ found → link
   └─ missing + writes enabled → create_employee
→ persist stable provider ID + credential hash
```

The server-side kiosk session can now carry Employee context separately from the Magento commerce actor.

No enrollment HTTP route/browser Employee selector is exposed yet. The next slice remains the short-lived authorised enrollment handshake followed by Employee-card authentication and automatic cart assignment.


### 21 Sep 2026 — Fluid scope correction

Clarified the earlier "no Fluid changes" statement:

- NEXT ARGO integration itself requires no Fluid changes.
- The only Fluid change currently needed for end-to-end Employee ordering is to let the existing bound kiosk session call `cssAssignCartEmployee`, so Fluid can keep enforcing canonical Employee attribution and purchase controls.

Fluid #100 was reduced accordingly.

The kiosk-bound session does **not** get:

```text
css_company_employee
css_company_employees
```

Employee lookup/browsing remains outside the kiosk-bound customer session. The future authorised enrollment flow will provide the exact canonical Employee identity to css_kiosk, which then stores only the trusted Employee mapping and uses `cssAssignCartEmployee` for the cart.


### 21 Sep 2026 — company kiosk commerce actor is the next prerequisite

Employee RFID identification and Magento commerce authentication must remain separate.

A canonical Employee is a beneficiary and deliberately has no Magento login. Therefore Employee-card sign-in needs a configured company user to act as the Magento commerce actor:

```text
Employee RFID
  → canonical Employee identity
  → company kiosk commerce actor
  → existing bound Magento customer/company session
  → cssAssignCartEmployee(employee_id)
```

The existing kiosk assertion exchange already supports this safely from trusted server-side IDs and does not require persisting a password.

Recommended durable configuration:

```text
company_id
commerce_customer_id
commerce_company_user_id
configured_at / updated_at
```

Initial administration should select an existing company user with checkout permission rather than silently using whoever performed Employee enrollment. Prefer a clearly designated "Kiosk Buyer" company user where practical.

The css_admin company-management query already exposes both `customer_id` and company `user_id`, plus `can_checkout`, so the admin UI has enough data to select/validate the actor without another Fluid schema change.

Important basket-isolation requirement:

A newly authenticated Employee must never inherit another Employee's abandoned basket. Before Employee-card authentication is considered complete, css_kiosk must guarantee an empty/current basket for that Employee/commerce-actor context.

If one commerce actor is ever used by multiple physical kiosks concurrently, Magento's single active customer cart becomes a concurrency concern. Initial deployment should bind the actor to the intended kiosk/site, and multi-kiosk concurrency must be addressed explicitly before scaling that pattern.

Recommended next implementation sequence:

1. company kiosk commerce-actor configuration;
2. server-to-server css_admin → css_kiosk enrollment API;
3. short-lived one-use Employee enrollment code;
4. kiosk enrollment mode + RFID scan;
5. Employee-card sign-in using configured commerce actor;
6. basket isolation + automatic `cssAssignCartEmployee`;
7. product mapping and ARGO cart creation.


### 21 Sep 2026 — commerce actor correction: each Employee has a Magento account

Deployment assumption confirmed: every Employee using the kiosk will also have their own Magento / Fluid company-user account.

Therefore the previously proposed shared company "Kiosk Buyer" commerce actor is **not required** for this deployment.

The correct identity model is:

```text
one RFID
  ├─ existing kiosk customer credential link
  │    → Employee's own Magento customer
  │    → Employee's own Fluid company-user membership
  │    → existing bound Magento kiosk session
  │
  └─ dedicated Employee credential link
       → canonical CSS Employee
       → ARGO employee_id
```

The two links may use the same credential hash but remain separate durable records because they represent different identities/purposes.

On card presentation:

```text
RFID
→ resolve existing Magento customer/company credential
→ establish Employee's own bound Magento session
→ resolve dedicated canonical Employee credential
→ require same company
→ attach Employee context to kiosk session
→ cssAssignCartEmployee(employee_id)
```

No shared or delegated commerce actor is involved.

#### Enrollment consequence

The existing one-time Magento card-link flow can be reused as part of Employee enrollment:

```text
authorised admin selects canonical Employee
→ Employee presents RFID
→ Employee signs in once with their own Magento credentials if the customer credential is not already linked
→ verify Magento company membership matches canonical Employee company
→ reconcile RFID with ARGO
→ persist Employee credential hash + ARGO employee_id
```

If the RFID is already linked to the correct Magento customer, the enrollment flow only needs to add/verify the canonical Employee + ARGO link.

The canonical Employee still must not be inferred only from the Magento customer identity because the current Fluid Employee model is a separate beneficiary record and does not contain a direct company_user/customer foreign key.

#### Basket isolation

Because each Employee has their own Magento account/customer cart, the shared-actor concurrency concern is removed.

The kiosk still must ensure the authenticated cart is assigned to the canonical Employee before checkout via `cssAssignCartEmployee`, and Fluid remains authoritative for active Employee/company/manager scope and purchase controls.

#### Revised next sequence

1. authorised Employee RFID enrollment handshake;
2. reuse/verify existing Magento customer-card linkage;
3. persist canonical Employee + ARGO link;
4. Employee card sign-in resolves both customer and Employee identities;
5. automatic whole-cart Employee assignment;
6. SKU → ARGO product mapping;
7. order → ARGO cart creation.


### 21 Sep 2026 — authorised Employee RFID enrollment handshake

Opened css_kiosk PR #33:

```text
Add authorised Employee RFID enrollment handshake
```

Adds:

- 5-minute one-use Employee enrollment codes;
- server-to-server authenticated enrollment issuer for css_admin;
- trusted-device kiosk lookup/completion endpoint;
- kiosk UI: enter code → show exact Employee → tap RFID;
- reuse of the existing Magento card-link/sign-in flow if the RFID has not been linked to the Employee's own Magento account yet;
- company/customer/RFID identity cross-checks before canonical Employee + ARGO linkage;
- code claim/release/consume semantics so failed provider reconciliation does not burn the code;
- only the newest still-pending code for one Employee remains valid.

Opened css_admin PR #103:

```text
Add Employee RFID enrollment action
```

Each active Employee row gets an RFID action that:

```text
reload exact canonical Employee
→ server-to-server call to css_kiosk
→ display 8-character enrollment code + expiry
```

Required shared configuration:

```text
css_kiosk:
  KIOSK_EMPLOYEE_ENROLLMENT_SHARED_SECRET=<strong random secret>

css_admin:
  CSS_KIOSK_BASE_URL=https://kiosk.csscdn.co.uk
  KIOSK_EMPLOYEE_ENROLLMENT_SHARED_SECRET=<same secret>
```

The secret is server-only and the raw RFID never passes through css_admin.

Next after #33/#103 live acceptance:

1. normal Employee card sign-in resolves the dedicated Employee link;
2. attach Employee context to the kiosk session automatically;
3. automatically call `cssAssignCartEmployee` for the active customer cart;
4. then build SKU → ARGO product mapping and order → `create_cart`.


### 21 Sep 2026 — simple product mapping + physical cart-release acceptance

Opened css_kiosk PR #34:

```text
Add loaded-cart locker release test
```

Product mapping is intentionally minimal:

```text
Magento SKU
→ exact active ARGO customer_code
→ fallback exact active ARGO code
→ one match = product_id
→ zero/multiple = fail closed
```

No manual mapping table is introduced unless real data proves code alignment is insufficient.

The manager/admin Locker workspace now has a separate **Release loaded cart** acceptance section.

This does not enable arbitrary cell-level opening.

Acceptance flow:

```text
manager/admin session
→ known physically loaded cart_id
→ active collector badge
→ verify configured terminal + cart + badge
→ request_cart_withdrawal
→ queued/pending + request_key
→ operator confirms at ARGO machine
→ ARGO opens the cart's correct compartment(s)
```

The typed collector badge is a temporary acceptance-tool input and is not persisted. Normal Employee collection should later use the authenticated Employee RFID identity.

Physical test requires:

```text
ARGO_WRITES_ENABLED=true
```

Do not infer that an observed cart is loaded merely because it has product lines. Use a cart confirmed loaded by Lanzi/operations/the machine.


### 21 Sep 2026 — Open locker UX uses the sign-in RFID

PR #34 was simplified after physical UX review.

Product matching remains:

```text
Magento SKU
→ exact ARGO customer_code
→ fallback exact ARGO code
→ one match = product_id
```

Because the kiosk company's catalogue is deliberately limited, no separate product-mapping admin UI is planned unless real catalogue data proves code alignment is insufficient.

The manager/admin physical action keeps the operator-facing label **Open locker**, but is cart-scoped underneath:

```text
Open locker
→ request_cart_withdrawal(known cart_id)
→ ARGO local confirmation
→ ARGO chooses/opens the cart compartment(s)
```

The admin does not scan their badge a second time.

When a numeric RFID is used for kiosk login, css_kiosk keeps the badge only in the current in-memory kiosk session (maximum existing session lifetime), never in SQLite and never in browser state. The value is discarded on logout/expiry and is used transiently as the withdrawal `user_badge`.

The Open locker form therefore needs only the known loaded `cart_id`.

Per-cell Open buttons remain disabled because ARGO does not expose arbitrary cell opening.


### 21 Sep 2026 — normal Employee RFID sign-in + automatic cart assignment

Opened css_kiosk PR #37:

```text
Attach canonical Employee on normal RFID sign-in
```

Normal registered RFID login now additionally resolves the dedicated Employee credential/provider mapping.

When linked:

```text
RFID
→ Magento customer/company
→ canonical Employee
→ ARGO employee
→ kiosk session
```

Fail-closed checks:

- revoked Employee RFID link;
- Employee company mismatch;
- missing ARGO provider link;
- Fluid rejection of whole-cart Employee assignment.

Before the kiosk session is committed, css_kiosk calls the existing `cssAssignCartEmployee` against the current Magento cart. If Fluid rejects the Employee, the temporary Magento session is revoked and kiosk login fails.

After ordinary and grouped basket additions, css_kiosk assigns the whole cart to the session Employee again.

Before locker checkout preparation, the cart is assigned/revalidated once more.

Enforcement checkpoints:

```text
RFID login
→ basket additions
→ checkout
```

The browser never supplies an Employee ID.

Dependency note: css_kiosk #33 is still open in GitHub and should be merged before production relies on new Employee enrollment records.
