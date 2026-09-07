import { getMagentoConfig } from "@/lib/config";
import { MagentoCustomerAuthError } from "@/lib/magento/customer-auth";

export type KioskCompanySummary = {
  companyId: number;
  companyUserId: number;
  name: string | null;
  reference: string | null;
  selected: boolean;
};

export type VerifiedKioskCustomer = {
  customerId: number;
  firstName: string;
  lastName: string;
  email: string;
  company: KioskCompanySummary | null;
  companies: KioskCompanySummary[];
};

type GraphQLErrorItem = { message?: string };

type GraphQLResponse<TData> = {
  data?: TData;
  errors?: GraphQLErrorItem[];
};

type CustomerContextData = {
  customer: {
    firstname: string;
    lastname: string;
    email: string;
  } | null;
  css_company_context: {
    authenticated: boolean;
    customer_id: number | null;
    selected_company_id: number | null;
    companies: Array<{
      company_id: number;
      company_user_id: number;
      name: string | null;
      reference: string | null;
      active: boolean;
      selected: boolean;
    }>;
  };
};

const CUSTOMER_CONTEXT_QUERY = /* GraphQL */ `
  query KioskCustomerContext {
    customer {
      firstname
      lastname
      email
    }
    css_company_context {
      authenticated
      customer_id
      selected_company_id
      companies {
        company_id
        company_user_id
        name
        reference
        active
        selected
      }
    }
  }
`;

export async function getVerifiedKioskCustomer(token: string): Promise<VerifiedKioskCustomer> {
  const { graphqlUrl, storeCode } = getMagentoConfig();

  let response: Response;
  try {
    response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Store: storeCode,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: CUSTOMER_CONTEXT_QUERY, variables: {} }),
      cache: "no-store",
    });
  } catch {
    throw new MagentoCustomerAuthError(
      "We verified your password but could not load your customer account. Please try again.",
      "SERVICE_UNAVAILABLE",
      503,
    );
  }

  if (!response.ok) {
    throw new MagentoCustomerAuthError(
      "We verified your password but could not load your customer account. Please try again.",
      "SERVICE_UNAVAILABLE",
      503,
    );
  }

  let body: GraphQLResponse<CustomerContextData>;
  try {
    body = (await response.json()) as GraphQLResponse<CustomerContextData>;
  } catch {
    throw new MagentoCustomerAuthError(
      "The customer account service returned an invalid response.",
      "INVALID_RESPONSE",
      502,
    );
  }

  const customerId = body.data?.css_company_context?.customer_id;
  if (
    body.errors?.length ||
    !body.data?.customer ||
    !body.data.css_company_context?.authenticated ||
    typeof customerId !== "number" ||
    !Number.isInteger(customerId) ||
    customerId <= 0
  ) {
    throw new MagentoCustomerAuthError(
      "The customer account service could not confirm this account.",
      "INVALID_RESPONSE",
      502,
    );
  }

  const companies = body.data.css_company_context.companies
    .filter((company) => company.active)
    .map((company) => ({
      companyId: company.company_id,
      companyUserId: company.company_user_id,
      name: company.name,
      reference: company.reference,
      selected: company.selected,
    }));

  const selectedCompany =
    companies.find((company) => company.selected) ||
    companies.find((company) => company.companyId === body.data?.css_company_context.selected_company_id) ||
    companies[0] ||
    null;

  return {
    customerId,
    firstName: body.data.customer.firstname,
    lastName: body.data.customer.lastname,
    email: body.data.customer.email,
    company: selectedCompany,
    companies,
  };
}
