import { NextResponse } from "next/server";
import {
  ArgoWebhookConfigError,
  argoWebhookEventId,
  verifyArgoWebhookSignature,
} from "@/lib/argo/webhook";
import {
  ArgoWebhookEventConflictError,
  recordArgoWebhookEvent,
} from "@/lib/kiosk/argo-webhook-event-store";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 256 * 1024;

function jsonError(status: number, code: string, error: string) {
  return NextResponse.json({ ok: false, code, error }, { status });
}

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    /^\d+$/.test(contentLength) &&
    Number(contentLength) > MAX_BODY_BYTES
  ) {
    return jsonError(413, "ARGO_WEBHOOK_TOO_LARGE", "ARGO webhook body is too large.");
  }

  const signature = request.headers.get("x-argo-signature");
  const eventId = argoWebhookEventId(request.headers.get("x-argo-event-id"));

  if (!signature || !eventId) {
    return jsonError(
      400,
      "ARGO_WEBHOOK_HEADERS_REQUIRED",
      "ARGO webhook signature and event ID headers are required.",
    );
  }

  let rawBody: Buffer;
  try {
    rawBody = Buffer.from(await request.arrayBuffer());
  } catch {
    return jsonError(
      400,
      "ARGO_WEBHOOK_BODY_UNREADABLE",
      "ARGO webhook body could not be read.",
    );
  }

  if (rawBody.length === 0) {
    return jsonError(400, "ARGO_WEBHOOK_BODY_REQUIRED", "ARGO webhook body is required.");
  }

  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonError(413, "ARGO_WEBHOOK_TOO_LARGE", "ARGO webhook body is too large.");
  }

  try {
    if (!verifyArgoWebhookSignature(rawBody, signature)) {
      return jsonError(
        401,
        "ARGO_WEBHOOK_SIGNATURE_INVALID",
        "ARGO webhook signature is invalid.",
      );
    }
  } catch (error) {
    if (error instanceof ArgoWebhookConfigError) {
      return jsonError(
        503,
        "ARGO_WEBHOOK_NOT_CONFIGURED",
        "ARGO webhook verification is not configured.",
      );
    }
    throw error;
  }

  let payload: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody.toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonError(
        400,
        "ARGO_WEBHOOK_JSON_INVALID",
        "ARGO webhook body must be a JSON object.",
      );
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return jsonError(
      400,
      "ARGO_WEBHOOK_JSON_INVALID",
      "ARGO webhook body is not valid JSON.",
    );
  }

  const payloadEventId =
    typeof payload.event_id === "string" ? payload.event_id.trim() : null;
  if (payloadEventId && payloadEventId !== eventId) {
    return jsonError(
      409,
      "ARGO_WEBHOOK_EVENT_ID_MISMATCH",
      "ARGO webhook event ID does not match the signed delivery header.",
    );
  }

  try {
    const recorded = recordArgoWebhookEvent({
      eventId,
      rawBody,
      payload,
    });

    return NextResponse.json({
      ok: true,
      eventId,
      duplicate: !recorded.stored,
      processingStatus: recorded.event.processingStatus,
    });
  } catch (error) {
    if (error instanceof ArgoWebhookEventConflictError) {
      return jsonError(
        409,
        "ARGO_WEBHOOK_EVENT_CONFLICT",
        "ARGO webhook event ID was already stored with different content.",
      );
    }

    return jsonError(
      503,
      "ARGO_WEBHOOK_STORE_UNAVAILABLE",
      "ARGO webhook event could not be stored.",
    );
  }
}
