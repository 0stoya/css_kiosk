import { NextResponse } from "next/server";
import { ArgoApiError } from "@/lib/argo/client";
import { getArgoReadiness } from "@/lib/argo/readiness";

export const runtime = "nodejs";

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const argo = await getArgoReadiness();
    return NextResponse.json({ ok: true, argo });
  } catch (error) {
    if (error instanceof ArgoApiError) {
      return NextResponse.json(
        {
          ok: false,
          code: error.code,
          error: error.message,
          retryAfterSeconds: error.retryAfterSeconds,
        },
        { status: error.status },
      );
    }

    return NextResponse.json(
      {
        ok: false,
        code: "ARGO_UNAVAILABLE",
        error: "NEXT ARGO readiness could not be verified.",
      },
      { status: 503 },
    );
  }
}
