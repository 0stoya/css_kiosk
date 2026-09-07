import { getMagentoConfig } from "@/lib/config";
import { getKioskLockerConfig } from "@/lib/kiosk/locker-config";
import type { VerifiedKioskCustomer } from "@/lib/magento/customer-context";

type GraphQLErrorItem = { message?: string };
type GraphQLResponse<TData> = { data?: TData; errors?: GraphQLErrorItem[] };
type Money = { value?: number | null; currency?: string | null } | null;

type CheckoutContextData = {
  customerCart?: {
    id?: string | null;
    total_quantity?: number | null;
  } | null;
  css_ordering_capabilities?: {
    authenticated?: boolean;
    company_context?: boolean;
    company_active?: boolean | null;
    can_checkout?: boolean;
    can_submit_credit_order?: boolean;
    can_auto_approve_credit_order?: boolean;
  } | null;
};

type ShippingMethod = {
  carrier_code?: string | null;
  method_code?: string | null;
  carrier_title?: string | null;
  method_title?: string | null;
  available?: boolean | null;
  error_message?: string | null;
  amount?: Money;
} | null;

type ShippingAddress = {
  available_shipping_methods?: ShippingMethod[] | null;
  selected_shipping_method?: ShippingMethod;
} | null;

type ShippingCart = {
  total_quantity?: number | null;
  shipping_addresses?: ShippingAddress[] | null;
  prices?: {
    subtotal_excluding_tax?: Money;
    grand_total?: Money;
  } | null;
} | null;

type SetAddressData = {
  setShippingAddressesOnCart?: { cart?: ShippingCart } | null;
};

type SetMethodData = {
  setShippingMethodsOnCart?: { cart?: ShippingCart } | null;
};

export type KioskLockerCheckoutReview = {
  locker: {
    label: string;
    street: string[];
    city: string;
    region: string | null;
    postcode: string;
    countryCode: string;
  };
  shipping: {
    carrierCode: string;
    methodCode: string;
    carrierTitle: string;
    methodTitle: string;
    amount: { value: number; currency: string } | null;
  };
  basket: {
    totalQuantity: number;
    subtotal: { value: number; currency: string } | null;
    grandTotal: { value: number; currency: string } | null;
  };
  ordering: {
    canCheckout: boolean;
    canSubmitCreditOrder: boolean;
    canAutoApproveCreditOrder: boolean;
  };
};

export class MagentoLockerCheckoutError extends Error {
  constructor(
    message: string,
    readonly code: "UNAVAILABLE" | "REJECTED" | "INVALID_RESPONSE" | "NOT_CONFIGURED",
  ) {
    super(message);
    this.name = "MagentoLockerCheckoutError";
  }
}

const CHECKOUT_CONTEXT_QUERY = /* GraphQL */ `
  query KioskLockerCheckoutContext {
    customerCart {
      id
      total_quantity
    }
    css_ordering_capabilities {
      authenticated
      company_context
      company_active
      can_checkout
      can_submit_credit_order
      can_auto_approve_credit_order
    }
  }
`;

const SET_LOCKER_ADDRESS_MUTATION = /* GraphQL */ `
  mutation KioskSetLockerAddress($cartId: String!, $address: CartAddressInput!) {
    setShippingAddressesOnCart(
      input: {
        cart_id: $cartId
        shipping_addresses: [{ address: $address }]
      }
    ) {
      cart {
        total_quantity
        shipping_addresses {
          available_shipping_methods {
            carrier_code
            method_code
            carrier_title
            method_title
            available
            error_message
            amount {
              value
              currency
            }
          }
        }
      }
    }
  }
`;

const SET_LOCKER_METHOD_MUTATION = /* GraphQL */ `
  mutation KioskSetLockerMethod(
    $cartId: String!
    $carrierCode: String!
    $methodCode: String!
  ) {
    setShippingMethodsOnCart(
      input: {
        cart_id: $cartId
        shipping_methods: [{ carrier_code: $carrierCode, method_code: $methodCode }]
      }
    ) {
      cart {
        total_quantity
        shipping_addresses {
          selected_shipping_method {
            carrier_code
            method_code
            carrier_title
            method_title
            amount {
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
    }
  }
`;

