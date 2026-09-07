import { cookies } from "next/headers";

const PENDING_LINK_COOKIE = "css_kiosk_pending_link";

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export async function getPendingLinkProof() {
  return (await cookies()).get(PENDING_LINK_COOKIE)?.value ?? null;
}

export async function setPendingLinkProof(proof: string) {
  (await cookies()).set(PENDING_LINK_COOKIE, proof, {
    ...cookieOptions(),
    maxAge: 5 * 60,
  });
}

export async function clearPendingLinkProof() {
  (await cookies()).set(PENDING_LINK_COOKIE, "", {
    ...cookieOptions(),
    maxAge: 0,
  });
}
