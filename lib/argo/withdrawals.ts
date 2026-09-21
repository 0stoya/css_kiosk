import {
  ArgoApiError,
  configuredArgoDatabaseUuid,
  requestArgo,
} from "@/lib/argo/client";
import { normalizeArgoBadge } from "@/lib/argo/employees";
import {
  dataRecord,
  positiveInteger,
  text,
} from "@/lib/argo/parsing";

export type RequestArgoCartWithdrawalInput = {
  terminalId: number;
  cartId: number;
  userBadge: string;
};

export type ArgoWithdrawalRequest = {
  requestKey: string;
  phase: string;
  status: string;
  terminalId: number;
  cartId: number;
  badge: string;
  message: string;
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

function providerBadge(value: unknown) {
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
    "NEXT ARGO returned an invalid response for request_cart_withdrawal.data.badge.",
    "INVALID_RESPONSE",
    502,
  );
}

export async function requestArgoCartWithdrawal(
  input: RequestArgoCartWithdrawalInput,
): Promise<ArgoWithdrawalRequest> {
  const terminalId = positiveInput(input.terminalId, "terminal_id");
  const cartId = positiveInput(input.cartId, "cart_id");
  const badge = normalizeArgoBadge(input.userBadge);

  const body = await requestArgo({
    requestType: "request_cart_withdrawal",
    databaseUuid: configuredArgoDatabaseUuid(),
    parameters: {
      terminal_id: terminalId,
      cart_id: cartId,
      // Always submit a string. Raw badge formatting is transient and may
      // contain leading zeroes even if a provider response later normalises it.
      user_badge: badge,
    },
  });

  const row = dataRecord(body, "request_cart_withdrawal");
  const result: ArgoWithdrawalRequest = {
    requestKey: text(
      row.request_key,
      "request_cart_withdrawal.data.request_key",
    ),
    phase: text(row.phase, "request_cart_withdrawal.data.phase"),
    status: text(row.status, "request_cart_withdrawal.data.status"),
    terminalId: positiveInteger(
      row.terminal_id,
      "request_cart_withdrawal.data.terminal_id",
    ),
    cartId: positiveInteger(
      row.cart_id,
      "request_cart_withdrawal.data.cart_id",
    ),
    badge: providerBadge(row.badge),
    message: text(row.message, "request_cart_withdrawal.data.message"),
  };

  if (result.terminalId !== terminalId || result.cartId !== cartId) {
    throw new ArgoApiError(
      "NEXT ARGO queued a withdrawal for an unexpected cart or terminal.",
      "CORRELATION_MISMATCH",
      409,
    );
  }

  return result;
}
