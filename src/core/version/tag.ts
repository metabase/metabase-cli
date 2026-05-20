import { parse as parseSemver } from "semver";
import { z } from "zod";

import { MetabaseError } from "../errors";

export const Build = z.enum(["oss", "ee"]);
export type Build = z.infer<typeof Build>;

export const ParsedVersionSchema = z.object({
  tag: z.string(),
  build: Build,
  major: z.number().int().nonnegative(),
  patch: z.number().int().nonnegative(),
});
export type ParsedVersion = z.infer<typeof ParsedVersionSchema>;

export class VersionTagParseError extends MetabaseError {
  readonly category = "validation";
  readonly isRetryable = false;
  readonly exitCode = 1;
  readonly developerDetail: { readonly tag: string };

  constructor(tag: string) {
    super(`Unrecognized Metabase version tag: ${JSON.stringify(tag)} (expected v0.X.Y or v1.X.Y)`);
    this.name = "VersionTagParseError";
    this.developerDetail = { tag };
  }
}

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

export function parseTag(tag: string): ParsedVersion {
  const parsed = tryParseTag(tag);
  if (parsed === null) {
    throw new VersionTagParseError(tag);
  }
  return parsed;
}
