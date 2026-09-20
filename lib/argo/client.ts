import { getArgoConfig } from "@/lib/argo/config";

export type ArgoApiErrorCode =
  | "WRITE_DISABLED"
  | "CORRELATION_MISMATCH"
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "INVALID_RESPONSE"
  | "UNAVAILABLE";

export class ArgoApiError extends Error {
  constructor(
    message: string,
    readonly code: ArgoApiErrorCode,
    readonly status: number,
    readonly providerCode: string | null = null,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "ArgoApiError";
  }
}

type ArgoRequestInput = {
  requestType: string;
  databaseUuid?: string;
  parameters?: Record<string, unknown>;
  write?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function providerError(body: unknown) {
  if (!isRecord(body) || !isRecord(body.error)) return null;

  return {
    code: typeof body.error.code === "string" ? body.error.code : null,
    message: typeof body.error.message === "string" ? body.error.message : null,
  };
}

function retryAfterSeconds(response: Response) {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) return Number(value);

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
}

function mappedError(input: {
  status: number;
  providerCode: string | null;
  providerMessage: string | null;
  retryAfter: number | null;
}) {
  const message = input.providerMessage || "NEXT ARGO rejected the request.";

  if (input.status === 400) {
    return new ArgoApiError(message, "INVALID_REQUEST", 400, input.providerCode);
  }
  if (input.status === 401) {
    return new ArgoApiError(
      "NEXT ARGO authentication was rejected.",
      "UNAUTHORIZED",
      503,
      input.providerCode,
    );
  }
  if (input.status === 403) {
    return new ArgoApiError(message, "FORBIDDEN", 503, input.providerCode);
  }
  if (input.status === 404) {
    return new ArgoApiError(message, "NOT_FOUND", 404, input.providerCode);
  }
  if (input.status === 429) {
    return new ArgoApiError(
      "NEXT ARGO rate limit was reached.",
      "RATE_LIMITED",
      503,
      input.providerCode,
      input.retryAfter,
    );
  }

  return new ArgoApiError(
    "NEXT ARGO returned an unexpected provider error.",
    "PROVIDER_ERROR",
    502,
    input.providerCode,
  );
}

export async function requestArgo(input: ArgoRequestInput): Promise<unknown> {
  const config = getArgoConfig();

  if (input.write && !config.writesEnabled) {
    throw new ArgoApiError(
      "NEXT ARGO write operations are disabled.",
      "WRITE_DISABLED",
      503,
    );
  }

  const payload: Record<string, unknown> = {
    request_type: input.requestType,
  };
  if (input.databaseUuid) payload.database_uuid = input.databaseUuid;
  if (input.parameters) payload.parameters = input.parameters;

  let response: Response;
  try {
    response = await fetch(config.apiUrl, {
      method: "POST",
      headers: {
        "X-API-Key": config.apiKey,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    throw new ArgoApiError(
      "NEXT ARGO is unavailable right now.",
      "UNAVAILABLE",
      503,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ArgoApiError(
      "NEXT ARGO returned an invalid JSON response.",
      "INVALID_RESPONSE",
      502,
    );
  }

  if (!response.ok) {
    const error = providerError(body);
    throw mappedError({
      status: response.status,
      providerCode: error?.code || null,
      providerMessage: error?.message || null,
      retryAfter: retryAfterSeconds(response),
    });
  }

  if (!isRecord(body)) {
    throw new ArgoApiError(
      "NEXT ARGO returned an invalid response envelope.",
      "INVALID_RESPONSE",
      502,
    );
  }

  return body;
}

export function configuredArgoDatabaseUuid() {
  return getArgoConfig().databaseUuid;
}
