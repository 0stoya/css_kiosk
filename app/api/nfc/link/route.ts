import { NextResponse } from "next/server";
import {
  AuthenticatedKioskSessionError,
  establishAuthenticatedKioskSession,
} from "@/lib/kiosk/authenticated-session";
import {
  cancelPendingNfcLink,
  confirmPendingNfcLink,
  NfcCredentialStoreError,
} from "@/lib/kiosk/credential-store";
import {
  KioskDeviceRequestError,
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
  try {
    device = await verifyTrustedRequest(request);
  } catch (error) {
    return deviceFailure(error);
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

    const authenticated = await establishAuthenticatedKioskSession({
      deviceId: device.deviceId,
      linkedCustomer,
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
