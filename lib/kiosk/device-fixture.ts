export const DEVELOPMENT_DEVICE_ID_PREFIX = "SIM-GD238C";
export const DEVELOPMENT_DEVICE_LABEL = "TouchWo GD238C simulator";

export function isDevelopmentDeviceId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith(`${DEVELOPMENT_DEVICE_ID_PREFIX}-`) &&
    value.length <= 128 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}
