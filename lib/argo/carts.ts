import { ArgoApiError, configuredArgoDatabaseUuid, requestArgo } from "@/lib/argo/client";
import {
  array,
  dataArray,
  dataRecord,
  listMeta,
  nullableText,
  nonNegativeInteger,
  positiveInteger,
  record,
  text,
} from "@/lib/argo/parsing";
import type { ArgoCart, ArgoCartLine, ArgoCartSummary, ArgoPage } from "@/lib/argo/types";

type CartListInput = {
  terminalId?: number;
  employeeId?: number;
  badge?: string;
  page?: number;
  perPage?: number;
  q?: string;
  status?: "active" | "inactive" | "all";
  modifiedSince?: string;
};

function cartSummary(value: unknown, context: string): ArgoCartSummary {
  const row = record(value, context);
  return {
    id: positiveInteger(row.id, `${context}.id`),
    terminalId: positiveInteger(row.terminal_id, `${context}.terminal_id`),
    employeeId: positiveInteger(row.employee_id, `${context}.employee_id`),
    badge: text(row.badge, `${context}.badge`),
    createdAt: text(row.created_at, `${context}.created_at`),
    projectId: nonNegativeInteger(row.project_id, `${context}.project_id`),
    projectNumber: text(row.project_number, `${context}.project_number`),
    lineCount: nonNegativeInteger(row.line_count, `${context}.line_count`),
    totalQuantity: nonNegativeInteger(
      row.total_quantity,
      `${context}.total_quantity`,
    ),
  };
}

function cartLine(value: unknown, context: string): ArgoCartLine {
  const row = record(value, context);
  const product = record(row.product, `${context}.product`);

  return {
    id: positiveInteger(row.id, `${context}.id`),
    productId: positiveInteger(row.product_id, `${context}.product_id`),
    attributeId: nonNegativeInteger(row.attribute_id, `${context}.attribute_id`),
    quantity: nonNegativeInteger(row.quantity, `${context}.quantity`),
    outcomeId: nonNegativeInteger(row.outcome_id, `${context}.outcome_id`),
    expiryDate: nullableText(row.expiry_date, `${context}.expiry_date`),
    expectedArrivalDate: nullableText(
      row.expected_arrival_date,
      `${context}.expected_arrival_date`,
    ),
    product: {
      code: nullableText(product.code, `${context}.product.code`),
      customerCode: nullableText(
        product.customer_code,
        `${context}.product.customer_code`,
      ),
      description: nullableText(
        product.description,
        `${context}.product.description`,
      ),
      unit: nullableText(product.unit, `${context}.product.unit`),
    },
  };
}

function listParameters(input: CartListInput) {
  const parameters: Record<string, unknown> = {};
  if (input.terminalId !== undefined) parameters.terminal_id = input.terminalId;
  if (input.employeeId !== undefined) parameters.employee_id = input.employeeId;
  if (input.badge !== undefined) parameters.badge = input.badge;
  if (input.page !== undefined) parameters.page = input.page;
  if (input.perPage !== undefined) parameters.per_page = input.perPage;
  if (input.q !== undefined) parameters.q = input.q;
  if (input.status !== undefined) parameters.status = input.status;
  if (input.modifiedSince !== undefined) parameters.modified_since = input.modifiedSince;
  return parameters;
}

export async function listArgoCarts(
  input: CartListInput = {},
): Promise<ArgoPage<ArgoCartSummary>> {
  const body = await requestArgo({
    requestType: "list_carts",
    databaseUuid: configuredArgoDatabaseUuid(),
    parameters: listParameters(input),
  });

  return {
    data: dataArray(body, "list_carts").map((item, index) =>
      cartSummary(item, `list_carts.data[${index}]`),
    ),
    meta: listMeta(body, "list_carts"),
  };
}

export async function getArgoCart(id: number): Promise<ArgoCart> {
  const body = await requestArgo({
    requestType: "get_cart",
    databaseUuid: configuredArgoDatabaseUuid(),
    parameters: { id },
  });
  const row = dataRecord(body, "get_cart");
  const lines = array(row.lines, "get_cart.data.lines").map((item, index) =>
    cartLine(item, `get_cart.data.lines[${index}]`),
  );

  return {
    id: positiveInteger(row.id, "get_cart.data.id"),
    terminalId: positiveInteger(row.terminal_id, "get_cart.data.terminal_id"),
    employeeId: positiveInteger(row.employee_id, "get_cart.data.employee_id"),
    badge: text(row.badge, "get_cart.data.badge"),
    createdAt: text(row.created_at, "get_cart.data.created_at"),
    projectId: nonNegativeInteger(row.project_id, "get_cart.data.project_id"),
    projectNumber: text(row.project_number, "get_cart.data.project_number"),
    lines,
    lineCount: nonNegativeInteger(row.line_count, "get_cart.data.line_count"),
    totalQuantity: nonNegativeInteger(
      row.total_quantity,
      "get_cart.data.total_quantity",
    ),
  };
}


export async function verifyArgoCartCorrelation(input: {
  cartId: number;
  terminalId: number;
  employeeId: number;
  badge?: string;
}): Promise<ArgoCart> {
  const cart = await getArgoCart(input.cartId);

  if (
    cart.terminalId !== input.terminalId ||
    cart.employeeId !== input.employeeId ||
    (input.badge !== undefined && cart.badge !== input.badge)
  ) {
    throw new ArgoApiError(
      "NEXT ARGO cart no longer matches the expected employee or terminal.",
      "CORRELATION_MISMATCH",
      409,
    );
  }

  return cart;
}
