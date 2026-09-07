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
- [x] real CSS logo used across kiosk auth states
- [x] NFC authentication state model
- [x] development-only NFC reader simulator behind the `NfcReader` boundary
- [x] deterministic hardware fixtures: ready / unavailable / registered / unknown / revoked / read error
- [x] deterministic Magento-auth fixtures: success / invalid credentials / unavailable
- [x] passive NFC target: card reads arrive as external reader events, not screen taps
- [x] unknown-card email/password linking journey prototype
- [x] explicit account-link confirmation before assigning the card
- [x] signed-in welcome and sign-out reset
- [x] simulator documented in `docs/SIMULATOR.md`
- [x] real Magento customer-token + authenticated customer/company lookup implemented server-side
- [x] real Magento customer authentication accepted against the live environment
- [x] server-side hashed NFC credential persistence + five-minute pending card-link proof implemented
- [ ] accept a real Magento account link against the persistent simulated card and confirm it survives restart
- [ ] define kiosk device registration and trust model
- [ ] define trusted kiosk-to-Magento authenticated session exchange for subsequent card taps
- [ ] implement inactivity session reset
- [ ] implement offline / degraded-network state
- [ ] inspect TouchWo GD238C Android version, SoC, NFC hardware/API and browser/WebView capabilities

### K0 acceptance

- Runs at portrait 1080 x 1920 without horizontal scrolling.
- All customer actions are comfortably touchable.
- Known-card and unknown-card journeys can be exercised without physical NFC hardware.
- Reader unavailable, card read error, invalid Magento credentials and Magento service outage all fail closed in the simulator.
- Prototype controls are unavailable in a production build.
- Production cannot create a fake NFC read or accept simulated Magento authentication.
- Real Magento verification returns only safe customer/company data to the browser; the customer token is not returned or persisted client-side.
- Raw NFC credentials are not stored; only a SHA-256 credential hash is persisted server-side.
- Pending card links are short-lived, HttpOnly-bound and require explicit confirmation.
- A linked card cannot silently move to another customer account.
- No password, Magento token or reusable customer credential is persisted client-side.

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
