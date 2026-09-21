import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  EmployeeEnrollmentStoreError,
  issueEmployeeEnrollment,
} from "@/lib/kiosk/employee-enrollment-store";

export const runtime = "nodejs";

function sharedSecret() {
  const secret = process.env.KIOSK_EMPLOYEE_ENROLLMENT_SHARED_SECRET?.trim();
  if (!secret) {
    throw new Error("KIOSK_EMPLOYEE_ENROLLMENT_SHARED_SECRET is not configured.");
  }
  return secret;
}

function authorized(request: Request) {
  const authorization = request.headers.get("authorization")?.trim() || "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) return false;

  const expected = createHash("sha256").update(sharedSecret()).digest();
  const presented = createHash("sha256").update(match[1]).digest();
  return timingSafeEqual(expected, presented);
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

export async function POST(request: Request) {
  try {
    if (!authorized(request)) {
      return NextResponse.json(
        { ok: false, code: "UNAUTHORIZED", error: "Enrollment integration authentication failed." },
        { status: 401 },
      );
    }
  } catch {
    return NextResponse.json(
      { ok: false, code: "NOT_CONFIGURED", error: "Employee enrollment integration is not configured." },
      { status: 503 },
    );
  }

  let payload: {
    companyId?: unknown;
    employeeId?: unknown;
    employeeCode?: unknown;
    firstName?: unknown;
    lastName?: unknown;
  };

  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_REQUEST", error: "Enrollment request body is invalid." },
      { status: 400 },
    );
  }

  const companyId = positiveInteger(payload.companyId);
  const employeeId = positiveInteger(payload.employeeId);
  const firstName = typeof payload.firstName === "string" ? payload.firstName.trim() : "";
  const lastName = typeof payload.lastName === "string" ? payload.lastName.trim() : "";
  const employeeCode =
    typeof payload.employeeCode === "string" && payload.employeeCode.trim()
      ? payload.employeeCode.trim()
      : null;

  if (!companyId || !employeeId || !firstName || !lastName) {
    return NextResponse.json(
      { ok: false, code: "INVALID_REQUEST", error: "Company, Employee and Employee name are required." },
      { status: 400 },
    );
  }

  try {
    const issued = issueEmployeeEnrollment({
      companyId,
      employeeId,
      employeeCode,
      firstName,
      lastName,
    });

    return NextResponse.json({
      ok: true,
      enrollment: {
        code: issued.code,
        companyId: issued.enrollment.companyId,
        employeeId: issued.enrollment.employeeId,
        employeeCode: issued.enrollment.employeeCode,
        firstName: issued.enrollment.firstName,
        lastName: issued.enrollment.lastName,
        expiresAt: issued.enrollment.expiresAt,
      },
    });
  } catch (error) {
    if (error instanceof EmployeeEnrollmentStoreError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { ok: false, code: "STORE_UNAVAILABLE", error: "Employee enrollment could not be started." },
      { status: 503 },
    );
  }
}
