import { NextResponse } from "next/server";
import {
  KioskDeviceRequestError,
  readTrustedJsonRequest,
} from "@/lib/kiosk/device-request";
import { getKioskSessionId } from "@/lib/kiosk/session-cookie";
import { getKioskSession } from "@/lib/kiosk/session-store";
import {
  MagentoLockerCheckoutError,
  prepareAuthenticatedLockerCheckout,
} from "@/lib/magento/locker-checkout";
import {
  MagentoLockerOrderError,
  submitAuthenticatedLockerOrder,
} from "@/lib/magento/locker-order";

export const runtime = "nodejs";

type LockerCheckoutRequest = {
  action?: unknown;
};

function deviceFailure(error: unknown) {
  if (error instanceof KioskDeviceRequestError) {
    return NextResponse.json(
      { ok: false, code: error.code, error: error.message },
      { status: error.status },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      code: "DEVICE_UNAVAILABLE",
      error: "Kiosk device validation is unavailable.",
    },
    { status: 503 },
  );
}

function checkoutFailure(error: MagentoLockerCheckoutError) {
  const status =
    error.code === "NOT_CONFIGURED"
      ? 503
      : error.code === "UNAVAILABLE"
        ? 503
        : error.code === "REJECTED"
          ? 409
          : 502;

  return NextResponse.json(
    {
      ok: false,
      code: `LOCKER_${error.code}`,
      error:
        error.code === "REJECTED" || error.code === "NOT_CONFIGURED"
          ? error.message
          : "Locker checkout could not be prepared right now.",
    },
    { status },
  );
}

function orderFailure(error: MagentoLockerOrderError) {
  const status = error.code === "REJECTED" ? 409 : error.code === "UNAVAILABLE" ? 503 : 502;
  return NextResponse.json(
    {
      ok: false,
      code: `LOCKER_ORDER_${error.code}`,
      error:
        error.code === "REJECTED"
          ? error.message
          : "The locker order could not be submitted right now.",
    },
    { status },
  );
}

export async function POST(request: Request) {
  let device;
  let payload: LockerCheckoutRequest;

  try {
    const trusted = await readTrustedJsonRequest<LockerCheckoutRequest>(request);
    device = trusted.device;
    payload = trusted.payload;
  } catch (error) {
    return deviceFailure(error);
  }

  if (payload.action !== "prepare" && payload.action !== "confirm") {
    return NextResponse.json(
      { ok: false, code: "INVALID_REQUEST", error: "Locker checkout request is invalid." },
      { status: 400 },
    );
  }

  const sessionId = await getKioskSessionId();
  const session = sessionId ? getKioskSession(sessionId, device.deviceId) : null;

  if (!session) {
    return NextResponse.json(
      { ok: false, code: "SESSION_REQUIRED", error: "Kiosk session has expired." },
      { status: 401 },
    );
  }

  let checkout;
  try {
    checkout = await prepareAuthenticatedLockerCheckout({
      token: session.magentoToken,
      customer: session.customer,
    });
  } catch (error) {
    if (error instanceof MagentoLockerCheckoutError) return checkoutFailure(error);

    return NextResponse.json(
      {
        ok: false,
        code: "LOCKER_UNAVAILABLE",
        error: "Locker checkout could not be prepared right now.",
      },
      { status: 503 },
    );
  }

  if (payload.action === "prepare") {
    return NextResponse.json({ ok: true, checkout });
  }

  if (!checkout.ordering.canSubmitCreditOrder) {
    return NextResponse.json(
      {
        ok: false,
        code: "LOCKER_ORDER_REJECTED",
        error: "This trade account is not allowed to submit an order from the kiosk.",
      },
      { status: 409 },
    );
  }

  try {
    const submission = await submitAuthenticatedLockerOrder({
      token: session.magentoToken,
    });

    return NextResponse.json({ ok: true, checkout, submission });
  } catch (error) {
    if (error instanceof MagentoLockerOrderError) return orderFailure(error);

    return NextResponse.json(
      {
        ok: false,
        code: "LOCKER_ORDER_UNAVAILABLE",
        error: "The locker order could not be submitted right now.",
      },
      { status: 503 },
    );
  }
}
