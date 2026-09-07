"use client";

import type { KioskProductOptions } from "@/lib/magento/product-options";
import styles from "./product-option-selector.module.css";

type SelectionMap = Record<string, string[]>;

type ProductOptionSelectorProps = {
  product: KioskProductOptions;
  selections: SelectionMap;
  disabled?: boolean;
  onChange: (selections: SelectionMap) => void;
};

function selected(selections: SelectionMap, groupUid: string, choiceUid: string) {
  return (selections[groupUid] || []).includes(choiceUid);
}

export function ProductOptionSelector({
  product,
  selections,
  disabled = false,
  onChange,
}: ProductOptionSelectorProps) {
  function chooseSingle(groupUid: string, choiceUid: string) {
    onChange({ ...selections, [groupUid]: [choiceUid] });
  }

  function toggleMultiple(groupUid: string, choiceUid: string) {
    const current = selections[groupUid] || [];
    const next = current.includes(choiceUid)
      ? current.filter((uid) => uid !== choiceUid)
      : [...current, choiceUid];
    onChange({ ...selections, [groupUid]: next });
  }

  if (product.productType === "ConfigurableProduct") {
    return (
      <div className={styles.stack}>
        {product.configurableOptions.map((option) => (
          <fieldset className={styles.group} key={option.uid}>
            <legend>
              {option.label}
              <span>Required</span>
            </legend>
            <div className={styles.choices}>
              {option.values.map((value) => {
                const active = selected(selections, option.uid, value.uid);
                return (
                  <button
                    className={active ? styles.choiceActive : styles.choice}
                    type="button"
                    key={value.uid}
                    onClick={() => chooseSingle(option.uid, value.uid)}
                    disabled={disabled}
                    aria-pressed={active}
                  >
                    {value.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
    );
  }

  if (product.productType === "BundleProduct") {
    return (
      <div className={styles.stack}>
        {product.bundleItems.map((item) => {
          const multiple = item.type.toLowerCase() === "checkbox";
          return (
            <fieldset className={styles.group} key={item.uid}>
              <legend>
                {item.title}
                <span>{item.required ? "Required" : "Optional"}</span>
              </legend>
              <div className={styles.choices}>
                {item.choices.map((choice) => {
                  const active = selected(selections, item.uid, choice.uid);
                  const unavailable = choice.stockStatus === "OUT_OF_STOCK";
                  return (
                    <button
                      className={active ? styles.choiceActive : styles.choice}
                      type="button"
                      key={choice.uid}
                      onClick={() =>
                        multiple
                          ? toggleMultiple(item.uid, choice.uid)
                          : chooseSingle(item.uid, choice.uid)
                      }
                      disabled={disabled || unavailable}
                      aria-pressed={active}
                    >
                      <strong>{choice.label}</strong>
                      <small>
                        {choice.sku ? `${choice.sku} · ` : ""}
                        {unavailable ? "Out of stock" : `Qty ${choice.quantity}`}
                      </small>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
    );
  }

  return null;
}

export function defaultProductSelections(product: KioskProductOptions): SelectionMap {
  if (product.productType !== "BundleProduct") return {};

  return Object.fromEntries(
    product.bundleItems
      .map((item) => {
        const defaults = item.choices.filter((choice) => choice.isDefault).map((choice) => choice.uid);
        const selectedDefaults = item.type.toLowerCase() === "checkbox" ? defaults : defaults.slice(0, 1);
        return [item.uid, selectedDefaults] as const;
      })
      .filter(([, values]) => values.length > 0),
  );
}

export function productSelectionsComplete(
  product: KioskProductOptions,
  selections: SelectionMap,
) {
  if (product.productType === "ConfigurableProduct") {
    return (
      product.configurableOptions.length > 0 &&
      product.configurableOptions.every((option) => (selections[option.uid] || []).length === 1)
    );
  }

  if (product.productType === "BundleProduct") {
    return (
      product.bundleItems.length > 0 &&
      product.bundleItems.every(
        (item) => !item.required || (selections[item.uid] || []).length > 0,
      )
    );
  }

  return true;
}

export function selectedProductOptionUids(selections: SelectionMap) {
  return [...new Set(Object.values(selections).flat())];
}
