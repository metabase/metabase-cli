import { errorMessage, NetworkError } from "../errors";

interface NetworkTarget {
  host: string;
  hostname: string;
}

const NETWORK_HINTS: Record<string, (target: NetworkTarget) => string> = {
  ECONNREFUSED: (t) =>
    `Connection refused by ${t.host} — is Metabase running and is the port correct?`,
  ENOTFOUND: (t) => `Host not found: ${t.hostname} — check the URL.`,
  EAI_AGAIN: (t) => `Could not resolve ${t.hostname} — check your network connection and the URL.`,
  ECONNRESET: (t) =>
    `Connection to ${t.host} was reset — the server may have closed it, or http/https may be mismatched.`,
  ETIMEDOUT: (t) => `Connection to ${t.host} timed out — check the host, port, and your network.`,
};

const TLS_ERROR_CODES: ReadonlySet<string> = new Set([
  "EPROTO",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

// Map a fetch transport failure (DNS, refused, reset, TLS) to a NetworkError with a host-aware
// hint. Shared by the typed client and the OAuth protocol boundary so both surface the same
// diagnostics instead of a bare `TypeError: fetch failed`.
export function buildNetworkError(error: unknown, method: string, url: string): NetworkError {
  const fallback = errorMessage(error);
  const code = causeCode(error);
  const target = networkTarget(url);
  return new NetworkError(networkMessage(code, target, fallback), {
    method,
    url,
    cause: code ?? fallback,
  });
}

function networkMessage(code: string | null, target: NetworkTarget, fallback: string): string {
  if (code === null) {
    return `Could not reach Metabase: ${fallback}`;
  }
  if (TLS_ERROR_CODES.has(code)) {
    return (
      `Could not reach Metabase: TLS error contacting ${target.host} (${code}) — ` +
      `the certificate could not be verified, or https:// was used against a plain-HTTP server. ` +
      `For a certificate the OS does not trust either, set NODE_EXTRA_CA_CERTS to its CA bundle.`
    );
  }
  const hint = NETWORK_HINTS[code];
  if (hint === undefined) {
    return `Could not reach Metabase: ${fallback} (${code})`;
  }
  return `Could not reach Metabase: ${hint(target)}`;
}

function causeCode(error: unknown): string | null {
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error && "code" in cause && typeof cause.code === "string") {
    return cause.code;
  }
  return null;
}

function networkTarget(url: string): NetworkTarget {
  const parsed = new URL(url);
  return { host: parsed.host, hostname: parsed.hostname };
}
