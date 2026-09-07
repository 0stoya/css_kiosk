# CSS Kiosk

Customer-facing trade-counter kiosk for Chelmsford Safety Supplies.

## Product boundary

- Target hardware: TouchWo GD238C
- Target platform: Android
- Primary orientation: portrait
- Primary design canvas: 1080 x 1920
- Public kiosk URL: `https://kiosk.csscdn.co.uk` (planned)
- Customer authentication: NFC-first, with Magento email/password used once to link an unregistered card
- Admin and kiosk remain separate applications and security boundaries

## Current foundation

K0 provides a touch-first authentication prototype that can be developed before the physical kiosk is available:

- registered NFC card journey
- unregistered card → Magento email/password → explicit card-link confirmation
- revoked-card failure state
- signed-in welcome/sign-out
- development-only NFC simulator
- Android/native NFC reader interface for later hardware integration

The current email/password check is deliberately a prototype state transition only. It does not claim to authenticate Magento until the real server-side contract is added.

See `ROADMAP.md` and `docs/NFC_AUTH.md` for the delivery and security boundaries.

## Local development

Requires Node 22 or newer and Yarn 1.x.

```bash
yarn install
yarn dev
```

Then open `http://localhost:3000` and use the **Prototype NFC** panel to switch between Unknown, Registered and Revoked card scenarios.

The first local install should commit the generated `yarn.lock` before K0 is merged.

## Validation

```bash
yarn lint
yarn typecheck
yarn build
```

A production build hides the prototype controls and disables simulated NFC taps; real production input will come only from the Android reader bridge.
