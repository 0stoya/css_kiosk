export type KioskAuthState =
  | "idle"
  | "reading"
  | "unregistered"
  | "linking"
  | "confirm-link"
  | "welcome"
  | "error";

export type MockCardScenario = "registered" | "unregistered" | "revoked";

export type KioskCustomer = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
};

export const mockCustomer: KioskCustomer = {
  id: "mock-customer-1",
  firstName: "Alex",
  lastName: "Taylor",
  email: "alex.taylor@example.com",
  companyName: "Example Trade Customer",
};
