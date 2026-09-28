# NEXT ARGO webhook inbox

CSS Kiosk accepts NEXT ARGO machine events at:

```text
POST /api/argo/events
```

This endpoint is server-to-server only. It does not use a kiosk browser session or
trusted-device signature.

## Security contract

NEXT ARGO sends:

- `X-Argo-Signature`: HMAC-SHA256 of the **raw request body**, encoded as 64 hex characters.
- `X-Argo-Event-Id`: stable unique delivery/event identifier.

The kiosk verifies the HMAC against `ARGO_WEBHOOK_SECRET` **before JSON parsing**.
Re-serialising JSON before verification is deliberately not supported because it
changes the signed bytes.

Generate a shared secret with:

```bash
openssl rand -hex 32
```

Store it only on the kiosk server:

```text
ARGO_WEBHOOK_SECRET=<shared secret>
```

Send the same value to NEXT ARGO through a separate secure channel.

## Durable receipt and retries

A valid signed delivery is written to the same SQLite database configured by
`KIOSK_DB_PATH`, in `argo_webhook_events`, before a 2xx response is returned.

`event_id` is the primary key. A retry with the same event ID and exact same body:

- returns 2xx again;
- increments `delivery_count`;
- does not create a second event.

If the same event ID is delivered with different body bytes, the endpoint returns
409 and preserves the original record.

The inbox stores the original body, SHA-256 hash, receive timestamps and a small
set of indexable fields when present. The raw body remains the authoritative
provider payload.

## Event processing

NEXT ARGO currently documents:

- `cart.loaded`: the loader placed the cart in a compartment and closed the door;
  this is the ready-for-collection signal.
- `cart.withdrawn`: collection completed; `request_key` may be null when the cart
  was collected directly at the machine.

Events can arrive more than once and are not strictly ordered. Downstream order
state must therefore:

1. deduplicate by event ID;
2. sequence by provider `occurred_at`, not HTTP arrival time;
3. tolerate `cart.withdrawn` without a kiosk withdrawal request key.

The first implementation is intentionally a durable inbox only. Order/fulfilment
state processing will be wired to the order bridge separately, so webhook receipt
is not coupled to Magento/OGL processing availability.

## Response behaviour

- `200`: event safely stored, or an exact duplicate was already stored.
- `400`: malformed headers/body.
- `401`: invalid HMAC signature.
- `409`: event ID mismatch/conflict.
- `413`: body exceeds 256 KiB.
- `503`: webhook secret or durable storage unavailable.

NEXT ARGO retries non-2xx responses, so operational failures intentionally return
non-2xx rather than acknowledging an event that was not durably stored.
