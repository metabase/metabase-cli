import { z } from "zod";

export const ParsedVersion = z.object({
  tag: z.string(),
  major: z.number().int().nonnegative(),
  patch: z.number().int().nonnegative(),
});
export type ParsedVersion = z.infer<typeof ParsedVersion>;

export const Edition = z.enum(["oss", "ee"]);
export type Edition = z.infer<typeof Edition>;

// Metabase's build stamps the edition into the leading number: an OSS jar is tagged `v0.<major>.<patch>`
// and an EE jar `v1.<major>.<patch>`, released and `-SNAPSHOT` alike, with an optional fourth number on
// a hotfix (`v0.62.19.5`) — so the tag is not semver, and a semver parser refuses a real release. A tag
// that fits neither shape (`vUNKNOWN`, `vLOCAL_DEV`) says nothing about the edition.
const TAG = /^v?([01])\.(\d+)\.(\d+)(?:\.\d+)?(?:-([0-9A-Za-z.-]+))?$/;
const OSS_EDITION_NUMBER = "0";

// A locally built jar reports "v0.1.0-SNAPSHOT", which would read as Metabase v1 and make every version
// gate fire against a server that actually carries the newest features. Metabase itself treats any
// "-SNAPSHOT" tag as "no version", so we do too.
const DEV_BUILD_SUFFIX = "SNAPSHOT";

interface TagParts {
  readonly edition: Edition;
  readonly major: number;
  readonly patch: number;
  readonly prerelease: string | null;
}

function tagParts(tag: string): TagParts | null {
  const match = TAG.exec(tag);
  if (match === null) {
    return null;
  }
  const [, editionNumber, major, patch, prerelease] = match;
  if (editionNumber === undefined || major === undefined || patch === undefined) {
    return null;
  }
  return {
    edition: editionNumber === OSS_EDITION_NUMBER ? "oss" : "ee",
    major: Number(major),
    patch: Number(patch),
    prerelease: prerelease ?? null,
  };
}

export function tryParseTag(tag: string): ParsedVersion | null {
  const parts = tagParts(tag);
  if (parts === null || parts.prerelease === DEV_BUILD_SUFFIX) {
    return null;
  }
  return { tag, major: parts.major, patch: parts.patch };
}

export function editionFromTag(tag: string): Edition | null {
  const parts = tagParts(tag);
  return parts === null ? null : parts.edition;
}
