import {
  ArgoApiError,
  configuredArgoDatabaseUuid,
  requestArgo,
} from "@/lib/argo/client";
import { normalizeArgoBadge } from "@/lib/argo/employees";
import {
  dataRecord,
  nonNegativeInteger,
  positiveInteger,
  text,
} from "@/lib/argo/parsing";

export type ArgoCartWriteLineInput = {
  productId: number;
  quantity: number;
  expiryDate: string;
  expectedArrivalDate: string;
};

export type CreateArgoCartInput = {
  terminalId: number;
  userBadge: string;
  lines: ArgoCartWriteLineInput[];
  projectNumber?: string;
  projectId?: number;
};

export type CreatedArgoCart = {
  id: number;
  terminalId: number;
  employeeId: number;
  badge: string;
  state: string;
};

export type UpsertArgoCartLineInput = {
  cartId: number;
  productId: number;
  quantity: number;
  expiryDate: string;
  expectedArrivalDate: string;
};

export type UpsertedArgoCartLine = {
  cartId: number;
  productId: number;
  attributeId: number;
};

function positiveInput(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new ArgoApiError(
      `${label} must be a safe positive integer.`,
      "INVALID_REQUEST",
      400,
    );
  }
  return value;
}

function nonNegativeInput(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ArgoApiError(
      `${label} must be a safe non-negative integer.`,
      "INVALID_REQUEST",
      400,
    );
  }
  return value;
}

function calendarDate(value: string, label: string) {
  const candidate = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(candidate);
  if (!match) {
    throw new ArgoApiError(
      `${label} must use YYYY-MM-DD.`,
      "INVALID_REQUEST",
      400,
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ArgoApiError(
      `${label} must be a real calendar date.`,
      "INVALID_REQUEST",
      400,
    );
  }

  return candidate;
}

function providerBadge(value: unknown, context: string) {
  if (typeof value === "string") {
    const badge = value.trim();
    if (/^\d{1,20}$/.test(badge)) return badge;
  }

  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    return String(value);
  }

  throw new ArgoApiError(
    `NEXT ARGO returned an invalid response for ${context}.`,
    "INVALID_RESPONSE",
    502,
  );
}

function lineParameters(line: ArgoCartWriteLineInput, index?: number) {
  const prefix = index === undefined ? "cart line" : `cart line ${index + 1}`;
  return {
    product_id: positiveInput(line.productId, `${prefix} product_id`),
    attribute_id: 0,
    quantity: positiveInput(line.quantity, `${prefix} quantity`),
    expiry_date: calendarDate(line.expiryDate, `${prefix} expiry_date`),
    expected_arrival_date: calendarDate(
      line.expectedArrivalDate,
      `${prefix} expected_arrival_date`,
    ),
  };
}

export async function createArgoCart(
  input: CreateArgoCartInput,
): Promise<CreatedArgoCart> {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new ArgoApiError(
      "NEXT ARGO cart creation requires at least one line.",
      "INVALID_REQUEST",
      400,
    );
  }

  const terminalId = positiveInput(input.terminalId, "terminal_id");
  const badge = normalizeArgoBadge(input.userBadge);
  const parameters: Record<string, unknown> = {
    terminal_id: terminalId,
    user_badge: badge,
    // Lanzi documents this as an array. Keep it as native JSON, never a
    // stringified JSON value from the documentation console example.
    lines: input.lines.map((line, index) => lineParameters(line, index)),
  };

  if (input.projectNumber !== undefined) {
    const projectNumber = input.projectNumber.trim();
    if (!projectNumber) {
      throw new ArgoApiError(
        "NEXT ARGO project_number must not be blank.",
        "INVALID_REQUEST",
        400,
      );
    }
    parameters.project_number = projectNumber;
  }

  if (input.projectId !== undefined) {
    parameters.project_id = nonNegativeInput(input.projectId, "project_id");
  }

  const body = await requestArgo({
    requestType: "create_cart",
    databaseUuid: configuredArgoDatabaseUuid(),
    parameters,
  });

  const row = dataRecord(body, "create_cart");
  const created: CreatedArgoCart = {
    id: positiveInteger(row.id, "create_cart.data.id"),
    terminalId: positiveInteger(
      row.terminal_id,
      "create_cart.data.terminal_id",
    ),
    employeeId: positiveInteger(
      row.employee_id,
      "create_cart.data.employee_id",
    ),
    badge: providerBadge(row.badge, "create_cart.data.badge"),
    state: text(row.state, "create_cart.data.state"),
  };

  if (created.terminalId !== terminalId) {
    throw new ArgoApiError(
      "NEXT ARGO created the cart against an unexpected terminal.",
      "CORRELATION_MISMATCH",
      409,
    );
  }

  return created;
}

export async function upsertArgoCartLine(
  input: UpsertArgoCartLineInput,
): Promise<UpsertedArgoCartLine> {
  const cartId = positiveInput(input.cartId, "cart_id");
  const line = lineParameters(input);

  const body = await requestArgo({
    requestType: "upsert_cart_line",
    databaseUuid: configuredArgoDatabaseUuid(),
    parameters: {
      cart_id: cartId,
      ...line,
    },
  });

  const row = dataRecord(body, "upsert_cart_line");
  const result: UpsertedArgoCartLine = {
    cartId: positiveInteger(row.cart_id, "upsert_cart_line.data.cart_id"),
    productId: positiveInteger(
      row.product_id,
      "upsert_cart_line.data.product_id",
    ),
    // Input is deliberately always 0. The current Lanzi response example
    // returns 4, so parse the provider value without asserting it equals 0
    // until that documentation discrepancy is clarified.
    attributeId: nonNegativeInteger(
      row.attribute_id,
      "upsert_cart_line.data.attribute_id",
    ),
  };

  if (result.cartId !== cartId || result.productId !== input.productId) {
    throw new ArgoApiError(
      "NEXT ARGO updated an unexpected cart line.",
      "CORRELATION_MISMATCH",
      409,
    );
  }

  return result;
}
