"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./locker-admin-panel.module.css";

type SignedFetch = (input: string, init?: RequestInit) => Promise<Response>;

type LockerPosition = {
  cellId: number;
  plateNumber: number;
  sectorNumber: number;
  cellNumber: number;
  state: "full" | "empty";
  product: {
    id: number;
    code: string | null;
    customerCode: string | null;
    description: string | null;
  } | null;
};

type LockerStatus = {
  terminal: {
    id: number;
    type: string;
    description: string;
    serialNumber: string;
    softwareVersion: string | null;
    active: boolean;
    statusCode: number;
    modifiedAt: string;
  };
  summary: {
    total: number;
    empty: number;
    partial: number;
    full: number;
    unassigned: number;
    unmaterialised: number;
  };
  positions: LockerPosition[];
  manualOpen: {
    available: false;
    reason: string;
  };
};

type LockerAdminResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  capability?: {
    canViewStatus: boolean;
    canOpen: boolean;
    manualOpenAvailable: boolean;
  };
  status?: LockerStatus;
};

type LockerAdminPanelProps = {
  signedFetch: SignedFetch;
  onClose: () => void;
  onSessionExpired: (message: string) => void;
};

function positionLabel(position: LockerPosition) {
  return `P${position.plateNumber} · S${position.sectorNumber} · C${position.cellNumber}`;
}

function productLabel(position: LockerPosition) {
  if (!position.product) return "No product assigned";
  return (
    position.product.description?.trim() ||
    position.product.customerCode?.trim() ||
    position.product.code?.trim() ||
    `ARGO product #${position.product.id}`
  );
}

