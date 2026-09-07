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
  productType: string;
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

type BasketMoney = {
  value: number;
  currency: string;
};

type BasketLine = {
  uid: string;
  quantity: number;
  sku: string;
  name: string;
  imageUrl: string | null;
  imageLabel: string | null;
  stockStatus: string | null;
  unitPrice: BasketMoney | null;
  rowTotal: BasketMoney | null;
};

type Basket = {
  totalQuantity: number;
  items: BasketLine[];
  subtotal: BasketMoney | null;
  grandTotal: BasketMoney | null;
};

type BasketResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  basket?: Basket;
};

type BasketAction =
  | { action: "get" }
  | { action: "add"; sku: string; quantity: number }
  | { action: "update"; itemUid: string; quantity: number }
  | { action: "remove"; itemUid: string };

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

function productTypeLabel(productType: string) {
  if (productType === "SimpleProduct") return "Ready to add";
  if (productType === "ConfigurableProduct") return "Options required";
  if (productType === "BundleProduct") return "Bundle options required";
  return "Product options required";
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
  const [basket, setBasket] = useState<Basket | null>(null);
  const [basketLoading, setBasketLoading] = useState(true);
  const [basketMutating, setBasketMutating] = useState(false);
  const [basketError, setBasketError] = useState<string | null>(null);
  const [basketOpen, setBasketOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<CatalogueProduct | null>(null);
  const [selectedQuantity, setSelectedQuantity] = useState(1);

  const companyName = customer.company?.name || "Personal account";
  const companyReference = customer.company?.reference || null;

  const handleSessionExpired = useCallback(() => {
    onSessionExpired("Your kiosk session has expired. Tap your card to sign in again.");
  }, [onSessionExpired]);

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
          handleSessionExpired();
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
    [handleSessionExpired, signedFetch],
  );

  const loadBasket = useCallback(async () => {
    setBasketLoading(true);
    setBasketError(null);

    try {
      const response = await signedFetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "get" }),
      });
      const body = (await response.json()) as BasketResponse;

      if (response.status === 401 || body.code === "SESSION_REQUIRED") {
        handleSessionExpired();
        return;
      }

      if (!response.ok || !body.ok || !body.basket) {
        setBasketError(body.error || "Your basket could not be loaded right now.");
        return;
      }

      setBasket(body.basket);
    } catch {
      setBasketError("Your basket could not be loaded right now.");
    } finally {
      setBasketLoading(false);
    }
  }, [handleSessionExpired, signedFetch]);

  useEffect(() => {
    let cancelled = false;

    async function startInitialLoad() {
      await Promise.resolve();
      if (cancelled) return;
      await Promise.all([
        loadCatalogue({ search: "", categoryUid: "" }),
        loadBasket(),
      ]);
    }

    void startInitialLoad();

    return () => {
      cancelled = true;
    };
  }, [loadBasket, loadCatalogue]);

  async function performBasketAction(action: BasketAction) {
    setBasketMutating(true);
    setBasketError(null);

    try {
      const response = await signedFetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const body = (await response.json()) as BasketResponse;

      if (response.status === 401 || body.code === "SESSION_REQUIRED") {
        handleSessionExpired();
        return false;
      }

      if (!response.ok || !body.ok || !body.basket) {
        setBasketError(body.error || "Your basket could not be updated right now.");
        return false;
      }

      setBasket(body.basket);
      return true;
    } catch {
      setBasketError("Your basket could not be updated right now.");
      return false;
    } finally {
      setBasketMutating(false);
      setBasketLoading(false);
    }
  }

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

  function openProduct(product: CatalogueProduct) {
    setBasketOpen(false);
    setSelectedProduct(product);
    setSelectedQuantity(1);
    setBasketError(null);
  }

  async function addSelectedProduct() {
    if (!selectedProduct || selectedProduct.productType !== "SimpleProduct") return;

    const added = await performBasketAction({
      action: "add",
      sku: selectedProduct.sku,
      quantity: selectedQuantity,
    });

    if (added) {
      setSelectedProduct(null);
      setBasketOpen(true);
    }
  }

  async function changeBasketQuantity(line: BasketLine, nextQuantity: number) {
    if (nextQuantity < 1) {
      await performBasketAction({ action: "remove", itemUid: line.uid });
      return;
    }

    await performBasketAction({
      action: "update",
      itemUid: line.uid,
      quantity: nextQuantity,
    });
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

  const basketCount = basket?.totalQuantity || 0;
  const selectedImage = safeImageUrl(selectedProduct?.imageUrl || null);
  const selectedInStock = selectedProduct?.stockStatus === "IN_STOCK";
  const selectedCanAdd = Boolean(
    selectedProduct && selectedProduct.productType === "SimpleProduct" && selectedInStock,
  );

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
        <button
          className={styles.basketButton}
          type="button"
          onClick={() => {
            setSelectedProduct(null);
            setBasketOpen(true);
          }}
          aria-label={`Open basket with ${basketCount} items`}
        >
          <BasketIcon />
          <span>Basket</span>
          <b>{basketLoading ? "…" : basketCount}</b>
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
                  <button className={styles.productAction} type="button" onClick={() => openProduct(product)}>
                    View / add
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      <p className={styles.securityNote}>
        Catalogue and basket requests use your short-lived kiosk session. Magento bearer tokens remain server-side and are never exposed to this screen.
      </p>

      {selectedProduct ? (
        <div className={styles.modalBackdrop} role="presentation">
          <section className={styles.detailPanel} role="dialog" aria-modal="true" aria-labelledby="product-detail-title">
            <button className={styles.closeButton} type="button" onClick={() => setSelectedProduct(null)} aria-label="Close product details">×</button>
            <div
              className={styles.detailImage}
              style={selectedImage ? { backgroundImage: `url(${JSON.stringify(selectedImage)})` } : undefined}
              role="img"
              aria-label={selectedProduct.imageLabel || selectedProduct.name}
            >
              {!selectedImage ? <span>{selectedProduct.name.slice(0, 1).toUpperCase()}</span> : null}
            </div>
            <div className={styles.detailBody}>
              <span className={styles.sku}>{selectedProduct.sku}</span>
              <h2 id="product-detail-title">{selectedProduct.name}</h2>
              <div className={styles.detailPriceRow}>
                {selectedProduct.price ? (
                  <strong>{formatMoney(selectedProduct.price.value, selectedProduct.price.currency)}</strong>
                ) : (
                  <strong>Price on request</strong>
                )}
                <span className={selectedInStock ? styles.inStock : styles.outOfStock}>
                  {selectedInStock ? "In stock" : "Check availability"}
                </span>
              </div>
              <p className={styles.productTypeNote}>{productTypeLabel(selectedProduct.productType)}</p>

              {selectedCanAdd ? (
                <div className={styles.addControls}>
                  <div className={styles.quantityControl} aria-label="Quantity">
                    <button
                      type="button"
                      onClick={() => setSelectedQuantity((quantity) => Math.max(1, quantity - 1))}
                      disabled={basketMutating || selectedQuantity <= 1}
                    >
                      −
                    </button>
                    <output>{selectedQuantity}</output>
                    <button
                      type="button"
                      onClick={() => setSelectedQuantity((quantity) => Math.min(999, quantity + 1))}
                      disabled={basketMutating || selectedQuantity >= 999}
                    >
                      +
                    </button>
                  </div>
                  <button
                    className={styles.addButton}
                    type="button"
                    onClick={() => void addSelectedProduct()}
                    disabled={basketMutating}
                  >
                    {basketMutating ? "Adding…" : "Add to basket"}
                  </button>
                </div>
              ) : (
                <p className={styles.optionNotice}>
                  {selectedInStock
                    ? "This product needs option selection before it can be added. Configurable and bundle options are the next basket slice."
                    : "This product is not currently available to add from the kiosk."}
                </p>
              )}

              {basketError ? <p className={styles.basketInlineError} role="alert">{basketError}</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {basketOpen ? (
        <div className={styles.modalBackdrop} role="presentation">
          <section className={styles.basketPanel} role="dialog" aria-modal="true" aria-labelledby="basket-title">
            <header className={styles.basketHeader}>
              <div>
                <p className={styles.eyebrow}>Current order</p>
                <h2 id="basket-title">Basket</h2>
              </div>
              <button className={styles.closeButton} type="button" onClick={() => setBasketOpen(false)} aria-label="Close basket">×</button>
            </header>

            {basketError ? <p className={styles.basketInlineError} role="alert">{basketError}</p> : null}

            {basketLoading ? (
              <div className={styles.basketEmpty}>Loading basket…</div>
            ) : null}

            {!basketLoading && (!basket || basket.items.length === 0) ? (
              <div className={styles.basketEmpty}>
                <strong>Your basket is empty</strong>
                <span>Close the basket and choose a product to get started.</span>
              </div>
            ) : null}

            {!basketLoading && basket?.items.length ? (
              <div className={styles.basketLines}>
                {basket.items.map((line) => {
                  const imageUrl = safeImageUrl(line.imageUrl);
                  return (
                    <article className={styles.basketLine} key={line.uid}>
                      <div
                        className={styles.basketLineImage}
                        style={imageUrl ? { backgroundImage: `url(${JSON.stringify(imageUrl)})` } : undefined}
                        role="img"
                        aria-label={line.imageLabel || line.name}
                      >
                        {!imageUrl ? <span>{line.name.slice(0, 1).toUpperCase()}</span> : null}
                      </div>
                      <div className={styles.basketLineBody}>
                        <span className={styles.sku}>{line.sku}</span>
                        <strong>{line.name}</strong>
                        <div className={styles.basketLinePrice}>
                          {line.rowTotal
                            ? formatMoney(line.rowTotal.value, line.rowTotal.currency)
                            : line.unitPrice
                              ? formatMoney(line.unitPrice.value * line.quantity, line.unitPrice.currency)
                              : "Price on request"}
                        </div>
                        <div className={styles.basketLineActions}>
                          <div className={styles.quantityControl} aria-label={`Quantity for ${line.name}`}>
                            <button
                              type="button"
                              onClick={() => void changeBasketQuantity(line, line.quantity - 1)}
                              disabled={basketMutating}
                            >
                              −
                            </button>
                            <output>{line.quantity}</output>
                            <button
                              type="button"
                              onClick={() => void changeBasketQuantity(line, line.quantity + 1)}
                              disabled={basketMutating || line.quantity >= 999}
                            >
                              +
                            </button>
                          </div>
                          <button
                            className={styles.removeButton}
                            type="button"
                            onClick={() => void performBasketAction({ action: "remove", itemUid: line.uid })}
                            disabled={basketMutating}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}

            <footer className={styles.basketFooter}>
              <div className={styles.totalRows}>
                <span>
                  <small>Subtotal ex VAT</small>
                  <strong>
                    {basket?.subtotal
                      ? formatMoney(basket.subtotal.value, basket.subtotal.currency)
                      : "—"}
                  </strong>
                </span>
                <span>
                  <small>Current total</small>
                  <strong>
                    {basket?.grandTotal
                      ? formatMoney(basket.grandTotal.value, basket.grandTotal.currency)
                      : "—"}
                  </strong>
                </span>
              </div>
              <button className={styles.checkoutButton} type="button" disabled>
                Checkout / counter handoff comes next
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
