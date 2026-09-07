import { getMagentoConfig } from "@/lib/config";

export type KioskBasketLine = {
  uid: string;
  quantity: number;
  sku: string;
  name: string;
  imageUrl: string | null;
  imageLabel: string | null;
  stockStatus: string | null;
  unitPrice: {
    value: number;
    currency: string;
  } | null;
  rowTotal: {
    value: number;
    currency: string;
  } | null;
};

export type KioskBasket = {
  totalQuantity: number;
  items: KioskBasketLine[];
  subtotal: {
    value: number;
    currency: string;
  } | null;
  grandTotal: {
    value: number;
    currency: string;
  } | null;
};

type Money = {
  value?: number | null;
  currency?: string | null;
} | null;

type CartItem = {
  uid?: string | null;
  quantity?: number | null;
  product?: {
    sku?: string | null;
    name?: string | null;
    stock_status?: string | null;
    small_image?: {
      url?: string | null;
      label?: string | null;
    } | null;
  } | null;
  prices?: {
    price?: Money;
    row_total?: Money;
  } | null;
} | null;

type CartRow = {
  id?: string | null;
  total_quantity?: number | null;
  items?: CartItem[] | null;
  prices?: {
    subtotal_excluding_tax?: Money;
    grand_total?: Money;
  } | null;
} | null;

type GraphQLErrorItem = { message?: string };
type GraphQLResponse<TData> = {
  data?: TData;
  errors?: GraphQLErrorItem[];
};

type CartMutationResult = {
  cart?: CartRow;
  user_errors?: Array<{ code?: string | null; message?: string | null }> | null;
} | null;

export class MagentoCartError extends Error {
  constructor(
    message: string,
    readonly code: "UNAVAILABLE" | "REJECTED" | "INVALID_RESPONSE",
  ) {
    super(message);
    this.name = "MagentoCartError";
  }
}

const CART_FIELDS = /* GraphQL */ `
  fragment KioskCartFields on Cart {
    id
    total_quantity
    items {
      uid
      quantity
      product {
        sku
        name
        stock_status
        small_image {
          url
          label
        }
      }
      prices {
        price {
          value
          currency
        }
        row_total {
          value
          currency
        }
      }
    }
    prices {
      subtotal_excluding_tax {
        value
        currency
      }
      grand_total {
        value
        currency
      }
    }
  }
`;

const CUSTOMER_CART_QUERY = /* GraphQL */ `
  ${CART_FIELDS}
  query KioskCustomerCart {
    customerCart {
      ...KioskCartFields
    }
  }
`;

const ADD_TO_CART_MUTATION = /* GraphQL */ `
  ${CART_FIELDS}
  mutation KioskAddProductsToCart($cartId: String!, $sku: String!, $quantity: Float!) {
    addProductsToCart(
      cartId: $cartId
      cartItems: [{ sku: $sku, quantity: $quantity }]
    ) {
      cart {
        ...KioskCartFields
      }
      user_errors {
        code
        message
      }
    }
  }
`;

const UPDATE_CART_MUTATION = /* GraphQL */ `
  ${CART_FIELDS}
  mutation KioskUpdateCartItem($cartId: String!, $itemUid: ID!, $quantity: Float!) {
    updateCartItems(
      input: {
        cart_id: $cartId
        cart_items: [{ cart_item_uid: $itemUid, quantity: $quantity }]
      }
    ) {
      cart {
        ...KioskCartFields
      }
    }
  }
`;

const REMOVE_CART_MUTATION = /* GraphQL */ `
  ${CART_FIELDS}
  mutation KioskRemoveCartItem($cartId: String!, $itemUid: ID!) {
    removeItemFromCart(
      input: { cart_id: $cartId, cart_item_uid: $itemUid }
    ) {
      cart {
        ...KioskCartFields
      }
    }
  }
`;

function money(value: Money) {
  if (typeof value?.value !== "number" || !value.currency) return null;
  return { value: value.value, currency: value.currency };
}

