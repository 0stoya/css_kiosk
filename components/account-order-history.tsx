"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./account-order-history.module.css";

type SignedFetch = (input: string, init?: RequestInit) => Promise<Response>;

type AccountOrder = {
  number: string;
  status: string;
  orderDate: string;
  locker: {
    oglOrderNumber: string | null;
    oglExported: boolean;
    shippingMethod: string;
    orderStatus: string;
  } | null;
};

type AccountOrdersResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  history?: {
    totalCount: number;
    orders: AccountOrder[];
  };
};

type AccountOrderHistoryProps = {
  signedFetch: SignedFetch;
  onSessionExpired: (message: string) => void;
};

function statusClass(status: string) {
  const value = status.toLowerCase();
  if (value.includes("complete") || value.includes("ready")) return styles.statusSuccess;
  if (value.includes("cancel") || value.includes("closed")) return styles.statusMuted;
  return styles.statusPending;
}

export function AccountOrderHistory({
  signedFetch,
  onSessionExpired,
}: AccountOrderHistoryProps) {
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await signedFetch("/api/account/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list" }),
      });
      const body = (await response.json()) as AccountOrdersResponse;

      if (response.status === 401 || body.code === "SESSION_REQUIRED") {
        onSessionExpired("Your kiosk session has expired. Tap your card to sign in again.");
        return;
      }

      if (!response.ok || !body.ok || !body.history) {
        setError(body.error || "Your recent orders could not be loaded right now.");
        return;
      }

      setOrders(body.history.orders);
      setTotalCount(body.history.totalCount);
    } catch {
      setError("Your recent orders could not be loaded right now.");
    } finally {
      setLoading(false);
    }
  }, [onSessionExpired, signedFetch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOrders();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadOrders]);

  return (
    <section className={styles.section} aria-label="Recent orders">
      <header className={styles.header}>
        <strong>Recent orders</strong>
        {!loading && !error && totalCount > 0 ? <span>{totalCount} total</span> : null}
      </header>

      {loading ? <p className={styles.message}>Loading orders…</p> : null}

      {error ? (
        <div className={styles.error} role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void loadOrders()}>Try again</button>
        </div>
      ) : null}

      {!loading && !error && orders.length === 0 ? (
        <p className={styles.message}>No recent orders for this company.</p>
      ) : null}

      {!loading && !error && orders.length ? (
        <div className={styles.orders}>
          {orders.map((order) => (
            <article className={styles.order} key={order.number}>
              <div className={styles.orderTop}>
                <strong>{order.number}</strong>
                <span className={statusClass(order.status)}>{order.status}</span>
              </div>
              {order.orderDate ? <time>{order.orderDate}</time> : null}
              {order.locker ? (
                <span className={styles.lockerStatus}>
                  Locker collection · {order.locker.oglOrderNumber
                    ? `OGL ${order.locker.oglOrderNumber}`
                    : "awaiting OGL export"}
                </span>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
