import { ConfigError } from "../core/errors";
import { resolveFormat } from "../output/format";
import { DEFAULT_MAX_BYTES, type Detail, type Format } from "../output/types";
import type { connectionFlags, outputFlags, profileFlag } from "./flags";

type FlagValue<T> = T extends { type: "boolean" }
  ? boolean
  : T extends { type: "string" }
    ? string
    : never;

type AllKnownFlags = typeof outputFlags & typeof profileFlag & typeof connectionFlags;

export type CommonArgs = {
  -readonly [K in keyof AllKnownFlags]?: FlagValue<AllKnownFlags[K]>;
};

export interface CommonContext {
  format: Format;
  detail: Detail;
  fields: string[] | undefined;
  maxBytes: number;
  url: string | undefined;
  apiKey: string | undefined;
  profile: string | undefined;
}

export interface ResolveOptions {
  isTty?: boolean;
}

const INTEGER_PATTERN = /^-?\d+$/;

export function resolveCommonFlags(args: CommonArgs, options: ResolveOptions = {}): CommonContext {
  const isTty = options.isTty ?? Boolean(process.stdout.isTTY);
  return {
    format: resolveFormat({ json: args.json, format: args.format, isTty }),
    detail: resolveDetail(args.detail),
    fields: parseFields(args.fields),
    maxBytes: parseMaxBytes(args.maxBytes),
    url: args.url,
    apiKey: args.apiKey,
    profile: args.profile,
  };
}

function resolveDetail(detail: string | undefined): Detail {
  const value = detail ?? "compact";
  if (value === "compact" || value === "full" || value === "fields") {
    return value;
  }
  throw new ConfigError(`invalid --detail value: "${value}" (expected: compact, full, fields)`);
}

function parseFields(value: string | undefined): string[] | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
}

function parseMaxBytes(value: string | undefined): number {
  const raw = value ?? String(DEFAULT_MAX_BYTES);
  if (!INTEGER_PATTERN.test(raw)) {
    throw new ConfigError(`invalid --max-bytes value: "${raw}" (expected non-negative integer)`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (parsed < 0) {
    throw new ConfigError(`invalid --max-bytes value: ${parsed} (must be non-negative)`);
  }
  return parsed;
}
