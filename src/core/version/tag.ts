import { parse as parseSemver } from "semver";
import { z } from "zod";

import { Edition } from "../../runtime/capabilities";

export const ParsedVersionSchema = z.object({
  tag: z.string(),
  build: Edition,
  major: z.number().int().nonnegative(),
  patch: z.number().int().nonnegative(),
});
export type ParsedVersion = z.infer<typeof ParsedVersionSchema>;

export function tryParseTag(tag: string): ParsedVersion | null {
  const parsed = parseSemver(tag);
  if (parsed === null || (parsed.major !== 0 && parsed.major !== 1)) {
    return null;
  }
  return {
    tag,
    build: parsed.major === 1 ? "ee" : "oss",
    major: parsed.minor,
    patch: parsed.patch,
  };
}
