import { NextResponse } from "next/server";
import { ArgoApiError } from "@/lib/argo/client";
import { getArgoConfig } from "@/lib/argo/config";
import { getArgoCart } from "@/lib/argo/carts";
import { resolveArgoEmployeeByBadge } from "@/lib/argo/employees";
import { getKioskLockerAdminStatus } from "@/lib/argo/locker-admin";
import { resolveConfiguredArgoTerminal } from "@/lib/argo/terminals";
import { requestArgoCartWithdrawal } from "@/lib/argo/withdrawals";
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
  cartId?: unknown;
  userBadge?: unknown;
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
    payload.action !== "open" &&
    payload.action !== "withdraw"
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
  const canReleaseCart = canViewStatus && getArgoConfig().writesEnabled;

  if (payload.action === "capability") {
    return NextResponse.json({
      ok: true,
      capability: {
        canViewStatus,
        canOpen: false,
        canReleaseCart,
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

  if (payload.action === "withdraw") {
    if (!getArgoConfig().writesEnabled) {
      return NextResponse.json(
        {
          ok: false,
          code: "LOCKER_WRITES_DISABLED",
          error: "NEXT ARGO writes are disabled on this kiosk.",
        },
        { status: 409 },
      );
    }

    const cartId =
      typeof payload.cartId === "number" &&
      Number.isInteger(payload.cartId) &&
      payload.cartId > 0
        ? payload.cartId
        : null;
    const userBadge =
      typeof payload.userBadge === "string" ? payload.userBadge.trim() : "";

    if (cartId === null || !/^\d{1,20}$/.test(userBadge)) {
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID_REQUEST",
          error: "Enter a valid loaded cart ID and numeric collector badge.",
        },
        { status: 400 },
      );
    }

    try {
      const terminal = await resolveConfiguredArgoTerminal();
      const cart = await getArgoCart(cartId);

      if (cart.terminalId !== terminal.id) {
        return NextResponse.json(
          {
            ok: false,
            code: "LOCKER_CART_TERMINAL_MISMATCH",
            error: "That cart is not assigned to the configured locker terminal.",
          },
          { status: 409 },
        );
      }

      if (cart.lineCount < 1 || cart.totalQuantity < 1) {
        return NextResponse.json(
          {
            ok: false,
            code: "LOCKER_CART_EMPTY",
            error: "That ARGO cart has no product lines to release.",
          },
          { status: 409 },
        );
      }

      const collector = await resolveArgoEmployeeByBadge(userBadge);
      if (!collector || collector.active === false) {
        return NextResponse.json(
          {
            ok: false,
            code: "LOCKER_COLLECTOR_UNKNOWN",
            error: "The collector badge is not an active NEXT ARGO employee.",
          },
          { status: 409 },
        );
      }

      const withdrawal = await requestArgoCartWithdrawal({
        terminalId: terminal.id,
        cartId,
        userBadge,
      });

      return NextResponse.json({
        ok: true,
        capability: {
          canViewStatus: true,
          canOpen: false,
          canReleaseCart: true,
          manualOpenAvailable: false,
        },
        withdrawal: {
          requestKey: withdrawal.requestKey,
          phase: withdrawal.phase,
          status: withdrawal.status,
          terminalId: withdrawal.terminalId,
          cartId: withdrawal.cartId,
          message: withdrawal.message,
        },
      });
    } catch (error) {
      if (error instanceof ArgoApiError) {
        return NextResponse.json(
          {
            ok: false,
            code: `LOCKER_${error.code}`,
            error: error.message,
            retryAfterSeconds: error.retryAfterSeconds,
          },
          { status: error.status },
        );
      }

      return NextResponse.json(
        {
          ok: false,
          code: "LOCKER_WITHDRAWAL_UNAVAILABLE",
          error: "The cart release request could not be sent right now.",
        },
        { status: 503 },
      );
    }
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
        canReleaseCart,
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
