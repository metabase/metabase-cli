import { SEEDED } from "./seed/seeded";

const SLEEP_SECONDS = 3;

// Well under the sleep, so the request times out on the client whatever the stack's speed.
export const SHORT_TIMEOUT_MS = 500;

interface NativeClause {
  query: string;
}

// A type alias rather than an interface, so it reads as the record a card's `dataset_query` takes.
export type SlowNativeQuery = {
  type: "native";
  database: number;
  native: NativeClause;
};

export function slowNativeQuery(): SlowNativeQuery {
  return {
    type: "native",
    database: SEEDED.warehouseDbId,
    native: { query: `WITH s AS (SELECT pg_sleep(${SLEEP_SECONDS})) SELECT 1 AS one FROM s` },
  };
}
