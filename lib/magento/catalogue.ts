import { getMagentoConfig } from "@/lib/config";

export type KioskCatalogueCategory = {
  uid: string;
  name: string;
  urlKey: string | null;
  productCount: number;
};

export type KioskCatalogueProduct = {
  uid: string;
  sku: string;
  name: string;
  productType: string;
  urlKey: string | null;
  imageUrl: string | null;
  imageLabel: string | null;
  stockStatus: string | null;
  price: {
    value: number;
    regularValue: number;
    currency: string;
  } | null;
};

export type KioskCatalogueResult = {
  categories: KioskCatalogueCategory[];
  products: KioskCatalogueProduct[];
  totalCount: number;
  currentPage: number;
  totalPages: number;
};

type GraphQLErrorItem = { message?: string };
type GraphQLResponse<TData> = {
  data?: TData;
  errors?: GraphQLErrorItem[];
};

type CategoryRow = {
  uid?: string | null;
  name?: string | null;
  url_key?: string | null;
  product_count?: number | null;
  include_in_menu?: number | boolean | null;
};

type ProductRow = {
  __typename?: string | null;
  uid?: string | null;
  sku?: string | null;
  name?: string | null;
  url_key?: string | null;
  stock_status?: string | null;
  small_image?: {
    url?: string | null;
    label?: string | null;
  } | null;
  price_range?: {
    minimum_price?: {
      regular_price?: {
        value?: number | null;
        currency?: string | null;
      } | null;
      final_price?: {
        value?: number | null;
        currency?: string | null;
      } | null;
    } | null;
  } | null;
};

type CatalogueData = {
  categoryList?:
    | Array<{ children?: CategoryRow[] | null }>
    | { children?: CategoryRow[] | null }
    | null;
  products?: {
    total_count?: number | null;
    page_info?: {
      current_page?: number | null;
      total_pages?: number | null;
    } | null;
    items?: Array<ProductRow | null> | null;
  } | null;
};

export class MagentoCatalogueError extends Error {
  constructor(
    message: string,
    readonly code: "UNAVAILABLE" | "REJECTED" | "INVALID_RESPONSE",
  ) {
    super(message);
    this.name = "MagentoCatalogueError";
  }
}

const CATEGORY_SELECTION = /* GraphQL */ `
  categoryList {
    children {
      uid
      name
      url_key
      product_count
      include_in_menu
    }
  }
`;

const PRODUCT_SELECTION = /* GraphQL */ `
  total_count
  page_info {
    current_page
    total_pages
  }
  items {
    __typename
    uid
    sku
    name
    url_key
    stock_status
    small_image {
      url
      label
    }
    price_range {
      minimum_price {
        regular_price {
          value
          currency
        }
        final_price {
          value
          currency
        }
      }
    }
  }
`;

const BROWSE_CATALOGUE_QUERY = /* GraphQL */ `
  query KioskCatalogueBrowse(
    $filter: ProductAttributeFilterInput!
    $pageSize: Int!
    $currentPage: Int!
  ) {
    ${CATEGORY_SELECTION}
    products(
      filter: $filter
      pageSize: $pageSize
      currentPage: $currentPage
      sort: { name: ASC }
    ) {
      ${PRODUCT_SELECTION}
    }
  }
`;

// Keep Magento full-text search separate from browse/category filtering. Some
// Magento search backends reject the old search + explicit null filter shape.
const SEARCH_CATALOGUE_QUERY = /* GraphQL */ `
  query KioskCatalogueSearch(
    $search: String!
    $pageSize: Int!
    $currentPage: Int!
  ) {
    ${CATEGORY_SELECTION}
    products(
      search: $search
      pageSize: $pageSize
      currentPage: $currentPage
    ) {
      ${PRODUCT_SELECTION}
    }
  }
`;

function categoryRows(categoryList: CatalogueData["categoryList"]): CategoryRow[] {
  if (!categoryList) return [];
  const roots = Array.isArray(categoryList) ? categoryList : [categoryList];
  return roots.flatMap((root) => root.children || []);
}

function priceFor(item: ProductRow) {
  const minimum = item.price_range?.minimum_price;
  const finalPrice = minimum?.final_price;
  const regularPrice = minimum?.regular_price;
  const value = finalPrice?.value;
  const regularValue = regularPrice?.value;
  const currency = finalPrice?.currency || regularPrice?.currency;

  if (typeof value !== "number" || typeof regularValue !== "number" || !currency) {
    return null;
  }

  return {
    value,
    regularValue,
    currency,
  };
}

export async function getAuthenticatedCatalogue(input: {
  token: string;
  search?: string;
  categoryUid?: string;
  page?: number;
  pageSize?: number;
}): Promise<KioskCatalogueResult> {
  const { graphqlUrl, storeCode } = getMagentoConfig();
  const search = input.search?.trim() || "";
  const categoryUid = input.categoryUid?.trim() || "";
  const pageSize = Math.max(1, Math.min(24, Math.trunc(input.pageSize || 8)));
  const currentPage = Math.max(1, Math.trunc(input.page || 1));

  const query = search ? SEARCH_CATALOGUE_QUERY : BROWSE_CATALOGUE_QUERY;
  const variables = search
    ? { search, pageSize, currentPage }
    : {
        filter: categoryUid
          ? { category_uid: { eq: categoryUid } }
          : { price: { from: "0" } },
        pageSize,
        currentPage,
      };

  let response: Response;
  try {
    response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        Store: storeCode,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      cache: "no-store",
    });
  } catch {
    throw new MagentoCatalogueError(
      "The trade catalogue is unavailable right now.",
      "UNAVAILABLE",
    );
  }

  if (!response.ok) {
    throw new MagentoCatalogueError(
      "The trade catalogue is unavailable right now.",
      "UNAVAILABLE",
    );
  }

  let body: GraphQLResponse<CatalogueData>;
  try {
    body = (await response.json()) as GraphQLResponse<CatalogueData>;
  } catch {
    throw new MagentoCatalogueError(
      "The trade catalogue returned an invalid response.",
      "INVALID_RESPONSE",
    );
  }

  if (body.errors?.length) {
    throw new MagentoCatalogueError(
      body.errors[0]?.message || "The trade catalogue could not be loaded.",
      "REJECTED",
    );
  }

  const productData = body.data?.products;
  if (!productData || !Array.isArray(productData.items)) {
    throw new MagentoCatalogueError(
      "The trade catalogue returned an invalid response.",
      "INVALID_RESPONSE",
    );
  }

  const categories = categoryRows(body.data?.categoryList)
    .filter((category) => {
      if (!category.uid || !category.name) return false;
      if (category.include_in_menu === 0 || category.include_in_menu === false) return false;
      return true;
    })
    .map((category) => ({
      uid: category.uid as string,
      name: category.name as string,
      urlKey: category.url_key || null,
      productCount: typeof category.product_count === "number" ? category.product_count : 0,
    }));

  const products = productData.items
    .filter((item): item is ProductRow => Boolean(item?.uid && item?.sku && item?.name))
    .map((item) => ({
      uid: item.uid as string,
      sku: item.sku as string,
      name: item.name as string,
      productType: item.__typename || "ProductInterface",
      urlKey: item.url_key || null,
      imageUrl: item.small_image?.url || null,
      imageLabel: item.small_image?.label || null,
      stockStatus: item.stock_status || null,
      price: priceFor(item),
    }));

  return {
    categories,
    products,
    totalCount: typeof productData.total_count === "number" ? productData.total_count : products.length,
    currentPage: productData.page_info?.current_page || currentPage,
    totalPages: productData.page_info?.total_pages || 1,
  };
}
