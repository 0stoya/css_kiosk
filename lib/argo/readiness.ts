import { getArgoHealth, listArgoDatabases } from "@/lib/argo/account";
import { ArgoApiError } from "@/lib/argo/client";
import { getArgoConfig } from "@/lib/argo/config";
import { resolveConfiguredArgoTerminal } from "@/lib/argo/terminals";

export type ArgoReadiness = {
  service: string | null;
  version: string | null;
  database: {
    uuid: string;
    name: string | null;
  };
  terminal: {
    id: number;
    plantId: number;
    type: string;
    serialNumber: string;
    description: string;
    active: boolean;
    statusCode: number;
    slotSummary: {
      total: number;
      full: number;
      empty: number;
      partial: number;
      unassigned: number;
      unmaterialised: number;
    };
  };
};

export async function getArgoReadiness(): Promise<ArgoReadiness> {
  const config = getArgoConfig();
  const [health, databases, terminal] = await Promise.all([
    getArgoHealth(),
    listArgoDatabases(),
    resolveConfiguredArgoTerminal(),
  ]);

  const configuredDatabase = databases.find(
    (database) => database.databaseUuid.toLowerCase() === config.databaseUuid,
  );

  if (!configuredDatabase) {
    throw new ArgoApiError(
      "The configured NEXT ARGO database is not granted to this API key.",
      "FORBIDDEN",
      503,
      "database_not_granted",
    );
  }

  return {
    service: health.service,
    version: health.version,
    database: {
      uuid: configuredDatabase.databaseUuid,
      name: configuredDatabase.name || null,
    },
    terminal: {
      id: terminal.id,
      plantId: terminal.plantId,
      type: terminal.type,
      serialNumber: terminal.serialNumber,
      description: terminal.description,
      active: terminal.active,
      statusCode: terminal.statusCode,
      slotSummary: terminal.slotSummary,
    },
  };
}
