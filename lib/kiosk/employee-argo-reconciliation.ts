import { ArgoApiError } from "@/lib/argo/client";
import { ensureArgoEmployeeForBadge } from "@/lib/argo/employees";
import {
  linkEmployeeCredentialWithArgo,
  type EmployeeCredentialLink,
  type EmployeeProviderLink,
} from "@/lib/kiosk/employee-credential-store";
import type { NfcCredential } from "@/lib/kiosk/nfc-reader";

export type CanonicalEmployeeForArgo = {
  companyId: number;
  employeeId: number;
  firstName: string;
  lastName: string;
};

export type ReconciledEmployeeCredential = {
  employee: {
    companyId: number;
    employeeId: number;
  };
  credential: EmployeeCredentialLink;
  provider: EmployeeProviderLink;
  argoEmployeeCreated: boolean;
};

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ArgoApiError(
      `${label} must be a safe positive integer.`,
      "INVALID_REQUEST",
      400,
    );
  }
  return value;
}

export async function reconcileEmployeeCredentialWithArgo(input: {
  credential: NfcCredential;
  employee: CanonicalEmployeeForArgo;
}): Promise<ReconciledEmployeeCredential> {
  if (input.credential.type !== "uid") {
    throw new ArgoApiError(
      "NEXT ARGO employee badges require the numeric RFID UID credential.",
      "INVALID_REQUEST",
      400,
    );
  }

  const companyId = positiveInteger(input.employee.companyId, "company_id");
  const employeeId = positiveInteger(input.employee.employeeId, "employee_id");
  const firstName = input.employee.firstName.trim();
  const lastName = input.employee.lastName.trim();

  if (!firstName || !lastName) {
    throw new ArgoApiError(
      "The canonical CSS Employee needs a first and last name before ARGO enrollment.",
      "INVALID_REQUEST",
      400,
    );
  }

  const ensured = await ensureArgoEmployeeForBadge({
    badge: input.credential.value,
    firstName,
    lastName,
  });

  if (ensured.employee.active === false) {
    throw new ArgoApiError(
      "The matching NEXT ARGO employee is inactive and cannot be linked for kiosk ordering.",
      "CORRELATION_MISMATCH",
      409,
    );
  }

  const stored = linkEmployeeCredentialWithArgo({
    credential: input.credential,
    companyId,
    employeeId,
    argoEmployeeId: ensured.employee.id,
    plantId: ensured.employee.plantId,
  });

  return {
    employee: { companyId, employeeId },
    credential: stored.link,
    provider: stored.provider,
    argoEmployeeCreated: ensured.created,
  };
}
