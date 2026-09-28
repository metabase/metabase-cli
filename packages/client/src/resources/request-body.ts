import type { z } from "zod";

import { ConfigError, formatZodIssue } from "../errors";

/**
 * Parse the body a caller hands a method, refusing one that does not match `schema` before any
 * request. `what` names the body in the refusal.
 */
export function parseRequestBody<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(formatZodIssue).join("; ");
    throw new ConfigError(`invalid ${what}: ${issues}`);
  }
  return parsed.data;
}
