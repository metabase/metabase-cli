import { ConfigError } from "./errors";

export function normalizeUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new ConfigError("URL must start with http:// or https://");
  }
  return trimmed;
}

// Drops credentials, query, and fragment for display, but keeps the path — a Metabase instance may
// be hosted under a subpath (https://my.org.com/metabase), and two instances on one host must stay
// distinguishable in `auth status` / `auth list` output.
export function displayUrl(input: string): string {
  const parsed = new URL(input);
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${path}`;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

// Guard against a tampered or hostile authorization-server metadata document redirecting the
// CLI's OAuth secrets (authorization code, PKCE verifier, refresh token) to another host. Every
// endpoint the CLI sends secrets to must share the configured Metabase URL's origin, and must use
// https unless it is a loopback dev instance.
export function assertEndpointOrigin(endpoint: string, baseUrl: string, label: string): void {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new ConfigError(`OAuth ${label} is not a valid URL: ${endpoint}`);
  }
  const base = new URL(baseUrl);
  if (parsed.protocol !== "https:" && !isLoopbackHost(parsed.hostname)) {
    throw new ConfigError(`OAuth ${label} must use https: ${endpoint}`);
  }
  if (parsed.origin !== base.origin) {
    throw new ConfigError(
      `OAuth ${label} origin (${parsed.origin}) does not match the Metabase URL (${base.origin})`,
    );
  }
}
