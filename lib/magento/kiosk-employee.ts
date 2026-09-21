import { getMagentoConfig } from "@/lib/config";
import { getMagentoCustomerGraphQlHeaders } from "@/lib/magento/kiosk-bound-session";

type GraphQLErrorItem = { message?: string };
type GraphQLResponse<TData> = {
  data?: TData;
  errors?: GraphQLErrorItem[];
};

export type KioskCanonicalEmployee = {
  companyId: number;
  employeeId: number;
  employeeCode: string | null;
  firstName: string;
  lastName: string;
  active: boolean;
};

type EmployeeData = {
  css_company_employee?: {
    employee_id?: number | null;
    company_id?: number | null;
    employee_code?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    active?: boolean | null;
  } | null;
};

type AssignEmployeeData = {
  cssAssignCartEmployee?: {
    id?: string | null;
  } | null;
};

export class MagentoKioskEmployeeError extends Error {
  constructor(
    message: string,
    readonly code: "UNAVAILABLE" | "REJECTED" | "INVALID_RESPONSE",
  ) {
    super(message);
    this.name = "MagentoKioskEmployeeError";
  }
}

const EXACT_EMPLOYEE_QUERY = /* GraphQL */ `
  query KioskExactEmployee($employeeId: Int!) {
    css_company_employee(employee_id: $employeeId) {
      employee_id
      company_id
      employee_code
      first_name
      last_name
      active
    }
  }
`;

const ASSIGN_CART_EMPLOYEE_MUTATION = /* GraphQL */ `
  mutation KioskAssignCartEmployee($cartId: String!, $employeeId: Int!) {
    cssAssignCartEmployee(cart_id: $cartId, employee_id: $employeeId) {
      id
    }
  }
`;

async function requestMagento<TData>(input: {
  token: string;
  query: string;
  variables: Record<string, unknown>;
}): Promise<TData> {
  const { graphqlUrl } = getMagentoConfig();

  let response: Response;
  try {
    response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        ...getMagentoCustomerGraphQlHeaders(input.token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: input.query,
        variables: input.variables,
      }),
      cache: "no-store",
    });
  } catch {
    throw new MagentoKioskEmployeeError(
      "Magento Employee validation is unavailable right now.",
      "UNAVAILABLE",
    );
  }

  let body: GraphQLResponse<TData>;
  try {
    body = (await response.json()) as GraphQLResponse<TData>;
  } catch {
    throw new MagentoKioskEmployeeError(
      "Magento returned an invalid Employee response.",
      "INVALID_RESPONSE",
    );
  }

  if (body.errors?.length) {
    throw new MagentoKioskEmployeeError(
      body.errors[0]?.message || "Magento rejected the Employee operation.",
      "REJECTED",
    );
  }

  if (!response.ok) {
    throw new MagentoKioskEmployeeError(
      "Magento Employee validation is unavailable right now.",
      "UNAVAILABLE",
    );
  }

  if (!body.data) {
    throw new MagentoKioskEmployeeError(
      "Magento returned an invalid Employee response.",
      "INVALID_RESPONSE",
    );
  }

  return body.data;
}

function positiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new MagentoKioskEmployeeError(
      `${label} must be a safe positive integer.`,
      "INVALID_RESPONSE",
    );
  }
  return value;
}

export async function getExactKioskEmployee(input: {
  token: string;
  companyId: number;
  employeeId: number;
}): Promise<KioskCanonicalEmployee> {
  const employeeId = positiveInteger(input.employeeId, "employee_id");
  const companyId = positiveInteger(input.companyId, "company_id");

  const data = await requestMagento<EmployeeData>({
    token: input.token,
    query: EXACT_EMPLOYEE_QUERY,
    variables: { employeeId },
  });

  const employee = data.css_company_employee;
  if (
    !employee ||
    typeof employee.employee_id !== "number" ||
    typeof employee.company_id !== "number" ||
    typeof employee.first_name !== "string" ||
    typeof employee.last_name !== "string" ||
    typeof employee.active !== "boolean"
  ) {
    throw new MagentoKioskEmployeeError(
      "Magento returned an invalid canonical Employee.",
      "INVALID_RESPONSE",
    );
  }

  if (
    employee.employee_id !== employeeId ||
    employee.company_id !== companyId
  ) {
    throw new MagentoKioskEmployeeError(
      "Magento returned an Employee for the wrong company context.",
      "INVALID_RESPONSE",
    );
  }

  return {
    companyId,
    employeeId,
    employeeCode:
      typeof employee.employee_code === "string" &&
      employee.employee_code.trim()
        ? employee.employee_code.trim()
        : null,
    firstName: employee.first_name.trim(),
    lastName: employee.last_name.trim(),
    active: employee.active,
  };
}

export async function assignKioskCartEmployee(input: {
  token: string;
  cartId: string;
  employeeId: number;
}) {
  const cartId = input.cartId.trim();
  if (!cartId) {
    throw new MagentoKioskEmployeeError(
      "Magento cart ID is required for Employee assignment.",
      "INVALID_RESPONSE",
    );
  }
  const employeeId = positiveInteger(input.employeeId, "employee_id");

  const data = await requestMagento<AssignEmployeeData>({
    token: input.token,
    query: ASSIGN_CART_EMPLOYEE_MUTATION,
    variables: { cartId, employeeId },
  });

  const assignedCartId = data.cssAssignCartEmployee?.id?.trim() || "";
  if (!assignedCartId || assignedCartId !== cartId) {
    throw new MagentoKioskEmployeeError(
      "Magento did not confirm Employee assignment for the expected cart.",
      "INVALID_RESPONSE",
    );
  }

  return { cartId: assignedCartId, employeeId };
}
