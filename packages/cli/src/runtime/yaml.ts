import { parse, stringify, YAMLParseError } from "yaml";
import type { ZodType } from "zod";

import { ConfigError, errorMessage, ValidationError } from "@metabase/client/errors";

interface ParseYamlOptions {
  source?: string;
}

type ParseYamlResult<T> =
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

// SnakeYAML, which Metabase reads serialized content with, ends a line at these characters; this
// parser does not, so a comment they end would hide the rest of its line from this parser alone.
const YAML_1_1_LINE_BREAKS = /[\u0085\u2028\u2029]/;

// One serialized Metabase file, read as YAML 1.2, which this check classifies by, and as YAML 1.1,
// which Metabase reads it as.
export interface MetabaseYaml {
  yaml12: unknown;
  yaml11: unknown;
}

function parseAs(input: string, source: string, version: "1.1" | "1.2"): unknown {
  try {
    return parse(input, { merge: true, version });
  } catch (error) {
    throw new ValidationError(`${source}: invalid YAML: ${errorMessage(error)}`, {
      source,
      zodIssues: [],
    });
  }
}

// Parses a serialized Metabase file as Metabase reads it, `<<` merge keys included. A file whose lines
// this parser and Metabase's would split differently is refused rather than guessed at.
export function parseMetabaseYaml(input: string, source: string): MetabaseYaml {
  if (YAML_1_1_LINE_BREAKS.test(input)) {
    throw new ValidationError(
      `${source}: holds U+0085, U+2028 or U+2029, which Metabase reads as a line break and this check does not; remove the character`,
      { source, zodIssues: [] },
    );
  }
  return { yaml12: parseAs(input, source, "1.2"), yaml11: parseAs(input, source, "1.1") };
}

export function stringifyYaml(value: unknown): string {
  return stringify(value, { lineWidth: 0 });
}
