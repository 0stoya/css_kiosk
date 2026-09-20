import { NextResponse } from "next/server";
import { ArgoApiError } from "@/lib/argo/client";
import { getKioskLockerAdminStatus } from "@/lib/argo/locker-admin";
import {
  KioskDeviceRequestError,
  readTrustedJsonRequest,
} from "@/lib/kiosk/device-request";
import { getKioskSessionId } from "@/lib/kiosk/session-cookie";
import { getKioskSession } from "@/lib/kiosk/session-store";
import {
  getKioskCompanyAdminCapability,
  MagentoCompanyAdminCapabilityError,
} from "@/lib/magento/company-admin-capability";

export const runtime = "nodejs";

type LockerAdminRequest = {
  action?: unknown;
  cellId?: unknown;
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

async function currentAdminCapability(input: {
  token: string;
  companyId: number;
  companyUserId: number;
}) {
  try {
    return await getKioskCompanyAdminCapability(input);
  } catch (error) {
    if (
      error instanceof MagentoCompanyAdminCapabilityError &&
      error.code === "REJECTED"
    ) {
      return null;
    }
    throw error;
  }
}

export async function POST(request: Request) {
  let device;
  let payload: LockerAdminRequest;

  try {
    const trusted = await readTrustedJsonRequest<LockerAdminRequest>(request);
    device = trusted.device;
    payload = trusted.payload;
  } catch (error) {
    return deviceFailure(error);
  }

  if (
    payload.action !== "capability" &&
    payload.action !== "status" &&
    payload.action !== "open"
  ) {
    return NextResponse.json(
      { ok: false, code: "INVALID_REQUEST", error: "Locker management request is invalid." },
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

  const company = session.customer.company;
  if (!company) {
    return NextResponse.json(
      {
        ok: false,
        code: "LOCKER_ADMIN_FORBIDDEN",
        error: "Locker management requires an active company account.",
      },
      { status: 403 },
    );
  }

  let capability;
  try {
    capability = await currentAdminCapability({
      token: session.magentoToken,
      companyId: company.companyId,
      companyUserId: company.companyUserId,
    });
  } catch (error) {
    if (error instanceof MagentoCompanyAdminCapabilityError) {
      return NextResponse.json(
        {
          ok: false,
          code: `LOCKER_ADMIN_${error.code}`,
          error: "Locker management permissions could not be verified right now.",
        },
        { status: error.code === "UNAVAILABLE" ? 503 : 502 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        code: "LOCKER_ADMIN_UNAVAILABLE",
        error: "Locker management permissions could not be verified right now.",
      },
      { status: 503 },
    );
  }

  const canViewStatus = capability?.canViewLockerStatus === true;

  if (payload.action === "capability") {
    return NextResponse.json({
      ok: true,
      capability: {
        canViewStatus,
        canOpen: false,
        manualOpenAvailable: false,
      },
    });
  }

  if (!canViewStatus) {
    return NextResponse.json(
      {
        ok: false,
        code: "LOCKER_ADMIN_FORBIDDEN",
        error: "This company account is not allowed to manage the locker.",
      },
      { status: 403 },
    );
  }

  if (payload.action === "open") {
    const cellId =
      typeof payload.cellId === "number" &&
      Number.isInteger(payload.cellId) &&
      payload.cellId > 0
        ? payload.cellId
        : null;

    if (cellId === null) {
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID_REQUEST",
          error: "Choose a current locker position before opening it.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        code: "LOCKER_MANUAL_OPEN_UNAVAILABLE",
        error: "Manual locker opening is waiting for the supported NEXT ARGO API contract.",
      },
      { status: 409 },
    );
  }

  try {
    const status = await getKioskLockerAdminStatus();
    return NextResponse.json({
      ok: true,
      capability: {
        canViewStatus: true,
        canOpen: false,
        manualOpenAvailable: false,
      },
      status,
    });
  } catch (error) {
    if (error instanceof ArgoApiError) {
      return NextResponse.json(
        {
          ok: false,
          code: `LOCKER_${error.code}`,
          error: "Live locker status could not be loaded right now.",
          retryAfterSeconds: error.retryAfterSeconds,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        code: "LOCKER_UNAVAILABLE",
        error: "Live locker status could not be loaded right now.",
      },
      { status: 503 },
    );
  }
}
