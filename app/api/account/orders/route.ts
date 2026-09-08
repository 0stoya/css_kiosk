import { NextResponse } from "next/server";
import {
  KioskDeviceRequestError,
  readTrustedJsonRequest,
} from "@/lib/kiosk/device-request";
import { getKioskSessionId } from "@/lib/kiosk/session-cookie";
import { getKioskSession } from "@/lib/kiosk/session-store";
import {
  getAuthenticatedCompanyOrders,
  MagentoCompanyOrdersError,
} from "@/lib/magento/company-orders";

export const runtime = "nodejs";

type OrdersRequest = {
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

export async function POST(request: Request) {
  let device;
  let payload: OrdersRequest;

  try {
    const trusted = await readTrustedJsonRequest<OrdersRequest>(request);
    device = trusted.device;
    payload = trusted.payload;
  } catch (error) {
    return deviceFailure(error);
  }

  if (payload.action !== "list") {
    return NextResponse.json(
      { ok: false, code: "INVALID_REQUEST", error: "Order history request is invalid." },
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

  try {
    const history = await getAuthenticatedCompanyOrders({
      token: session.magentoToken,
      page: 1,
      pageSize: 5,
    });

    return NextResponse.json({ ok: true, history });
  } catch (error) {
    if (error instanceof MagentoCompanyOrdersError) {
      return NextResponse.json(
        {
          ok: false,
          code: `ORDERS_${error.code}`,
          error: "Your recent orders could not be loaded right now.",
        },
        { status: error.code === "UNAVAILABLE" ? 503 : 502 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        code: "ORDERS_UNAVAILABLE",
        error: "Your recent orders could not be loaded right now.",
      },
      { status: 503 },
    );
  }
}
