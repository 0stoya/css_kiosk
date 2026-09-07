# CSS Kiosk Roadmap

Updated: 7 Sep 2026

## Product intent

Build a portrait, Android-first trade-counter kiosk for the TouchWo GD238C. Customers authenticate primarily by tapping an NFC card. If the card is unknown, the kiosk asks for the customer's existing Magento email/password once, verifies the account, and links the NFC credential for future taps.

## K0 — device and authentication foundation

Status: in progress

- [x] standalone `css_kiosk` repository
- [x] Next.js / React / TypeScript baseline aligned with CSS Admin runtime versions
- [x] 1080 x 1920 portrait-first touch shell
- [x] CSS brand tokens and touch-sized controls
- [x] NFC authentication state model
- [x] mock card scenarios: registered / unregistered / revoked
- [x] unknown-card email/password linking journey prototype
- [x] explicit account-link confirmation before assigning the card
- [x] signed-in welcome and sign-out reset
- [ ] generate and commit dependency lockfile after first local install
- [ ] connect real Magento customer authentication
- [ ] define server-side NFC credential persistence
- [ ] define kiosk device registration and trust model
- [ ] implement inactivity session reset
- [ ] implement offline / degraded-network state
- [ ] inspect TouchWo GD238C Android version, SoC, NFC hardware/API and browser/WebView capabilities

### K0 acceptance

- Runs at portrait 1080 x 1920 without horizontal scrolling.
- All customer actions are comfortably touchable.
- Known-card and unknown-card journeys can be exercised without physical NFC hardware.
- Prototype controls are unavailable in a production build.
- No password, Magento token or reusable customer credential is persisted client-side.
- Card linking requires successful Magento authentication and an explicit confirmation step once backend work begins.

## K1 — authenticated customer home

- customer/company context
- company branding/context where appropriate
- trade catalogue entry
- search
- category navigation
- favourites / common purchases foundation
- clear signed-in identity and sign-out

## K2 — catalogue and basket

- product search and filtering
- company product visibility
- customer/company pricing
- stock/availability presentation
- touch-first product detail
- basket
- quantity controls suitable for gloves/touchscreen use

## K3 — checkout / trade-counter handoff

Exact scope to be agreed after Magento order and counter workflows are inspected.

## K4 — Android kiosk shell

- boot on power
- immersive portrait fullscreen
- keep-awake policy
- native NFC bridge
- connectivity monitoring
- watchdog / recovery
- remote version visibility
- secure device identity

## K5 — production serving

- `kiosk.csscdn.co.uk`
- dedicated runtime identity
- loopback-only application listener
- PM2/systemd persistence
- nginx HTTPS boundary
- logs / rotation / runbook
- reboot acceptance

## Security rules

1. Never store a customer's Magento password.
2. Never write a Magento access token onto an NFC card.
3. Prefer a random opaque NFC credential; store only its hash server-side.
4. Card UID support is a fallback pending hardware inspection.
5. A linked card cannot silently move to another customer account.
6. Lost/revoked cards fail closed.
7. Kiosk sessions are short-lived and reset automatically on inactivity.
8. The kiosk device must never contain Magento Admin credentials.
9. Production NFC trust decisions belong to the server, not browser state.
