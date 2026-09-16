import { parse as parseSemver } from "semver";
import { z } from "zod";

export const ParsedVersion = z.object({
  tag: z.string(),
  major: z.number().int().nonnegative(),
  patch: z.number().int().nonnegative(),
});
export type ParsedVersion = z.infer<typeof ParsedVersion>;

export const Edition = z.enum(["oss", "ee"]);
export type Edition = z.infer<typeof Edition>;

// Metabase's build stamps the edition into the semver major: an OSS jar is tagged `v0.<major>.<patch>`
// and an EE jar `v1.<major>.<patch>`, released and `-SNAPSHOT` alike. A tag that parses to neither
// (`vUNKNOWN`, `vLOCAL_DEV`) says nothing about the edition.
const OSS_SEMVER_MAJOR = 0;
const EE_SEMVER_MAJOR = 1;

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
  if (parsed === null || editionOfSemverMajor(parsed.major) === null) {
    return null;
  }
  return {
    tag,
    major: parsed.minor,
    patch: parsed.patch,
  };
}

export function editionFromTag(tag: string): Edition | null {
  const parsed = parseSemver(tag);
  return parsed === null ? null : editionOfSemverMajor(parsed.major);
}

function editionOfSemverMajor(semverMajor: number): Edition | null {
  if (semverMajor === OSS_SEMVER_MAJOR) {
    return "oss";
  }
  if (semverMajor === EE_SEMVER_MAJOR) {
    return "ee";
  }
  return null;
}