function money(value: Money) {
  if (typeof value?.value !== "number" || !value.currency) return null;
  return { value: value.value, currency: value.currency };
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
    throw new MagentoLockerCheckoutError("Magento checkout is unavailable right now.", "UNAVAILABLE");
  }

  let body: GraphQLResponse<TData>;
  try {
    body = (await response.json()) as GraphQLResponse<TData>;
  } catch {
    throw new MagentoLockerCheckoutError("Magento returned an invalid checkout response.", "INVALID_RESPONSE");
  }

  if (body.errors?.length) {
    throw new MagentoLockerCheckoutError(
      body.errors[0]?.message || "Magento rejected the locker checkout request.",
      "REJECTED",
    );
  }

  if (!response.ok) {
    throw new MagentoLockerCheckoutError("Magento checkout is unavailable right now.", "UNAVAILABLE");
  }

  if (!body.data) {
    throw new MagentoLockerCheckoutError("Magento returned an invalid checkout response.", "INVALID_RESPONSE");
  }

  return body.data;
}

function configuredLocker() {
  try {
    return getKioskLockerConfig();
  } catch {
    throw new MagentoLockerCheckoutError(
      "This kiosk does not have a local locker configured yet.",
      "NOT_CONFIGURED",
    );
  }
}

export async function prepareAuthenticatedLockerCheckout(input: {
  token: string;
  customer: VerifiedKioskCustomer;
}): Promise<KioskLockerCheckoutReview> {
  const locker = configuredLocker();

  const context = await requestMagento<CheckoutContextData>({
    token: input.token,
    query: CHECKOUT_CONTEXT_QUERY,
  });

  const cartId = context.customerCart?.id?.trim() || "";
  const totalQuantity = context.customerCart?.total_quantity;
  const capabilities = context.css_ordering_capabilities;

  if (!cartId || typeof totalQuantity !== "number" || !capabilities) {
    throw new MagentoLockerCheckoutError("Magento returned an invalid checkout context.", "INVALID_RESPONSE");
  }

  if (totalQuantity <= 0) {
    throw new MagentoLockerCheckoutError("Your basket is empty.", "REJECTED");
  }

  if (
    !capabilities.authenticated ||
    !capabilities.company_context ||
    capabilities.company_active === false ||
    !capabilities.can_checkout
  ) {
    throw new MagentoLockerCheckoutError(
      "This trade account is not allowed to checkout from the kiosk.",
      "REJECTED",
    );
  }

  const setAddress = await requestMagento<SetAddressData>({
    token: input.token,
    query: SET_LOCKER_ADDRESS_MUTATION,
    variables: {
      cartId,
      address: {
        firstname: input.customer.firstName,
        lastname: input.customer.lastName,
        company: locker.label,
        street: locker.street,
        city: locker.city,
        ...(locker.region ? { region: locker.region } : {}),
        postcode: locker.postcode,
        country_code: locker.countryCode,
        telephone: locker.telephone,
        save_in_address_book: false,
      },
    },
  });

  const address = setAddress.setShippingAddressesOnCart?.cart?.shipping_addresses?.[0] || null;
  const availableMethod = address?.available_shipping_methods?.find(
    (method) =>
      method?.carrier_code === locker.carrierCode &&
      method.method_code === locker.methodCode &&
      method.available !== false,
  );

  if (!availableMethod) {
    throw new MagentoLockerCheckoutError(
      "The configured local locker delivery method is not available for this cart.",
      "REJECTED",
    );
  }

  const setMethod = await requestMagento<SetMethodData>({
    token: input.token,
    query: SET_LOCKER_METHOD_MUTATION,
    variables: {
      cartId,
      carrierCode: locker.carrierCode,
      methodCode: locker.methodCode,
    },
  });

  const cart = setMethod.setShippingMethodsOnCart?.cart || null;
  const selected = cart?.shipping_addresses?.[0]?.selected_shipping_method || null;

  if (
    !cart ||
    selected?.carrier_code !== locker.carrierCode ||
    selected.method_code !== locker.methodCode
  ) {
    throw new MagentoLockerCheckoutError(
      "Magento did not confirm the local locker delivery method.",
      "INVALID_RESPONSE",
    );
  }

  return {
    locker: {
      label: locker.label,
      street: locker.street,
      city: locker.city,
      region: locker.region,
      postcode: locker.postcode,
      countryCode: locker.countryCode,
    },
    shipping: {
      carrierCode: locker.carrierCode,
      methodCode: locker.methodCode,
      carrierTitle: selected.carrier_title || "CSS Locker Collection",
      methodTitle: selected.method_title || "Local locker collection",
      amount: money(selected.amount || null),
    },
    basket: {
      totalQuantity: typeof cart.total_quantity === "number" ? cart.total_quantity : totalQuantity,
      subtotal: money(cart.prices?.subtotal_excluding_tax || null),
      grandTotal: money(cart.prices?.grand_total || null),
    },
    ordering: {
      canCheckout: true,
      canSubmitCreditOrder: Boolean(capabilities.can_submit_credit_order),
      canAutoApproveCreditOrder: Boolean(capabilities.can_auto_approve_credit_order),
    },
  };
}
