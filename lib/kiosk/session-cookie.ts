import { cookies } from "next/headers";

const SESSION_COOKIE = "css_kiosk_session";
const SESSION_MAX_AGE_SECONDS = 15 * 60;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export async function getKioskSessionId() {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}

export async function setKioskSessionId(sessionId: string) {
  (await cookies()).set(SESSION_COOKIE, sessionId, {
    ...cookieOptions(),
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearKioskSessionId() {
  (await cookies()).set(SESSION_COOKIE, "", {
    ...cookieOptions(),
    maxAge: 0,
  });
}
