import { NextResponse } from "next/server";
import {
  createPendingNfcLink,
  NfcCredentialStoreError,
  parseNfcCredential,
} from "@/lib/kiosk/credential-store";
import { setPendingLinkProof } from "@/lib/kiosk/pending-link-cookie";
import {
  MagentoCustomerAuthError,
  requestMagentoCustomerToken,
} from "@/lib/magento/customer-auth";
import { getVerifiedKioskCustomer } from "@/lib/magento/customer-context";

export const runtime = "nodejs";

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  let payload: { email?: unknown; password?: unknown; credential?: unknown };

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid login request." }, { status: 400 });
  }

  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  const credential = parseNfcCredential(payload.credential);

  if (!email || !password) {
    return NextResponse.json(
      { ok: false, error: "Email address and password are required." },
      { status: 400 },
    );
  }

  if (!isEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid email address." },
      { status: 400 },
    );
  }

  if (!credential) {
    return NextResponse.json(
      { ok: false, error: "Tap the card again before signing in." },
      { status: 400 },
    );
  }

  try {
    const token = await requestMagentoCustomerToken(email, password);
    const customer = await getVerifiedKioskCustomer(token);
    const pendingProof = createPendingNfcLink(credential, customer);
    await setPendingLinkProof(pendingProof);

    return NextResponse.json({ ok: true, customer });
  } catch (error) {
    if (error instanceof MagentoCustomerAuthError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status },
      );
    }

    if (error instanceof NfcCredentialStoreError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { ok: false, code: "SERVICE_UNAVAILABLE", error: "Customer sign in is unavailable right now." },
      { status: 503 },
    );
  }
}
