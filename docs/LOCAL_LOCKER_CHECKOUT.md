# Local locker checkout

Status: K3.1 implementation branch `feat/local-locker-checkout`

## Boundary

Kiosk checkout is local-locker only. The browser cannot submit a delivery address, carrier code or shipping method.

```text
browser
  -> signed POST /api/checkout/locker { action: "prepare" }
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

The physical cabinet is a Lanzi Group ARGO LT PRO. Hardware/door control is a separate future integration; this checkout slice only prepares the Magento cart for delivery to the configured physical locker.

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

## Runtime acceptance

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

The accepted request path is:

```text
linked NFC
-> Welcome
-> catalogue
-> non-empty basket
-> signed POST /api/checkout/locker
-> Magento setShippingAddressesOnCart
-> csslocker / locker available
-> setShippingMethodsOnCart
-> 200 locker review
```

Fail-closed checks remain:

- missing kiosk locker environment -> `LOCKER_NOT_CONFIGURED` / 503;
- empty basket -> rejected;
- company cannot checkout -> rejected;
- Magento does not offer `csslocker / locker` for the configured address -> rejected;
- arbitrary address/carrier/method fields are not accepted by the endpoint because the request body contains only `action: "prepare"`.

## OGL order-number handoff

The physical locker workflow uses the OGL order number as its correlation key. The kiosk must not call OGL directly or manufacture that value.

`Fluid_OglOrder` already exports Magento sales orders asynchronously and persists the returned OGL `ordno` as `sales_order.ogl_id`. The deployed Commerce boundary is being extended in `0stoya/Fluid#74` with the customer-scoped GraphQL query:

```graphql
query KioskLockerOrderStatus($orderNumber: String!) {
  css_kiosk_locker_order_status(order_number: $orderNumber) {
    magento_order_number
    ogl_order_number
    ogl_exported
    shipping_method
    order_status
  }
}
```

The intended chain is:

```text
kiosk confirms prepared locker cart
-> existing company credit/order workflow
-> Magento sales order
-> Fluid_OglOrder queue
-> OGL ordno
-> sales_order.ogl_id
-> css_kiosk_locker_order_status
-> future locker provider maps OGL order -> compartment / READY
```

Because OGL export is asynchronous, a newly placed order may initially have no OGL number. The kiosk should treat that as `export pending`, not as failure, and re-read the Magento GraphQL status later.

For future pickup, the browser must not submit an authoritative OGL order number or compartment number to an open-door operation. The trusted kiosk server will correlate the card-authenticated customer to a durable delivery record, resolve its OGL number and locker assignment server-side, and only then call the physical locker adapter.

Target pickup UX:

```text
customer taps NFC
-> authenticated customer
-> READY delivery found
-> Order <OGL order number>
-> Locker <compartment>
-> [Open locker]
```

## Not in K3.1

K3.1 does not place the order or control the physical cabinet. The next checkout slice will use the prepared cart and accepted company ordering/payment/credit capabilities to implement final confirmation. The later locker-provider slice will handle compartment assignment, door state/opening and collection completion once the Lanzi integration contract is available.
