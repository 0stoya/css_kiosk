import { NextResponse } from "next/server";
import {
  KioskDeviceRequestError,
  readTrustedJsonRequest,
} from "@/lib/kiosk/device-request";
import { getKioskSessionId } from "@/lib/kiosk/session-cookie";
import { getKioskSession } from "@/lib/kiosk/session-store";
import {
  getAuthenticatedCatalogue,
  MagentoCatalogueError,
} from "@/lib/magento/catalogue";

export const runtime = "nodejs";

type CatalogueRequest = {
  search?: unknown;
  categoryUid?: unknown;
  page?: unknown;
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
  let payload: CatalogueRequest;

  try {
    const trusted = await readTrustedJsonRequest<CatalogueRequest>(request);
    device = trusted.device;
    payload = trusted.payload;
  } catch (error) {
    return deviceFailure(error);
  }

  const search = typeof payload.search === "string" ? payload.search.trim() : "";
  const categoryUid =
    typeof payload.categoryUid === "string" ? payload.categoryUid.trim() : "";
  const page =
    typeof payload.page === "number" && Number.isInteger(payload.page)
      ? payload.page
      : 1;

  if (search.length > 120 || categoryUid.length > 256 || page < 1 || page > 1000) {
    return NextResponse.json(
      { ok: false, code: "INVALID_REQUEST", error: "Catalogue request is invalid." },
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
    const catalogue = await getAuthenticatedCatalogue({
      token: session.magentoToken,
      search,
      categoryUid,
      page,
      pageSize: 8,
    });

    return NextResponse.json({
      ok: true,
      customer: session.customer,
      catalogue,
    });
  } catch (error) {
    if (error instanceof MagentoCatalogueError) {
      if (process.env.NODE_ENV !== "production") {
        console.error(`[catalogue] Magento ${error.code}: ${error.message}`);
      }

      return NextResponse.json(
        {
          ok: false,
          code: `CATALOGUE_${error.code}`,
          error: "The trade catalogue could not be loaded right now.",
        },
        { status: error.code === "UNAVAILABLE" ? 503 : 502 },
      );
    }

    if (process.env.NODE_ENV !== "production") {
      console.error("[catalogue] Unexpected catalogue failure", error);
    }

    return NextResponse.json(
      {
        ok: false,
        code: "CATALOGUE_UNAVAILABLE",
        error: "The trade catalogue could not be loaded right now.",
      },
      { status: 503 },
    );
  }
}
