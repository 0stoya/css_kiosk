import { SIMULATED_NFC_CREDENTIALS } from "@/lib/kiosk/development-fixtures";
import type { NfcErrorHandler, NfcReadHandler, NfcReader } from "@/lib/kiosk/nfc-reader";

export type SimulatedCardFixture = "registered" | "unregistered" | "revoked" | "read-error";
export type SimulatedMagentoResult = "real" | "success" | "invalid-credentials" | "unavailable";

export interface KioskNfcSimulator extends NfcReader {
  setAvailable(available: boolean): void;
  presentCard(fixture: SimulatedCardFixture): void;
}

class BrowserKioskNfcSimulator implements KioskNfcSimulator {
  private started = false;
  private available = true;
  private readHandlers = new Set<NfcReadHandler>();
  private errorHandlers = new Set<NfcErrorHandler>();

  async start() {
    this.started = true;
  }

  async stop() {
    this.started = false;
  }

  onCredential(handler: NfcReadHandler) {
    this.readHandlers.add(handler);
    return () => this.readHandlers.delete(handler);
  }

  onError(handler: NfcErrorHandler) {
    this.errorHandlers.add(handler);
    return () => this.errorHandlers.delete(handler);
  }

  setAvailable(available: boolean) {
    this.available = available;
  }

  presentCard(fixture: SimulatedCardFixture) {
    if (!this.started) {
      this.emitError(new Error("NFC simulator is not started."));
      return;
    }

    if (!this.available) {
      this.emitError(new Error("The NFC reader is unavailable."));
      return;
    }

    window.setTimeout(() => {
      if (fixture === "read-error") {
        this.emitError(new Error("The card could not be read. Please try again."));
        return;
      }

      this.readHandlers.forEach((handler) => handler(SIMULATED_NFC_CREDENTIALS[fixture]));
    }, 220);
  }

  private emitError(error: Error) {
    this.errorHandlers.forEach((handler) => handler(error));
  }
}

export function createKioskNfcSimulator(): KioskNfcSimulator {
  return new BrowserKioskNfcSimulator();
}
