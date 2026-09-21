import { ArgoApiError } from "@/lib/argo/client";
import { getArgoConfig } from "@/lib/argo/config";
import { createArgoCart } from "@/lib/argo/cart-writes";
import {
  getArgoCartCorrelationByProjectNumber,
  recordArgoCartCreated,
} from "@/lib/argo/cart-correlation-store";
import { getArgoCart, listArgoCarts } from "@/lib/argo/carts";
import { getArgoEmployee } from "@/lib/argo/employees";
import {
  argoExpectedArrivalDate,
  getArgoOrderBridgeConfig,
} from "@/lib/argo/order-bridge-config";
import {
  getArgoOrderFulfilmentByMagentoOrder,
  markArgoOrderFulfilmentCreated,
  markArgoOrderFulfilmentFailed,
  recordArgoOrderFulfilment,
  type PendingArgoOrderLine,
} from "@/lib/argo/order-fulfilment-store";
import { resolveArgoProductBySku } from "@/lib/argo/products";
import { resolveConfiguredArgoTerminal } from "@/lib/argo/terminals";
import type { KioskBasket } from "@/lib/magento/cart";

export type ArgoOrderPreflight = {
  enabled: true;
  terminalId: number;
  argoEmployeeId: number;
  lines: PendingArgoOrderLine[];
};

export type ArgoOrderBridgeResult =
  | { status: "DISABLED" }
  | {
      status: "WAITING_MAGENTO";
      creditOrderNumber: string | null;
    }
  | {
      status: "WAITING_OGL";
      magentoOrderNumber: string;
    }
  | {
      status: "CREATED";
      magentoOrderNumber: string;
      oglOrderNumber: string;
      argoCartId: number;
      providerState: string;
    }
  | {
      status: "FAILED";
      magentoOrderNumber: string;
      error: string;
    };

function aggregateBasket(basket: KioskBasket) {
  if (!basket.items.length) {
    throw new ArgoApiError(
      "The basket is empty.",
      "INVALID_REQUEST",
      400,
    );
  }

  const quantities = new Map<string, number>();
  for (const line of basket.items) {
    const sku = line.sku.trim();
    if (
      !sku ||
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0
    ) {
      throw new ArgoApiError(
        "The basket contains an invalid quantity for NEXT ARGO.",
        "INVALID_REQUEST",
        400,
      );
    }
    quantities.set(sku, (quantities.get(sku) || 0) + line.quantity);
  }

  return [...quantities.entries()].map(([sku, quantity]) => ({
    sku,
    quantity,
  }));
}

export async function prepareArgoOrderPreflight(input: {
  basket: KioskBasket;
  argoEmployeeId: number;
}): Promise<ArgoOrderPreflight | null> {
  const config = getArgoOrderBridgeConfig();
  if (!config.enabled) return null;

  const argoConfig = getArgoConfig();
  if (!argoConfig.writesEnabled) {
    throw new ArgoApiError(
      "NEXT ARGO order bridge is enabled but ARGO writes are disabled.",
      "WRITE_DISABLED",
      409,
    );
  }

  if (!Number.isSafeInteger(input.argoEmployeeId) || input.argoEmployeeId <= 0) {
    throw new ArgoApiError(
      "A linked NEXT ARGO employee is required for locker ordering.",
      "INVALID_REQUEST",
      409,
    );
  }

  const [terminal, employee] = await Promise.all([
    resolveConfiguredArgoTerminal(),
    getArgoEmployee(input.argoEmployeeId),
  ]);

  if (employee.active === false) {
    throw new ArgoApiError(
      "The linked NEXT ARGO employee is inactive.",
      "CORRELATION_MISMATCH",
      409,
    );
  }
  if (employee.plantId !== argoConfig.plantId) {
    throw new ArgoApiError(
      "The linked NEXT ARGO employee belongs to the wrong plant.",
      "CORRELATION_MISMATCH",
      409,
    );
  }

  const expectedArrivalDate = argoExpectedArrivalDate(config);
  if (config.expiryDate < expectedArrivalDate) {
    throw new Error(
      "ARGO_CART_NON_EXPIRING_EXPIRY_DATE must not be earlier than the expected arrival date.",
    );
  }
  const basketLines = aggregateBasket(input.basket);
  const resolvedProducts = await Promise.all(
    basketLines.map(async (line) => ({
      ...line,
      product: await resolveArgoProductBySku(line.sku),
    })),
  );

  const byProduct = new Map<
    number,
    { sku: string; productId: number; quantity: number }
  >();

  for (const line of resolvedProducts) {
    const existing = byProduct.get(line.product.id);
    if (existing && existing.sku !== line.sku) {
      throw new ArgoApiError(
        `Magento SKUs ${existing.sku} and ${line.sku} resolve to the same NEXT ARGO product.`,
        "CORRELATION_MISMATCH",
        409,
      );
    }

    byProduct.set(line.product.id, {
      sku: line.sku,
      productId: line.product.id,
      quantity: (existing?.quantity || 0) + line.quantity,
    });
  }

  return {
    enabled: true,
    terminalId: terminal.id,
    argoEmployeeId: employee.id,
    lines: [...byProduct.values()].map((line) => ({
      ...line,
      expiryDate: config.expiryDate,
      expectedArrivalDate,
    })),
  };
}

