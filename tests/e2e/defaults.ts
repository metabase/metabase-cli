export const DEFAULT_E2E_BASE_URL = "http://localhost:13000";
export const DEFAULT_E2E_STACK = "default";

export function resolveE2EBaseUrl(): string {
  return process.env["METABASE_CLI_E2E_URL"] ?? DEFAULT_E2E_BASE_URL;
}

export function resolveStackId(): string {
  return process.env["METABASE_CLI_E2E_STACK"] ?? DEFAULT_E2E_STACK;
}

export function resolveSnapshotName(): string {
  return `cli_${resolveStackId()}`;
}
