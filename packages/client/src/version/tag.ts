import { parse as parseSemver } from "semver";
import { z } from "zod";

export const ParsedVersion = z.object({
  tag: z.string(),
  major: z.number().int().nonnegative(),
  patch: z.number().int().nonnegative(),
});
export type ParsedVersion = z.infer<typeof ParsedVersion>;

// A dev build reports a tag that either fails semver outright ("vUNKNOWN", "vLOCAL_DEV") or parses
// to a number that means nothing — a locally built jar reports "v0.1.0-SNAPSHOT", which would read
// as Metabase v1 and make every version gate fire against a server that actually carries the newest
// features. Metabase itself treats any "-SNAPSHOT" tag as "no version", so we do too.
const DEV_BUILD_SUFFIX = "-SNAPSHOT";

export function tryParseTag(tag: string): ParsedVersion | null {
  if (tag.endsWith(DEV_BUILD_SUFFIX)) {
    return null;
  }
  const parsed = parseSemver(tag);
  if (parsed === null || (parsed.major !== 0 && parsed.major !== 1)) {
    return null;
  }
  return {
    tag,
    major: parsed.minor,
    patch: parsed.patch,
  };
}
