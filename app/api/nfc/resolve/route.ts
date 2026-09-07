import { NextResponse } from "next/server";
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

  try {
    ({ payload } = await readTrustedJsonRequest<{ credential?: unknown }>(request));
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
    if (stored.status !== "unregistered") {
      return NextResponse.json({ ok: true, ...stored });
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

    return NextResponse.json(
      { ok: false, code: "STORE_UNAVAILABLE", error: "Card lookup is unavailable right now." },
      { status: 503 },
    );
  }
}
