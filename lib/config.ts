function required(name: "MAGENTO_BASE_URL" | "MAGENTO_STORE_CODE") {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not configured.`);
  }
  return value;
}

function withoutTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function getMagentoConfig() {
  const baseUrl = withoutTrailingSlash(required("MAGENTO_BASE_URL"));
  const storeCode = required("MAGENTO_STORE_CODE");

  return {
    baseUrl,
    storeCode,
    graphqlUrl: process.env.MAGENTO_GRAPHQL_URL?.trim() || `${baseUrl}/graphql`,
  };
}
