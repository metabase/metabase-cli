import { ConfigError } from "@metabase/client/errors";
import { resolveFormat } from "../output/format";
import { DEFAULT_MAX_BYTES, type Format, type ListRange } from "../output/types";
import { parseCsv } from "../runtime/csv";

import type { connectionFlags, listFlags, outputFlags, profileFlag } from "./flags";
import { parseInteger, parseOptionalInteger } from "./parse-integer";

type FlagValue<T> = T extends { type: "boolean" }
  ? boolean
  : T extends { type: "string" }
    ? string
    : never;

type AllKnownFlags = typeof outputFlags &
  typeof profileFlag &
  typeof connectionFlags &
  typeof listFlags;

export type CommonArgs = {
  -readonly [K in keyof AllKnownFlags]?: FlagValue<AllKnownFlags[K]>;
};

export interface CommonContext {
  format: Format;
  full: boolean;
  fields: string[] | undefined;
  maxBytes: number;
  range: ListRange;
  url: string | undefined;
  apiKey: string | undefined;
  profile: string | undefined;
  skipPreflight: boolean;
}

interface ResolveOptions {
  isTty?: boolean;
}

// Resolvable on its own so an error reporter can learn the output format before any other flag
// has been parsed: every other resolver below can throw, and a config error that escapes them
// still has to be serialized in the shape the caller asked for.
export function resolveOutputFormat(args: CommonArgs, options: ResolveOptions = {}): Format {
  return resolveFormat({
    json: args.json,
    format: args.format,
    isTty: options.isTty ?? Boolean(process.stdout.isTTY),
  });
}

export function resolveCommonFlags(args: CommonArgs, options: ResolveOptions = {}): CommonContext {
  const fields = parseFields(args.fields);
  const full = args.full === true;
  if (full && fields !== undefined) {
    throw new ConfigError("--full conflicts with --fields (use one or neither)");
  }
  return {
    format: resolveOutputFormat(args, options),
    full,
    fields,
    maxBytes: parseMaxBytes(args.maxBytes),
    range: parseRange(args.limit, args.offset),
    url: args.url,
    apiKey: args.apiKey,
    profile: args.profile,
    skipPreflight: args.skipPreflight === true,
  };
}

function parseFields(value: string | undefined): string[] | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const parts = parseCsv(value);
  return parts.length > 0 ? parts : undefined;
}

function parseMaxBytes(value: string | undefined): number {
  return parseInteger(value ?? String(DEFAULT_MAX_BYTES), { name: "--max-bytes", min: 0 });
}

function parseRange(limit: string | undefined, offset: string | undefined): ListRange {
  const parsedLimit = parseOptionalInteger(limit, { name: "--limit", min: 1 });
  return {
    offset: parseInteger(offset ?? "0", { name: "--offset", min: 0 }),
    limit: parsedLimit === null ? undefined : parsedLimit,
  };
}
