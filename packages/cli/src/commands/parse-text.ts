import type { ZodType } from "zod";

import { ConfigError } from "@metabase/client/errors";
import { isBlank } from "@metabase/client/predicates";

// Blank is judged by Metabase's own rule, so the CLI refuses exactly the values the server would
// refuse, or would read as absent. A value is sent as given: the server matches it literally.
export function parseText(value: string, name: string): string {
  if (isBlank(value)) {
    throw new ConfigError(`invalid ${name}: must not be blank`);
  }
  return value;
}

// Only an absent flag is unset. A blank value is what a shell hands over for an expansion that
// resolved to nothing (`--query "$Q"`), and reading it as "no filter" turns a typo into a full
// unfiltered listing, so it is refused.
export function parseOptionalText(value: string | undefined, name: string): string | undefined {
  return value === undefined ? undefined : parseText(value, name);
}

// A flag that stands in for a body field runs through that field's own schema, so the flag and the
// body refuse the same values.
export function parseTextFlag(value: string, schema: ZodType<string>, flag: string): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const reasons = parsed.error.issues.map((issue) => issue.message).join("; ");
    throw new ConfigError(`${flag} ${reasons}`);
  }
  return parsed.data;
}
