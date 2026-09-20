import { requestArgo } from "@/lib/argo/client";
import {
  array,
  dataArray,
  nullableText,
  nonNegativeInteger,
  record,
  text,
} from "@/lib/argo/parsing";
import type { ArgoDatabase, ArgoHealth } from "@/lib/argo/types";

function nullableInteger(value: unknown, context: string) {
  if (value === null || value === undefined) return null;
  return nonNegativeInteger(value, context);
}

export async function getArgoHealth(): Promise<ArgoHealth> {
  const body = record(await requestArgo({ requestType: "health" }), "health");
  const limits = body.limits ? record(body.limits, "health.limits") : {};

  return {
    service: nullableText(body.service, "health.service"),
    version: nullableText(body.version, "health.version"),
    endpoint: nullableText(body.endpoint, "health.endpoint"),
    method: nullableText(body.method, "health.method"),
    authHeader: nullableText(body.auth_header, "health.auth_header"),
    limits: {
      perPageMax: nullableInteger(limits.per_page_max, "health.limits.per_page_max"),
      generalPerMinute: nullableInteger(
        limits.general_per_minute,
        "health.limits.general_per_minute",
      ),
      reportingPerMinute: nullableInteger(
        limits.reporting_per_minute,
        "health.limits.reporting_per_minute",
      ),
    },
    operations: body.operations === undefined ? [] : array(body.operations, "health.operations"),
    errors: body.errors === undefined ? [] : array(body.errors, "health.errors"),
    raw: body,
  };
}

export async function describeArgo(): Promise<Record<string, unknown>> {
  return record(await requestArgo({ requestType: "describe" }), "describe");
}

export async function listArgoDatabases(): Promise<ArgoDatabase[]> {
  const body = await requestArgo({ requestType: "list_databases" });
  return dataArray(body, "list_databases").map((item, index) => {
    const row = record(item, `list_databases.data[${index}]`);
    return {
      name: text(row.name, `list_databases.data[${index}].name`),
      databaseUuid: text(
        row.database_uuid,
        `list_databases.data[${index}].database_uuid`,
      ),
    };
  });
}
