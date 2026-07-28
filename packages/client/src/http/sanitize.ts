const SECRET_HEADER_NAMES = new Set([
  "authorization",
  "x-api-key",
  "x-metabase-session",
  "cookie",
  "set-cookie",
  "proxy-authorization",
]);

const REDACTED = "[REDACTED]";

export interface RedactionContext {
  knownSecrets: ReadonlySet<string>;
}

export function redactHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  const entries = headers instanceof Headers ? headers.entries() : Object.entries(headers);
  for (const [key, value] of entries) {
    result[key] = SECRET_HEADER_NAMES.has(key.toLowerCase()) ? REDACTED : value;
  }
  return result;
}

export function redactBody(body: string, ctx: RedactionContext): string {
  let result = body;
  for (const secret of ctx.knownSecrets) {
    if (secret.length === 0) {
      continue;
    }
    result = result.replaceAll(secret, REDACTED);
  }
  return result;
}
