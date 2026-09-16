import type { ZodType } from "zod";

import { ConfigError, errorMessage, ValidationError } from "./errors";

export const JSON_CONTENT_TYPE = "application/json";

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
  const sourcePrefix = opts.source === undefined ? "" : `${opts.source}: `;
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

// Metabase labels every non-string body `application/json` but only JSON-encodes collections; a
// number or boolean is streamed as its literal, which happens to be JSON, while a keyword is
// streamed as its bare name, which is not. A `text/plain` body is a string whatever it looks like
// (a string-typed setting holding "123" stays "123"). So the header decides between text and
// JSON, and within JSON the body decides: try JSON.parse first, and on parse failure wrap the body
// as a JSON string literal so the schema can validate the shape. A caller that expected an object
// then sees a ValidationError carrying the actual body in `developerDetail.zodIssues`.
export function parseJsonOrPlain<T>(
  text: string,
  contentType: string | null,
  schema: ZodType<T>,
  opts: ParseJsonOptions = {},
): T {
  if (!isJsonContentType(contentType)) {
    return parseJson(JSON.stringify(text), schema, opts);
  }
  const attempt = parseJsonResult(text, schema, opts);
  if (attempt.ok) {
    return attempt.value;
  }
  if (attempt.error instanceof ValidationError) {
    throw attempt.error;
  }
  return parseJson(JSON.stringify(text), schema, opts);
}

function isJsonContentType(contentType: string | null): boolean {
  return contentType !== null && contentType.includes(JSON_CONTENT_TYPE);
}
