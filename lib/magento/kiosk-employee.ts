import { getMagentoConfig } from "@/lib/config";
import { getMagentoCustomerGraphQlHeaders } from "@/lib/magento/kiosk-bound-session";

type GraphQLErrorItem = { message?: string };
type GraphQLResponse<TData> = {
  data?: TData;
  errors?: GraphQLErrorItem[];
};

type CurrentCartData = {
  customerCart?: {
    id?: string | null;
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

const CURRENT_CART_QUERY = /* GraphQL */ `
  query KioskEmployeeCurrentCart {
    customerCart {
      id
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
      "Magento Employee assignment is unavailable right now.",
      "UNAVAILABLE",
    );
  }

  let body: GraphQLResponse<TData>;
  try {
    body = (await response.json()) as GraphQLResponse<TData>;
  } catch {
    throw new MagentoKioskEmployeeError(
      "Magento returned an invalid Employee assignment response.",
      "INVALID_RESPONSE",
    );
  }

  if (body.errors?.length) {
    throw new MagentoKioskEmployeeError(
      body.errors[0]?.message || "Magento rejected the Employee assignment.",
      "REJECTED",
    );
  }

  if (!response.ok) {
    throw new MagentoKioskEmployeeError(
      "Magento Employee assignment is unavailable right now.",
      "UNAVAILABLE",
    );
  }

  if (!body.data) {
    throw new MagentoKioskEmployeeError(
      "Magento returned an invalid Employee assignment response.",
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


export async function assignCurrentKioskCartEmployee(input: {
  token: string;
  employeeId: number;
}) {
  const employeeId = positiveInteger(input.employeeId, "employee_id");
  const current = await requestMagento<CurrentCartData>({
    token: input.token,
    query: CURRENT_CART_QUERY,
    variables: {},
  });

  const cartId = current.customerCart?.id?.trim() || "";
  if (!cartId) {
    throw new MagentoKioskEmployeeError(
      "Magento did not return the current Employee cart.",
      "INVALID_RESPONSE",
    );
  }

  return assignKioskCartEmployee({
    token: input.token,
    cartId,
    employeeId,
  });
}
