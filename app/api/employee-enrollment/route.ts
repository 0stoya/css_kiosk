import { NextResponse } from "next/server";
import { ArgoApiError } from "@/lib/argo/client";
import { reconcileEmployeeCredentialWithArgo } from "@/lib/kiosk/employee-argo-reconciliation";
import {
  claimEmployeeEnrollment,
  completeEmployeeEnrollment,
  EmployeeEnrollmentStoreError,
  lookupEmployeeEnrollment,
  releaseEmployeeEnrollment,
} from "@/lib/kiosk/employee-enrollment-store";
import {
  EmployeeCredentialStoreError,
  resolveEmployeeCredential,
} from "@/lib/kiosk/employee-credential-store";
import {
  NfcCredentialStoreError,
  parseNfcCredential,
  resolveNfcCredential,
} from "@/lib/kiosk/credential-store";
import {
  KioskDeviceRequestError,
  readTrustedJsonRequest,
} from "@/lib/kiosk/device-request";
import { getKioskSessionId } from "@/lib/kiosk/session-cookie";
import {
  getKioskSession,
  setKioskSessionEmployee,
} from "@/lib/kiosk/session-store";

export const runtime = "nodejs";

type EnrollmentRequest = {
  action?: unknown;
  code?: unknown;
  credential?: unknown;
};

function deviceFailure(error: unknown) {
  if (error instanceof KioskDeviceRequestError) {
    return NextResponse.json(
      { ok: false, code: error.code, error: error.message },
      { status: error.status },
    );
  }

  return NextResponse.json(
    { ok: false, code: "DEVICE_UNAVAILABLE", error: "Kiosk device validation is unavailable." },
    { status: 503 },
  );
}

function enrollmentSummary(enrollment: ReturnType<typeof lookupEmployeeEnrollment>) {
  return {
    companyId: enrollment.companyId,
    employeeId: enrollment.employeeId,
    employeeCode: enrollment.employeeCode,
    firstName: enrollment.firstName,
    lastName: enrollment.lastName,
    expiresAt: enrollment.expiresAt,
  };
}

function knownFailure(error: unknown) {
  if (error instanceof EmployeeEnrollmentStoreError) {
    return NextResponse.json(
      { ok: false, code: error.code, error: error.message },
      { status: error.status },
    );
  }

  if (error instanceof EmployeeCredentialStoreError) {
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

  if (error instanceof ArgoApiError) {
    return NextResponse.json(
      { ok: false, code: `ARGO_${error.code}`, error: error.message },
      { status: error.status },
    );
  }

  return null;
}

export async function POST(request: Request) {
  let device;
  let payload: EnrollmentRequest;

  try {
    const trusted = await readTrustedJsonRequest<EnrollmentRequest>(request);
    device = trusted.device;
    payload = trusted.payload;
  } catch (error) {
    return deviceFailure(error);
  }

  const action = payload.action;
  const code = typeof payload.code === "string" ? payload.code : "";

  if (action === "lookup") {
    try {
      const enrollment = lookupEmployeeEnrollment(code);
      return NextResponse.json({
        ok: true,
        enrollment: enrollmentSummary(enrollment),
      });
    } catch (error) {
      return (
        knownFailure(error) ||
        NextResponse.json(
          { ok: false, code: "ENROLLMENT_UNAVAILABLE", error: "Employee enrollment is unavailable right now." },
          { status: 503 },
        )
      );
    }
  }

  if (action !== "complete") {
    return NextResponse.json(
      { ok: false, code: "INVALID_REQUEST", error: "Employee enrollment request is invalid." },
      { status: 400 },
    );
  }

  const credential = parseNfcCredential(payload.credential);
  if (!credential) {
    return NextResponse.json(
      { ok: false, code: "INVALID_CREDENTIAL", error: "A valid RFID credential is required." },
      { status: 400 },
    );
  }

  const sessionId = await getKioskSessionId();
  const session = sessionId ? getKioskSession(sessionId, device.deviceId) : null;
  if (!session || !sessionId) {
    return NextResponse.json(
      { ok: false, code: "SESSION_REQUIRED", error: "Sign in with this RFID before completing Employee enrollment." },
      { status: 401 },
    );
  }

  let claimed = false;
  try {
    const enrollment = claimEmployeeEnrollment(code);
    claimed = true;

    if (session.customer.company?.companyId !== enrollment.companyId) {
      throw new EmployeeCredentialStoreError(
        "This RFID account belongs to a different company than the selected Employee.",
        "CREDENTIAL_ALREADY_LINKED",
        409,
      );
    }

    const customerCredential = resolveNfcCredential(credential);
    if (
      customerCredential.status !== "registered" ||
      customerCredential.customer.customerId !== session.customer.customerId
    ) {
      throw new EmployeeCredentialStoreError(
        "The RFID used for Employee enrollment does not match the signed-in Magento account.",
        "CREDENTIAL_ALREADY_LINKED",
        409,
      );
    }

    const existingEmployeeCredential = resolveEmployeeCredential(credential);
    if (
      existingEmployeeCredential.status === "linked" &&
      (
        existingEmployeeCredential.link.companyId !== enrollment.companyId ||
        existingEmployeeCredential.link.employeeId !== enrollment.employeeId
      )
    ) {
      throw new EmployeeCredentialStoreError(
        "This RFID is already linked to a different canonical Employee.",
        "CREDENTIAL_ALREADY_LINKED",
        409,
      );
    }

    const reconciled = await reconcileEmployeeCredentialWithArgo({
      credential,
      employee: {
        companyId: enrollment.companyId,
        employeeId: enrollment.employeeId,
        firstName: enrollment.firstName,
        lastName: enrollment.lastName,
      },
    });

    setKioskSessionEmployee({
      sessionId,
      deviceId: device.deviceId,
      employee: {
        companyId: enrollment.companyId,
        employeeId: enrollment.employeeId,
        argoEmployeeId: reconciled.provider.providerEmployeeId,
        argoPlantId: reconciled.provider.plantId,
      },
    });

    completeEmployeeEnrollment(code);
    claimed = false;

    return NextResponse.json({
      ok: true,
      enrollment: enrollmentSummary(enrollment),
      employee: {
        employeeId: enrollment.employeeId,
        argoEmployeeId: reconciled.provider.providerEmployeeId,
        argoEmployeeCreated: reconciled.argoEmployeeCreated,
      },
    });
  } catch (error) {
    if (claimed) {
      try {
        releaseEmployeeEnrollment(code);
      } catch {
        // Preserve the original enrollment error.
      }
    }

    return (
      knownFailure(error) ||
      NextResponse.json(
        { ok: false, code: "ENROLLMENT_UNAVAILABLE", error: "Employee RFID enrollment could not be completed." },
        { status: 503 },
      )
    );
  }
}
