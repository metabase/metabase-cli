import { z } from "zod";

import type { ResourceView } from "./view";

const VERSION_TAG_REGEX = /^v?(?<flavor>[01])\.(?<major>\d+)\.(?<patch>\d+)/;

export const ServerVersion = z
  .object({
    tag: z.string(),
    date: z.string().optional(),
    hash: z.string().optional(),
  })
  .loose();
export type ServerVersion = z.infer<typeof ServerVersion>;

export const TokenFeatures = z.record(z.string(), z.boolean());
export type TokenFeatures = z.infer<typeof TokenFeatures>;

export const SessionProperties = z
  .object({
    version: ServerVersion,
    "token-features": TokenFeatures.optional(),
  })
  .loose();
export type SessionProperties = z.infer<typeof SessionProperties>;

export const SessionPropertiesCompact = SessionProperties.pick({
  version: true,
  "token-features": true,
}).strip();
export type SessionPropertiesCompact = z.infer<typeof SessionPropertiesCompact>;

export const sessionPropertiesView: ResourceView<SessionProperties> = {
  compactPick: SessionPropertiesCompact,
  tableColumns: [
    { key: "version", label: "Version" },
    { key: "token-features", label: "Token features" },
  ],
};

export type Build = "oss" | "ee";

export interface ParsedVersion {
  tag: string;
  build: Build;
  major: number;
  patch: number;
}

export class VersionTagParseError extends Error {
  constructor(tag: string) {
    super(`Unrecognized Metabase version tag: ${JSON.stringify(tag)} (expected v0.X.Y or v1.X.Y)`);
    this.name = "VersionTagParseError";
  }
}

export function parseTag(tag: string): ParsedVersion {
  const match = VERSION_TAG_REGEX.exec(tag);
  const groups = match?.groups;
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
