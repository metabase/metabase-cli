import { parse, stringify, YAMLParseError } from "yaml";
import type { ZodType } from "zod";

import { ConfigError, errorMessage, ValidationError } from "../core/errors";

export interface ParseYamlOptions {
  source?: string;
}

export type ParseYamlResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ConfigError | ValidationError };

export function parseYaml<T>(input: string, schema: ZodType<T>, opts: ParseYamlOptions = {}): T {
  const result = parseYamlResult(input, schema, opts);
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}

export function parseYamlResult<T>(
  input: string,
  schema: ZodType<T>,
  opts: ParseYamlOptions = {},
): ParseYamlResult<T> {
  const sourcePrefix = opts.source ? `${opts.source}: ` : "";
  let raw: unknown;
  try {
    raw = parse(input);
  } catch (error) {
    if (error instanceof YAMLParseError) {
      return {
        ok: false,
        error: new ConfigError(`${sourcePrefix}invalid YAML: ${error.message}`),
      };
    }
    return {
      ok: false,
      error: new ConfigError(`${sourcePrefix}invalid YAML: ${errorMessage(error)}`),
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

export function stringifyYaml(value: unknown): string {
  return stringify(value, { lineWidth: 0 });
}
