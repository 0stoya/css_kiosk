# Authenticated CSS Commerce kiosk session

This slice converts a trusted, linked NFC card into a real Magento customer session without exposing Magento bearer tokens to browser JavaScript or the Android device.

The deployed Commerce-side contract belongs to `0stoya/Fluid`, under `Css/Commerce`.

## GraphQL transport rule

All kiosk authentication traffic to Magento uses GraphQL.

- first-time email/password verification uses Magento's standard `generateCustomerToken` mutation;
- returning-card assertion exchange uses the CSS Commerce `css_kiosk_customer_session` mutation;
- customer/company refresh uses the authenticated `customer` + `css_company_context` query;
- logout/token invalidation uses Magento's standard `revokeCustomerToken` mutation.

There is no kiosk-specific Magento REST endpoint and no Magento Admin/integration credential in `css_kiosk`.

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
CSS Commerce GraphQL css_kiosk_customer_session
        ↓
Css/Commerce verifies assertion + replay ID
        ↓
Magento issues standard customer token
        ↓
css_kiosk GraphQL query: customer + css_company_context
        ↓
customer/company still matches linked NFC context?
        ↓ yes
short-lived opaque css_kiosk session cookie
```

The browser receives only safe customer/company data and an expiry timestamp. The Magento token remains in server memory.

## First-time card linking

An unknown card asks for the customer's existing email/password once. `css_kiosk` sends those credentials only in a server-side GraphQL call to Magento's standard `generateCustomerToken` mutation.

The returned customer token is used server-side to read current customer/company context and create the pending NFC link. Invalid credentials fail closed with a generic login error; the password is cleared immediately after submission and is never persisted.

## Session properties

- fixed 15-minute lifetime for this slice;
- raw session ID is a random 256-bit value held only in an HttpOnly, SameSite=Strict cookie;
- server stores only a SHA-256 hash of the session ID as the map key;
- Magento bearer token exists only in server process memory;
- server restart intentionally destroys all active kiosk sessions;
- durable NFC links remain in SQLite and can establish a new session after restart;
- replacing a session revokes the previous Magento token best-effort through GraphQL;
- sign out/reset destroys the kiosk session and revokes the Magento token best-effort through GraphQL.

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
- the CSS Commerce session exchange is unavailable.

This prevents a stale NFC snapshot from preserving company access after Magento access has changed.

## RSA assertion key

Generate the RSA key on the kiosk application host, outside the repository. The private key belongs only to `css_kiosk`; CSS Commerce receives only the public key.

Configure kiosk server environment:

```text
KIOSK_MAGENTO_ASSERTION_PRIVATE_KEY_PATH=/srv/css-kiosk/keys/magento-assertion-private.pem
```

Never copy the RSA private key to Fluid/Commerce, source control, browser storage, an NFC card, or the Android device.

## Assertion contract

The backend signs a compact RS256 assertion with a maximum lifetime of 60 seconds:

```json
{
  "iss": "css-kiosk",
  "aud": "css-commerce",
  "purpose": "customer_session",
  "sub": "<Magento customer ID>",
  "device_id": "<trusted kiosk device ID>",
  "jti": "<random single-use ID>",
  "iat": 1788768000,
  "exp": 1788768060
}
```

The `jti` is new for every exchange. `Css/Commerce` persists consumed `jti` values long enough to reject assertion replay.

## Runtime acceptance

With the matching `Fluid/Css/Commerce` GraphQL contract deployed/configured and this kiosk branch running:

1. simulator reports `Device trust: Trusted`;
2. unknown-card login uses `generateCustomerToken` and still resolves the correct CSS customer/company;
3. present an already-linked real NFC fixture;
4. `css_kiosk_customer_session` issues a fresh customer token server-side;
5. current Magento customer/company is re-read over GraphQL;
6. kiosk reaches Welcome without password;
7. browser receives `css_kiosk_session` as HttpOnly cookie only;
8. reset/sign out clears that cookie and revokes the Magento customer token through GraphQL best-effort;
9. presenting the same linked card again creates a new authenticated session;
10. restarting the kiosk server destroys the old session but does not remove the card link.

The standard Magento customer token itself may outlive the kiosk session; that is why logout/replacement performs server-side token revocation and the bearer token is never exposed to the browser.
