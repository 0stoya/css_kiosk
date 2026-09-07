import { NextResponse } from "next/server";
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
  try {
    await verifyTrustedRequest(request);
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
    const customer = confirmPendingNfcLink(proof);
    await clearPendingLinkProof();
    return NextResponse.json({ ok: true, customer });
  } catch (error) {
    await clearPendingLinkProof();

    if (error instanceof NfcCredentialStoreError) {
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
  try {
    await verifyTrustedRequest(request);
  } catch (error) {
    return deviceFailure(error);
  }

  const proof = await getPendingLinkProof();

  try {
    if (proof) cancelPendingNfcLink(proof);
  } finally {
    await clearPendingLinkProof();
  }

  return NextResponse.json({ ok: true });
}
