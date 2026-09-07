export type NfcCredentialType = "secure-token" | "uid";

export type NfcCredential = {
  type: NfcCredentialType;
  value: string;
};

export type NfcReadHandler = (credential: NfcCredential) => void;
export type NfcErrorHandler = (error: Error) => void;

export interface NfcReader {
  start(): Promise<void>;
  stop(): Promise<void>;
  onCredential(handler: NfcReadHandler): () => void;
  onError(handler: NfcErrorHandler): () => void;
}

/**
 * Production Android code will implement this interface through a narrow native
 * bridge. The web UI must not assume Web NFC, NDEF or UID until the TouchWo
 * hardware has been inspected.
 */
export type NfcReaderFactory = () => NfcReader;
