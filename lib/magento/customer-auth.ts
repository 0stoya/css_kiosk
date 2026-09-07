import { getMagentoConfig } from "@/lib/config";

export type MagentoCustomerAuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "SECOND_FACTOR_REQUIRED"
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

const CUSTOMER_PASSWORD_LOGIN_MUTATION = /* GraphQL */ `
  mutation KioskCustomerPasswordLogin($input: OstoyaCustomerPasswordLoginInput!) {
    ostoya_customer_password_login(input: $input) {
      status
      token
      customer_id
      customer_email
      requires_second_factor
      challenge_id
      message
    }
  }
`;

type LoginPayload = {
  status?: string;
  token?: string | null;
  customer_id?: number | null;
  customer_email?: string | null;
  requires_second_factor?: boolean;
  challenge_id?: string | null;
  message?: string | null;
};

type LoginResponse = {
  data?: { ostoya_customer_password_login?: LoginPayload | null };
  errors?: Array<{ message?: string }>;
};

function authFailureFromGraphQl(body: LoginResponse): MagentoCustomerAuthError {
  const message = body.errors?.map((item) => item.message || "").join(" ").toLowerCase() || "";

  if (message.includes("second factor") || message.includes("verification code")) {
    return new MagentoCustomerAuthError(
      "This account requires a verification code before it can be linked to a kiosk card.",
      "SECOND_FACTOR_REQUIRED",
      401,
    );
  }

  if (message.includes("password login is disabled")) {
    return new MagentoCustomerAuthError(
      "Password sign in is not available for this account.",
      "SECOND_FACTOR_REQUIRED",
      401,
    );
  }

  return new MagentoCustomerAuthError(
    "Email address or password was not recognised. Please try again.",
    "INVALID_CREDENTIALS",
    401,
  );
}

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
        query: CUSTOMER_PASSWORD_LOGIN_MUTATION,
        variables: { input: { email, password } },
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
    throw authFailureFromGraphQl(body);
  }

  const login = body.data?.ostoya_customer_password_login;
  if (!login) {
    throw new MagentoCustomerAuthError(
      "The customer account service returned an invalid response.",
      "INVALID_RESPONSE",
      502,
    );
  }

  if (login.requires_second_factor || login.status !== "AUTHENTICATED") {
    throw new MagentoCustomerAuthError(
      login.message?.trim() || "This account requires a verification code before it can be linked to a kiosk card.",
      "SECOND_FACTOR_REQUIRED",
      401,
    );
  }

  const token = login.token?.trim() || "";
  if (token.length < 16) {
    throw new MagentoCustomerAuthError(
      "The customer account service returned an invalid response.",
      "INVALID_RESPONSE",
      502,
    );
  }

  return token;
}
