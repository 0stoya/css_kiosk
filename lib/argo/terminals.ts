import { ArgoApiError, configuredArgoDatabaseUuid, requestArgo } from "@/lib/argo/client";
import { getArgoConfig } from "@/lib/argo/config";
import {
  array,
  boolean,
  dataArray,
  dataRecord,
  integer,
  listMeta,
  nullableText,
  nonNegativeInteger,
  positiveInteger,
  record,
  text,
} from "@/lib/argo/parsing";
import type {
  ArgoPage,
  ArgoSlotSummary,
  ArgoTerminal,
  ArgoTerminalLoadingPlan,
  ArgoTerminalSlot,
  ArgoTerminalSummary,
} from "@/lib/argo/types";

type TerminalListInput = {
  plantId?: number;
  type?: string;
  page?: number;
  perPage?: number;
  q?: string;
  status?: "active" | "inactive" | "all";
  modifiedSince?: string;
};

function slotSummary(value: unknown, context: string): ArgoSlotSummary {
  const row = record(value, context);
  return {
    total: nonNegativeInteger(row.total, `${context}.total`),
    empty: nonNegativeInteger(row.empty, `${context}.empty`),
    partial: nonNegativeInteger(row.partial, `${context}.partial`),
    full: nonNegativeInteger(row.full, `${context}.full`),
    unassigned: nonNegativeInteger(row.unassigned, `${context}.unassigned`),
    unmaterialised: nonNegativeInteger(
      row.unmaterialised,
      `${context}.unmaterialised`,
    ),
  };
}

function terminalSummary(value: unknown, context: string): ArgoTerminalSummary {
  const row = record(value, context);
  return {
    id: positiveInteger(row.id, `${context}.id`),
    type: text(row.type, `${context}.type`),
    plantId: positiveInteger(row.plant_id, `${context}.plant_id`),
    description: text(row.description, `${context}.description`),
    ipAddress: nullableText(row.ip_address, `${context}.ip_address`),
    serialNumber: text(row.serial_number, `${context}.serial_number`),
    softwareVersion: nullableText(row.software_version, `${context}.software_version`),
    active: boolean(row.active, `${context}.active`),
    statusCode: integer(row.status_code, `${context}.status_code`),
    modifiedAt: text(row.modified_at, `${context}.modified_at`),
    slotSummary: slotSummary(row.slot_summary, `${context}.slot_summary`),
  };
}

function slot(value: unknown, context: string): ArgoTerminalSlot {
  const row = record(value, context);
  const productId =
    row.product_id === null || row.product_id === undefined
      ? null
      : positiveInteger(row.product_id, `${context}.product_id`);

  return {
    cellId: positiveInteger(row.cell_id, `${context}.cell_id`),
    plateNumber: positiveInteger(row.plate_number, `${context}.plate_number`),
    sectorNumber: positiveInteger(row.sector_number, `${context}.sector_number`),
    cellNumber: positiveInteger(row.cell_number, `${context}.cell_number`),
    productId,
  };
}

function loadingPlan(value: unknown, context: string): ArgoTerminalLoadingPlan {
  const row = record(value, context);
  const product = record(row.product, `${context}.product`);
  const inventory = record(row.inventory, `${context}.inventory`);

  return {
    id: positiveInteger(row.id, `${context}.id`),
    plate: positiveInteger(row.plate, `${context}.plate`),
    sector: positiveInteger(row.sector, `${context}.sector`),
    cellCount: nonNegativeInteger(row.cell_count, `${context}.cell_count`),
    quantityPerCell: nonNegativeInteger(
      row.quantity_per_cell,
      `${context}.quantity_per_cell`,
    ),
    capacity: nonNegativeInteger(row.capacity, `${context}.capacity`),
    product: {
      id: positiveInteger(product.id, `${context}.product.id`),
      code: nullableText(product.code, `${context}.product.code`),
      customerCode: nullableText(
        product.customer_code,
        `${context}.product.customer_code`,
      ),
      description: nullableText(
        product.description,
        `${context}.product.description`,
      ),
    },
    variant: row.variant ?? null,
    inventory: {
      maximum: integer(inventory.maximum, `${context}.inventory.maximum`),
      current: integer(inventory.current, `${context}.inventory.current`),
      reserve: integer(inventory.reserve, `${context}.inventory.reserve`),
    },
    modifiedAt: text(row.modified_at, `${context}.modified_at`),
  };
}

