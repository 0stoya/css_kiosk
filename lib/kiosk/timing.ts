function publicSeconds(
  value: string | undefined,
  fallback: number,
  range: { min: number; max: number },
) {
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    !Number.isInteger(parsed) ||
    parsed < range.min ||
    parsed > range.max
  ) {
    return fallback;
  }

  return parsed;
}

export const KIOSK_WELCOME_DELAY_SECONDS = publicSeconds(
  process.env.NEXT_PUBLIC_KIOSK_WELCOME_DELAY_SECONDS,
  2,
  { min: 1, max: 30 },
);

export const KIOSK_INACTIVITY_TIMEOUT_SECONDS = publicSeconds(
  process.env.NEXT_PUBLIC_KIOSK_INACTIVITY_TIMEOUT_SECONDS,
  90,
  { min: 30, max: 900 },
);

export const KIOSK_WELCOME_DELAY_MS = KIOSK_WELCOME_DELAY_SECONDS * 1000;
export const KIOSK_INACTIVITY_TIMEOUT_MS = KIOSK_INACTIVITY_TIMEOUT_SECONDS * 1000;
