import { getMagentoConfig } from "@/lib/config";

const LOCKER_CARRIER_CODE = "csslocker";
const LOCKER_METHOD_CODE = "locker";
const PAYMENT_METHOD_CODE = "companycredit";

type GraphQLErrorItem = { message?: string };
type GraphQLResponse<TData> = { data?: TData; errors?: GraphQLErrorItem[] };

type CartContextData = {
  customerCart?: {
    id?: string | null;
    total_quantity?: number | null;
    available_payment_methods?: Array<{
      code?: string | null;
      title?: string | null;
    } | null> | null;
    shipping_addresses?: Array<{
      selected_shipping_method?: {
        carrier_code?: string | null;
        method_code?: string | null;
      } | null;
    } | null> | null;
  } | null;
};

type SetPaymentData = {
  setPaymentMethodOnCart?: {
    cart?: {
      selected_payment_method?: {
        code?: string | null;
        title?: string | null;
      } | null;
    } | null;
  } | null;
};

type SubmitCreditOrderData = {
  cssSubmitCreditOrder?: {
    credit_order_id?: number | null;
    credit_order_number?: string | null;
    status?: string | null;
    auto_approved?: boolean | null;
    approval_required?: boolean | null;
    grand_total?: number | null;
    payment_method?: string | null;
    order_id?: number | null;
    order_number?: string | null;
    order_placed?: boolean | null;
  } | null;
};

type LockerStatusData = {
  css_kiosk_locker_order_status?: {
    magento_order_number?: string | null;
    ogl_order_number?: string | null;
    ogl_exported?: boolean | null;
    shipping_method?: string | null;
    order_status?: string | null;
  } | null;
};

export type KioskLockerOrderSubmission = {
  creditOrderId: number;
  creditOrderNumber: string | null;
  status: string;
  autoApproved: boolean;
  approvalRequired: boolean;
  grandTotal: number;
  paymentMethod: string;
  orderId: number | null;
  orderNumber: string | null;
  orderPlaced: boolean;
  oglOrderNumber: string | null;
  oglExported: boolean;
};

export class MagentoLockerOrderError extends Error {
  constructor(
    message: string,
    readonly code: "UNAVAILABLE" | "REJECTED" | "INVALID_RESPONSE",
  ) {
    super(message);
    this.name = "MagentoLockerOrderError";
  }
}

const CART_CONTEXT_QUERY = /* GraphQL */ `
  query KioskLockerOrderCartContext {
    customerCart {
      id
      total_quantity
      available_payment_methods {
        code
        title
      }
      shipping_addresses {
        selected_shipping_method {
          carrier_code
          method_code
        }
      }
    }
  }
`;

const SET_PAYMENT_METHOD_MUTATION = /* GraphQL */ `
  mutation KioskSetLockerPaymentMethod($cartId: String!, $code: String!) {
    setPaymentMethodOnCart(
      input: {
        cart_id: $cartId
        payment_method: { code: $code }
      }
    ) {
      cart {
        selected_payment_method {
          code
          title
        }
      }
    }
  }
`;

const SUBMIT_CREDIT_ORDER_MUTATION = /* GraphQL */ `
  mutation KioskSubmitLockerCreditOrder($cartId: String!) {
    cssSubmitCreditOrder(input: { cart_id: $cartId }) {
      credit_order_id
      credit_order_number
      status
      auto_approved
      approval_required
      grand_total
      payment_method
      order_id
      order_number
      order_placed
    }
  }
`;

const LOCKER_ORDER_STATUS_QUERY = /* GraphQL */ `
  query KioskLockerOrderStatus($orderNumber: String!) {
    css_kiosk_locker_order_status(order_number: $orderNumber) {
      magento_order_number
      ogl_order_number
      ogl_exported
      shipping_method
      order_status
    }
  }
`;

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
    throw new MagentoLockerOrderError("Magento order submission is unavailable right now.", "UNAVAILABLE");
  }

  let body: GraphQLResponse<TData>;
  try {
    body = (await response.json()) as GraphQLResponse<TData>;
  } catch {
    throw new MagentoLockerOrderError("Magento returned an invalid order response.", "INVALID_RESPONSE");
  }

  if (body.errors?.length) {
    throw new MagentoLockerOrderError(
      body.errors[0]?.message || "Magento rejected the locker order.",
      "REJECTED",
    );
  }

  if (!response.ok) {
    throw new MagentoLockerOrderError("Magento order submission is unavailable right now.", "UNAVAILABLE");
  }

  if (!body.data) {
    throw new MagentoLockerOrderError("Magento returned an invalid order response.", "INVALID_RESPONSE");
  }

  return body.data;
}

