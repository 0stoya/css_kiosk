"use client";

import { useState } from "react";
import type { KioskCatalogueProduct } from "@/lib/magento/catalogue";
import styles from "./catalogue-product-card.module.css";

type CatalogueProductCardProps = {
  product: KioskCatalogueProduct;
  onOpen: () => void;
};

function safeImageUrl(value: string | null) {
  if (!value) return null;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
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

function PlaceholderIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </svg>
  );
}

export function CatalogueProductCard({ product, onOpen }: CatalogueProductCardProps) {
  const imageUrl = safeImageUrl(product.imageUrl);
  const [imageFailed, setImageFailed] = useState(false);
  const inStock = product.stockStatus === "IN_STOCK";
  const hasDiscount = Boolean(
    product.price && product.price.regularValue > product.price.value,
  );
  const showImage = Boolean(imageUrl && !imageFailed);

  return (
    <article className={styles.card}>
      <div className={styles.image} role="img" aria-label={product.imageLabel || product.name}>
        {showImage ? (
          // Magento catalogue media is remote and varies by store; native img lets us fail cleanly.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl as string}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className={styles.imageFallback} aria-hidden="true">
            <PlaceholderIcon />
          </span>
        )}
      </div>

      <div className={styles.info}>
        <span className={styles.sku}>{product.sku}</span>
        <h2>{product.name}</h2>

        <div className={styles.meta}>
          <div className={styles.price}>
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

      <button className={styles.action} type="button" onClick={onOpen}>
        View / add
      </button>
    </article>
  );
}
