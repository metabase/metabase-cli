export const DEFAULT_E2E_BASE_URL = "http://localhost:13000";
export const DEFAULT_E2E_STACK = "default";

export function resolveE2EBaseUrl(): string {
  return process.env["METABASE_CLI_E2E_URL"] ?? DEFAULT_E2E_BASE_URL;
}

export function resolveStackId(): string {
  return process.env["METABASE_CLI_E2E_STACK"] ?? DEFAULT_E2E_STACK;
}

export function resolveSnapshotName(): string {
  // Metabase's snapshot endpoint sanitizes the name to an identifier (e.g. `-` → `_`)
  // when writing `<name>.sql`, so keep the name underscore-safe to match on disk.
  return `cli_${resolveStackId().replaceAll("-", "_")}`;
}

// The warehouse the bootstrap connects as the seeded database, reachable from the Metabase
// container by its compose service name.
export const WAREHOUSE_CONNECTION = {
  host: "data-db",
  port: 5432,
  dbname: "warehouse",
  user: "metabase_test",
  password: "metabase_test",
  ssl: false,
} as const;
