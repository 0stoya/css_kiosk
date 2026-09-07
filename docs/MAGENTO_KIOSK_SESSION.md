# Authenticated CSS Commerce kiosk session

This slice converts a trusted, linked NFC card into a real Magento customer session without exposing Magento bearer tokens to browser JavaScript or the Android device.

The deployed Commerce-side contract belongs to `0stoya/Fluid`, under `Css/Commerce`.

## GraphQL transport rule

All kiosk authentication and customer-session traffic to Magento uses HTTPS GraphQL.

- first-time email/password verification uses Magento's standard `generateCustomerToken` mutation;
- returning-card assertion exchange uses the CSS Commerce `css_kiosk_customer_session` mutation;
- customer/company refresh uses the authenticated `customer` + `css_company_context` query;
- logout/token invalidation uses Magento's standard `revokeCustomerToken` mutation.

There is no kiosk-specific Magento REST endpoint, no Magento Admin/integration credential in `css_kiosk`, and no dependency on another Magento repository.

RSA and ECDSA signatures authenticate trust boundaries. They do not change the transport rule: Magento communication remains GraphQL-only.

## Accepted flow

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
        ↓
Welcome / authenticated kiosk state
```

The browser receives only safe customer/company data and an expiry timestamp. The Magento token remains in server memory.

## First-time card linking

An unknown card asks for the customer's existing email/password once. `css_kiosk` sends those credentials only in a server-side GraphQL call to Magento's standard `generateCustomerToken` mutation.

The returned customer token is used server-side to read current customer/company context and create the pending NFC link. Invalid credentials fail closed with a generic login error; the password is cleared immediately after submission and is never persisted.

The card is linked only after explicit confirmation. Raw card credentials are not stored; only their SHA-256 hash is persisted.

## Magento customer ID rule

Magento 2.4.9 exposes the standard GraphQL `customer.id` as an opaque GraphQL ID rather than the numeric entity ID. For example:

```text
customer.id = Ng==
```

`Ng==` decodes to the numeric entity ID `6`, but kiosk code must not depend on decoding Magento's opaque GraphQL identifier.

The kiosk instead uses:

```text
css_company_context.customer_id
```

as the authoritative numeric Magento customer entity ID for:

- durable NFC customer linkage;
- the RS256 assertion `sub` claim;
- returning-card identity comparison.

Legacy development snapshots created before this rule are normalized on read and the durable SQLite row is repaired.

## Session properties

- fixed 15-minute hard lifetime for this slice;
- raw session ID is a random 256-bit value held only in an HttpOnly, SameSite=Strict cookie;
- server stores only a SHA-256 hash of the session ID as the map key;
- Magento bearer token exists only in server process memory;
- server restart intentionally destroys all active kiosk sessions;
- durable NFC links remain in SQLite and can establish a new session after restart;
- replacing a session revokes the previous Magento token best-effort through GraphQL;
- sign out/reset destroys the kiosk session and revokes the Magento token best-effort through GraphQL.

A later inactivity slice will add activity-driven expiry/reset. The fixed lifetime here is the hard upper bound for the initial authenticated session.

## Fresh identity and company check

The linked NFC record is an identity pointer, not an authorization cache.

After Magento issues a customer token, `css_kiosk` immediately queries Magento again for:

- current numeric customer ID through `css_company_context.customer_id`;
- current customer name/email;
- current `css_company_context`;
- current active company memberships.

The session fails closed when:

- Magento returns a different/missing customer;
- the company linked with the NFC card is no longer an active company membership;
- the CSS Commerce session exchange is unavailable;
- the signed assertion is invalid, expired or replayed.

This prevents a stale NFC snapshot from preserving company access after Magento access has changed.

## RSA assertion key

Generate the RSA key on the kiosk application host, outside the repository. The private key belongs only to `css_kiosk`; CSS Commerce receives only the public key.

Kiosk server environment:

```text
KIOSK_MAGENTO_ASSERTION_PRIVATE_KEY_PATH=/srv/css-kiosk/keys/magento-assertion-private.pem
```

Never copy the RSA private key to Fluid/Commerce, source control, browser storage, an NFC card, or the Android device.

The matching public key is configured in Magento under the CSS Commerce kiosk configuration. Production operation must not require CLI access for key rotation/enabling; Magento Admin exposes the kiosk configuration, including the public key and enable flag.

## Assertion contract

The backend signs a compact RS256 assertion with a maximum lifetime of 60 seconds.

Header:

```json
{
  "alg": "RS256",
  "typ": "JWT",
  "kid": "css-kiosk-v1"
}
```

Claims:

```json
{
  "iss": "css-kiosk",
  "aud": "css-commerce",
  "purpose": "customer_session",
  "sub": "<numeric Magento customer ID>",
  "device_id": "<trusted kiosk device ID>",
  "jti": "<random single-use ID>",
  "iat": 1788768000,
  "exp": 1788768060
}
```

The `jti` is new for every exchange. `Css/Commerce` persists consumed `jti` values long enough to reject assertion replay.

Commerce defaults/configuration accepted in the live environment:

```text
enabled  = 1
issuer   = css-kiosk
audience = css-commerce
key id   = css-kiosk-v1
max ttl  = 60
skew     = 15
```

The configured Magento public-key fingerprint matched the public key derived from the kiosk RSA private key during acceptance.

## Live runtime acceptance — 7 Sep 2026

Accepted against the live Magento environment with the deployed `0stoya/Fluid/Css/Commerce` GraphQL contract:

1. simulator reports the kiosk device as trusted;
2. linked card is resolved from durable hashed NFC storage;
3. kiosk signs a fresh one-use RS256 assertion with numeric Magento customer ID;
4. `css_kiosk_customer_session` accepts the assertion and issues a Magento customer token server-side;
5. `customer` + `css_company_context` are re-read over GraphQL;
6. kiosk reaches Welcome without asking for the password again;
7. accepted identity displayed:

```text
Welcome, Chris
Greener Ealing Ltd
chris@ostoya.io
Account EAL001
```

8. Magento bearer token remains server-side; browser authentication is the opaque HttpOnly `css_kiosk_session` cookie.

The acceptance process also verified:

- RSA private key is a valid standard RSA key and readable by the kiosk process;
- Magento GraphQL endpoint is reachable;
- Magento public key matches the kiosk key pair;
- Magento issuer/audience/key ID/TTL/skew match the kiosk assertion contract;
- actual Magento `KioskAssertionVerifier` accepts a fresh signed assertion;
- the prior `customer.id = Ng==` failure was caused by using the opaque GraphQL ID as assertion `sub` and is corrected by the numeric customer-ID rule above.

## Next slice: authenticated catalogue

The kiosk session is already authenticated. The next slice must make `Continue` use that existing server-side session for catalogue/customer requests.

Requirements:

- browser sends only the opaque `css_kiosk_session` cookie;
- server resolves the session and uses the associated Magento token for GraphQL calls;
- Magento bearer token remains absent from browser-visible responses/storage;
- customer/company context remains enforced for catalogue visibility/pricing;
- missing/expired session returns safely to NFC authentication;
- sign out remains available throughout the authenticated catalogue journey.