function listParameters(input: TerminalListInput) {
  const parameters: Record<string, unknown> = {};
  if (input.plantId !== undefined) parameters.plant_id = input.plantId;
  if (input.type !== undefined) parameters.type = input.type;
  if (input.page !== undefined) parameters.page = input.page;
  if (input.perPage !== undefined) parameters.per_page = input.perPage;
  if (input.q !== undefined) parameters.q = input.q;
  if (input.status !== undefined) parameters.status = input.status;
  if (input.modifiedSince !== undefined) parameters.modified_since = input.modifiedSince;
  return parameters;
}

export async function listArgoTerminals(
  input: TerminalListInput = {},
): Promise<ArgoPage<ArgoTerminalSummary>> {
  const body = await requestArgo({
    requestType: "list_terminals",
    databaseUuid: configuredArgoDatabaseUuid(),
    parameters: listParameters(input),
  });

  return {
    data: dataArray(body, "list_terminals").map((item, index) =>
      terminalSummary(item, `list_terminals.data[${index}]`),
    ),
    meta: listMeta(body, "list_terminals"),
  };
}

export async function getArgoTerminal(id: number): Promise<ArgoTerminal> {
  const body = await requestArgo({
    requestType: "get_terminal",
    databaseUuid: configuredArgoDatabaseUuid(),
    parameters: { id },
  });
  const row = dataRecord(body, "get_terminal");
  const summary = terminalSummary(row, "get_terminal.data");

  return {
    ...summary,
    emptySlots: array(row.empty_slots, "get_terminal.data.empty_slots").map((item, index) =>
      slot(item, `get_terminal.data.empty_slots[${index}]`),
    ),
    fullSlots: array(row.full_slots, "get_terminal.data.full_slots").map((item, index) =>
      slot(item, `get_terminal.data.full_slots[${index}]`),
    ),
    loadingPlan: array(row.loading_plan, "get_terminal.data.loading_plan").map(
      (item, index) => loadingPlan(item, `get_terminal.data.loading_plan[${index}]`),
    ),
  };
}

export async function resolveConfiguredArgoTerminal(): Promise<ArgoTerminal> {
  const config = getArgoConfig();
  const page = await listArgoTerminals({
    plantId: config.plantId,
    type: config.terminalType,
    perPage: 500,
    status: "active",
  });

  const matches = page.data.filter(
    (terminal) =>
      terminal.active &&
      terminal.plantId === config.plantId &&
      terminal.type === config.terminalType &&
      terminal.serialNumber === config.terminalSerial,
  );

  if (matches.length === 0) {
    throw new ArgoApiError(
      "The configured NEXT ARGO terminal was not found.",
      "NOT_FOUND",
      503,
    );
  }

  if (matches.length !== 1) {
    throw new ArgoApiError(
      "NEXT ARGO returned more than one configured terminal match.",
      "INVALID_RESPONSE",
      502,
    );
  }

  const terminal = await getArgoTerminal(matches[0].id);
  if (
    !terminal.active ||
    terminal.plantId !== config.plantId ||
    terminal.type !== config.terminalType ||
    terminal.serialNumber !== config.terminalSerial
  ) {
    throw new ArgoApiError(
      "NEXT ARGO terminal identity changed during resolution.",
      "INVALID_RESPONSE",
      502,
    );
  }

  return terminal;
}
