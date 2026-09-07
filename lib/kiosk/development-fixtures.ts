import type { NfcCredential } from "@/lib/kiosk/nfc-reader";
import type { VerifiedKioskCustomer } from "@/lib/magento/customer-context";

export const SIMULATED_NFC_CREDENTIALS = {
  registered: { type: "secure-token", value: "SIM-CARD-REGISTERED-001" },
  unregistered: { type: "secure-token", value: "SIM-CARD-UNREGISTERED-001" },
  revoked: { type: "secure-token", value: "SIM-CARD-REVOKED-001" },
} as const satisfies Record<string, NfcCredential>;

const company = {
  companyId: 900001,
  companyUserId: 900001,
  name: "Example Trade Customer",
  reference: "SIM001",
  selected: true,
};

export const simulatedRegisteredCustomer: VerifiedKioskCustomer = {
  customerId: 900001,
  firstName: "Alex",
  lastName: "Taylor",
  email: "alex.taylor@example.com",
  company,
  companies: [company],
};

export function resolveDevelopmentFixture(credential: NfcCredential) {
  if (process.env.NODE_ENV === "production") return null;

  if (credential.value === SIMULATED_NFC_CREDENTIALS.registered.value) {
    return { status: "registered" as const, customer: simulatedRegisteredCustomer };
  }

  if (credential.value === SIMULATED_NFC_CREDENTIALS.revoked.value) {
    return { status: "revoked" as const };
  }

  if (credential.value === SIMULATED_NFC_CREDENTIALS.unregistered.value) {
    return { status: "unregistered" as const };
  }

  return null;
}
