import { getMagentoConfig } from "@/lib/config";
import { getMagentoCustomerGraphQlHeaders } from "@/lib/magento/kiosk-bound-session";

const REVOKE_CUSTOMER_TOKEN_MUTATION = /* GraphQL */ `
  mutation KioskRevokeCustomerToken {
    revokeCustomerToken {
      result
    }
  }
`;

export async function revokeMagentoCustomerToken(token: string) {
  if (!token) return false;

  const { graphqlUrl } = getMagentoConfig();

  try {
    const response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        ...getMagentoCustomerGraphQlHeaders(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: REVOKE_CUSTOMER_TOKEN_MUTATION, variables: {} }),
      cache: "no-store",
    });

    if (!response.ok) return false;
    const body = (await response.json()) as {
      data?: { revokeCustomerToken?: { result?: boolean } };
      errors?: unknown[];
    };

    return !body.errors?.length && body.data?.revokeCustomerToken?.result === true;
  } catch {
    return false;
  }
}
