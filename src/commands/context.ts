import { ConfigError } from "../core/errors";
import { resolveFormat } from "../output/format";
import { DEFAULT_MAX_BYTES, type Format } from "../output/types";
import { parseCsv } from "../runtime/csv";

import type { connectionFlags, outputFlags, profileFlag } from "./flags";
import { parseInteger } from "./parse-integer";

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
  full: boolean;
  fields: string[] | undefined;
  maxBytes: number;
  url: string | undefined;
  apiKey: string | undefined;
  profile: string | undefined;
}

export interface ResolveOptions {
  isTty?: boolean;
}

export function resolveCommonFlags(args: CommonArgs, options: ResolveOptions = {}): CommonContext {
  const isTty = options.isTty ?? Boolean(process.stdout.isTTY);
  const fields = parseFields(args.fields);
  const full = args.full === true;
  if (full && fields !== undefined) {
    throw new ConfigError("--full conflicts with --fields (use one or neither)");
  }
  return {
    format: resolveFormat({ json: args.json, format: args.format, isTty }),
    full,
    fields,
    maxBytes: parseMaxBytes(args.maxBytes),
    url: args.url,
    apiKey: args.apiKey,
    profile: args.profile,
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
