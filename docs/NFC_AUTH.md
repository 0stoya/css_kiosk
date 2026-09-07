# NFC authentication design

## Customer journey

### Registered card

1. Customer taps NFC card.
2. Android/native bridge supplies an opaque card credential to the kiosk web application.
3. Kiosk backend validates the device and credential.
4. Backend resolves the linked Magento customer/company.
5. Backend creates a short-lived kiosk session.
6. Customer enters the authenticated kiosk workspace.

### Unregistered card

1. Customer taps an unknown NFC card.
2. Kiosk explains that the card is not registered.
3. Customer enters Magento customer email/password.
4. Server authenticates those credentials against Magento.
5. If authentication succeeds, kiosk displays the resolved customer/company and asks for explicit confirmation.
6. On confirmation, server links the NFC credential to that Magento customer.
7. Password is discarded and a short-lived kiosk session is created.
8. Future taps use the NFC relationship and do not require the password.

### Already assigned / revoked card

The kiosk must fail closed. A card cannot be silently reassigned by entering a different customer's password. Reassignment belongs to an authorised staff/Admin workflow.

## Trust boundaries

### Android shell

Responsibilities:

- read NFC hardware
- provide a stable bridge event to the web app
- maintain immersive kiosk mode
- expose device identity material through a controlled interface

It must not contain Magento Admin credentials or customer passwords.

### Kiosk web application

Responsibilities:

- customer-facing state machine and UX
- submit credentials to same-origin kiosk backend over HTTPS
- hold only short-lived session state
- clear all customer state on sign-out / timeout

### Server/backend

Responsibilities:

- validate registered kiosk device
- hash/resolve NFC credential
- authenticate Magento customer credentials
- verify customer/company eligibility
- create/revoke NFC relationships
- create short-lived kiosk sessions
- rate-limit failed registration attempts
- audit card registration, use and revocation

## Proposed records

```text
KioskDevice
  id
  name
  deviceKeyHash
  enabled
  lastSeenAt

NfcCredential
  id
  customerId
  companyId
  credentialHash
  credentialType      secure-token | uid
  label
  enabled
  issuedAt
  revokedAt
  lastUsedAt

KioskSession
  id
  kioskDeviceId
  customerId
  companyId
  expiresAt
  lastActivityAt

KioskAudit
  id
  kioskDeviceId
  customerId?
  nfcCredentialId?
  action
  result
  createdAt
```

Do not enforce one-card-per-customer in the persistence model. Multiple active cards may become useful later. A single physical credential, however, may have at most one active customer assignment.

## Credential material

Preferred after hardware inspection:

- writable NDEF-compatible card
- cryptographically random 256-bit opaque credential
- server stores `SHA-256(credential)` only

Fallback:

- hardware/card UID if that is all the TouchWo reader exposes
- treat UID authentication as lower assurance and document cloning risk

The web application consumes a common abstraction regardless of hardware:

```ts
type NfcCredential = {
  type: "secure-token" | "uid";
  value: string;
};
```

## Proposed server operations

Names are placeholders until the Magento/Fluid schema is inspected.

```graphql
mutation KioskNfcLogin($credential: String!, $deviceId: String!) {
  kioskNfcLogin(credential: $credential, deviceId: $deviceId) {
    sessionToken
    expiresAt
    customer {
      id
      firstname
      lastname
      email
      companyId
    }
  }
}

mutation LinkKioskNfcCard(
  $credential: String!
  $deviceId: String!
  $email: String!
  $password: String!
) {
  linkKioskNfcCard(
    credential: $credential
    deviceId: $deviceId
    email: $email
    password: $password
  ) {
    linkChallenge
    customer {
      id
      firstname
      lastname
      email
      companyId
    }
  }
}
```

The final link should require confirmation against a short-lived `linkChallenge`, so simply validating email/password does not immediately assign the physical card.

## Public-kiosk protections

- never log email/password payloads
- never persist password in localStorage/sessionStorage/IndexedDB
- clear form values after submission/abort
- disable password-manager/autofill where the Android WebView permits it
- rate-limit failures by device + NFC credential + account identity
- short registration-screen inactivity timeout
- short authenticated inactivity timeout
- clear basket/customer state when session ends unless product requirements explicitly preserve anonymous basket state
- avoid customer PII on the idle screen
- hide all prototype/debug controls in production builds
