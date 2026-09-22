import {
  ArgoApiError,
  configuredArgoDatabaseUuid,
  requestArgo,
} from "@/lib/argo/client";
import { getArgoConfig } from "@/lib/argo/config";
import { normalizeArgoBadge } from "@/lib/argo/employees";

export type ArgoJsonType =
  | "missing"
  | "null"
  | "array"
  | "object"
  | "string"
  | "number"
  | "boolean";

export type ArgoEmployeeIdentityDiagnostic = {
  resultCount: number;
  employeeId: string | null;
  employeeIdJsonType: ArgoJsonType;
  plantId: string | null;
  plantIdJsonType: ArgoJsonType;
  expectedPlantId: number;
  plantMatch: boolean;
  active: string | null;
  activeJsonType: ArgoJsonType;
  badgeJsonType: ArgoJsonType;
  matchedStoredEmployeeId: boolean | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonType(value: unknown, present = true): ArgoJsonType {
  if (!present) return "missing";
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "missing";
}

function safeScalar(value: unknown, present = true): string | null {
  if (!present || value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  return null;
}

function integerValue(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

export async function getArgoEmployeeIdentityDiagnostic(input: {
  badge: string;
  expectedEmployeeId?: number | null;
}): Promise<ArgoEmployeeIdentityDiagnostic> {
  const config = getArgoConfig();
  const badge = normalizeArgoBadge(input.badge);

  const body = await requestArgo({
    requestType: "list_employees",
    databaseUuid: configuredArgoDatabaseUuid(),
    parameters: {
      plant_id: config.plantId,
      badge,
      status: "all",
      per_page: 10,
    },
  });

  if (!isRecord(body) || !Array.isArray(body.data)) {
    throw new ArgoApiError(
      "NEXT ARGO returned an invalid list_employees diagnostic response.",
      "INVALID_RESPONSE",
      502,
    );
  }

  const rows = body.data.filter(isRecord);
  const expectedEmployeeId =
    typeof input.expectedEmployeeId === "number" &&
    Number.isSafeInteger(input.expectedEmployeeId) &&
    input.expectedEmployeeId > 0
      ? input.expectedEmployeeId
      : null;

  let row: Record<string, unknown> | null = null;
  if (expectedEmployeeId !== null) {
    row =
      rows.find((candidate) => integerValue(candidate.id) === expectedEmployeeId) ||
      null;
  }
  if (!row && rows.length === 1) row = rows[0];

  if (!row) {
    throw new ArgoApiError(
      rows.length === 0
        ? "NEXT ARGO returned no employee for the current provider badge."
        : "NEXT ARGO returned multiple employees and none matched the stored Employee ID.",
      rows.length === 0 ? "NOT_FOUND" : "CORRELATION_MISMATCH",
      rows.length === 0 ? 404 : 409,
    );
  }

  const hasId = Object.prototype.hasOwnProperty.call(row, "id");
  const hasPlantId = Object.prototype.hasOwnProperty.call(row, "plant_id");
  const hasActive = Object.prototype.hasOwnProperty.call(row, "active");
  const hasBadge = Object.prototype.hasOwnProperty.call(row, "badge");
  const rawId = row.id;
  const rawPlantId = row.plant_id;

  return {
    resultCount: rows.length,
    employeeId: safeScalar(rawId, hasId),
    employeeIdJsonType: jsonType(rawId, hasId),
    plantId: safeScalar(rawPlantId, hasPlantId),
    plantIdJsonType: jsonType(rawPlantId, hasPlantId),
    expectedPlantId: config.plantId,
    plantMatch: integerValue(rawPlantId) === config.plantId,
    active: safeScalar(row.active, hasActive),
    activeJsonType: jsonType(row.active, hasActive),
    badgeJsonType: jsonType(row.badge, hasBadge),
    matchedStoredEmployeeId:
      expectedEmployeeId === null
        ? null
        : integerValue(rawId) === expectedEmployeeId,
  };
}
