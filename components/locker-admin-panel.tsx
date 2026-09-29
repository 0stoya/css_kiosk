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
    machine: {
      state: "loaded" | "withdrawn" | null;
      loadedAt: string | null;
      withdrawnAt: string | null;
      compartment: string | null;
      requestKey: string | null;
      status: string | null;
    };
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
  providerCode?: string | null;
  providerMessage?: string | null;
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
    collectorCreated?: boolean;
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

function machineStateLabel(cart: LockerStatus["carts"][number]) {
  if (cart.machine.state === "withdrawn") return "Collected";
  if (cart.machine.state === "loaded") return "Ready for collection";
  return "ARGO active cart";
}

function machineStateDetail(cart: LockerStatus["carts"][number]) {
  if (cart.machine.state === "withdrawn" && cart.machine.withdrawnAt) {
    return formatUpdated(cart.machine.withdrawnAt);
  }
  if (cart.machine.state === "loaded" && cart.machine.compartment) {
    return `Compartment ${cart.machine.compartment}`;
  }
  if (cart.machine.state === "loaded" && cart.machine.loadedAt) {
    return `Loaded ${formatUpdated(cart.machine.loadedAt)}`;
  }
  return "No machine event stored yet";
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
    const timer = window.setTimeout(() => {
      void loadStatus();
    }, 0);

    return () => window.clearTimeout(timer);
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
        setReleaseError(
          body.providerCode
            ? `${body.error || "The cart release request was rejected."} [${body.providerCode}]`
            : body.error || "The cart release request was rejected.",
        );
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
                These are ARGO cart IDs associated with terminal {status.terminal.id}, enriched with signed machine events. When ARGO reports a loaded compartment we show it directly; the kiosk does not infer a cart-to-cell mapping.
              </p>
              {status.carts.length ? (
                <div className={styles.cartList}>
                  {status.carts.map((cart) => {
                    const collected = cart.machine.state === "withdrawn";
                    return (
                      <button
                        type="button"
                        className={styles.cartCard}
                        key={cart.id}
                        onClick={() => setReleaseCartId(String(cart.id))}
                        title={
                          collected
                            ? `Cart ${cart.id} has already been collected`
                            : `Use cart ${cart.id} for Open locker`
                        }
                        disabled={collected}
                      >
                        <span>
                          <strong>Cart {cart.id}</strong>
                          <small>{cart.projectNumber || "No project / OGL reference"}</small>
                          <small>ARGO owner · Employee {cart.employeeId}</small>
                        </span>
                        <span>
                          <strong>{cart.totalQuantity}</strong>
                          <small>{cart.lineCount} line{cart.lineCount === 1 ? "" : "s"}</small>
                        </span>
                        <span>
                          <strong>{machineStateLabel(cart)}</strong>
                          <small>{machineStateDetail(cart)}</small>
                        </span>
                        <span className={styles.useCart}>
                          {collected ? "Collected" : "Use cart"}
                        </span>
                      </button>
                    );
                  })}
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
                Request collection for an ARGO cart on this terminal. A signed cart.withdrawn event blocks repeat release; older carts without a stored cart.loaded event remain available. ARGO still requires confirmation on the machine before any door opens.
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
                The collector ARGO badge is retained server-side as provider metadata and is never exposed to browser state. Linked Employees are revalidated by ARGO employee ID; legacy company admins can be provisioned into the existing ARGO Admin profile when required.
              </p>
              {releaseError ? (
                <p className={styles.openError} role="alert">{releaseError}</p>
              ) : null}
              {releaseResult ? (
                <div className={styles.releaseResult} role="status">
                  <strong>Open request queued</strong>
                  <span>Cart {releaseResult.cartId} · {releaseResult.phase} / {releaseResult.status}</span>
                  <span>{releaseResult.message}</span>
                  {releaseResult.collectorCreated ? (
                    <span>ARGO admin collector created for this authorised locker manager.</span>
                  ) : null}
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
