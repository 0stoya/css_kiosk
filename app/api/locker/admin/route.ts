import { NextResponse } from "next/server";
import { ArgoApiError } from "@/lib/argo/client";
import { getArgoConfig } from "@/lib/argo/config";
import { getArgoCart } from "@/lib/argo/carts";
import {
  equivalentArgoBadge,
  getArgoEmployee,
  resolveArgoEmployeeByBadge,
} from "@/lib/argo/employees";
import { getKioskLockerAdminStatus } from "@/lib/argo/locker-admin";
import { resolveConfiguredArgoTerminal } from "@/lib/argo/terminals";
import { requestArgoCartWithdrawal } from "@/lib/argo/withdrawals";
import {
  KioskDeviceRequestError,
  readTrustedJsonRequest,
} from "@/lib/kiosk/device-request";
import {
  getEmployeeProviderLink,
  rememberEmployeeProviderBadge,
} from "@/lib/kiosk/employee-credential-store";
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
  let storedProviderBadge: string | null = null;

  if (session.employee) {
    try {
      const provider = getEmployeeProviderLink(
        session.employee.companyId,
        session.employee.employeeId,
      );
      if (
        provider &&
        provider.providerEmployeeId === session.employee.argoEmployeeId &&
        provider.plantId === session.employee.argoPlantId
      ) {
        storedProviderBadge = provider.argoBadge;
      }
    } catch {
      // The current in-memory RFID remains a safe fallback for this live
      // session if durable provider storage is temporarily unavailable.
    }
  }

  const sessionBadge = session.rfidBadge;
  const collectorBadge =
    storedProviderBadge ||
    (typeof sessionBadge === "string" && /^\d{1,20}$/.test(sessionBadge)
      ? sessionBadge
      : null);
  const writesEnabled = getArgoConfig().writesEnabled;
  const hasCollectorBadge = typeof collectorBadge === "string";
  const canReleaseCart = canViewStatus && writesEnabled && hasCollectorBadge;
  const releaseUnavailableReason = !writesEnabled
    ? "ARGO writes disabled"
    : !hasCollectorBadge
      ? "Employee ARGO badge unavailable"
      : null;

  if (payload.action === "capability") {
    return NextResponse.json({
      ok: true,
      capability: {
        canViewStatus,
        canOpen: false,
        canReleaseCart,
        releaseUnavailableReason,
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
    if (cartId === null || !collectorBadge) {
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID_REQUEST",
          error:
            cartId === null
              ? "Enter a valid loaded cart ID."
              : "This Employee does not have an ARGO badge available for collection.",
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

      const collector = session.employee
        ? await getArgoEmployee(session.employee.argoEmployeeId)
        : await resolveArgoEmployeeByBadge(collectorBadge);

      if (!collector) {
        return NextResponse.json(
          {
            ok: false,
            code: "LOCKER_COLLECTOR_UNKNOWN",
            error: "The collector badge is not known to NEXT ARGO.",
          },
          { status: 409 },
        );
      }

      if (collector.active === false) {
        return NextResponse.json(
          {
            ok: false,
            code: "LOCKER_COLLECTOR_INACTIVE",
            error: "The linked NEXT ARGO employee is inactive.",
          },
          { status: 409 },
        );
      }

      if (collector.plantId !== getArgoConfig().plantId) {
        return NextResponse.json(
          {
            ok: false,
            code: "LOCKER_COLLECTOR_PLANT_MISMATCH",
            error: "The linked NEXT ARGO employee belongs to a different plant.",
          },
          { status: 409 },
        );
      }

      if (
        session.employee &&
        collector.id !== session.employee.argoEmployeeId
      ) {
        return NextResponse.json(
          {
            ok: false,
            code: "LOCKER_COLLECTOR_ID_MISMATCH",
            error: "The linked NEXT ARGO employee does not match this kiosk Employee.",
          },
          { status: 409 },
        );
      }

      if (!equivalentArgoBadge(collector.badge, collectorBadge)) {
        return NextResponse.json(
          {
            ok: false,
            code: "LOCKER_COLLECTOR_BADGE_MISMATCH",
            error: "The stored ARGO badge does not match the linked NEXT ARGO employee.",
          },
          { status: 409 },
        );
      }

      if (session.employee) {
        rememberEmployeeProviderBadge({
          companyId: session.employee.companyId,
          employeeId: session.employee.employeeId,
          providerEmployeeId: collector.id,
          plantId: collector.plantId,
          argoBadge: collector.badge,
        });
      }

      const withdrawal = await requestArgoCartWithdrawal({
        terminalId: terminal.id,
        cartId,
        userBadge: collector.badge,
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
        releaseUnavailableReason,
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
