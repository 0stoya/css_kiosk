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
  carts: Array<{
    id: number;
    employeeId: number;
    projectNumber: string;
    lineCount: number;
    totalQuantity: number;
    createdAt: string;
  }>;
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
    canReleaseCart?: boolean;
    releaseUnavailableReason?: string | null;
    manualOpenAvailable: boolean;
  };
  status?: LockerStatus;
  withdrawal?: {
    requestKey: string;
    phase: string;
    status: string;
    terminalId: number;
    cartId: number;
    message: string;
  };
  diagnostic?: {
    resultCount: number;
    employeeId: string | null;
    employeeIdJsonType: string;
    plantShape: string;
    plantContainerJsonType: string;
    plantId: string | null;
    plantIdJsonType: string;
    expectedPlantId: number;
    plantMatch: boolean;
    active: string | null;
    activeJsonType: string;
    badgeJsonType: string;
    matchedStoredEmployeeId: boolean | null;
  };
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
  const [releaseCartId, setReleaseCartId] = useState("");
  const [releasePending, setReleasePending] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [releaseResult, setReleaseResult] = useState<NonNullable<LockerAdminResponse["withdrawal"]> | null>(null);
  const [diagnosticLoading, setDiagnosticLoading] = useState(false);
  const [diagnosticError, setDiagnosticError] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<NonNullable<LockerAdminResponse["diagnostic"]> | null>(null);

  const loadStatus = useCallback(
    async () => {
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

  function refreshStatus() {
    setRefreshing(true);
    setError(null);
    void loadStatus();
  }

  function retryStatus() {
    setLoading(true);
    setError(null);
    void loadStatus();
  }

  async function runIdentityDiagnostic() {
    setDiagnosticLoading(true);
    setDiagnosticError(null);
    setDiagnostic(null);

    try {
      const response = await signedFetch("/api/locker/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "identity_diagnostic" }),
      });
      const body = (await response.json()) as LockerAdminResponse;

      if (response.status === 401 || body.code === "SESSION_REQUIRED") {
        onSessionExpired("Your kiosk session has expired. Tap your card to sign in again.");
        return;
      }

      if (!response.ok || !body.ok || !body.diagnostic) {
        setDiagnosticError(body.error || "ARGO identity diagnostic failed.");
        return;
      }

      setDiagnostic(body.diagnostic);
    } catch {
      setDiagnosticError("ARGO identity diagnostic could not be completed.");
    } finally {
      setDiagnosticLoading(false);
    }
  }

  async function requestCartRelease() {
    const cartId = Number(releaseCartId);
    if (!Number.isInteger(cartId) || cartId <= 0) {
      setReleaseError("Enter a valid loaded cart ID.");
      return;
    }

    setReleasePending(true);
    setReleaseError(null);
    setReleaseResult(null);

    try {
      const response = await signedFetch("/api/locker/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "withdraw",
          cartId,
        }),
      });
      const body = (await response.json()) as LockerAdminResponse;

      if (response.status === 401 || body.code === "SESSION_REQUIRED") {
        onSessionExpired("Your kiosk session has expired. Tap your card to sign in again.");
        return;
      }

      if (!response.ok || !body.ok || !body.withdrawal) {
        setReleaseError(body.error || "The cart release request was rejected.");
        return;
      }

      setReleaseResult(body.withdrawal);
    } catch {
      setReleaseError("The cart release request could not be sent right now.");
    } finally {
      setReleasePending(false);
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
              onClick={refreshStatus}
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
            <button type="button" onClick={retryStatus}>Try again</button>
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

            <section className={styles.cartsSection} aria-label="Terminal ARGO carts">
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>ARGO cart records</p>
                  <h3>{status.carts.length} active cart{status.carts.length === 1 ? "" : "s"} on this terminal</h3>
                </div>
              </div>
              <p className={styles.releaseIntro}>
                These are ARGO cart IDs associated with terminal {status.terminal.id}. The current API does not tell us which occupied cell belongs to which cart.
              </p>
              {status.carts.length ? (
                <div className={styles.cartList}>
                  {status.carts.map((cart) => (
                    <button
                      type="button"
                      className={styles.cartCard}
                      key={cart.id}
                      onClick={() => setReleaseCartId(String(cart.id))}
                      title={`Use cart ${cart.id} for Open locker`}
                    >
                      <span>
                        <strong>Cart {cart.id}</strong>
                        <small>{cart.projectNumber || "No project / OGL reference"}</small>
                      </span>
                      <span>
                        <strong>{cart.totalQuantity}</strong>
                        <small>{cart.lineCount} line{cart.lineCount === 1 ? "" : "s"}</small>
                      </span>
                      <span>
                        <strong>Employee {cart.employeeId}</strong>
                        <small>ARGO owner</small>
                      </span>
                      <span className={styles.useCart}>Use cart</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyState}>ARGO returned no active cart records for this terminal.</div>
              )}
            </section>

            <section className={styles.releaseSection} aria-label="Open locker">
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>Physical acceptance test</p>
                  <h3>Open locker</h3>
                </div>
                <span className={capability?.canReleaseCart ? styles.liveBadge : styles.pendingBadge}>
                  {capability?.canReleaseCart
                    ? "Ready"
                    : capability?.releaseUnavailableReason || "Unavailable"}
                </span>
              </div>
              <p className={styles.releaseIntro}>
                Open the locker for a cart confirmed as physically loaded on this terminal. This uses the RFID you signed in with; ARGO still requires confirmation on the machine before any door opens.
              </p>
              <div className={styles.releaseForm}>
                <label>
                  <span>ARGO cart ID</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={releaseCartId}
                    onChange={(event) => setReleaseCartId(event.target.value.replace(/\D+/g, ""))}
                    placeholder="420425001"
                    disabled={releasePending}
                  />
                </label>
                <button
                  className={styles.releaseButton}
                  type="button"
                  onClick={() => void requestCartRelease()}
                  disabled={!capability?.canReleaseCart || releasePending}
                >
                  {releasePending ? "Requesting…" : "Open locker"}
                </button>
              </div>
              <p className={styles.releaseHint}>
                The ARGO badge is retained server-side as provider metadata for this Employee and is never exposed to browser state.
              </p>
              <div className={styles.diagnosticActions}>
                <button
                  className={styles.diagnosticButton}
                  type="button"
                  onClick={() => void runIdentityDiagnostic()}
                  disabled={diagnosticLoading}
                >
                  {diagnosticLoading ? "Checking ARGO identity…" : "Run ARGO identity diagnostic"}
                </button>
              </div>
              {diagnosticError ? (
                <p className={styles.openError} role="alert">{diagnosticError}</p>
              ) : null}
              {diagnostic ? (
                <div className={styles.diagnosticResult} role="status">
                  <strong>ARGO identity diagnostic</strong>
                  <dl>
                    <div><dt>Employee ID</dt><dd>{diagnostic.employeeId ?? "missing"}</dd></div>
                    <div><dt>ID JSON type</dt><dd>{diagnostic.employeeIdJsonType}</dd></div>
                    <div><dt>Plant source</dt><dd>{diagnostic.plantShape}</dd></div>
                    <div><dt>plant JSON type</dt><dd>{diagnostic.plantContainerJsonType}</dd></div>
                    <div><dt>Plant ID</dt><dd>{diagnostic.plantId ?? "missing"}</dd></div>
                    <div><dt>Plant ID JSON type</dt><dd>{diagnostic.plantIdJsonType}</dd></div>
                    <div><dt>Expected plant</dt><dd>{diagnostic.expectedPlantId}</dd></div>
                    <div><dt>Plant match</dt><dd>{diagnostic.plantMatch ? "Yes" : "No"}</dd></div>
                    <div><dt>Active</dt><dd>{diagnostic.active ?? "missing"} ({diagnostic.activeJsonType})</dd></div>
                    <div><dt>Badge JSON type</dt><dd>{diagnostic.badgeJsonType}</dd></div>
                    <div><dt>Provider rows</dt><dd>{diagnostic.resultCount}</dd></div>
                    <div>
                      <dt>Stored Employee match</dt>
                      <dd>
                        {diagnostic.matchedStoredEmployeeId === null
                          ? "Not available"
                          : diagnostic.matchedStoredEmployeeId
                            ? "Yes"
                            : "No"}
                      </dd>
                    </div>
                  </dl>
                  <small>The badge value itself is deliberately not shown.</small>
                </div>
              ) : null}
              {releaseError ? (
                <p className={styles.openError} role="alert">{releaseError}</p>
              ) : null}
              {releaseResult ? (
                <div className={styles.releaseResult} role="status">
                  <strong>Open request queued</strong>
                  <span>Cart {releaseResult.cartId} · {releaseResult.phase} / {releaseResult.status}</span>
                  <span>{releaseResult.message}</span>
                  <code>{releaseResult.requestKey}</code>
                  <small>Go to the ARGO machine now and confirm the request on its screen.</small>
                </div>
              ) : null}
            </section>

            <section className={styles.positionsSection}>
              <div className={styles.sectionHeading}>
                <div>
                  <p className={styles.eyebrow}>Occupied positions</p>
                  <h3>{fullPositions.length} reported full</h3>
                </div>
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
