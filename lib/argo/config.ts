const DEFAULT_ARGO_API_URL = "https://next.lanzigroup.com/customer-api";

export type ArgoConfig = {
  apiUrl: string;
  apiKey: string;
  databaseUuid: string;
  plantId: number;
  terminalType: string;
  terminalSerial: string;
  writesEnabled: boolean;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function positiveInteger(name: string) {
  const value = required(name);
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a safe positive integer.`);
  }

  return parsed;
}

function databaseUuid() {
  const value = required("ARGO_DATABASE_UUID").toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) {
    throw new Error("ARGO_DATABASE_UUID must be a valid UUID.");
  }
  return value;
}

function apiUrl() {
  const raw = process.env.ARGO_API_URL?.trim() || DEFAULT_ARGO_API_URL;
  const parsed = new URL(raw);

  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("ARGO_API_URL must use HTTPS in production.");
  }

  return parsed.toString().replace(/\/$/, "");
}

export function getArgoConfig(): ArgoConfig {
  return {
    apiUrl: apiUrl(),
    apiKey: required("ARGO_API_KEY"),
    databaseUuid: databaseUuid(),
    plantId: positiveInteger("ARGO_PLANT_ID"),
    terminalType: required("ARGO_TERMINAL_TYPE"),
    terminalSerial: required("ARGO_TERMINAL_SERIAL"),
    writesEnabled: process.env.ARGO_WRITES_ENABLED?.trim().toLowerCase() === "true",
  };
}
