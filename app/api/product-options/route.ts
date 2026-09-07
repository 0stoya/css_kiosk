import { NextResponse } from "next/server";
import {
  KioskDeviceRequestError,
  readTrustedJsonRequest,
} from "@/lib/kiosk/device-request";
import { getKioskSessionId } from "@/lib/kiosk/session-cookie";
import { getKioskSession } from "@/lib/kiosk/session-store";
import {
  getAuthenticatedProductOptions,
  MagentoProductOptionsError,
} from "@/lib/magento/product-options";

export const runtime = "nodejs";

type ProductOptionsRequest = {
  sku?: unknown;
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
  let payload: ProductOptionsRequest;

  try {
    const trusted = await readTrustedJsonRequest<ProductOptionsRequest>(request);
    device = trusted.device;
    payload = trusted.payload;
  } catch (error) {
    return deviceFailure(error);
  }

  const sku = typeof payload.sku === "string" ? payload.sku.trim() : "";
  if (!sku || sku.length > 160) {
    return NextResponse.json(
      { ok: false, code: "INVALID_REQUEST", error: "Product option request is invalid." },
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
    const product = await getAuthenticatedProductOptions({
      token: session.magentoToken,
      sku,
    });

    return NextResponse.json({ ok: true, product });
  } catch (error) {
    if (error instanceof MagentoProductOptionsError) {
      const status =
        error.code === "UNAVAILABLE"
          ? 503
          : error.code === "NOT_FOUND"
            ? 404
            : error.code === "REJECTED"
              ? 409
              : 502;

      return NextResponse.json(
        {
          ok: false,
          code: `PRODUCT_OPTIONS_${error.code}`,
          error:
            error.code === "NOT_FOUND"
              ? "This product is no longer available."
              : "Product options could not be loaded right now.",
        },
        { status },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        code: "PRODUCT_OPTIONS_UNAVAILABLE",
        error: "Product options could not be loaded right now.",
      },
      { status: 503 },
    );
  }
}
