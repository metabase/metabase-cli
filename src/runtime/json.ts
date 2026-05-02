import type { ZodType } from "zod";

import { ConfigError, errorMessage, ValidationError } from "../core/errors";

export interface ParseJsonOptions {
  source?: string;
}

export type ParseJsonResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ConfigError | ValidationError };

export function parseJson<T>(input: string, schema: ZodType<T>, opts: ParseJsonOptions = {}): T {
  const result = parseJsonResult(input, schema, opts);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

export function parseJsonResult<T>(
  input: string,
  schema: ZodType<T>,
  opts: ParseJsonOptions = {},
): ParseJsonResult<T> {
  const sourcePrefix = opts.source ? `${opts.source}: ` : "";
  let raw: unknown;
  try {
    raw = JSON.parse(input);
  } catch (error) {
    return {
      ok: false,
      error: new ConfigError(`${sourcePrefix}invalid JSON: ${errorMessage(error)}`),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: new ValidationError(`${sourcePrefix}value did not match expected schema`, {
        source: opts.source ?? "<input>",
        zodIssues: parsed.error.issues,
      }),
    };
  }
  return { ok: true, value: parsed.data };
}
