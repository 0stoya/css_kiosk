export type ArgoListMeta = {
  page: number;
  perPage: number;
  total: number;
  pageCount: number;
};

export type ArgoDatabase = {
  name: string;
  databaseUuid: string;
};

export type ArgoSlotSummary = {
  total: number;
  empty: number;
  partial: number;
  full: number;
  unassigned: number;
  unmaterialised: number;
};

export type ArgoTerminalSummary = {
  id: number;
  type: string;
  plantId: number;
  description: string;
  ipAddress: string | null;
  serialNumber: string;
  softwareVersion: string | null;
  active: boolean;
  statusCode: number;
  modifiedAt: string;
  slotSummary: ArgoSlotSummary;
};

export type ArgoTerminalSlot = {
  cellId: number;
  plateNumber: number;
  sectorNumber: number;
  cellNumber: number;
  productId: number | null;
};

export type ArgoTerminalLoadingPlan = {
  id: number;
  plate: number;
  sector: number;
  cellCount: number;
  quantityPerCell: number;
  capacity: number;
  product: {
    id: number;
    code: string | null;
    customerCode: string | null;
    description: string | null;
  };
  variant: unknown;
  inventory: {
    maximum: number;
    current: number;
    reserve: number;
  };
  modifiedAt: string;
};

export type ArgoTerminal = ArgoTerminalSummary & {
  emptySlots: ArgoTerminalSlot[];
  fullSlots: ArgoTerminalSlot[];
  loadingPlan: ArgoTerminalLoadingPlan[];
};

export type ArgoEmployee = {
  id: number;
  plantId: number;
  badge: string;
  firstName: string | null;
  lastName: string | null;
  employeeNumber: string | null;
  profileId: number | null;
  profileName: string | null;
  active: boolean | null;
  modifiedAt: string | null;
  raw: Record<string, unknown>;
};

export type ArgoProduct = {
  id: number;
  code: string | null;
  customerCode: string | null;
  description: string | null;
  unit: string | null;
  active: boolean | null;
  modifiedAt: string | null;
  raw: Record<string, unknown>;
};

export type ArgoCartSummary = {
  id: number;
  terminalId: number;
  employeeId: number;
  badge: string;
  createdAt: string;
  projectId: number;
  projectNumber: string;
  lineCount: number;
  totalQuantity: number;
};

export type ArgoCartLine = {
  id: number;
  productId: number;
  attributeId: number;
  quantity: number;
  outcomeId: number;
  expiryDate: string | null;
  expectedArrivalDate: string | null;
  product: {
    code: string | null;
    customerCode: string | null;
    description: string | null;
    unit: string | null;
  };
};

export type ArgoCart = Omit<ArgoCartSummary, "lineCount" | "totalQuantity"> & {
  lines: ArgoCartLine[];
  lineCount: number;
  totalQuantity: number;
};

export type ArgoPage<T> = {
  data: T[];
  meta: ArgoListMeta;
};

export type ArgoHealth = {
  service: string | null;
  version: string | null;
  endpoint: string | null;
  method: string | null;
  authHeader: string | null;
  limits: {
    perPageMax: number | null;
    generalPerMinute: number | null;
    reportingPerMinute: number | null;
  };
  operations: unknown[];
  errors: unknown[];
  raw: Record<string, unknown>;
};