function formatUpdated(value: string) {
  const date = new Date(value.replace(" ", "T") + (value.includes("T") ? "" : "Z"));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function LockerAdminPanel({
  signedFetch,
  onClose,
  onSessionExpired,
}: LockerAdminPanelProps) {
  const [status, setStatus] = useState<LockerStatus | null>(null);
  const [capability, setCapability] = useState<LockerAdminResponse["capability"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  const loadStatus = useCallback(
    async (refresh = false) => {
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);

      try {
        const response = await signedFetch("/api/locker/admin", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "status" }),
        });
        const body = (await response.json()) as LockerAdminResponse;

        if (response.status === 401 || body.code === "SESSION_REQUIRED") {
          onSessionExpired("Your kiosk session has expired. Tap your card to sign in again.");
          return;
        }

        if (!response.ok || !body.ok || !body.status || !body.capability) {
          setError(body.error || "Live locker status could not be loaded right now.");
          return;
        }

        setStatus(body.status);
        setCapability(body.capability);
      } catch {
        setError("Live locker status could not be loaded right now.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [onSessionExpired, signedFetch],
  );

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function requestOpen(position: LockerPosition) {
    if (!capability?.canOpen || !capability.manualOpenAvailable) return;
    setOpenError(null);

    try {
      const response = await signedFetch("/api/locker/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", cellId: position.cellId }),
      });
      const body = (await response.json()) as LockerAdminResponse;

      if (response.status === 401 || body.code === "SESSION_REQUIRED") {
        onSessionExpired("Your kiosk session has expired. Tap your card to sign in again.");
        return;
      }

      if (!response.ok || !body.ok) {
        setOpenError(body.error || "This locker position could not be opened.");
        return;
      }

      await loadStatus(true);
    } catch {
      setOpenError("This locker position could not be opened.");
    }
  }

  const fullPositions = status?.positions.filter((position) => position.state === "full") || [];
  const emptyPositions = status?.positions.filter((position) => position.state === "empty") || [];

  return (
    <div className={styles.backdrop} role="presentation">
      <section className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="locker-admin-title">
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Locker management</p>
            <h2 id="locker-admin-title">Live locker status</h2>
            {status ? (
              <p className={styles.subtitle}>
                {status.terminal.description} · {status.terminal.serialNumber}
              </p>
            ) : null}
          </div>
          <div className={styles.headerActions}>
            <button
              className={styles.refreshButton}
              type="button"
              onClick={() => void loadStatus(true)}
              disabled={loading || refreshing}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <button className={styles.closeButton} type="button" onClick={onClose} aria-label="Close locker status">
              ×
            </button>
          </div>
        </header>

        {loading ? <div className={styles.loading}>Loading live locker status…</div> : null}

        {error ? (
          <div className={styles.error} role="alert">
            <strong>Locker status unavailable</strong>
            <span>{error}</span>
            <button type="button" onClick={() => void loadStatus()}>Try again</button>
          </div>
        ) : null}

        {status && !error ? (
          <>
            <section className={styles.summary} aria-label="Locker occupancy summary">
              <article>
                <span>Total positions</span>
                <strong>{status.summary.total}</strong>
              </article>
              <article>
                <span>Full</span>
                <strong>{status.summary.full}</strong>
              </article>
              <article>
                <span>Empty</span>
                <strong>{status.summary.empty}</strong>
              </article>
              <article>
                <span>Unmaterialised</span>
                <strong>{status.summary.unmaterialised}</strong>
              </article>
            </section>

            <div className={styles.statusLine}>
              <span className={status.terminal.active ? styles.liveBadge : styles.offlineBadge}>
                {status.terminal.active ? "ARGO active" : "ARGO inactive"}
              </span>
              <span>Provider status {status.terminal.statusCode}</span>
              <span>Updated {formatUpdated(status.terminal.modifiedAt)}</span>
            </div>

            {openError ? <p className={styles.openError} role="alert">{openError}</p> : null}

            <section className={styles.positionsSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>Occupied positions</p>
                  <h3>{fullPositions.length} reported full</h3>
                </div>
                {!capability?.manualOpenAvailable ? (
                  <span className={styles.pendingBadge}>Manual open API pending</span>
                ) : null}
              </div>

              {fullPositions.length ? (
                <div className={styles.positionGrid}>
                  {fullPositions.map((position) => (
                    <article className={styles.positionCard} key={position.cellId}>
                      <div className={styles.positionTop}>
                        <div>
                          <span className={styles.positionState}>Full</span>
                          <strong>{positionLabel(position)}</strong>
                        </div>
                        <span className={styles.cellId}>Cell {position.cellId}</span>
                      </div>
                      <div className={styles.product}>
                        <strong>{productLabel(position)}</strong>
                        {position.product?.customerCode ? (
                          <span>{position.product.customerCode}</span>
                        ) : position.product?.code ? (
                          <span>{position.product.code}</span>
                        ) : null}
                      </div>
                      <button
                        className={styles.openButton}
                        type="button"
                        disabled={!capability?.canOpen || !capability.manualOpenAvailable}
                        onClick={() => void requestOpen(position)}
                      >
                        Open locker
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyState}>ARGO currently reports no full positions.</div>
              )}
            </section>

            {emptyPositions.length ? (
              <section className={styles.positionsSection}>
                <div className={styles.sectionHeading}>
                  <div>
                    <p className={styles.eyebrow}>Empty positions</p>
                    <h3>{emptyPositions.length} reported empty</h3>
                  </div>
                </div>
                <div className={styles.emptyPositionList}>
                  {emptyPositions.map((position) => (
                    <span key={position.cellId}>{positionLabel(position)} · Cell {position.cellId}</span>
                  ))}
                </div>
              </section>
            ) : null}

            <footer className={styles.footer}>
              <p>
                {status.manualOpen.available
                  ? "Opening a position requires current server-side authorisation."
                  : status.manualOpen.reason}
              </p>
              {status.summary.unmaterialised > 0 ? (
                <p>
                  ARGO reports {status.summary.unmaterialised} unmaterialised position
                  {status.summary.unmaterialised === 1 ? "" : "s"}. These are shown separately from confirmed empty positions.
                </p>
              ) : null}
            </footer>
          </>
        ) : null}
      </section>
    </div>
  );
}