export async function createArgoCartForFulfilment(input: {
  magentoOrderNumber: string;
  oglOrderNumber: string;
}) {
  const fulfilment = getArgoOrderFulfilmentByMagentoOrder(
    input.magentoOrderNumber,
  );
  if (!fulfilment) {
    throw new Error("ARGO fulfilment snapshot was not found.");
  }

  if (fulfilment.status === "CREATED" && fulfilment.argoCartId) {
    return {
      argoCartId: fulfilment.argoCartId,
      providerState: "created",
    };
  }

  const localCorrelation = getArgoCartCorrelationByProjectNumber(
    input.oglOrderNumber,
  );
  if (localCorrelation) {
    if (
      localCorrelation.magentoOrderNumber !== input.magentoOrderNumber ||
      localCorrelation.terminalId !== fulfilment.terminalId ||
      localCorrelation.argoEmployeeId !== fulfilment.argoEmployeeId
    ) {
      throw new ArgoApiError(
        "The existing NEXT ARGO order correlation does not match this fulfilment.",
        "CORRELATION_MISMATCH",
        409,
      );
    }

    markArgoOrderFulfilmentCreated({
      magentoOrderNumber: input.magentoOrderNumber,
      oglOrderNumber: input.oglOrderNumber,
      argoCartId: localCorrelation.argoCartId,
    });
    return {
      argoCartId: localCorrelation.argoCartId,
      providerState: localCorrelation.providerState,
    };
  }

  const providerPage = await listArgoCarts({
    terminalId: fulfilment.terminalId,
    q: input.oglOrderNumber,
    status: "all",
    perPage: 500,
  });
  const providerMatches = providerPage.data.filter(
    (cart) => cart.projectNumber === input.oglOrderNumber,
  );

  if (providerMatches.length > 1) {
    throw new ArgoApiError(
      "NEXT ARGO returned more than one cart for this OGL order reference.",
      "CORRELATION_MISMATCH",
      409,
    );
  }

  if (providerMatches.length === 1) {
    const existing = providerMatches[0];
    if (
      existing.terminalId !== fulfilment.terminalId ||
      existing.employeeId !== fulfilment.argoEmployeeId
    ) {
      throw new ArgoApiError(
        "The existing NEXT ARGO cart belongs to a different employee or terminal.",
        "CORRELATION_MISMATCH",
        409,
      );
    }

    const existingCart = await getArgoCart(existing.id);
    const expectedLines = new Map(
      fulfilment.lines.map((line) => [line.productId, line.quantity]),
    );
    const actualLines = new Map<number, number>();
    for (const line of existingCart.lines) {
      actualLines.set(
        line.productId,
        (actualLines.get(line.productId) || 0) + line.quantity,
      );
    }

    const linesMatch =
      actualLines.size === expectedLines.size &&
      [...expectedLines].every(
        ([productId, quantity]) => actualLines.get(productId) === quantity,
      );

    if (!linesMatch) {
      throw new ArgoApiError(
        "The existing NEXT ARGO cart does not match the saved locker order lines.",
        "CORRELATION_MISMATCH",
        409,
      );
    }

    recordArgoCartCreated({
      projectNumber: input.oglOrderNumber,
      magentoOrderNumber: input.magentoOrderNumber,
      argoCartId: existing.id,
      terminalId: existing.terminalId,
      argoEmployeeId: existing.employeeId,
      providerState: "existing",
    });
    markArgoOrderFulfilmentCreated({
      magentoOrderNumber: input.magentoOrderNumber,
      oglOrderNumber: input.oglOrderNumber,
      argoCartId: existing.id,
    });
    return {
      argoCartId: existing.id,
      providerState: "existing",
    };
  }

  const employee = await getArgoEmployee(fulfilment.argoEmployeeId);
  if (employee.active === false) {
    throw new ArgoApiError(
      "The linked NEXT ARGO employee is inactive.",
      "CORRELATION_MISMATCH",
      409,
    );
  }

  const created = await createArgoCart({
    terminalId: fulfilment.terminalId,
    userBadge: employee.badge,
    projectNumber: input.oglOrderNumber,
    lines: fulfilment.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      expiryDate: line.expiryDate,
      expectedArrivalDate: line.expectedArrivalDate,
    })),
  });

  if (created.employeeId !== fulfilment.argoEmployeeId) {
    throw new ArgoApiError(
      "NEXT ARGO created the cart for an unexpected employee.",
      "CORRELATION_MISMATCH",
      409,
    );
  }

  recordArgoCartCreated({
    projectNumber: input.oglOrderNumber,
    magentoOrderNumber: input.magentoOrderNumber,
    argoCartId: created.id,
    terminalId: created.terminalId,
    argoEmployeeId: created.employeeId,
    providerState: created.state,
  });

  markArgoOrderFulfilmentCreated({
    magentoOrderNumber: input.magentoOrderNumber,
    oglOrderNumber: input.oglOrderNumber,
    argoCartId: created.id,
  });

  return {
    argoCartId: created.id,
    providerState: created.state,
  };
}