function safeCart(row: CartRow): KioskBasket {
  if (!row) {
    throw new MagentoCartError("Magento returned an invalid cart.", "INVALID_RESPONSE");
  }

  const items = (row.items || [])
    .filter((item): item is NonNullable<CartItem> => Boolean(item?.uid && item.product?.sku && item.product?.name))
    .map((item) => ({
      uid: item.uid as string,
      quantity: typeof item.quantity === "number" ? item.quantity : 0,
      sku: item.product!.sku as string,
      name: item.product!.name as string,
      imageUrl: item.product!.small_image?.url || null,
      imageLabel: item.product!.small_image?.label || null,
      stockStatus: item.product!.stock_status || null,
      unitPrice: money(item.prices?.price || null),
      rowTotal: money(item.prices?.row_total || null),
    }));

  return {
    totalQuantity:
      typeof row.total_quantity === "number"
        ? row.total_quantity
        : items.reduce((sum, item) => sum + item.quantity, 0),
    items,
    subtotal: money(row.prices?.subtotal_excluding_tax || null),
    grandTotal: money(row.prices?.grand_total || null),
  };
}

async function requestMagento<TData>(input: {
  token: string;
  query: string;
  variables?: Record<string, unknown>;
}): Promise<TData> {
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
        query: input.query,
        variables: input.variables || {},
      }),
      cache: "no-store",
    });
  } catch {
    throw new MagentoCartError("The basket service is unavailable right now.", "UNAVAILABLE");
  }

  let body: GraphQLResponse<TData>;
  try {
    body = (await response.json()) as GraphQLResponse<TData>;
  } catch {
    throw new MagentoCartError("Magento returned an invalid basket response.", "INVALID_RESPONSE");
  }

  if (body.errors?.length) {
    throw new MagentoCartError(
      body.errors[0]?.message || "Magento rejected the basket request.",
      "REJECTED",
    );
  }

  if (!response.ok) {
    throw new MagentoCartError("The basket service is unavailable right now.", "UNAVAILABLE");
  }

  if (!body.data) {
    throw new MagentoCartError("Magento returned an invalid basket response.", "INVALID_RESPONSE");
  }

  return body.data;
}

async function customerCartRow(token: string) {
  const data = await requestMagento<{ customerCart?: CartRow }>({
    token,
    query: CUSTOMER_CART_QUERY,
  });

  const row = data.customerCart || null;
  if (!row?.id) {
    throw new MagentoCartError("Magento returned an invalid customer cart.", "INVALID_RESPONSE");
  }

  return row;
}

function mutationCart(result: CartMutationResult) {
  const userError = result?.user_errors?.find((item) => item?.message);
  if (userError?.message) {
    throw new MagentoCartError(userError.message, "REJECTED");
  }

  if (!result?.cart) {
    throw new MagentoCartError("Magento returned an invalid basket response.", "INVALID_RESPONSE");
  }

  return safeCart(result.cart);
}

export async function getAuthenticatedBasket(token: string): Promise<KioskBasket> {
  return safeCart(await customerCartRow(token));
}

export async function addAuthenticatedBasketItem(input: {
  token: string;
  sku: string;
  quantity: number;
}): Promise<KioskBasket> {
  const cart = await customerCartRow(input.token);
  const data = await requestMagento<{ addProductsToCart?: CartMutationResult }>({
    token: input.token,
    query: ADD_TO_CART_MUTATION,
    variables: {
      cartId: cart.id,
      sku: input.sku,
      quantity: input.quantity,
    },
  });

  return mutationCart(data.addProductsToCart || null);
}

export async function updateAuthenticatedBasketItem(input: {
  token: string;
  itemUid: string;
  quantity: number;
}): Promise<KioskBasket> {
  const cart = await customerCartRow(input.token);
  const data = await requestMagento<{ updateCartItems?: CartMutationResult }>({
    token: input.token,
    query: UPDATE_CART_MUTATION,
    variables: {
      cartId: cart.id,
      itemUid: input.itemUid,
      quantity: input.quantity,
    },
  });

  return mutationCart(data.updateCartItems || null);
}

export async function removeAuthenticatedBasketItem(input: {
  token: string;
  itemUid: string;
}): Promise<KioskBasket> {
  const cart = await customerCartRow(input.token);
  const data = await requestMagento<{ removeItemFromCart?: CartMutationResult }>({
    token: input.token,
    query: REMOVE_CART_MUTATION,
    variables: {
      cartId: cart.id,
      itemUid: input.itemUid,
    },
  });

  return mutationCart(data.removeItemFromCart || null);
}
