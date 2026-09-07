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

## Backend boundary

Until the real kiosk authentication API is connected, the simulator also controls the expected Magento verification result for the unknown-card registration flow:

- Success
- Invalid credentials
- Service unavailable

A successful simulated login can continue to the explicit `Link this card?` confirmation state. Invalid credentials remain on the registration form and service failure fails closed.

## Production rule

The simulator controls are rendered only when `NODE_ENV !== "production"`.

The production build must not:

- create a simulated card read from a screen tap;
- accept simulated Magento authentication;
- create a simulated NFC link.

Until the real Android reader and real backend authentication are connected, those production paths fail closed.

## Manual acceptance matrix

Run `yarn dev` and exercise:

| Reader | Card | Magento | Expected result |
| --- | --- | --- | --- |
| Ready | Registered | n/a | Welcome |
| Ready | Unknown | Success | Login -> account found -> link confirmation -> welcome |
| Ready | Unknown | Invalid credentials | Registration form error |
| Ready | Unknown | Service unavailable | Fail-closed error screen |
| Ready | Revoked | n/a | Fail-closed revoked-card error |
| Ready | Read error | n/a | Fail-closed read error |
| Unavailable | Any | n/a | Reader-unavailable error |

Also validate the 1080 x 1920 portrait viewport and confirm no horizontal overflow.

## Hardware handoff

When the TouchWo is available, inspect Android version, NFC hardware/API and card technology. Implement the native bridge behind `NfcReader`; do not redesign the customer state machine around vendor-specific reader details.
