export const DEFAULT_E2E_BASE_URL = "http://localhost:13000";

export function resolveE2EBaseUrl(): string {
  return process.env["METABASE_CLI_E2E_URL"] ?? DEFAULT_E2E_BASE_URL;
}
