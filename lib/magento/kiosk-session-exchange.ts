import { getMagentoConfig } from "@/lib/config";

export class MagentoKioskSessionError extends Error {
  constructor(message: string, readonly code: "UNAVAILABLE" | "REJECTED" | "INVALID_RESPONSE") {
    super(message);
    this.name = "MagentoKioskSessionError";
  }
}

export async function exchangeMagentoKioskAssertion(assertion: string) {
  const { kioskCustomerSessionUrl } = getMagentoConfig();

  let response: Response;
  try {
    response = await fetch(kioskCustomerSessionUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assertion }),
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
      "Customer session could not be established.",
      response.status >= 500 ? "UNAVAILABLE" : "REJECTED",
    );
  }

  let token: unknown;
  try {
    token = await response.json();
  } catch {
    throw new MagentoKioskSessionError(
      "Customer session service returned an invalid response.",
      "INVALID_RESPONSE",
    );
  }

  if (typeof token !== "string" || token.trim().length < 16) {
    throw new MagentoKioskSessionError(
      "Customer session service returned an invalid response.",
      "INVALID_RESPONSE",
    );
  }

  return token.trim();
}
