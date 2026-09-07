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

export async function requestMagentoCustomerToken(email: string, password: string) {
  const { customerTokenUrl } = getMagentoConfig();

  let response: Response;
  try {
    response = await fetch(customerTokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: email, password }),
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
    if (response.status === 400 || response.status === 401) {
      throw new MagentoCustomerAuthError(
        "Email address or password was not recognised. Please try again.",
        "INVALID_CREDENTIALS",
        401,
      );
    }

    throw new MagentoCustomerAuthError(
      "We cannot reach the customer account service right now. Please try again shortly.",
      "SERVICE_UNAVAILABLE",
      503,
    );
  }

  let token: unknown;
  try {
    token = await response.json();
  } catch {
    throw new MagentoCustomerAuthError(
      "The customer account service returned an invalid response.",
      "INVALID_RESPONSE",
      502,
    );
  }

  if (typeof token !== "string" || !token.trim()) {
    throw new MagentoCustomerAuthError(
      "The customer account service returned an invalid response.",
      "INVALID_RESPONSE",
      502,
    );
  }

  return token;
}
