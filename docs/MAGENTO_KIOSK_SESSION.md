# Authenticated Magento kiosk session

This slice converts a trusted, linked NFC card into a real Magento customer session without exposing Magento bearer tokens to browser JavaScript or the Android device.

It depends on the matching Magento customer-session exchange contract in `0stoya/Magento` PR #142.

## Flow

```text
Android/simulator device signature
        ↓
css_kiosk verifies trusted device + nonce
        ↓
server resolves hashed NFC credential
        ↓
server signs one-use RS256 customer_session assertion
        ↓
Magento verifies assertion + replay ID
        ↓
Magento issues standard customer token
        ↓
css_kiosk queries current customer + css_company_context
        ↓
customer/company still matches linked NFC context?
        ↓ yes
short-lived opaque css_kiosk session cookie
```

The browser receives only safe customer/company data and an expiry timestamp. The Magento token remains in server memory.

## Session properties

- fixed 15-minute lifetime for this slice;
- raw session ID is a random 256-bit value held only in an HttpOnly, SameSite=Strict cookie;
- server stores only a SHA-256 hash of the session ID as the map key;
- Magento bearer token exists only in server process memory;
- server restart intentionally destroys all active kiosk sessions;
- durable NFC links remain in SQLite and can establish a new session after restart;
- replacing a session revokes the previous Magento token best-effort;
- sign out/reset destroys the kiosk session and revokes the Magento token best-effort.

A later inactivity slice will add activity-driven expiry/reset. The fixed lifetime here is the hard upper bound for the initial authenticated session.

## Fresh identity check

The linked NFC record is an identity pointer, not an authorization cache.

After Magento issues a customer token, `css_kiosk` immediately queries Magento again for:

- current customer ID/name/email;
- current `css_company_context`;
- current active company memberships.

The session fails closed when:

- Magento returns a different/missing customer;
- the company linked with the NFC card is no longer an active company membership;
- Magento/session exchange is unavailable.

This prevents a stale NFC snapshot from preserving company access after Magento access has changed.

## RSA assertion key

Generate the RSA key on the kiosk application host, outside the repository:

```bash
sudo install -d -m 0700 /srv/css-kiosk/keys
sudo openssl genpkey \
  -algorithm RSA \
  -pkeyopt rsa_keygen_bits:3072 \
  -out /srv/css-kiosk/keys/magento-assertion-private.pem
sudo chmod 600 /srv/css-kiosk/keys/magento-assertion-private.pem
sudo openssl pkey \
  -in /srv/css-kiosk/keys/magento-assertion-private.pem \
  -pubout \
  -out /tmp/css-kiosk-magento-assertion-public.pem
```

Configure kiosk server environment:

```text
KIOSK_MAGENTO_ASSERTION_PRIVATE_KEY_PATH=/srv/css-kiosk/keys/magento-assertion-private.pem
```

Only the public PEM is copied/configured on Magento. Never copy the RSA private key to Magento, source control, browser storage, an NFC card, or the Android device.

## Assertion contract

The backend signs a compact RS256 assertion with a maximum lifetime of 60 seconds:

```json
{
  "iss": "css-kiosk",
  "aud": "css-magento",
  "purpose": "customer_session",
  "sub": "<Magento customer ID>",
  "device_id": "<trusted kiosk device ID>",
  "jti": "<random single-use ID>",
  "iat": 1788768000,
  "exp": 1788768060
}
```

The `jti` is new for every exchange. Magento persists consumed `jti` values long enough to reject assertion replay.

## Runtime acceptance

With Magento PR #142 deployed/configured and this kiosk branch running:

1. simulator reports `Device trust: Trusted`;
2. present an already-linked real NFC fixture;
3. Magento exchange issues a fresh customer token server-side;
4. current Magento customer/company is re-read;
5. kiosk reaches Welcome without password;
6. browser receives `css_kiosk_session` as HttpOnly cookie only;
7. reset/sign out clears that cookie and revokes the Magento customer token best-effort;
8. presenting the same linked card again creates a new authenticated session;
9. restarting the kiosk server destroys the old session but does not remove the card link.

The standard Magento customer token itself may outlive the kiosk session; that is why logout/replacement performs server-side token revocation and the bearer token is never exposed to the browser.
