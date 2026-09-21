import { ArgoApiError } from "@/lib/argo/client";

export type ArgoOrderBridgeConfig = {
  enabled: boolean;
  expiryDate: string;
  expectedArrivalOffsetDays: number;
};

function calendarDate(value: string, name: string) {
  const candidate = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(candidate);
  if (!match) throw new Error(`${name} must use YYYY-MM-DD.`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${name} must be a real calendar date.`);
  }
  return candidate;
}

function offsetDays() {
  const raw = process.env.ARGO_CART_EXPECTED_ARRIVAL_OFFSET_DAYS?.trim();
  if (!raw || !/^\d+$/.test(raw)) {
    throw new Error(
      "ARGO_CART_EXPECTED_ARRIVAL_OFFSET_DAYS must be configured as a non-negative integer.",
    );
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > 365) {
    throw new Error(
      "ARGO_CART_EXPECTED_ARRIVAL_OFFSET_DAYS must be between 0 and 365.",
    );
  }
  return value;
}

export function getArgoOrderBridgeConfig(): ArgoOrderBridgeConfig {
  const enabled =
    process.env.ARGO_ORDER_BRIDGE_ENABLED?.trim().toLowerCase() === "true";

  if (!enabled) {
    return {
      enabled: false,
      expiryDate: "",
      expectedArrivalOffsetDays: 0,
    };
  }

  return {
    enabled: true,
    expiryDate: calendarDate(
      process.env.ARGO_CART_NON_EXPIRING_EXPIRY_DATE?.trim() || "",
      "ARGO_CART_NON_EXPIRING_EXPIRY_DATE",
    ),
    expectedArrivalOffsetDays: offsetDays(),
  };
}

export function argoExpectedArrivalDate(config: ArgoOrderBridgeConfig, now = new Date()) {
  if (!config.enabled) {
    throw new ArgoApiError(
      "NEXT ARGO order bridge is disabled.",
      "WRITE_DISABLED",
      409,
    );
  }

  const date = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  date.setUTCDate(date.getUTCDate() + config.expectedArrivalOffsetDays);
  return date.toISOString().slice(0, 10);
}
