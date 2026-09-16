import { KNOWN_RANGE, Skew } from "@metabase/client/version/profile";

import { EMPTY_CELL } from "../../output/table";

const SKEW_LABEL: Readonly<Record<Skew, string>> = Object.freeze({
  supported: "supported",
  "newer-than-known": `newer than this CLI knows (v${KNOWN_RANGE.max} max)`,
  unknown: "unknown version",
});

function pickProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || !(key in value)) {
    return undefined;
  }
  const inner: unknown = Reflect.get(value, key);
  return inner;
}

function pickString(value: unknown, key: string): string | null {
  const inner = pickProperty(value, key);
  return typeof inner === "string" ? inner : null;
}

function pickBoolean(value: unknown, key: string): boolean | null {
  const inner = pickProperty(value, key);
  return typeof inner === "boolean" ? inner : null;
}

export function renderUserName(value: unknown): string {
  return pickString(value, "name") ?? EMPTY_CELL;
}

export function renderUserRole(value: unknown): string {
  const isAdmin = pickBoolean(value, "isAdmin");
  if (isAdmin === null) {
    return EMPTY_CELL;
  }
  return isAdmin ? "Admin" : "User";
}

export function renderAuthMethod(value: unknown): string {
  if (value === "oauth") {
    return "OAuth";
  }
  if (value === "apiKey") {
    return "API key";
  }
  return EMPTY_CELL;
}

export function renderVersionTag(value: unknown): string {
  return pickString(value, "tag") ?? EMPTY_CELL;
}

export function renderTimestamp(value: unknown): string {
  return typeof value === "string" ? value : EMPTY_CELL;
}

export function renderSkew(value: unknown): string {
  const parsed = Skew.safeParse(value);
  return parsed.success ? SKEW_LABEL[parsed.data] : EMPTY_CELL;
}
