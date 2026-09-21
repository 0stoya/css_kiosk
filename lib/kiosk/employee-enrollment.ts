import {
  reconcileEmployeeCredentialWithArgo,
  type ReconciledEmployeeCredential,
} from "@/lib/kiosk/employee-argo-reconciliation";
import type { NfcCredential } from "@/lib/kiosk/nfc-reader";
import {
  getExactKioskEmployee,
  MagentoKioskEmployeeError,
} from "@/lib/magento/kiosk-employee";

export class EmployeeEnrollmentError extends Error {
  constructor(
    message: string,
    readonly code: "INACTIVE_EMPLOYEE" | "COMPANY_MISMATCH",
    readonly status: number,
  ) {
    super(message);
    this.name = "EmployeeEnrollmentError";
  }
}

export async function enrollKioskEmployeeCredential(input: {
  magentoToken: string;
  companyId: number;
  employeeId: number;
  credential: NfcCredential;
}): Promise<{
  canonicalEmployee: {
    companyId: number;
    employeeId: number;
    employeeCode: string | null;
    firstName: string;
    lastName: string;
  };
  reconciliation: ReconciledEmployeeCredential;
}> {
  const employee = await getExactKioskEmployee({
    token: input.magentoToken,
    companyId: input.companyId,
    employeeId: input.employeeId,
  });

  if (employee.companyId !== input.companyId) {
    throw new EmployeeEnrollmentError(
      "The selected Employee does not belong to this kiosk company.",
      "COMPANY_MISMATCH",
      409,
    );
  }

  if (!employee.active) {
    throw new EmployeeEnrollmentError(
      "The selected Employee is inactive and cannot be enrolled for kiosk ordering.",
      "INACTIVE_EMPLOYEE",
      409,
    );
  }

  const reconciliation = await reconcileEmployeeCredentialWithArgo({
    credential: input.credential,
    employee: {
      companyId: employee.companyId,
      employeeId: employee.employeeId,
      firstName: employee.firstName,
      lastName: employee.lastName,
    },
  });

  return {
    canonicalEmployee: {
      companyId: employee.companyId,
      employeeId: employee.employeeId,
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
    },
    reconciliation,
  };
}

export { MagentoKioskEmployeeError };
