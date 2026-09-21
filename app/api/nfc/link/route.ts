import { NextResponse } from "next/server";
import {
  AuthenticatedKioskSessionError,
  establishAuthenticatedKioskSession,
} from "@/lib/kiosk/authenticated-session";
import {
  cancelPendingNfcLink,
  confirmPendingNfcLink,
  NfcCredentialStoreError,
  parseNfcCredential,
  resolveNfcCredential,
} from "@/lib/kiosk/credential-store";
import {
  KioskDeviceRequestError,
  readTrustedJsonRequest,
  verifyTrustedRequest,
} from "@/lib/kiosk/device-request";
import {
  clearPendingLinkProof,
  getPendingLinkProof,
} from "@/lib/kiosk/pending-link-cookie";
import {
  clearKioskSessionId,
  getKioskSessionId,
} from "@/lib/kiosk/session-cookie";
import { destroyKioskSession } from "@/lib/kiosk/session-store";
import { revokeMagentoCustomerToken } from "@/lib/magento/revoke-customer-token";

export const runtime = "nodejs";

function deviceFailure(error: unknown) {
  if (error instanceof KioskDeviceRequestError) {
    return NextResponse.json(
      { ok: false, code: error.code, error: error.message },
      { status: error.status },
    );
  }

  return NextResponse.json(
    { ok: false, code: "DEVICE_UNAVAILABLE", error: "Kiosk device validation is unavailable." },
    { status: 503 },
  );
}

export async function POST(request: Request) {
  let device;
  let payload: { credential?: unknown };
  try {
    const trusted = await readTrustedJsonRequest<{ credential?: unknown }>(request);
    device = trusted.device;
    payload = trusted.payload;
  } catch (error) {
    return deviceFailure(error);
  }

  const credential = parseNfcCredential(payload.credential);
  if (!credential) {
    return NextResponse.json(
      { ok: false, code: "INVALID_CREDENTIAL", error: "Tap the RFID again before linking it." },
      { status: 400 },
    );
  }

  const proof = await getPendingLinkProof();
  if (!proof) {
    return NextResponse.json(
      { ok: false, error: "No pending card link was found. Tap the card and sign in again." },
      { status: 409 },
    );
  }

  try {
    const linkedCustomer = confirmPendingNfcLink(proof);
    await clearPendingLinkProof();

    const resolved = resolveNfcCredential(credential);
    if (
      resolved.status !== "registered" ||
      resolved.customer.customerId !== linkedCustomer.customerId
    ) {
      return NextResponse.json(
        {
          ok: false,
          code: "CARD_LINK_MISMATCH",
          error: "The RFID presented for linking does not match the verified customer account.",
        },
        { status: 409 },
      );
    }

    const authenticated = await establishAuthenticatedKioskSession({
      deviceId: device.deviceId,
      linkedCustomer,
      rfidBadge:
        credential.type === "uid" && /^\d{1,20}$/.test(credential.value)
          ? credential.value
          : null,
    });

    return NextResponse.json({
      ok: true,
      customer: authenticated.customer,
      session: authenticated.session,
    });
  } catch (error) {
    await clearPendingLinkProof();

    if (error instanceof NfcCredentialStoreError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status },
      );
    }

    if (error instanceof AuthenticatedKioskSessionError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { ok: false, code: "STORE_UNAVAILABLE", error: "Card linking is unavailable right now." },
      { status: 503 },
    );
  }
}

export async function DELETE(request: Request) {
  let device;
  try {
    device = await verifyTrustedRequest(request);
  } catch (error) {
    return deviceFailure(error);
  }

  const proof = await getPendingLinkProof();
  const sessionId = await getKioskSessionId();

  try {
    if (proof) cancelPendingNfcLink(proof);

    const session = sessionId ? destroyKioskSession(sessionId, device.deviceId) : null;
    if (session) {
      await revokeMagentoCustomerToken(session.magentoToken).catch(() => false);
    }
  } finally {
    await clearPendingLinkProof();
    await clearKioskSessionId();
  }

  return NextResponse.json({ ok: true });
}
