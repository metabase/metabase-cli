import { DEFAULT_MAX_BYTES } from "../output/types";

export const outputFlags = {
  format: { type: "string", description: "auto | json | text", default: "auto" },
  json: { type: "boolean", description: "Shorthand for --format json" },
  full: {
    type: "boolean",
    description: "Return the full object (default: compact)",
  },
  fields: {
    type: "string",
    description: "Dot-paths, comma separated (mutually exclusive with --full)",
  },
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
    description: "Skip the server version capability check for this command",
    alias: "skip-preflight",
  },
} as const;
