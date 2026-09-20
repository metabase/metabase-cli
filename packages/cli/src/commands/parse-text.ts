import { ConfigError } from "@metabase/client/errors";

// Only an absent flag is unset. A blank value is what a shell hands over for an expansion that
// resolved to nothing (`--query "$Q"`), and reading it as "no filter" turns a typo into a full
// unfiltered listing, so it is refused. A value is sent as given: the server matches it literally.
export function parseOptionalText(value: string | undefined, name: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value.trim() === "") {
    throw new ConfigError(`invalid ${name}: must not be blank`);
  }
  return value;
}
