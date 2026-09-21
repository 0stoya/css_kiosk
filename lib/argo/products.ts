import { ArgoApiError, configuredArgoDatabaseUuid, requestArgo } from "@/lib/argo/client";
import {
  dataArray,
  dataRecord,
  listMeta,
  nullableText,
  positiveInteger,
  record,
} from "@/lib/argo/parsing";
import type { ArgoPage, ArgoProduct } from "@/lib/argo/types";

type ProductListInput = {
  page?: number;
  perPage?: number;
  q?: string;
  status?: "active" | "inactive" | "all";
  modifiedSince?: string;
};

function product(value: unknown, context: string): ArgoProduct {
  const row = record(value, context);
  return {
    id: positiveInteger(row.id, `${context}.id`),
    code: nullableText(row.code, `${context}.code`),
    customerCode: nullableText(row.customer_code, `${context}.customer_code`),
    description: nullableText(row.description, `${context}.description`),
    unit: nullableText(row.unit, `${context}.unit`),
    active: typeof row.active === "boolean" ? row.active : null,
    modifiedAt: typeof row.modified_at === "string" ? row.modified_at : null,
    raw: row,
  };
}

function listParameters(input: ProductListInput) {
  const parameters: Record<string, unknown> = {};
  if (input.page !== undefined) parameters.page = input.page;
  if (input.perPage !== undefined) parameters.per_page = input.perPage;
  if (input.q !== undefined) parameters.q = input.q;
  if (input.status !== undefined) parameters.status = input.status;
  if (input.modifiedSince !== undefined) parameters.modified_since = input.modifiedSince;
  return parameters;
}

export async function listArgoProducts(
  input: ProductListInput = {},
): Promise<ArgoPage<ArgoProduct>> {
  const body = await requestArgo({
    requestType: "list_products",
    databaseUuid: configuredArgoDatabaseUuid(),
    parameters: listParameters(input),
  });

  return {
    data: dataArray(body, "list_products").map((item, index) =>
      product(item, `list_products.data[${index}]`),
    ),
    meta: listMeta(body, "list_products"),
  };
}

export async function getArgoProduct(id: number): Promise<ArgoProduct> {
  const body = await requestArgo({
    requestType: "get_product",
    databaseUuid: configuredArgoDatabaseUuid(),
    parameters: { id },
  });
  return product(dataRecord(body, "get_product"), "get_product.data");
}


function normaliseSku(value: string | null | undefined) {
  return value?.trim().toUpperCase() || "";
}

export async function resolveArgoProductBySku(sku: string): Promise<ArgoProduct> {
  const requested = normaliseSku(sku);
  if (!requested) {
    throw new ArgoApiError(
      "A Magento SKU is required for NEXT ARGO product matching.",
      "INVALID_REQUEST",
      400,
    );
  }

  const page = await listArgoProducts({
    q: sku.trim(),
    status: "active",
    perPage: 500,
  });

  const active = page.data.filter((product) => product.active !== false);
  const customerCodeMatches = active.filter(
    (product) => normaliseSku(product.customerCode) === requested,
  );

  if (customerCodeMatches.length > 1) {
    throw new ArgoApiError(
      `NEXT ARGO returned more than one active product with customer_code ${sku.trim()}.`,
      "INVALID_RESPONSE",
      502,
    );
  }
  if (customerCodeMatches.length === 1) return customerCodeMatches[0];

  const codeMatches = active.filter(
    (product) => normaliseSku(product.code) === requested,
  );
  if (codeMatches.length > 1) {
    throw new ArgoApiError(
      `NEXT ARGO returned more than one active product with code ${sku.trim()}.`,
      "INVALID_RESPONSE",
      502,
    );
  }
  if (codeMatches.length === 1) return codeMatches[0];

  throw new ArgoApiError(
    `No active NEXT ARGO product matches Magento SKU ${sku.trim()}.`,
    "NOT_FOUND",
    404,
  );
}
