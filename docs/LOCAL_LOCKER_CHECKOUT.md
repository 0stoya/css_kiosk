# Local locker checkout

Status: K3 implementation branch `feat/local-locker-checkout`

## Boundary

Kiosk checkout is local-locker only. The browser cannot submit a delivery address, carrier code, shipping method, payment method or Magento cart ID.

```text
browser
  -> signed POST /api/checkout/locker { action: "prepare" | "confirm" }
  -> trusted kiosk-device verification
  -> HttpOnly css_kiosk_session
  -> server-held Magento customer token
  -> server-side fixed locker configuration
  -> Magento GraphQL only
```

The Magento-side carrier lives in the deployed `0stoya/Fluid/Css/Commerce` boundary and has the fixed shipping contract:

```text
carrier_code: csslocker
method_code:  locker
```

The physical cabinet is a Lanzi Group ARGO LT PRO. Hardware/door control is a separate integration; this checkout slice creates the Magento/OGL order correlation required by that later pickup flow.

## Required kiosk server configuration

Configure these outside source control:

```text
KIOSK_LOCKER_LABEL
KIOSK_LOCKER_STREET_1
KIOSK_LOCKER_STREET_2        optional
KIOSK_LOCKER_CITY
KIOSK_LOCKER_REGION          optional
KIOSK_LOCKER_POSTCODE
KIOSK_LOCKER_COUNTRY_CODE
KIOSK_LOCKER_TELEPHONE
```

The kiosk postcode/country must match the Magento `CSS Locker Collection` configuration. The carrier and method codes are intentionally hard-coded in server code and are not browser inputs.

## GraphQL preparation flow

`prepareAuthenticatedLockerCheckout()` performs these operations using the session-held Magento customer token:

1. query `customerCart` and `css_ordering_capabilities`;
2. reject an empty cart or a customer/company that cannot checkout;
3. apply the fixed local locker with `setShippingAddressesOnCart`;
4. verify Magento returns `csslocker / locker` in `available_shipping_methods`;
5. select exactly that method with `setShippingMethodsOnCart`;
6. return only safe locker, shipping and total information to the browser.

The Magento cart ID remains server-side.

## Runtime preparation acceptance

Accepted on the live Magento runtime on 7 Sep 2026 after the company-carrier compatibility fix in `0stoya/Fluid#73`.

The kiosk successfully prepared the configured Greenford locker and displayed:

```text
CSS Local Locker
Greenford Depot, Greenford Road
Greenford, Middlesex
UB69AP · GB

Collect from CSS Locker
Locker delivery £0.00
Subtotal ex VAT £191.18
Checkout total £191.18
```

## Order confirmation flow

The review screen now exposes one explicit confirmation action. `POST /api/checkout/locker` with `{ action: "confirm" }` re-runs the server-side locker preparation before creating an order, so a stale or altered quote cannot bypass the locker-only boundary.

The server then:

1. reloads the authenticated `customerCart`;
2. verifies the selected method is still exactly `csslocker / locker`;
3. verifies Magento currently offers `companycredit` (`Payment on Account`);
4. selects `companycredit` with standard Magento GraphQL `setPaymentMethodOnCart`;
5. submits the cart through `cssSubmitCreditOrder`;
6. returns the Fluid credit-order result and Magento order number when auto-approval places the order immediately;
7. best-effort reads `css_kiosk_locker_order_status` to return the persisted OGL order number when the asynchronous OGL export has already completed.

If approval is required, the kiosk shows the Fluid credit-order reference. The Magento/OGL locker correlation becomes available after that approved credit order is placed as a Magento sales order.

OGL export is asynchronous, so a successful Magento locker order can initially show:

```text
Magento order: 000000123
OGL order: waiting for export
```

and later resolve through the `Css/Commerce` GraphQL contract once `Fluid_OglOrder` writes the OGL `ordno` to `sales_order.ogl_id`.

## OGL status acceptance note

The first manual OGL-status probes used Magento orders `000000158` and `000000159`, both created on 4 Sep 2026 before the locker carrier/checkout flow was introduced. They correctly return `The locker order was not found.` because the Commerce resolver deliberately requires `shipping_method = csslocker_locker`.

A new order created by this kiosk confirmation flow is required to validate the OGL handoff.

## Runtime order acceptance

After the Fluid kiosk OGL-status GraphQL contract is deployed, use an intended acceptance/test basket because the final confirmation is destructive:

```text
linked NFC
-> Welcome
-> catalogue
-> add at least one item
-> Basket
-> Review local locker checkout
-> signed POST /api/checkout/locker { action: prepare }
-> 200 / csslocker + locker
-> Confirm order to local locker
-> signed POST /api/checkout/locker { action: confirm }
```

Expected successful immediate-order state:

```text
payment_method = companycredit
order_placed = true
order_number = Magento increment ID
shipping_method = csslocker_locker
OGL number = value when export already completed, otherwise waiting
```

Expected approval-required state:

```text
credit_order_number present
approval_required = true
order_placed = false
```

Fail-closed checks:

- missing kiosk locker environment -> `LOCKER_NOT_CONFIGURED` / 503;
- empty basket -> rejected;
- company cannot checkout or submit credit order -> rejected;
- Magento does not offer `csslocker / locker` for the configured address -> rejected;
- `companycredit` is not available to the account -> rejected;
- arbitrary address/carrier/method/payment/cart fields are not accepted because the request body contains only the action.

## Pickup boundary

A later physical-locker slice will use the OGL order number as the server-side correlation key:

```text
OGL order
-> warehouse assigns ARGO LT PRO compartment
-> READY
-> customer taps registered NFC card
-> authenticated customer delivery lookup
-> show order + locker compartment
-> [Open locker]
```

The browser must never be trusted to provide the authoritative OGL order number or compartment number to a door command. The server will resolve those from an opaque delivery record associated with the authenticated customer.
