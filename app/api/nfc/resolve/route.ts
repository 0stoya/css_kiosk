import { NextResponse } from "next/server";
import {
  AuthenticatedKioskSessionError,
  establishAuthenticatedKioskSession,
} from "@/lib/kiosk/authenticated-session";
import {
  NfcCredentialStoreError,
  parseNfcCredential,
  resolveNfcCredential,
} from "@/lib/kiosk/credential-store";
import {
  KioskDeviceRequestError,
  readTrustedJsonRequest,
} from "@/lib/kiosk/device-request";
import { resolveDevelopmentFixture } from "@/lib/kiosk/development-fixtures";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let payload: { credential?: unknown };
  let device;

  try {
    ({ payload, device } = await readTrustedJsonRequest<{ credential?: unknown }>(request));
  } catch (error) {
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

  const credential = parseNfcCredential(payload.credential);
  if (!credential) {
    return NextResponse.json({ ok: false, error: "Invalid NFC credential." }, { status: 400 });
  }

  try {
    const stored = resolveNfcCredential(credential);

    if (stored.status === "registered") {
      const authenticated = await establishAuthenticatedKioskSession({
        deviceId: device.deviceId,
        linkedCustomer: stored.customer,
      });

      return NextResponse.json({
        ok: true,
        status: "registered",
        customer: authenticated.customer,
        session: authenticated.session,
      });
    }

    if (stored.status === "revoked") {
      return NextResponse.json({ ok: true, status: "revoked" });
    }

    const fixture = resolveDevelopmentFixture(credential);
    if (fixture) {
      return NextResponse.json({ ok: true, ...fixture });
    }

    return NextResponse.json({ ok: true, status: "unregistered" });
  } catch (error) {
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
      { ok: false, code: "STORE_UNAVAILABLE", error: "Card lookup is unavailable right now." },
      { status: 503 },
    );
  }
}
