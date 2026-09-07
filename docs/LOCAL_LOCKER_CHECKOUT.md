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

After Magento's locker carrier is enabled and the kiosk environment contains the matching physical locker configuration:

```text
linked NFC
-> Welcome
-> catalogue
-> add at least one item
-> signed POST /api/checkout/locker
-> 200
```

Expected response state:

```text
locker label/address = configured physical locker
shipping carrierCode = csslocker
shipping methodCode = locker
basket totalQuantity > 0
grandTotal present
```

Fail-closed checks:

- missing kiosk locker environment -> `LOCKER_NOT_CONFIGURED` / 503;
- empty basket -> rejected;
- company cannot checkout -> rejected;
- Magento does not offer `csslocker / locker` for the configured address -> rejected;
- arbitrary address/carrier/method fields are not accepted by the endpoint because the request body contains only `action: "prepare"`.

## Not in K3.1

K3.1 does not place the order. The next checkout slice will use the prepared cart and accepted company ordering/payment/credit capabilities to implement the final review/confirmation and order/credit-order submission path.
