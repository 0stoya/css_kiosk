import { ArgoApiError } from "@/lib/argo/client";
import type { ArgoListMeta } from "@/lib/argo/types";

export function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidResponse(context);
  }
  return value as Record<string, unknown>;
}

export function array(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw invalidResponse(context);
  return value;
}

export function integer(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw invalidResponse(context);
  }
  return value;
}

export function nonNegativeInteger(value: unknown, context: string): number {
  const parsed = integer(value, context);
  if (parsed < 0) throw invalidResponse(context);
  return parsed;
}

export function positiveInteger(value: unknown, context: string): number {
  const parsed = integer(value, context);
  if (parsed <= 0) throw invalidResponse(context);
  return parsed;
}

export function text(value: unknown, context: string): string {
  if (typeof value !== "string") throw invalidResponse(context);
  return value;
}

export function nullableText(value: unknown, context: string): string | null {
  if (value === null || value === undefined) return null;
  return text(value, context);
}

export function boolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") throw invalidResponse(context);
  return value;
}

export function nullableBoolean(value: unknown, context: string): boolean | null {
  if (value === null || value === undefined) return null;
  return boolean(value, context);
}

export function dataRecord(body: unknown, context: string) {
  const envelope = record(body, context);
  return record(envelope.data, context);
}

export function dataArray(body: unknown, context: string) {
  const envelope = record(body, context);
  return array(envelope.data, context);
}

export function listMeta(body: unknown, context: string): ArgoListMeta {
  const envelope = record(body, context);
  const meta = record(envelope.meta, context);
  return {
    page: positiveInteger(meta.page, `${context}.meta.page`),
    perPage: positiveInteger(meta.per_page, `${context}.meta.per_page`),
    total: nonNegativeInteger(meta.total, `${context}.meta.total`),
    pageCount: nonNegativeInteger(meta.page_count, `${context}.meta.page_count`),
  };
}

export function invalidResponse(context: string): ArgoApiError {
  return new ArgoApiError(
    `NEXT ARGO returned an invalid response for ${context}.`,
    "INVALID_RESPONSE",
    502,
  );
}
