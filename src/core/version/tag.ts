import { MetabaseError } from "../errors";

const VERSION_TAG_REGEX = /^v?(?<flavor>[01])\.(?<major>\d+)\.(?<patch>\d+)/;

export type Build = "oss" | "ee";

export interface ParsedVersion {
  readonly tag: string;
  readonly build: Build;
  readonly major: number;
  readonly patch: number;
}

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

export function parseTag(tag: string): ParsedVersion {
  const groups = VERSION_TAG_REGEX.exec(tag)?.groups;
  const flavor = groups?.["flavor"];
  const major = groups?.["major"];
  const patch = groups?.["patch"];
  if (flavor === undefined || major === undefined || patch === undefined) {
    throw new VersionTagParseError(tag);
  }
  return {
    tag,
    build: flavor === "1" ? "ee" : "oss",
    major: Number.parseInt(major, 10),
    patch: Number.parseInt(patch, 10),
  };
}
