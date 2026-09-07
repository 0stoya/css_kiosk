import { NextResponse } from "next/server";
import {
  MagentoCustomerAuthError,
  requestMagentoCustomerToken,
} from "@/lib/magento/customer-auth";
import { getVerifiedKioskCustomer } from "@/lib/magento/customer-context";

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  let payload: { email?: unknown; password?: unknown };

  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid login request." }, { status: 400 });
  }

  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const password = typeof payload.password === "string" ? payload.password : "";

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

  try {
    const token = await requestMagentoCustomerToken(email, password);
    const customer = await getVerifiedKioskCustomer(token);

    return NextResponse.json({ ok: true, customer });
  } catch (error) {
    if (error instanceof MagentoCustomerAuthError) {
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
