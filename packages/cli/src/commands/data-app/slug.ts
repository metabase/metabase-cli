import { ConfigError } from "@metabase/client/errors";
import { DATA_APP_SLUG_PATTERN } from "@metabase/client/domain/data-app";

export const slugArg = {
  slug: { type: "positional", description: "Data app slug (its /apps/<slug> URL)", required: true },
} as const;

export function parseSlug(raw: string): string {
  if (!DATA_APP_SLUG_PATTERN.test(raw)) {
    throw new ConfigError(`slug "${raw}" must be dash-cased: a-z, 0-9 and single dashes`);
  }
  return raw;
}
