import { getMagentoConfig } from "@/lib/config";

export class MagentoKioskSessionError extends Error {
  constructor(message: string, readonly code: "UNAVAILABLE" | "REJECTED" | "INVALID_RESPONSE") {
    super(message);
    this.name = "MagentoKioskSessionError";
  }
}

const KIOSK_CUSTOMER_SESSION_MUTATION = /* GraphQL */ `
  mutation KioskCustomerSession($input: OstoyaKioskCustomerSessionInput!) {
    ostoya_kiosk_customer_session(input: $input) {
      token
    }
  }
`;

type KioskSessionResponse = {
  data?: {
    ostoya_kiosk_customer_session?: {
      token?: string | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
};

export async function exchangeMagentoKioskAssertion(assertion: string) {
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
        query: KIOSK_CUSTOMER_SESSION_MUTATION,
        variables: { input: { assertion } },
      }),
      cache: "no-store",
    });
  } catch {
    throw new MagentoKioskSessionError(
      "Customer session service is unavailable right now.",
      "UNAVAILABLE",
    );
  }

  if (!response.ok) {
    throw new MagentoKioskSessionError(
      "Customer session service is unavailable right now.",
      "UNAVAILABLE",
    );
  }

  let body: KioskSessionResponse;
  try {
    body = (await response.json()) as KioskSessionResponse;
  } catch {
    throw new MagentoKioskSessionError(
      "Customer session service returned an invalid response.",
      "INVALID_RESPONSE",
    );
  }

  if (body.errors?.length) {
    throw new MagentoKioskSessionError(
      "Customer session could not be established.",
      "REJECTED",
    );
  }

  const token = body.data?.ostoya_kiosk_customer_session?.token?.trim() || "";
  if (token.length < 16) {
    throw new MagentoKioskSessionError(
      "Customer session service returned an invalid response.",
      "INVALID_RESPONSE",
    );
  }

  return token;
}
