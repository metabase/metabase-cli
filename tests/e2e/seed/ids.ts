export const E2E_SNAPSHOT_NAME = "cli_default";

export const E2E_GROUPS = {
  ALL_USERS: 1,
  ADMIN: 2,
} as const;

export const E2E_DATABASES = {
  WAREHOUSE: 1,
} as const;

export const E2E_COLLECTIONS = {
  DEFAULT: 4,
} as const;

export const E2E_CARDS = {
  ORDERS_BY_STATUS: 94,
} as const;

export const E2E_DASHBOARDS = {
  ORDERS_OVERVIEW: 10,
} as const;

export const E2E_DASHCARDS = {
  ORDERS_OVERVIEW_FIRST: 87,
} as const;

export const E2E_TABLES = {
  CUSTOMERS: 169,
  DAILY_SALES: 168,
  ORDER_ITEMS: 173,
  ORDER_SUMMARY: 170,
  ORDERS: 174,
  PRODUCTS: 172,
  REVIEWS: 171,
} as const;

export const E2E_FIELDS = {
  CUSTOMERS_EMAIL: 1664,
  ORDERS_ID: 1689,
} as const;
