"use client";

import Image from "next/image";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { VerifiedKioskCustomer } from "@/lib/magento/customer-context";
import type { KioskProductOptions } from "@/lib/magento/product-options";
import {
  defaultGroupedQuantities,
  defaultProductSelections,
  groupedSelectionsComplete,
  ProductOptionSelector,
  productSelectionsComplete,
  selectedGroupedBasketItems,
  selectedProductOptionUids,
} from "./product-option-selector";
import { AccountOrderHistory } from "./account-order-history";
import { CatalogueProductCard } from "./catalogue-product-card";
import styles from "./catalogue-home.module.css";

type SignedFetch = (input: string, init?: RequestInit) => Promise<Response>;

type CatalogueCategory = {
  uid: string;
  name: string;
  urlKey: string | null;
  imageUrl: string | null;
  position: number;
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

type ProductOptionsResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  product?: KioskProductOptions;
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

type LockerCheckoutReview = {
  locker: {
    label: string;
    street: string[];
    city: string;
    region: string | null;
    postcode: string;
    countryCode: string;
  };
  shipping: {
    carrierCode: string;
    methodCode: string;
    carrierTitle: string;
    methodTitle: string;
    amount: BasketMoney | null;
  };
  basket: {
    totalQuantity: number;
    subtotal: BasketMoney | null;
    grandTotal: BasketMoney | null;
  };
  ordering: {
    canCheckout: boolean;
    canSubmitCreditOrder: boolean;
    canAutoApproveCreditOrder: boolean;
  };
};

type LockerOrderSubmission = {
  creditOrderId: number;
  creditOrderNumber: string | null;
  status: string;
  autoApproved: boolean;
  approvalRequired: boolean;
  grandTotal: number;
  paymentMethod: string;
  orderId: number | null;
  orderNumber: string | null;
  orderPlaced: boolean;
  oglOrderNumber: string | null;
  oglExported: boolean;
};

type LockerCheckoutResponse = {
  ok?: boolean;
  code?: string;
  error?: string;
  checkout?: LockerCheckoutReview;
  submission?: LockerOrderSubmission;
};

type BasketAction =
  | { action: "get" }
  | { action: "add"; sku: string; quantity: number; selectedOptions?: string[] }
  | { action: "add_grouped"; items: Array<{ sku: string; quantity: number }> }
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

function AccountIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

function customerLogoFor(reference: string | null) {
  switch (reference?.toUpperCase()) {
    case "EAL001":
      return { src: "/greener-ealing-logo.svg", alt: "Greener Ealing" };
    default:
      return null;
  }
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
  if (productType === "ConfigurableProduct") return "Choose product options";
  if (productType === "BundleProduct") return "Build your bundle";
  if (productType === "GroupedProduct") return "Choose item quantities";
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
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [basket, setBasket] = useState<Basket | null>(null);
  const [basketLoading, setBasketLoading] = useState(true);
  const [basketMutating, setBasketMutating] = useState(false);
  const [basketError, setBasketError] = useState<string | null>(null);
  const [basketOpen, setBasketOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [lockerCheckout, setLockerCheckout] = useState<LockerCheckoutReview | null>(null);
  const [lockerCheckoutLoading, setLockerCheckoutLoading] = useState(false);
  const [lockerCheckoutError, setLockerCheckoutError] = useState<string | null>(null);
  const [lockerOrderSubmission, setLockerOrderSubmission] = useState<LockerOrderSubmission | null>(null);
  const [lockerOrderSubmitting, setLockerOrderSubmitting] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<CatalogueProduct | null>(null);
  const [selectedQuantity, setSelectedQuantity] = useState(1);
  const [productOptions, setProductOptions] = useState<KioskProductOptions | null>(null);
  const [productOptionsLoading, setProductOptionsLoading] = useState(false);
  const [productOptionsError, setProductOptionsError] = useState<string | null>(null);
  const [productOptionSelections, setProductOptionSelections] = useState<Record<string, string[]>>({});
  const [groupedProductQuantities, setGroupedProductQuantities] = useState<Record<string, number>>({});

  const companyName = customer.company?.name || "Personal account";
  const companyReference = customer.company?.reference || null;
  const customerLogo = customerLogoFor(companyReference);

  const handleSessionExpired = useCallback(() => {
    onSessionExpired("Your kiosk session has expired. Tap your card to sign in again.");
  }, [onSessionExpired]);

  const loadCatalogue = useCallback(
    async (input: { search: string; categoryUid: string; page: number }) => {
      setLoading(true);
      setError(null);

      try {
        const response = await signedFetch("/api/catalogue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            search: input.search || undefined,
            categoryUid: input.categoryUid || undefined,
            page: input.page,
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
        setCurrentPage(Math.max(1, body.catalogue.currentPage));
        setTotalPages(Math.max(1, body.catalogue.totalPages));
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
        loadCatalogue({ search: "", categoryUid: "", page: 1 }),
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
    setLockerCheckout(null);
    setLockerCheckoutError(null);
    setLockerOrderSubmission(null);

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

  async function prepareLockerCheckout() {
    setLockerCheckoutLoading(true);
    setLockerCheckoutError(null);
    setLockerOrderSubmission(null);

    try {
      const response = await signedFetch("/api/checkout/locker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare" }),
      });
      const body = (await response.json()) as LockerCheckoutResponse;

      if (response.status === 401 || body.code === "SESSION_REQUIRED") {
        handleSessionExpired();
        return;
      }

      if (!response.ok || !body.ok || !body.checkout) {
        setLockerCheckoutError(body.error || "Local locker checkout could not be prepared right now.");
        return;
      }

      setLockerCheckout(body.checkout);
      setBasket((current) =>
        current
          ? {
              ...current,
              totalQuantity: body.checkout!.basket.totalQuantity,
              subtotal: body.checkout!.basket.subtotal,
              grandTotal: body.checkout!.basket.grandTotal,
            }
          : current,
      );
    } catch {
      setLockerCheckoutError("Local locker checkout could not be prepared right now.");
    } finally {
      setLockerCheckoutLoading(false);
    }
  }

  async function confirmLockerOrder() {
    if (!lockerCheckout?.ordering.canSubmitCreditOrder || lockerOrderSubmitting) return;

    setLockerOrderSubmitting(true);
    setLockerCheckoutError(null);

    try {
      const response = await signedFetch("/api/checkout/locker", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
      });
      const body = (await response.json()) as LockerCheckoutResponse;

      if (response.status === 401 || body.code === "SESSION_REQUIRED") {
        handleSessionExpired();
        return;
      }

      if (!response.ok || !body.ok || !body.checkout || !body.submission) {
        setLockerCheckoutError(body.error || "The locker order could not be submitted right now.");
        return;
      }

      setLockerCheckout(body.checkout);
      setLockerOrderSubmission(body.submission);
      if (body.submission.orderPlaced) {
        setBasket({ totalQuantity: 0, items: [], subtotal: null, grandTotal: null });
      }
    } catch {
      setLockerCheckoutError("The locker order could not be submitted right now.");
    } finally {
      setLockerOrderSubmitting(false);
    }
  }

  async function loadProductOptions(product: CatalogueProduct) {
    setProductOptionsLoading(true);
    setProductOptionsError(null);
    setProductOptions(null);
    setProductOptionSelections({});
    setGroupedProductQuantities({});

    try {
      const response = await signedFetch("/api/product-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sku: product.sku }),
      });
      const body = (await response.json()) as ProductOptionsResponse;

      if (response.status === 401 || body.code === "SESSION_REQUIRED") {
        handleSessionExpired();
        return;
      }

      if (!response.ok || !body.ok || !body.product) {
        setProductOptionsError(body.error || "Product options could not be loaded right now.");
        return;
      }

      if (body.product.sku !== product.sku || body.product.productType !== product.productType) {
        setProductOptionsError("This product changed while you were viewing it. Please try again.");
        return;
      }

      setProductOptions(body.product);
      setProductOptionSelections(defaultProductSelections(body.product));
      setGroupedProductQuantities(defaultGroupedQuantities(body.product));
    } catch {
      setProductOptionsError("Product options could not be loaded right now.");
    } finally {
      setProductOptionsLoading(false);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSearch = searchInput.trim();
    setActiveSearch(nextSearch);
    void loadCatalogue({ search: nextSearch, categoryUid: activeCategoryUid, page: 1 });
  }

  function chooseCategory(uid: string) {
    const nextUid = activeCategoryUid === uid ? "" : uid;
    setActiveCategoryUid(nextUid);
    void loadCatalogue({ search: activeSearch, categoryUid: nextUid, page: 1 });
  }

  function clearFilters() {
    setSearchInput("");
    setActiveSearch("");
    setActiveCategoryUid("");
    void loadCatalogue({ search: "", categoryUid: "", page: 1 });
  }

  function goToPage(page: number) {
    if (loading || page < 1 || page > totalPages || page === currentPage) return;
    setAccountOpen(false);
    void loadCatalogue({ search: activeSearch, categoryUid: activeCategoryUid, page });
  }

  function openProduct(product: CatalogueProduct) {
    setBasketOpen(false);
    setAccountOpen(false);
    setLockerCheckout(null);
    setLockerCheckoutError(null);
    setLockerOrderSubmission(null);
    setSelectedProduct(product);
    setSelectedQuantity(1);
    setBasketError(null);
    setProductOptions(null);
    setProductOptionsError(null);
    setProductOptionSelections({});
    setGroupedProductQuantities({});

    if (
      product.productType === "ConfigurableProduct" ||
      product.productType === "BundleProduct" ||
      product.productType === "GroupedProduct"
    ) {
      void loadProductOptions(product);
    }
  }

  function closeProduct() {
    setSelectedProduct(null);
    setProductOptions(null);
    setProductOptionsError(null);
    setProductOptionSelections({});
    setGroupedProductQuantities({});
  }

  async function addSelectedProduct() {
    if (!selectedProduct) return;

    let added = false;

    if (selectedProduct.productType === "GroupedProduct") {
      if (!productOptions || !groupedSelectionsComplete(productOptions, groupedProductQuantities)) return;
      added = await performBasketAction({
        action: "add_grouped",
        items: selectedGroupedBasketItems(productOptions, groupedProductQuantities),
      });
    } else {
      let selectedOptions: string[] | undefined;
      if (
        selectedProduct.productType === "ConfigurableProduct" ||
        selectedProduct.productType === "BundleProduct"
      ) {
        if (!productOptions || !productSelectionsComplete(productOptions, productOptionSelections)) return;
        selectedOptions = selectedProductOptionUids(productOptionSelections);
      } else if (selectedProduct.productType !== "SimpleProduct") {
        return;
      }

      added = await performBasketAction({
        action: "add",
        sku: selectedProduct.sku,
        quantity: selectedQuantity,
        selectedOptions,
      });
    }

    if (added) {
      closeProduct();
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

  function closeBasket() {
    setBasketOpen(false);
    setLockerCheckout(null);
    setLockerCheckoutError(null);
    setLockerOrderSubmission(null);
  }

  function openBasket() {
    closeProduct();
    setAccountOpen(false);
    setLockerCheckout(null);
    setLockerCheckoutError(null);
    setLockerOrderSubmission(null);
    setBasketOpen(true);
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
  const selectedNeedsOptions = Boolean(
    selectedProduct &&
      (
        selectedProduct.productType === "ConfigurableProduct" ||
        selectedProduct.productType === "BundleProduct" ||
        selectedProduct.productType === "GroupedProduct"
      ),
  );
  const selectedOptionsComplete = Boolean(
    selectedNeedsOptions &&
      productOptions &&
      (selectedProduct?.productType === "GroupedProduct"
        ? groupedSelectionsComplete(productOptions, groupedProductQuantities)
        : productSelectionsComplete(productOptions, productOptionSelections)),
  );
  const selectedCanAdd = Boolean(
    selectedProduct &&
      selectedInStock &&
      (selectedProduct.productType === "SimpleProduct" || selectedOptionsComplete),
  );

  return (
    <section className={styles.catalogueShell} aria-label="Authenticated trade catalogue">
      <header className={styles.catalogueHeader}>
        <div className={styles.brandGroup}>
          <Image
            className={styles.headerCssLogo}
            src="/css-logo.png"
            alt="Chelmsford Safety Supplies"
            width={2222}
            height={514}
            sizes="240px"
            priority
          />
          <span className={styles.brandDivider} aria-hidden="true" />
          <div className={styles.customerBrand}>
            {customerLogo ? (
              <Image
                className={styles.customerLogo}
                src={customerLogo.src}
                alt={customerLogo.alt}
                width={360}
                height={120}
                sizes="180px"
              />
            ) : (
              <span className={styles.customerFallback}>{companyName}</span>
            )}
          </div>
        </div>

        <div className={styles.headerActions}>
          <div className={styles.accountMenuWrap}>
            <button
              className={styles.iconButton}
              type="button"
              onClick={() => setAccountOpen((open) => !open)}
              aria-expanded={accountOpen}
              aria-label="My account"
            >
              <AccountIcon />
              <span>My account</span>
            </button>
            {accountOpen ? (
              <div className={styles.accountMenu}>
                <strong>{companyName}</strong>
                <span>{customer.firstName} {customer.lastName}</span>
                <span>{customer.email}</span>
                {companyReference ? <span>Account {companyReference}</span> : null}
                <AccountOrderHistory
                  signedFetch={signedFetch}
                  onSessionExpired={onSessionExpired}
                />
                <button type="button" onClick={onSignOut}>Sign out</button>
              </div>
            ) : null}
          </div>

          <button
            className={styles.iconButton}
            type="button"
            onClick={openBasket}
            aria-label={`Open basket with ${basketCount} items`}
          >
            <BasketIcon />
            <span>Basket</span>
            <b>{basketLoading ? "…" : basketCount}</b>
          </button>
        </div>
      </header>

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
        <div
          className={styles.categoryStrip}
          aria-label="Kiosk product categories"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "10px",
            overflow: "visible",
            padding: 0,
          }}
        >
          {categories.map((category) => {
            const imageUrl = safeImageUrl(category.imageUrl);
            const active = activeCategoryUid === category.uid;

            return (
              <button
                key={category.uid}
                className={active ? styles.categoryActive : styles.categoryButton}
                type="button"
                onClick={() => chooseCategory(category.uid)}
                disabled={loading}
                aria-pressed={active}
                style={{
                  width: "100%",
                  minHeight: "160px",
                  maxWidth: "none",
                  display: "grid",
                  gridTemplateRows: "112px auto",
                  overflow: "hidden",
                  padding: 0,
                  textAlign: "left",
                  boxShadow: active
                    ? "0 0 0 3px rgb(0 87 168 / 12%)"
                    : "0 8px 20px rgb(0 35 72 / 7%)",
                }}
              >
                <span
                  role="img"
                  aria-label={`${category.name} category`}
                  style={{
                    minHeight: "112px",
                    display: "grid",
                    placeItems: "center",
                    backgroundColor: "#f4f7fa",
                    backgroundImage: imageUrl ? `url(${JSON.stringify(imageUrl)})` : undefined,
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "center",
                    backgroundSize: "cover",
                    borderBottom: "1px solid var(--css-border)",
                  }}
                >
                  {!imageUrl ? (
                    <span
                      aria-hidden="true"
                      style={{
                        width: "58px",
                        height: "58px",
                        display: "grid",
                        placeItems: "center",
                        borderRadius: "15px",
                        background: "#e4eff8",
                        color: "var(--css-primary)",
                        fontFamily: "var(--font-secondary)",
                        fontSize: "29px",
                        fontWeight: 900,
                      }}
                    >
                      {category.name.slice(0, 1).toUpperCase()}
                    </span>
                  ) : null}
                </span>
                <span
                  style={{
                    minHeight: "48px",
                    display: "flex",
                    alignItems: "center",
                    padding: "9px 12px",
                    fontSize: "15px",
                    fontWeight: 900,
                    lineHeight: 1.2,
                  }}
                >
                  {category.name}
                </span>
              </button>
            );
          })}
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
            onClick={() => void loadCatalogue({ search: activeSearch, categoryUid: activeCategoryUid, page: currentPage })}
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
          <span>Try another search or clear the current filters.</span>
          <button type="button" onClick={clearFilters}>Show all products</button>
        </div>
      ) : null}

      {!error && !loading && products.length ? (
        <div className={styles.productGrid}>
          {products.map((product) => (
            <CatalogueProductCard
              key={product.uid}
              product={product}
              onOpen={() => openProduct(product)}
            />
          ))}
        </div>
      ) : null}

      {!error && !loading && totalPages > 1 ? (
        <nav className={styles.pagination} aria-label="Catalogue pages">
          <button type="button" onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>
            ← Previous
          </button>
          <span>Page <strong>{currentPage}</strong> of {totalPages}</span>
          <button type="button" onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}>
            Next →
          </button>
        </nav>
      ) : null}

      {selectedProduct ? (
        <div className={styles.modalBackdrop} role="presentation">
          <section className={styles.detailPanel} role="dialog" aria-modal="true" aria-labelledby="product-detail-title">
            <button className={styles.closeButton} type="button" onClick={closeProduct} aria-label="Close product details">×</button>
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

              {selectedNeedsOptions && productOptionsLoading ? (
                <p className={styles.optionNotice}>Loading available options…</p>
              ) : null}

              {selectedNeedsOptions && productOptionsError ? (
                <div className={styles.errorPanel} role="alert">
                  <span>{productOptionsError}</span>
                  <button type="button" onClick={() => void loadProductOptions(selectedProduct)}>
                    Try again
                  </button>
                </div>
              ) : null}

              {selectedNeedsOptions && productOptions ? (
                <ProductOptionSelector
                  product={productOptions}
                  selections={productOptionSelections}
                  groupedQuantities={groupedProductQuantities}
                  onChange={setProductOptionSelections}
                  onGroupedQuantityChange={setGroupedProductQuantities}
                  disabled={basketMutating}
                />
              ) : null}

              {selectedCanAdd ? (
                <div className={styles.addControls}>
                  {selectedProduct.productType !== "GroupedProduct" ? (
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
                  ) : null}
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
                  {!selectedInStock
                    ? "This product is not currently available to add from the kiosk."
                    : productOptionsError
                      ? "Reload the product options before adding this item."
                      : selectedProduct.productType === "GroupedProduct"
                        ? "Choose a quantity for at least one available item."
                        : selectedNeedsOptions
                          ? "Choose every required option before adding this product."
                          : "This product type is not yet supported by the kiosk basket."}
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
                <p className={styles.eyebrow}>
                  {lockerOrderSubmission ? "Order submitted" : lockerCheckout ? "Local locker checkout" : "Current order"}
                </p>
                <h2 id="basket-title">
                  {lockerOrderSubmission ? "Locker order confirmation" : lockerCheckout ? "Locker collection review" : "Basket"}
                </h2>
              </div>
              <button className={styles.closeButton} type="button" onClick={closeBasket} aria-label="Close basket">×</button>
            </header>

            {basketError && !lockerCheckout ? <p className={styles.basketInlineError} role="alert">{basketError}</p> : null}
            {lockerCheckoutError ? <p className={styles.basketInlineError} role="alert">{lockerCheckoutError}</p> : null}

            {lockerCheckout ? (
              <>
                <div className={styles.basketEmpty}>
                  <strong>{lockerCheckout.locker.label}</strong>
                  {lockerCheckout.locker.street.map((line) => <span key={line}>{line}</span>)}
                  <span>
                    {lockerCheckout.locker.city}
                    {lockerCheckout.locker.region ? `, ${lockerCheckout.locker.region}` : ""}
                  </span>
                  <span>{lockerCheckout.locker.postcode} · {lockerCheckout.locker.countryCode}</span>
                </div>

                <div className={styles.totalRows}>
                  <span>
                    <small>Delivery method</small>
                    <strong>{lockerCheckout.shipping.methodTitle}</strong>
                  </span>
                  <span>
                    <small>Locker delivery</small>
                    <strong>
                      {lockerCheckout.shipping.amount
                        ? formatMoney(lockerCheckout.shipping.amount.value, lockerCheckout.shipping.amount.currency)
                        : "Included"}
                    </strong>
                  </span>
                  <span>
                    <small>Subtotal ex VAT</small>
                    <strong>
                      {lockerCheckout.basket.subtotal
                        ? formatMoney(lockerCheckout.basket.subtotal.value, lockerCheckout.basket.subtotal.currency)
                        : "—"}
                    </strong>
                  </span>
                  <span>
                    <small>Checkout total</small>
                    <strong>
                      {lockerCheckout.basket.grandTotal
                        ? formatMoney(lockerCheckout.basket.grandTotal.value, lockerCheckout.basket.grandTotal.currency)
                        : "—"}
                    </strong>
                  </span>
                </div>

                {lockerOrderSubmission ? (
                  <div className={styles.basketEmpty}>
                    <strong>
                      {lockerOrderSubmission.orderPlaced
                        ? "Your locker order has been placed"
                        : lockerOrderSubmission.approvalRequired
                          ? "Your order has been submitted for approval"
                          : "Your order has been submitted"}
                    </strong>
                    {lockerOrderSubmission.orderNumber ? (
                      <span>Magento order {lockerOrderSubmission.orderNumber}</span>
                    ) : null}
                    {lockerOrderSubmission.creditOrderNumber ? (
                      <span>Credit order {lockerOrderSubmission.creditOrderNumber}</span>
                    ) : null}
                    {lockerOrderSubmission.orderPlaced ? (
                      lockerOrderSubmission.oglOrderNumber ? (
                        <span>OGL order {lockerOrderSubmission.oglOrderNumber}</span>
                      ) : (
                        <span>Waiting for OGL export reference…</span>
                      )
                    ) : (
                      <span>The OGL and locker reference will be created after the Magento order is placed.</span>
                    )}
                  </div>
                ) : (
                  <p className={styles.optionNotice}>
                    This kiosk can deliver only to this local locker. The delivery address and shipping method were applied by the trusted kiosk server and confirmed by Magento.
                  </p>
                )}

                <footer className={styles.basketFooter}>
                  {lockerOrderSubmission ? (
                    <button className={styles.checkoutButton} type="button" onClick={closeBasket}>
                      Done
                    </button>
                  ) : (
                    <>
                      <button
                        className={styles.removeButton}
                        type="button"
                        onClick={() => {
                          setLockerCheckout(null);
                          setLockerCheckoutError(null);
                          setLockerOrderSubmission(null);
                        }}
                        disabled={lockerOrderSubmitting}
                      >
                        Back to basket
                      </button>
                      <button
                        className={styles.checkoutButton}
                        type="button"
                        onClick={() => void confirmLockerOrder()}
                        disabled={lockerOrderSubmitting || !lockerCheckout.ordering.canSubmitCreditOrder}
                      >
                        {lockerOrderSubmitting ? "Submitting order…" : "Confirm order to local locker"}
                      </button>
                    </>
                  )}
                </footer>

                {!lockerOrderSubmission && !lockerCheckout.ordering.canSubmitCreditOrder ? (
                  <p className={styles.basketInlineError} role="alert">
                    This trade account is not allowed to submit an order from the kiosk.
                  </p>
                ) : null}
              </>
            ) : (
              <>
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
                  <button
                    className={styles.checkoutButton}
                    type="button"
                    onClick={() => void prepareLockerCheckout()}
                    disabled={
                      basketLoading ||
                      basketMutating ||
                      lockerCheckoutLoading ||
                      !basket ||
                      basket.items.length === 0
                    }
                  >
                    {lockerCheckoutLoading ? "Preparing local locker…" : "Review local locker checkout"}
                  </button>
                </footer>
              </>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}