async function tryLockerOrderStatus(token: string, orderNumber: string) {
  try {
    const data = await requestMagento<LockerStatusData>({
      token,
      query: LOCKER_ORDER_STATUS_QUERY,
      variables: { orderNumber },
    });
    const status = data.css_kiosk_locker_order_status;
    if (
      status?.magento_order_number === orderNumber &&
      status.shipping_method === `${LOCKER_CARRIER_CODE}_${LOCKER_METHOD_CODE}`
    ) {
      return {
        oglOrderNumber: status.ogl_order_number?.trim() || null,
        oglExported: Boolean(status.ogl_exported && status.ogl_order_number),
      };
    }
  } catch {
    // Order placement has already succeeded at this point. OGL status is best-effort only.
  }

  return { oglOrderNumber: null, oglExported: false };
}

export async function submitAuthenticatedLockerOrder(input: {
  token: string;
}): Promise<KioskLockerOrderSubmission> {
  const context = await requestMagento<CartContextData>({
    token: input.token,
    query: CART_CONTEXT_QUERY,
  });

  const cart = context.customerCart;
  const cartId = cart?.id?.trim() || "";
  const totalQuantity = cart?.total_quantity;
  const selectedShipping = cart?.shipping_addresses?.[0]?.selected_shipping_method || null;

  if (!cartId || typeof totalQuantity !== "number") {
    throw new MagentoLockerOrderError("Magento returned an invalid cart for order submission.", "INVALID_RESPONSE");
  }

  if (totalQuantity <= 0) {
    throw new MagentoLockerOrderError("Your basket is empty.", "REJECTED");
  }

  if (
    selectedShipping?.carrier_code !== LOCKER_CARRIER_CODE ||
    selectedShipping.method_code !== LOCKER_METHOD_CODE
  ) {
    throw new MagentoLockerOrderError(
      "The local locker delivery method must be confirmed before placing this order.",
      "REJECTED",
    );
  }

  const paymentAvailable = Boolean(
    cart?.available_payment_methods?.some((method) => method?.code === PAYMENT_METHOD_CODE),
  );
  if (!paymentAvailable) {
    throw new MagentoLockerOrderError(
      "Payment on Account is not available for this trade account.",
      "REJECTED",
    );
  }

  const payment = await requestMagento<SetPaymentData>({
    token: input.token,
    query: SET_PAYMENT_METHOD_MUTATION,
    variables: {
      cartId,
      code: PAYMENT_METHOD_CODE,
    },
  });

  if (payment.setPaymentMethodOnCart?.cart?.selected_payment_method?.code !== PAYMENT_METHOD_CODE) {
    throw new MagentoLockerOrderError(
      "Magento did not confirm Payment on Account for this order.",
      "INVALID_RESPONSE",
    );
  }

  const submitted = await requestMagento<SubmitCreditOrderData>({
    token: input.token,
    query: SUBMIT_CREDIT_ORDER_MUTATION,
    variables: { cartId },
  });

  const result = submitted.cssSubmitCreditOrder;
  if (
    !result ||
    typeof result.credit_order_id !== "number" ||
    result.credit_order_id <= 0 ||
    !result.status ||
    typeof result.grand_total !== "number" ||
    !result.payment_method ||
    typeof result.order_placed !== "boolean"
  ) {
    throw new MagentoLockerOrderError("Magento returned an invalid credit-order response.", "INVALID_RESPONSE");
  }

  if (result.payment_method !== PAYMENT_METHOD_CODE) {
    throw new MagentoLockerOrderError(
      "Magento returned an unexpected payment method for this order.",
      "INVALID_RESPONSE",
    );
  }

  const orderNumber = result.order_number?.trim() || null;
  const orderPlaced = result.order_placed;
  if (orderPlaced && !orderNumber) {
    throw new MagentoLockerOrderError(
      "Magento placed the order without returning its order number.",
      "INVALID_RESPONSE",
    );
  }

  const ogl = orderPlaced && orderNumber
    ? await tryLockerOrderStatus(input.token, orderNumber)
    : { oglOrderNumber: null, oglExported: false };

  return {
    creditOrderId: result.credit_order_id,
    creditOrderNumber: result.credit_order_number?.trim() || null,
    status: result.status,
    autoApproved: Boolean(result.auto_approved),
    approvalRequired: Boolean(result.approval_required),
    grandTotal: result.grand_total,
    paymentMethod: result.payment_method,
    orderId: typeof result.order_id === "number" && result.order_id > 0 ? result.order_id : null,
    orderNumber,
    orderPlaced,
    oglOrderNumber: ogl.oglOrderNumber,
    oglExported: ogl.oglExported,
  };
}
