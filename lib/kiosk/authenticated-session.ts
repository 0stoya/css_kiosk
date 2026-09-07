import { createMagentoKioskAssertion } from "@/lib/kiosk/magento-assertion";
import { createKioskSession } from "@/lib/kiosk/session-store";
import { setKioskSessionId } from "@/lib/kiosk/session-cookie";
import type { VerifiedKioskCustomer } from "@/lib/magento/customer-context";
import { getVerifiedKioskCustomer } from "@/lib/magento/customer-context";
import {
  exchangeMagentoKioskAssertion,
  MagentoKioskSessionError,
} from "@/lib/magento/kiosk-session-exchange";
import { revokeMagentoCustomerToken } from "@/lib/magento/revoke-customer-token";

export class AuthenticatedKioskSessionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "SESSION_UNAVAILABLE"
      | "CUSTOMER_CHANGED"
      | "COMPANY_ACCESS_CHANGED",
    readonly status: number,
  ) {
    super(message);
    this.name = "AuthenticatedKioskSessionError";
  }
}

function currentCustomerForLinkedContext(
  linked: VerifiedKioskCustomer,
  fresh: VerifiedKioskCustomer,
): VerifiedKioskCustomer {
  if (fresh.customerId !== linked.customerId) {
    throw new AuthenticatedKioskSessionError(
      "This card no longer matches the current customer account.",
      "CUSTOMER_CHANGED",
      403,
    );
  }

  if (!linked.company) return fresh;

  const linkedCompany = fresh.companies.find(
    (company) => company.companyId === linked.company?.companyId,
  );

  if (!linkedCompany) {
    throw new AuthenticatedKioskSessionError(
      "This card's company access has changed. Please ask a member of staff for help.",
      "COMPANY_ACCESS_CHANGED",
      403,
    );
  }

  return {
    ...fresh,
    company: linkedCompany,
    companies: fresh.companies,
  };
}

export async function establishAuthenticatedKioskSession(input: {
  deviceId: string;
  linkedCustomer: VerifiedKioskCustomer;
}) {
  let magentoToken = "";

  try {
    const assertion = createMagentoKioskAssertion({
      customerId: input.linkedCustomer.customerId,
      deviceId: input.deviceId,
    });
    magentoToken = await exchangeMagentoKioskAssertion(assertion);

    const freshCustomer = await getVerifiedKioskCustomer(magentoToken);
    const customer = currentCustomerForLinkedContext(input.linkedCustomer, freshCustomer);
    const { sessionId, session } = createKioskSession({
      deviceId: input.deviceId,
      magentoToken,
      customer,
    });

    await setKioskSessionId(sessionId);

    return {
      customer,
      session: {
        authenticated: true as const,
        expiresAt: session.expiresAt,
      },
    };
  } catch (error) {
    if (magentoToken) {
      await revokeMagentoCustomerToken(magentoToken).catch(() => false);
    }

    if (error instanceof AuthenticatedKioskSessionError) throw error;
    if (error instanceof MagentoKioskSessionError) {
      throw new AuthenticatedKioskSessionError(
        error.message,
        "SESSION_UNAVAILABLE",
        error.code === "REJECTED" ? 401 : 503,
      );
    }

    throw new AuthenticatedKioskSessionError(
      "Customer session could not be established right now.",
      "SESSION_UNAVAILABLE",
      503,
    );
  }
}
