import { getArgoProduct } from "@/lib/argo/products";
import { resolveConfiguredArgoTerminal } from "@/lib/argo/terminals";
import type { ArgoProduct } from "@/lib/argo/types";

const PRODUCT_CACHE_TTL_MS = 60_000;
const productCache = new Map<number, { expiresAt: number; value: ArgoProduct | null }>();

async function cachedArgoProduct(productId: number) {
  const cached = productCache.get(productId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: ArgoProduct | null = null;
  try {
    value = await getArgoProduct(productId);
  } catch {
    value = null;
  }

  productCache.set(productId, {
    value,
    expiresAt: Date.now() + PRODUCT_CACHE_TTL_MS,
  });
  return value;
}

export type KioskLockerAdminPosition = {
  cellId: number;
  plateNumber: number;
  sectorNumber: number;
  cellNumber: number;
  state: "full" | "empty";
  product: {
    id: number;
    code: string | null;
    customerCode: string | null;
    description: string | null;
  } | null;
};

export type KioskLockerAdminStatus = {
  terminal: {
    id: number;
    type: string;
    description: string;
    serialNumber: string;
    softwareVersion: string | null;
    active: boolean;
    statusCode: number;
    modifiedAt: string;
  };
  summary: {
    total: number;
    empty: number;
    partial: number;
    full: number;
    unassigned: number;
    unmaterialised: number;
  };
  positions: KioskLockerAdminPosition[];
  manualOpen: {
    available: false;
    reason: string;
  };
};

export async function getKioskLockerAdminStatus(): Promise<KioskLockerAdminStatus> {
  const terminal = await resolveConfiguredArgoTerminal();
  const productIds = [
    ...new Set(
      terminal.fullSlots
        .map((slot) => slot.productId)
        .filter((value): value is number => typeof value === "number"),
    ),
  ];

  const productRows = await Promise.all(
    productIds.map(async (productId) => [productId, await cachedArgoProduct(productId)] as const),
  );
  const products = new Map(productRows);

  const positions: KioskLockerAdminPosition[] = [
    ...terminal.fullSlots.map((slot) => {
      const product = slot.productId ? products.get(slot.productId) || null : null;
      return {
        cellId: slot.cellId,
        plateNumber: slot.plateNumber,
        sectorNumber: slot.sectorNumber,
        cellNumber: slot.cellNumber,
        state: "full" as const,
        product: slot.productId
          ? {
              id: slot.productId,
              code: product?.code || null,
              customerCode: product?.customerCode || null,
              description: product?.description || null,
            }
          : null,
      };
    }),
    ...terminal.emptySlots.map((slot) => ({
      cellId: slot.cellId,
      plateNumber: slot.plateNumber,
      sectorNumber: slot.sectorNumber,
      cellNumber: slot.cellNumber,
      state: "empty" as const,
      product: null,
    })),
  ].sort(
    (left, right) =>
      left.plateNumber - right.plateNumber ||
      left.sectorNumber - right.sectorNumber ||
      left.cellNumber - right.cellNumber ||
      left.cellId - right.cellId,
  );

  return {
    terminal: {
      id: terminal.id,
      type: terminal.type,
      description: terminal.description,
      serialNumber: terminal.serialNumber,
      softwareVersion: terminal.softwareVersion,
      active: terminal.active,
      statusCode: terminal.statusCode,
      modifiedAt: terminal.modifiedAt,
    },
    summary: terminal.slotSummary,
    positions,
    manualOpen: {
      available: false,
      reason: "Manual locker opening is waiting for the supported NEXT ARGO API contract.",
    },
  };
}
