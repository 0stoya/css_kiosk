import { getMagentoConfig } from "@/lib/config";

export type KioskCompanyOrder = {
  number: string;
  status: string;
  orderDate: string;
};

type GraphQLErrorItem = { message?: string };
type GraphQLResponse<TData> = {
  data?: TData;
  errors?: GraphQLErrorItem[];
};

type CompanyOrdersData = {
  css_company_orders?: {
    total_count?: number | null;
    items?: Array<{
      number?: string | null;
      status?: string | null;
      order_date?: string | null;
    } | null> | null;
  } | null;
};

export class MagentoCompanyOrdersError extends Error {
  constructor(
    message: string,
    readonly code: "UNAVAILABLE" | "REJECTED" | "INVALID_RESPONSE",
  ) {
    super(message);
    this.name = "MagentoCompanyOrdersError";
  }
}

const COMPANY_ORDERS_QUERY = /* GraphQL */ `
  query KioskCompanyOrders($currentPage: Int!, $pageSize: Int!) {
    css_company_orders(currentPage: $currentPage, pageSize: $pageSize) {
      total_count
      items {
        number
        status
        order_date
      }
    }
  }
`;

export async function getAuthenticatedCompanyOrders(input: {
  token: string;
  page?: number;
  pageSize?: number;
}) {
  const { graphqlUrl, storeCode } = getMagentoConfig();
  const currentPage = Math.max(1, Math.trunc(input.page || 1));
  const pageSize = Math.max(1, Math.min(20, Math.trunc(input.pageSize || 5)));

  let response: Response;
  try {
    response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        Store: storeCode,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: COMPANY_ORDERS_QUERY,
        variables: { currentPage, pageSize },
      }),
      cache: "no-store",
    });
  } catch {
    throw new MagentoCompanyOrdersError("Order history is unavailable right now.", "UNAVAILABLE");
  }

  if (!response.ok) {
    throw new MagentoCompanyOrdersError("Order history is unavailable right now.", "UNAVAILABLE");
  }

  let body: GraphQLResponse<CompanyOrdersData>;
  try {
    body = (await response.json()) as GraphQLResponse<CompanyOrdersData>;
  } catch {
    throw new MagentoCompanyOrdersError("Order history returned an invalid response.", "INVALID_RESPONSE");
  }

  if (body.errors?.length) {
    throw new MagentoCompanyOrdersError(
      body.errors[0]?.message || "Order history could not be loaded.",
      "REJECTED",
    );
  }

  const result = body.data?.css_company_orders;
  if (!result || !Array.isArray(result.items)) {
    throw new MagentoCompanyOrdersError("Order history returned an invalid response.", "INVALID_RESPONSE");
  }

  const orders: KioskCompanyOrder[] = result.items
    .filter((item): item is NonNullable<typeof item> => Boolean(item?.number))
    .map((item) => ({
      number: item.number as string,
      status: item.status?.trim() || "Unknown",
      orderDate: item.order_date?.trim() || "",
    }));

  return {
    totalCount: typeof result.total_count === "number" ? result.total_count : orders.length,
    orders,
  };
}
