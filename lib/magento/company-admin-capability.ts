import { getMagentoConfig } from "@/lib/config";
import { getMagentoCustomerGraphQlHeaders } from "@/lib/magento/kiosk-bound-session";

type GraphQLErrorItem = { message?: string };
type GraphQLResponse<TData> = { data?: TData; errors?: GraphQLErrorItem[] };

type CompanyAdminCapabilityData = {
  css_company_admin?: {
    company_id?: number | null;
    company_user_id?: number | null;
    is_company_admin?: boolean | null;
  } | null;
};

export type KioskCompanyAdminCapability = {
  companyId: number;
  companyUserId: number;
  isCompanyAdmin: boolean;
};

export class MagentoCompanyAdminCapabilityError extends Error {
  constructor(
    message: string,
    readonly code: "UNAVAILABLE" | "REJECTED" | "INVALID_RESPONSE",
  ) {
    super(message);
    this.name = "MagentoCompanyAdminCapabilityError";
  }
}

const COMPANY_ADMIN_CAPABILITY_QUERY = /* GraphQL */ `
  query KioskCompanyAdminCapability {
    css_company_admin {
      company_id
      company_user_id
      is_company_admin
    }
  }
`;

export async function getKioskCompanyAdminCapability(input: {
  token: string;
  companyId: number;
  companyUserId: number;
}): Promise<KioskCompanyAdminCapability> {
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
        query: COMPANY_ADMIN_CAPABILITY_QUERY,
        variables: {},
      }),
      cache: "no-store",
    });
  } catch {
    throw new MagentoCompanyAdminCapabilityError(
      "Company administration capability is unavailable right now.",
      "UNAVAILABLE",
    );
  }

  let body: GraphQLResponse<CompanyAdminCapabilityData>;
  try {
    body = (await response.json()) as GraphQLResponse<CompanyAdminCapabilityData>;
  } catch {
    throw new MagentoCompanyAdminCapabilityError(
      "Magento returned an invalid company administration response.",
      "INVALID_RESPONSE",
    );
  }

  if (body.errors?.length) {
    throw new MagentoCompanyAdminCapabilityError(
      body.errors[0]?.message || "Company administration access was rejected.",
      "REJECTED",
    );
  }

  if (!response.ok) {
    throw new MagentoCompanyAdminCapabilityError(
      "Company administration capability is unavailable right now.",
      "UNAVAILABLE",
    );
  }

  const capability = body.data?.css_company_admin;
  if (
    !capability ||
    typeof capability.company_id !== "number" ||
    typeof capability.company_user_id !== "number" ||
    typeof capability.is_company_admin !== "boolean"
  ) {
    throw new MagentoCompanyAdminCapabilityError(
      "Magento returned an invalid company administration capability.",
      "INVALID_RESPONSE",
    );
  }

  if (
    capability.company_id !== input.companyId ||
    capability.company_user_id !== input.companyUserId
  ) {
    throw new MagentoCompanyAdminCapabilityError(
      "Magento returned company administration capability for the wrong company context.",
      "INVALID_RESPONSE",
    );
  }

  return {
    companyId: capability.company_id,
    companyUserId: capability.company_user_id,
    isCompanyAdmin: capability.is_company_admin,
  };
}
