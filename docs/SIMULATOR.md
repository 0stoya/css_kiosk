# Kiosk simulator

The development simulator exists so the customer journey can be built and accepted before the TouchWo GD238C is physically available.

It is intentionally split into two boundaries.

## Hardware boundary

The browser UI consumes the same `NfcReader` interface that the future Android wrapper will implement.

Development uses `lib/kiosk/simulator.ts` to emit deterministic reader events. The main NFC target is passive; presenting a simulated card from the developer panel represents holding a physical card near the real reader.

Hardware fixtures:

- Reader `Ready`
- Reader `Unavailable`
- Registered card
- Unknown card
- Revoked card
- Card read error

The simulated cards emit opaque `secure-token` credentials. The UI does not depend on a card UID or NDEF payload format.

## Magento authentication boundary

The simulator can now run the unknown-card email/password step in two ways:

- `Real Magento` — POST the entered credentials to the kiosk server route, authenticate against Magento's customer-token endpoint, then load the authenticated customer and `css_company_context` through GraphQL;
- deterministic fixtures — `Success`, `Invalid credentials`, or `Service unavailable` for repeatable UI/failure-state testing.

The real-auth route returns only a safe customer/company summary. It does not return the Magento customer token to the browser and does not persist the submitted password.

Card persistence is still simulated in development. A successful real Magento verification can therefore reach the explicit `Link this card?` confirmation screen, but production card linking remains fail-closed until the server-side NFC persistence slice is implemented.

## Production rule

The simulator controls are rendered only when `NODE_ENV !== "production"`.

The production build must not:

- create a simulated card read from a screen tap;
- accept simulated Magento authentication;
- create a simulated NFC link.

Real Magento customer verification is a server capability and is allowed in production. Actual NFC linking is not enabled until a real server-side card-link proof/persistence mechanism exists.

## Manual acceptance matrix

Run `yarn dev` and exercise:

| Reader | Card | Magento | Expected result |
| --- | --- | --- | --- |
| Ready | Registered | n/a | Welcome |
| Ready | Unknown | Real Magento + valid account | Real customer/company shown on link confirmation |
| Ready | Unknown | Real Magento + invalid password | Registration form error |
| Ready | Unknown | Fixture: success | Mock account found -> link confirmation -> welcome |
| Ready | Unknown | Fixture: invalid credentials | Registration form error |
| Ready | Unknown | Fixture: service unavailable | Fail-closed error screen |
| Ready | Revoked | n/a | Fail-closed revoked-card error |
| Ready | Read error | n/a | Fail-closed read error |
| Unavailable | Any | n/a | Reader-unavailable error |

Also validate the 1080 x 1920 portrait viewport and confirm no horizontal overflow.

## Real Magento configuration

Copy the endpoint values from the accepted CSS Admin environment into a local kiosk environment file without committing secrets:

```bash
cp .env.example .env.local
```

Required names:

```text
MAGENTO_BASE_URL
MAGENTO_STORE_CODE
```

Optional overrides:

```text
MAGENTO_GRAPHQL_URL
MAGENTO_CUSTOMER_TOKEN_URL
```

Do not add Magento Admin credentials to the kiosk environment.

## Hardware handoff

When the TouchWo is available, inspect Android version, NFC hardware/API and card technology. Implement the native bridge behind `NfcReader`; do not redesign the customer state machine around vendor-specific reader details.
