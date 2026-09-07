"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { VerifiedKioskCustomer } from "@/lib/magento/customer-context";
import styles from "./catalogue-home.module.css";

type SignedFetch = (input: string, init?: RequestInit) => Promise<Response>;

type CatalogueCategory = {
  uid: string;
  name: string;
  urlKey: string | null;
  productCount: number;
};

type CatalogueProduct = {
  uid: string;
  sku: string;
  name: string;
  urlKey: string | null;
  imageUrl: string | null;
  imageLabel: string | null;
  stockStatus: string | null;
  price: {
    value: number;
    regularValue: number;
    currency: string;
  } | null;
};

type CatalogueResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  customer?: VerifiedKioskCustomer;
  catalogue?: {
    categories: CatalogueCategory[];
    products: CatalogueProduct[];
    totalCount: number;
    currentPage: number;
    totalPages: number;
  };
};

type CatalogueHomeProps = {
  customer: VerifiedKioskCustomer;
  signedFetch: SignedFetch;
  onSignOut: () => void;
  onSessionExpired: (message: string) => void;
};

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

function BasketIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M3 5h2l2.2 10.1a2 2 0 0 0 2 1.6h7.9a2 2 0 0 0 2-1.6L21 8H6" />
      <circle cx="10" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
    </svg>
  );
}

function formatMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function safeImageUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function CatalogueHome({
  customer,
  signedFetch,
  onSignOut,
  onSessionExpired,
}: CatalogueHomeProps) {
  const [searchInput, setSearchInput] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [activeCategoryUid, setActiveCategoryUid] = useState("");
  const [categories, setCategories] = useState<CatalogueCategory[]>([]);
  const [products, setProducts] = useState<CatalogueProduct[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const companyName = customer.company?.name || "Personal account";
  const companyReference = customer.company?.reference || null;

  const loadCatalogue = useCallback(
    async (input: { search: string; categoryUid: string }) => {
      setLoading(true);
      setError(null);

      try {
        const response = await signedFetch("/api/catalogue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            search: input.search || undefined,
            categoryUid: input.categoryUid || undefined,
            page: 1,
          }),
        });

        const body = (await response.json()) as CatalogueResponse;

        if (response.status === 401 || body.code === "SESSION_REQUIRED") {
          onSessionExpired("Your kiosk session has expired. Tap your card to sign in again.");
          return;
        }

        if (!response.ok || !body.ok || !body.catalogue) {
          setError(body.error || "The trade catalogue could not be loaded right now.");
          return;
        }

        setCategories(body.catalogue.categories);
        setProducts(body.catalogue.products);
        setTotalCount(body.catalogue.totalCount);
      } catch {
        setError("The trade catalogue could not be loaded right now.");
      } finally {
        setLoading(false);
      }
    },
    [onSessionExpired, signedFetch],
  );

  useEffect(() => {
    let cancelled = false;

    async function startInitialLoad() {
      await Promise.resolve();
      if (cancelled) return;
      await loadCatalogue({ search: "", categoryUid: "" });
    }

    void startInitialLoad();

    return () => {
      cancelled = true;
    };
  }, [loadCatalogue]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSearch = searchInput.trim();
    setActiveSearch(nextSearch);
    void loadCatalogue({ search: nextSearch, categoryUid: activeCategoryUid });
  }

  function chooseCategory(uid: string) {
    const nextUid = activeCategoryUid === uid ? "" : uid;
    setActiveCategoryUid(nextUid);
    void loadCatalogue({ search: activeSearch, categoryUid: nextUid });
  }

  function clearFilters() {
    setSearchInput("");
    setActiveSearch("");
    setActiveCategoryUid("");
    void loadCatalogue({ search: "", categoryUid: "" });
  }

  const resultLabel = useMemo(() => {
    if (loading) return "Loading trade catalogue…";
    if (activeSearch) return `${totalCount} result${totalCount === 1 ? "" : "s"} for “${activeSearch}”`;
    if (activeCategoryUid) {
      const category = categories.find((item) => item.uid === activeCategoryUid);
      return category ? `${totalCount} products in ${category.name}` : `${totalCount} products`;
    }
    return `${totalCount} products available`;
  }, [activeCategoryUid, activeSearch, categories, loading, totalCount]);

  return (
    <section className={styles.catalogueShell} aria-label="Authenticated trade catalogue">
      <header className={styles.accountBar}>
        <div>
          <span className={styles.accountLabel}>Signed in</span>
          <strong>{companyName}</strong>
          <span className={styles.accountMeta}>
            {customer.firstName} {customer.lastName}
            {companyReference ? ` · ${companyReference}` : ""}
          </span>
        </div>
        <button className={styles.signOutButton} type="button" onClick={onSignOut}>
          Sign out
        </button>
      </header>

      <div className={styles.heroRow}>
        <div>
          <p className={styles.eyebrow}>Trade catalogue</p>
          <h1>What do you need today?</h1>
          <p>Live catalogue and pricing for your signed-in CSS account.</p>
        </div>
        <button className={styles.basketButton} type="button" disabled aria-label="Basket coming next">
          <BasketIcon />
          <span>Basket</span>
          <b>0</b>
        </button>
      </div>

      <form className={styles.searchForm} onSubmit={submitSearch}>
        <span className={styles.searchIcon}><SearchIcon /></span>
        <input
          type="search"
          inputMode="search"
          autoComplete="off"
          placeholder="Search products or SKU"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          aria-label="Search products or SKU"
        />
        <button type="submit" disabled={loading}>Search</button>
      </form>

      {categories.length ? (
        <div className={styles.categoryStrip} aria-label="Product categories">
          {categories.slice(0, 10).map((category) => (
            <button
              key={category.uid}
              className={activeCategoryUid === category.uid ? styles.categoryActive : styles.categoryButton}
              type="button"
              onClick={() => chooseCategory(category.uid)}
              disabled={loading}
            >
              <span>{category.name}</span>
              {category.productCount > 0 ? <small>{category.productCount}</small> : null}
            </button>
          ))}
        </div>
      ) : null}

      <div className={styles.resultBar}>
        <strong>{resultLabel}</strong>
        {activeSearch || activeCategoryUid ? (
          <button type="button" onClick={clearFilters} disabled={loading}>Clear filters</button>
        ) : null}
      </div>

      {error ? (
        <div className={styles.errorPanel} role="alert">
          <strong>Catalogue unavailable</strong>
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void loadCatalogue({ search: activeSearch, categoryUid: activeCategoryUid })}
          >
            Try again
          </button>
        </div>
      ) : null}

      {!error && loading ? (
        <div className={styles.loadingGrid} aria-live="polite">
          {Array.from({ length: 6 }, (_, index) => <div key={index} className={styles.loadingCard} />)}
        </div>
      ) : null}

      {!error && !loading && products.length === 0 ? (
        <div className={styles.emptyPanel}>
          <strong>No products found</strong>
          <span>Try another search or clear the category filter.</span>
          <button type="button" onClick={clearFilters}>Show all products</button>
        </div>
      ) : null}

      {!error && !loading && products.length ? (
        <div className={styles.productGrid}>
          {products.map((product) => {
            const imageUrl = safeImageUrl(product.imageUrl);
            const inStock = product.stockStatus === "IN_STOCK";
            const hasDiscount = Boolean(
              product.price && product.price.regularValue > product.price.value,
            );

            return (
              <article className={styles.productCard} key={product.uid}>
                <div
                  className={styles.productImage}
                  style={imageUrl ? { backgroundImage: `url(${JSON.stringify(imageUrl)})` } : undefined}
                  role="img"
                  aria-label={product.imageLabel || product.name}
                >
                  {!imageUrl ? <span>{product.name.slice(0, 1).toUpperCase()}</span> : null}
                </div>
                <div className={styles.productBody}>
                  <span className={styles.sku}>{product.sku}</span>
                  <h2>{product.name}</h2>
                  <div className={styles.productFooter}>
                    <div className={styles.priceBlock}>
                      {product.price ? (
                        <>
                          <strong>{formatMoney(product.price.value, product.price.currency)}</strong>
                          {hasDiscount ? (
                            <span>{formatMoney(product.price.regularValue, product.price.currency)}</span>
                          ) : null}
                        </>
                      ) : (
                        <strong>Price on request</strong>
                      )}
                    </div>
                    <span className={inStock ? styles.inStock : styles.outOfStock}>
                      {inStock ? "In stock" : "Check availability"}
                    </span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      <p className={styles.securityNote}>
        Catalogue requests use your short-lived kiosk session. Magento bearer tokens remain server-side and are never exposed to this screen.
      </p>
    </section>
  );
}
