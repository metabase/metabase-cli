import type { StringArgDef } from "citty";

import { DEFAULT_MAX_BYTES } from "../output/types";
import type { ListMarker } from "../runtime/citty";

interface ListFlagDef extends StringArgDef {
  type: "string";
}

// citty's arg type does not declare the marker, and a generic args object skips excess-property
// checks, so a mistyped key would compile and silently drop the flag from the list check. This is
// the one place the marker is written.
export function listFlag<const T extends ListFlagDef>(def: T): T & ListMarker {
  return { ...def, list: true };
}

// A command whose output is always the server's JSON as-is has nothing to project or cap, so it
// takes only the format pair, which still picks the shape of an error report.
export const formatFlags = {
  format: { type: "string", description: "auto | json | text", default: "auto" },
  json: { type: "boolean", description: "Shorthand for --format json" },
} as const;

export const outputFlags = {
  ...formatFlags,
  full: {
    type: "boolean",
    description: "Return the full object (default: compact)",
  },
  fields: listFlag({
    type: "string",
    description: "Dot-paths, comma separated (mutually exclusive with --full)",
  }),
  maxBytes: {
    type: "string",
    description: "Output size cap; 0 disables",
    default: String(DEFAULT_MAX_BYTES),
    alias: "max-bytes",
  },
} as const;

export const listFlags = {
  limit: {
    type: "string",
    description: "Max items to return (default: as many as fit the output cap)",
  },
  offset: {
    type: "string",
    description: "Start at this item index; pass the previous run's next_offset to continue",
    default: "0",
  },
} as const;

// An endpoint whose unbounded read is expensive caps itself, so its `--limit` carries a real
// default. The shared description promises the output cap is the only bound, which would be a
// lie for such a command, and the `default` key is what `--help --json` shows an agent.
export function listFlagsWithDefaultLimit(defaultLimit: number) {
  return {
    ...listFlags,
    limit: {
      type: "string",
      description: "Max items to return",
      default: String(defaultLimit),
    },
  } as const;
}

export const profileFlag = {
  profile: { type: "string", description: "Named profile (default: 'default')", alias: "p" },
} as const;

export const connectionFlags = {
  url: { type: "string", description: "Metabase URL" },
  apiKey: { type: "string", description: "API key", alias: "api-key" },
  skipPreflight: {
    type: "boolean",
    description:
      "Skip the client's version and license checks made before a request, and let the server answer",
    alias: "skip-preflight",
  },
} as const;
