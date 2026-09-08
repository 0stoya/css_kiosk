import { getKioskCatalogueConfig, getMagentoConfig } from "@/lib/config";

export type KioskCatalogueCategory = {
  uid: string;
  name: string;
  urlKey: string | null;
  imageUrl: string | null;
  position: number;
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
  image?: string | null;
  position?: number | null;
  product_count?: number | null;
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

type CategoryData = {
  categories?: {
    items?: Array<CategoryRow | null> | null;
  } | null;
};

type ProductData = {
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

const KIOSK_CATEGORIES_QUERY = /* GraphQL */ `
  query KioskCatalogueCategories($rootUid: String!) {
    categories(
      filters: { parent_category_uid: { eq: $rootUid } }
      pageSize: 50
      currentPage: 1
    ) {
      items {
        uid
        name
        url_key
        image
        position
        product_count
      }
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

const BROWSE_PRODUCTS_QUERY = /* GraphQL */ `
  query KioskCatalogueBrowse(
    $pageSize: Int!
    $currentPage: Int!
  ) {
    products(
      pageSize: $pageSize
      currentPage: $currentPage
      sort: { name: ASC }
    ) {
      ${PRODUCT_SELECTION}
    }
  }
`;

const FILTERED_BROWSE_PRODUCTS_QUERY = /* GraphQL */ `
  query KioskCatalogueCategoryBrowse(
    $filter: ProductAttributeFilterInput!
    $pageSize: Int!
    $currentPage: Int!
  ) {
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

const SEARCH_PRODUCTS_QUERY = /* GraphQL */ `
  query KioskCatalogueSearch(
    $search: String!
    $pageSize: Int!
    $currentPage: Int!
  ) {
    products(
      search: $search
      pageSize: $pageSize
      currentPage: $currentPage
    ) {
      ${PRODUCT_SELECTION}
    }
  }
`;

const FILTERED_SEARCH_PRODUCTS_QUERY = /* GraphQL */ `
  query KioskCatalogueCategorySearch(
    $search: String!
    $filter: ProductAttributeFilterInput!
    $pageSize: Int!
    $currentPage: Int!
  ) {
    products(
      search: $search
      filter: $filter
      pageSize: $pageSize
      currentPage: $currentPage
    ) {
      ${PRODUCT_SELECTION}
    }
  }
`;

async function requestGraphQl<TData>(input: {
  graphqlUrl: string;
  storeCode: string;
  token: string;
  query: string;
  variables: Record<string, unknown>;
}): Promise<TData> {
  let response: Response;
  try {
    response = await fetch(input.graphqlUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.token}`,
        Store: input.storeCode,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: input.query, variables: input.variables }),
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

  let body: GraphQLResponse<TData>;
  try {
    body = (await response.json()) as GraphQLResponse<TData>;
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

  if (!body.data) {
    throw new MagentoCatalogueError(
      "The trade catalogue returned an invalid response.",
      "INVALID_RESPONSE",
    );
  }

  return body.data;
}

function categoryImageUrl(baseUrl: string, image: string | null | undefined) {
  const value = image?.trim();
  if (!value) return null;

  try {
    const absolute = new URL(value);
    if (absolute.protocol === "https:" || absolute.protocol === "http:") {
      return absolute.toString();
    }
  } catch {
    // Magento commonly returns the category image filename rather than an absolute URL.
  }

  const relative = value.replace(/^\/+/, "");
  const path = relative.startsWith("media/")
    ? `/${relative}`
    : `/media/catalog/category/${relative}`;

  try {
    return new URL(path, `${baseUrl}/`).toString();
  } catch {
    return null;
  }
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
  const { baseUrl, graphqlUrl, storeCode } = getMagentoConfig();
  const { categoryRootUid } = getKioskCatalogueConfig();
  const search = input.search?.trim() || "";
  const categoryUid = input.categoryUid?.trim() || "";
  const pageSize = Math.max(1, Math.min(24, Math.trunc(input.pageSize || 8)));
  const currentPage = Math.max(1, Math.trunc(input.page || 1));

  const categoryData = await requestGraphQl<CategoryData>({
    graphqlUrl,
    storeCode,
    token: input.token,
    query: KIOSK_CATEGORIES_QUERY,
    variables: { rootUid: categoryRootUid },
  });

  const categoryItems = categoryData.categories?.items;
  if (!Array.isArray(categoryItems)) {
    throw new MagentoCatalogueError(
      "The kiosk categories returned an invalid response.",
      "INVALID_RESPONSE",
    );
  }

  const categories = categoryItems
    .filter((category): category is CategoryRow => Boolean(category?.uid && category?.name))
    .map((category) => ({
      uid: category.uid as string,
      name: category.name as string,
      urlKey: category.url_key || null,
      imageUrl: categoryImageUrl(baseUrl, category.image),
      position: typeof category.position === "number" ? category.position : 0,
      productCount: typeof category.product_count === "number" ? category.product_count : 0,
    }))
    .sort((left, right) => left.position - right.position || left.name.localeCompare(right.name));

  const kioskCategoryUids = categories.map((category) => category.uid);
  if (categoryUid && !kioskCategoryUids.includes(categoryUid)) {
    throw new MagentoCatalogueError(
      "The selected category is not available on this kiosk.",
      "REJECTED",
    );
  }

  let query: string;
  let variables: Record<string, unknown>;

  if (search && categoryUid) {
    query = FILTERED_SEARCH_PRODUCTS_QUERY;
    variables = {
      search,
      filter: { category_uid: { eq: categoryUid } },
      pageSize,
      currentPage,
    };
  } else if (search) {
    query = SEARCH_PRODUCTS_QUERY;
    variables = { search, pageSize, currentPage };
  } else if (categoryUid) {
    query = FILTERED_BROWSE_PRODUCTS_QUERY;
    variables = {
      filter: { category_uid: { eq: categoryUid } },
      pageSize,
      currentPage,
    };
  } else {
    query = BROWSE_PRODUCTS_QUERY;
    variables = { pageSize, currentPage };
  }

  const productData = await requestGraphQl<ProductData>({
    graphqlUrl,
    storeCode,
    token: input.token,
    query,
    variables,
  });

  const productsResult = productData.products;
  if (!productsResult || !Array.isArray(productsResult.items)) {
    throw new MagentoCatalogueError(
      "The trade catalogue returned an invalid response.",
      "INVALID_RESPONSE",
    );
  }

  const products = productsResult.items
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
    totalCount:
      typeof productsResult.total_count === "number"
        ? productsResult.total_count
        : products.length,
    currentPage: productsResult.page_info?.current_page || currentPage,
    totalPages: productsResult.page_info?.total_pages || 1,
  };
}
