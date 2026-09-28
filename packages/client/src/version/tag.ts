import { z } from "zod";

export const ReleaseVersion = z.object({
  kind: z.literal("release"),
  tag: z.string(),
  major: z.number().int().nonnegative(),
  patch: z.number().int().nonnegative(),
});
export type ReleaseVersion = z.infer<typeof ReleaseVersion>;

// Master and local builds report a tag that names no release (`vUNKNOWN`, `vLOCAL_DEV`,
// `v0.1.0-SNAPSHOT`). Nothing but an unreleased build does, and such a build is ahead of every
// release, so it carries the newest behaviour rather than an unknown one.
export const DevelopmentBuild = z.object({
  kind: z.literal("development"),
  tag: z.string(),
});
export type DevelopmentBuild = z.infer<typeof DevelopmentBuild>;

export const ServerVersion = z.discriminatedUnion("kind", [ReleaseVersion, DevelopmentBuild]);
export type ServerVersion = z.infer<typeof ServerVersion>;

export const Edition = z.enum(["oss", "ee"]);
export type Edition = z.infer<typeof Edition>;

// Metabase's build stamps the edition into the leading number: an OSS jar is tagged `v0.<major>.<patch>`
// and an EE jar `v1.<major>.<patch>`, released and `-SNAPSHOT` alike, with an optional fourth number on
// a hotfix (`v0.62.19.5`) — so the tag is not semver, and a semver parser refuses a real release. A tag
// that fits neither shape (`vUNKNOWN`, `vLOCAL_DEV`) says nothing about the edition.
const TAG = /^v?([01])\.(\d+)\.(\d+)(?:\.\d+)?(?:-([0-9A-Za-z.-]+))?$/;
const OSS_EDITION_NUMBER = "0";

// A `-SNAPSHOT` jar fits the release shape, but only an unreleased build reports one.
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

export function parseTag(tag: string): ServerVersion {
  const parts = tagParts(tag);
  if (parts === null || parts.prerelease === DEV_BUILD_SUFFIX) {
    return { kind: "development", tag };
  }
  return { kind: "release", tag, major: parts.major, patch: parts.patch };
}

export function editionFromTag(tag: string): Edition | null {
  const parts = tagParts(tag);
  return parts === null ? null : parts.edition;
}

export function describeVersion(version: ServerVersion): string {
  return version.kind === "release" ? version.tag : `development build ${version.tag}`;
}

// A persisted version is re-derived from its tag, so a record written under older placement rules
// reads the way this client places the tag today.
export const StoredServerVersion = z
  .object({ tag: z.string() })
  .loose()
  .transform(({ tag }) => parseTag(tag));
