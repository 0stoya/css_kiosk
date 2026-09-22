import { ArgoApiError, configuredArgoDatabaseUuid, requestArgo } from "@/lib/argo/client";
import { getArgoConfig } from "@/lib/argo/config";
import {
  dataArray,
  dataRecord,
  listMeta,
  nullableText,
  positiveInteger,
  record,
  text,
} from "@/lib/argo/parsing";
import type { ArgoEmployee, ArgoPage } from "@/lib/argo/types";

type EmployeeListInput = {
  plantId?: number;
  badge?: string;
  page?: number;
  perPage?: number;
  q?: string;
  status?: "active" | "inactive" | "all";
  modifiedSince?: string;
};

export type CreateArgoEmployeeInput = {
  badge: string;
  firstName: string;
  lastName: string;
  employeeNumber?: string;
  departmentId?: number;
  employeeGroupId?: number;
  jobId?: number;
  qualificationId?: number;
  costCentreId?: number;
  profileId?: number;
  bandId?: number;
  hiredOn?: string;
  leftOn?: string;
};

export function normalizeArgoBadge(value: string) {
  const badge = value.trim();
  if (!/^\d{1,20}$/.test(badge)) {
    throw new ArgoApiError(
      "The RFID value is not valid for NEXT ARGO.",
      "INVALID_REQUEST",
      400,
    );
  }
  return badge;
}

function providerPositiveInteger(value: unknown, context: string) {
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > 0
  ) {
    return value;
  }

  if (
    typeof value === "string" &&
    /^[1-9]\d*$/.test(value.trim())
  ) {
    const parsed = Number(value.trim());
    if (Number.isSafeInteger(parsed)) return parsed;
  }

  throw new ArgoApiError(
    `NEXT ARGO returned an invalid response for ${context}.`,
    "INVALID_RESPONSE",
    502,
  );
}

function providerBadge(value: unknown, context: string) {
  if (typeof value === "string" && /^\d{1,20}$/.test(value.trim())) {
    return value.trim();
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

function equivalentBadge(left: string, right: string) {
  const normalise = (value: string) => value.replace(/^0+(?=\d)/, "");
  return normalise(left) === normalise(right);
}

function employee(value: unknown, context: string): ArgoEmployee {
  const row = record(value, context);
  const plant =
    row.plant !== undefined && row.plant !== null
      ? record(row.plant, `${context}.plant`)
      : null;
  const plantIdValue = plant?.id ?? row.plant_id;
  const plantIdContext =
    plant?.id !== undefined
      ? `${context}.plant.id`
      : `${context}.plant_id`;

  return {
    id: positiveInteger(row.id, `${context}.id`),
    // Live list_employees returns plant as an object:
    // { plant: { id: 150, name: "(England)" } }.
    // Retain plant_id as a compatibility fallback for older/provider variants.
    plantId: providerPositiveInteger(plantIdValue, plantIdContext),
    badge: providerBadge(row.badge, `${context}.badge`),
    firstName: nullableText(row.first_name, `${context}.first_name`),
    lastName: nullableText(row.last_name, `${context}.last_name`),
    employeeNumber: nullableText(row.employee_number, `${context}.employee_number`),
    active: typeof row.active === "boolean" ? row.active : null,
    modifiedAt: typeof row.modified_at === "string" ? row.modified_at : null,
    raw: row,
  };
}

function listParameters(input: EmployeeListInput) {
  const parameters: Record<string, unknown> = {};
  if (input.plantId !== undefined) parameters.plant_id = input.plantId;
  if (input.badge !== undefined) parameters.badge = normalizeArgoBadge(input.badge);
  if (input.page !== undefined) parameters.page = input.page;
  if (input.perPage !== undefined) parameters.per_page = input.perPage;
  if (input.q !== undefined) parameters.q = input.q;
  if (input.status !== undefined) parameters.status = input.status;
  if (input.modifiedSince !== undefined) parameters.modified_since = input.modifiedSince;
  return parameters;
}

export async function listArgoEmployees(
  input: EmployeeListInput = {},
): Promise<ArgoPage<ArgoEmployee>> {
  const body = await requestArgo({
    requestType: "list_employees",
    databaseUuid: configuredArgoDatabaseUuid(),
    parameters: listParameters(input),
  });

  return {
    data: dataArray(body, "list_employees").map((item, index) =>
      employee(item, `list_employees.data[${index}]`),
    ),
    meta: listMeta(body, "list_employees"),
  };
}

export async function getArgoEmployee(id: number): Promise<ArgoEmployee> {
  const body = await requestArgo({
    requestType: "get_employee",
    databaseUuid: configuredArgoDatabaseUuid(),
    parameters: { id },
  });
  return employee(dataRecord(body, "get_employee"), "get_employee.data");
}

export async function resolveArgoEmployeeByBadge(
  rawBadge: string,
): Promise<ArgoEmployee | null> {
  const config = getArgoConfig();
  const badge = normalizeArgoBadge(rawBadge);
  const page = await listArgoEmployees({
    plantId: config.plantId,
    badge,
    status: "all",
    perPage: 500,
  });

  const matches = page.data.filter(
    (item) =>
      item.plantId === config.plantId && equivalentBadge(item.badge, badge),
  );

  if (matches.length > 1) {
    throw new ArgoApiError(
      "NEXT ARGO returned more than one employee for this plant and badge.",
      "INVALID_RESPONSE",
      502,
    );
  }

  return matches[0] || null;
}

export async function createArgoEmployee(
  input: CreateArgoEmployeeInput,
): Promise<ArgoEmployee> {
  const config = getArgoConfig();
  const parameters: Record<string, unknown> = {
    badge: normalizeArgoBadge(input.badge),
    first_name: input.firstName.trim(),
    last_name: input.lastName.trim(),
    plant_id: config.plantId,
    department_id: input.departmentId ?? 0,
    employee_group_id: input.employeeGroupId ?? 0,
    job_id: input.jobId ?? 0,
    qualification_id: input.qualificationId ?? 0,
    cost_centre_id: input.costCentreId ?? 0,
    profile_id: input.profileId ?? 0,
    band_id: input.bandId ?? 0,
  };

  if (!parameters.first_name || !parameters.last_name) {
    throw new ArgoApiError(
      "NEXT ARGO employee first and last names are required.",
      "INVALID_REQUEST",
      400,
    );
  }

  if (input.employeeNumber?.trim()) parameters.employee_number = input.employeeNumber.trim();
  if (input.hiredOn?.trim()) parameters.hired_on = input.hiredOn.trim();
  if (input.leftOn?.trim()) parameters.left_on = input.leftOn.trim();

  const body = await requestArgo({
    requestType: "create_employee",
    databaseUuid: configuredArgoDatabaseUuid(),
    parameters,
  });

  const created = dataRecord(body, "create_employee");
  const id = positiveInteger(created.id, "create_employee.data.id");
  return getArgoEmployee(id);
}


export async function ensureArgoEmployeeForBadge(
  input: Omit<CreateArgoEmployeeInput, "badge"> & { badge: string },
): Promise<{ employee: ArgoEmployee; created: boolean }> {
  const existing = await resolveArgoEmployeeByBadge(input.badge);
  if (existing) return { employee: existing, created: false };

  const created = await createArgoEmployee(input);
  return { employee: created, created: true };
}
