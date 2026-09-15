# Bound Magento kiosk sessions

This kiosk now uses the device/company/store-bound session contract introduced by `0stoya/Fluid#92` for returning-card authentication.

## Trust chain

```text
signed active kiosk device request
  -> linked NFC credential
  -> customer + linked company context
  -> one-use RS256 assertion
       purpose = customer_session_bound
       sub = Magento customer ID
       company_id = linked company
       store_code = configured Magento store
       device_id = verified kiosk device
  -> GraphQL css_kiosk_customer_session
  -> cssks2 envelope (server-side only)
       opaque bound token
       separate session proof
       customer/company/company-user/device/store binding
       expiry
  -> opaque HttpOnly css_kiosk_session in the browser
```

The `cssks2.` envelope is never returned to browser JavaScript. It is kept only in the kiosk server's in-memory session registry.

## Magento GraphQL requests

For a bound session, the kiosk server decodes the envelope and sends:

```text
Authorization: Bearer <bound token>
Store: <bound store code>
X-Css-Kiosk-Device-Id: <bound device id>
X-Css-Kiosk-Session-Proof: <session proof>
```

The Magento/Fluid side re-checks the customer, company membership, active-company state, store/website, device and session proof on every request and permits only the kiosk GraphQL surface.

First-time email/password verification remains unchanged: Magento's normal `generateCustomerToken` token is used transiently on the kiosk server to verify/link the account, then revoked best-effort. Returning linked-card sessions no longer use a normal Magento customer token.

## Deployment order

1. Deploy and accept `0stoya/Fluid#92` first.
2. Deploy this kiosk cutover.
3. Sign out/reset any pre-existing kiosk session and establish a new session with a linked card.
4. Complete the acceptance checks below.
5. Only after the bound flow is accepted should the legacy `purpose=customer_session` exchange be disabled/removed from Fluid.

## Acceptance

A linked card should still reach the same customer/company catalogue and locker-checkout experience.

Verify:

- returning-card exchange succeeds and Magento returns a `cssks2.` envelope server-side;
- no Magento bound token or session proof appears in browser responses/storage;
- customer/company identity is unchanged;
- catalogue, search, product options and basket operations work;
- locker review and an intended test order work;
- My Account order history works;
- sign-out revokes the bound Magento session;
- wrong/missing device ID, session proof or Store header fails closed at Magento;
- the bound token alone cannot be used as a normal Magento REST/customer bearer token;
- removing the customer from the bound company or disabling the company invalidates subsequent requests.

## Remaining production-device work

The bound Magento session closes the broad customer-token exchange identified in the security review. Production Android device commissioning/signing remains a separate K4 hardening task: the TouchWo Keystore private key must sign production kiosk requests and devices must have an authorised enrollment/disable/revoke workflow.
