import { getMagentoConfig } from "@/lib/config";

export type KioskConfigurableValue = {
  uid: string;
  label: string;
};

export type KioskConfigurableOption = {
  uid: string;
  attributeCode: string;
  label: string;
  values: KioskConfigurableValue[];
};

export type KioskBundleChoice = {
  uid: string;
  label: string;
  isDefault: boolean;
  canChangeQuantity: boolean;
  quantity: number;
  sku: string | null;
  name: string | null;
  stockStatus: string | null;
};

export type KioskBundleItem = {
  uid: string;
  title: string;
  type: string;
  required: boolean;
  choices: KioskBundleChoice[];
};

export type KioskGroupedItem = {
  sku: string;
  name: string;
  stockStatus: string | null;
  defaultQuantity: number;
};

export type KioskProductOptions = {
  sku: string;
  productType: string;
  configurableOptions: KioskConfigurableOption[];
  bundleItems: KioskBundleItem[];
  groupedItems: KioskGroupedItem[];
};

type GraphQLErrorItem = { message?: string };
type GraphQLResponse<TData> = {
  data?: TData;
  errors?: GraphQLErrorItem[];
};

type ProductOptionsData = {
  products?: {
    items?: Array<{
      __typename?: string | null;
      sku?: string | null;
      configurable_options?: Array<{
        uid?: string | null;
        attribute_code?: string | null;
        label?: string | null;
        values?: Array<{
          uid?: string | null;
          label?: string | null;
        } | null> | null;
      } | null> | null;
      items?: Array<{
        uid?: string | null;
        title?: string | null;
        type?: string | null;
        required?: boolean | null;
        options?: Array<{
          uid?: string | null;
          label?: string | null;
          is_default?: boolean | null;
          can_change_quantity?: boolean | null;
          quantity?: number | null;
          product?: {
            sku?: string | null;
            name?: string | null;
            stock_status?: string | null;
          } | null;
        } | null> | null;
        qty?: number | null;
        position?: number | null;
        product?: {
          sku?: string | null;
          name?: string | null;
          stock_status?: string | null;
        } | null;
      } | null> | null;
    } | null> | null;
  } | null;
};

export class MagentoProductOptionsError extends Error {
  constructor(
    message: string,
    readonly code: "UNAVAILABLE" | "REJECTED" | "INVALID_RESPONSE" | "NOT_FOUND",
  ) {
    super(message);
    this.name = "MagentoProductOptionsError";
  }
}

const PRODUCT_OPTIONS_QUERY = /* GraphQL */ `
  query KioskProductOptions($sku: String!) {
    products(filter: { sku: { eq: $sku } }) {
      items {
        __typename
        sku
        ... on ConfigurableProduct {
          configurable_options {
            uid
            attribute_code
            label
            values {
              uid
              label
            }
          }
        }
        ... on BundleProduct {
          items {
            uid
            title
            type
            required
            options {
              uid
              label
              is_default
              can_change_quantity
              quantity
              product {
                sku
                name
                stock_status
              }
            }
          }
        }
        ... on GroupedProduct {
          items {
            qty
            position
            product {
              sku
              name
              stock_status
            }
          }
        }
      }
    }
  }
`;

export async function getAuthenticatedProductOptions(input: {
  token: string;
  sku: string;
}): Promise<KioskProductOptions> {
  const { graphqlUrl, storeCode } = getMagentoConfig();

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
        query: PRODUCT_OPTIONS_QUERY,
        variables: { sku: input.sku },
      }),
      cache: "no-store",
    });
  } catch {
    throw new MagentoProductOptionsError(
      "Product options are unavailable right now.",
      "UNAVAILABLE",
    );
  }

  let body: GraphQLResponse<ProductOptionsData>;
  try {
    body = (await response.json()) as GraphQLResponse<ProductOptionsData>;
  } catch {
    throw new MagentoProductOptionsError(
      "Magento returned an invalid product option response.",
      "INVALID_RESPONSE",
    );
  }

  if (body.errors?.length) {
    throw new MagentoProductOptionsError(
      body.errors[0]?.message || "Magento rejected the product option request.",
      "REJECTED",
    );
  }

  if (!response.ok) {
    throw new MagentoProductOptionsError(
      "Product options are unavailable right now.",
      "UNAVAILABLE",
    );
  }

  const row = body.data?.products?.items?.find((item) => item?.sku === input.sku) || null;
  if (!row?.sku || !row.__typename) {
    throw new MagentoProductOptionsError("Product could not be found.", "NOT_FOUND");
  }

  const configurableOptions = (row.configurable_options || [])
    .filter((option) => Boolean(option?.uid && option?.attribute_code && option?.label))
    .map((option) => ({
      uid: option!.uid as string,
      attributeCode: option!.attribute_code as string,
      label: option!.label as string,
      values: (option!.values || [])
        .filter((value) => Boolean(value?.uid && value?.label))
        .map((value) => ({ uid: value!.uid as string, label: value!.label as string })),
    }));

  const bundleItems = row.__typename === "BundleProduct"
    ? (row.items || [])
        .filter((item) => Boolean(item?.uid && item?.title && item?.type))
        .map((item) => ({
          uid: item!.uid as string,
          title: item!.title as string,
          type: item!.type as string,
          required: item!.required === true,
          choices: (item!.options || [])
            .filter((option) => Boolean(option?.uid && option?.label))
            .map((option) => ({
              uid: option!.uid as string,
              label: option!.label as string,
              isDefault: option!.is_default === true,
              canChangeQuantity: option!.can_change_quantity === true,
              quantity:
                typeof option!.quantity === "number" && option!.quantity > 0
                  ? option!.quantity
                  : 1,
              sku: option!.product?.sku || null,
              name: option!.product?.name || null,
              stockStatus: option!.product?.stock_status || null,
            })),
        }))
    : [];

  const groupedItems = row.__typename === "GroupedProduct"
    ? (row.items || [])
        .filter((item) => Boolean(item?.product?.sku && item?.product?.name))
        .sort((a, b) => (a?.position || 0) - (b?.position || 0))
        .map((item) => ({
          sku: item!.product!.sku as string,
          name: item!.product!.name as string,
          stockStatus: item!.product!.stock_status || null,
          defaultQuantity:
            typeof item!.qty === "number" && item!.qty > 0 && Number.isFinite(item!.qty)
              ? Math.min(999, Math.max(1, Math.trunc(item!.qty)))
              : 0,
        }))
    : [];

  return {
    sku: row.sku,
    productType: row.__typename,
    configurableOptions,
    bundleItems,
    groupedItems,
  };
}
