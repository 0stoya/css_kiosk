import { configuredArgoDatabaseUuid, requestArgo } from "@/lib/argo/client";
import {
  dataArray,
  dataRecord,
  listMeta,
  nullableBoolean,
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
    active: nullableBoolean(row.active, `${context}.active`),
    modifiedAt: nullableText(row.modified_at, `${context}.modified_at`),
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
