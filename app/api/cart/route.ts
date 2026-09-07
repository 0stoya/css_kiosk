import { NextResponse } from "next/server";
import {
  KioskDeviceRequestError,
  readTrustedJsonRequest,
} from "@/lib/kiosk/device-request";
import { getKioskSessionId } from "@/lib/kiosk/session-cookie";
import { getKioskSession } from "@/lib/kiosk/session-store";
import {
  addAuthenticatedBasketItem,
  getAuthenticatedBasket,
  MagentoCartError,
  removeAuthenticatedBasketItem,
  updateAuthenticatedBasketItem,
} from "@/lib/magento/cart";

export const runtime = "nodejs";

type CartAction = "get" | "add" | "update" | "remove";

type CartRequest = {
  action?: unknown;
  sku?: unknown;
  quantity?: unknown;
  itemUid?: unknown;
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

function validAction(value: unknown): value is CartAction {
  return value === "get" || value === "add" || value === "update" || value === "remove";
}

export async function POST(request: Request) {
  let device;
  let payload: CartRequest;

  try {
    const trusted = await readTrustedJsonRequest<CartRequest>(request);
    device = trusted.device;
    payload = trusted.payload;
  } catch (error) {
    return deviceFailure(error);
  }

  if (!validAction(payload.action)) {
    return NextResponse.json(
      { ok: false, code: "INVALID_REQUEST", error: "Basket request is invalid." },
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

  const sku = typeof payload.sku === "string" ? payload.sku.trim() : "";
  const itemUid = typeof payload.itemUid === "string" ? payload.itemUid.trim() : "";
  const quantity =
    typeof payload.quantity === "number" && Number.isInteger(payload.quantity)
      ? payload.quantity
      : 0;

  if (
    sku.length > 160 ||
    itemUid.length > 256 ||
    ((payload.action === "add" || payload.action === "update") && (quantity < 1 || quantity > 999)) ||
    (payload.action === "add" && !sku) ||
    ((payload.action === "update" || payload.action === "remove") && !itemUid)
  ) {
    return NextResponse.json(
      { ok: false, code: "INVALID_REQUEST", error: "Basket request is invalid." },
      { status: 400 },
    );
  }

  try {
    let basket;

    if (payload.action === "add") {
      basket = await addAuthenticatedBasketItem({
        token: session.magentoToken,
        sku,
        quantity,
      });
    } else if (payload.action === "update") {
      basket = await updateAuthenticatedBasketItem({
        token: session.magentoToken,
        itemUid,
        quantity,
      });
    } else if (payload.action === "remove") {
      basket = await removeAuthenticatedBasketItem({
        token: session.magentoToken,
        itemUid,
      });
    } else {
      basket = await getAuthenticatedBasket(session.magentoToken);
    }

    return NextResponse.json({
      ok: true,
      basket,
    });
  } catch (error) {
    if (error instanceof MagentoCartError) {
      const status = error.code === "UNAVAILABLE" ? 503 : error.code === "REJECTED" ? 409 : 502;
      return NextResponse.json(
        {
          ok: false,
          code: `BASKET_${error.code}`,
          error:
            error.code === "REJECTED"
              ? error.message
              : "The basket could not be updated right now.",
        },
        { status },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        code: "BASKET_UNAVAILABLE",
        error: "The basket could not be updated right now.",
      },
      { status: 503 },
    );
  }
}