export async function finaliseArgoOrderBridge(input: {
  preflight: ArgoOrderPreflight | null;
  creditOrderNumber: string | null;
  magentoOrderNumber: string | null;
  oglOrderNumber: string | null;
}): Promise<ArgoOrderBridgeResult> {
  if (!input.preflight) return { status: "DISABLED" };

  if (!input.magentoOrderNumber) {
    recordArgoOrderFulfilment({
      creditOrderNumber: input.creditOrderNumber,
      argoEmployeeId: input.preflight.argoEmployeeId,
      terminalId: input.preflight.terminalId,
      lines: input.preflight.lines,
    });
    return {
      status: "WAITING_MAGENTO",
      creditOrderNumber: input.creditOrderNumber,
    };
  }

  recordArgoOrderFulfilment({
    creditOrderNumber: input.creditOrderNumber,
    magentoOrderNumber: input.magentoOrderNumber,
    oglOrderNumber: input.oglOrderNumber,
    argoEmployeeId: input.preflight.argoEmployeeId,
    terminalId: input.preflight.terminalId,
    lines: input.preflight.lines,
  });

  if (!input.oglOrderNumber) {
    return {
      status: "WAITING_OGL",
      magentoOrderNumber: input.magentoOrderNumber,
    };
  }

  try {
    const created = await createArgoCartForFulfilment({
      magentoOrderNumber: input.magentoOrderNumber,
      oglOrderNumber: input.oglOrderNumber,
    });

    return {
      status: "CREATED",
      magentoOrderNumber: input.magentoOrderNumber,
      oglOrderNumber: input.oglOrderNumber,
      argoCartId: created.argoCartId,
      providerState: created.providerState,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "NEXT ARGO cart creation failed.";
    markArgoOrderFulfilmentFailed(input.magentoOrderNumber, message);
    return {
      status: "FAILED",
      magentoOrderNumber: input.magentoOrderNumber,
      error: message,
    };
  }
}
