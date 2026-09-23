import { ArgoApiError } from "@/lib/argo/client";
import { getArgoConfig } from "@/lib/argo/config";
import {
  createArgoEmployee,
  resolveArgoEmployeeByBadge,
  resolveArgoProfileIdByName,
} from "@/lib/argo/employees";
import type { ArgoEmployee } from "@/lib/argo/types";

export type EnsuredArgoAdminCollector = {
  employee: ArgoEmployee;
  created: boolean;
  profileId: number | null;
};

async function argoStage<T>(
  stage: string,
  action: () => Promise<T>,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof ArgoApiError) {
      const detail = error.providerMessage || error.message;
      throw new ArgoApiError(
        `${stage}: ${detail}`,
        error.code,
        error.status,
        error.providerCode,
        error.retryAfterSeconds,
        error.providerMessage,
      );
    }
    throw error;
  }
}

function requiredName(value: string, label: string) {
  const result = value.trim();
  if (!result) {
    throw new ArgoApiError(
      `${label} is required before provisioning an ARGO admin collector.`,
      "INVALID_REQUEST",
      400,
    );
  }
  return result;
}

function validateCollector(employee: ArgoEmployee) {
  const config = getArgoConfig();

  if (employee.active === false) {
    throw new ArgoApiError(
      "The matching NEXT ARGO admin collector is inactive.",
      "CORRELATION_MISMATCH",
      409,
    );
  }

  if (employee.plantId !== config.plantId) {
    throw new ArgoApiError(
      "The matching NEXT ARGO admin collector belongs to another plant.",
      "CORRELATION_MISMATCH",
      409,
    );
  }

  return employee;
}

export async function ensureArgoAdminCollector(input: {
  badge: string;
  firstName: string;
  lastName: string;
  allowCreate: boolean;
}): Promise<EnsuredArgoAdminCollector> {
  const existing = await argoStage(
    "ARGO admin badge lookup failed",
    () => resolveArgoEmployeeByBadge(input.badge),
  );
  if (existing) {
    return {
      employee: validateCollector(existing),
      created: false,
      profileId: existing.profileId,
    };
  }

  if (!input.allowCreate) {
    throw new ArgoApiError(
      "Only an authorised locker manager may provision a missing NEXT ARGO admin collector.",
      "FORBIDDEN",
      403,
    );
  }

  const profileId = await argoStage(
    "ARGO Admin profile discovery failed",
    () => resolveArgoProfileIdByName("Admin"),
  );
  const created = await argoStage(
    "ARGO admin Employee creation failed",
    () => createArgoEmployee({
    badge: input.badge,
    firstName: requiredName(input.firstName, "Admin first name"),
    lastName: requiredName(input.lastName, "Admin last name"),
      profileId,
    }),
  );

  validateCollector(created);

  if (created.profileId !== null && created.profileId !== profileId) {
    throw new ArgoApiError(
      "NEXT ARGO created the admin collector with an unexpected profile.",
      "CORRELATION_MISMATCH",
      409,
    );
  }

  return {
    employee: created,
    created: true,
    profileId,
  };
}
