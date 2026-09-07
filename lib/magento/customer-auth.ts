import { getMagentoConfig } from "@/lib/config";

export type MagentoCustomerAuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "SERVICE_UNAVAILABLE"
  | "INVALID_RESPONSE";

export class MagentoCustomerAuthError extends Error {
  constructor(
    message: string,
    public readonly code: MagentoCustomerAuthErrorCode,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MagentoCustomerAuthError";
  }
}

const GENERATE_CUSTOMER_TOKEN_MUTATION = /* GraphQL */ `
  mutation KioskGenerateCustomerToken($email: String!, $password: String!) {
    generateCustomerToken(email: $email, password: $password) {
      token
    }
  }
`;

type LoginResponse = {
  data?: { generateCustomerToken?: { token?: string | null } | null };
  errors?: Array<{ message?: string }>;
};

export async function requestMagentoCustomerToken(email: string, password: string) {
  const { graphqlUrl, storeCode } = getMagentoConfig();

  let response: Response;
  try {
    response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        Store: storeCode,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: GENERATE_CUSTOMER_TOKEN_MUTATION,
        variables: { email, password },
      }),
      cache: "no-store",
    });
  } catch {
    throw new MagentoCustomerAuthError(
      "We cannot reach the customer account service right now. Please try again shortly.",
      "SERVICE_UNAVAILABLE",
      503,
    );
  }

  if (!response.ok) {
    throw new MagentoCustomerAuthError(
      "We cannot reach the customer account service right now. Please try again shortly.",
      "SERVICE_UNAVAILABLE",
      503,
    );
  }

  let body: LoginResponse;
  try {
    body = (await response.json()) as LoginResponse;
  } catch {
    throw new MagentoCustomerAuthError(
      "The customer account service returned an invalid response.",
      "INVALID_RESPONSE",
      502,
    );
  }

  if (body.errors?.length) {
    throw new MagentoCustomerAuthError(
      "Email address or password was not recognised. Please try again.",
      "INVALID_CREDENTIALS",
      401,
    );
  }

  const token = body.data?.generateCustomerToken?.token?.trim() || "";
  if (token.length < 16) {
    throw new MagentoCustomerAuthError(
      "The customer account service returned an invalid response.",
      "INVALID_RESPONSE",
      502,
    );
  }

  return token;
}
