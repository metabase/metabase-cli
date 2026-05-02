import { DEFAULT_MAX_BYTES } from "../output/types";

export const outputFlags = {
  format: { type: "string", description: "auto | json | text", default: "auto" },
  json: { type: "boolean", description: "Shorthand for --format json" },
  detail: { type: "string", description: "compact | full | fields", default: "compact" },
  fields: {
    type: "string",
    description: "Dot-paths, comma separated (with --detail fields)",
  },
  maxBytes: {
    type: "string",
    description: "Output size cap; 0 disables",
    default: String(DEFAULT_MAX_BYTES),
    alias: "max-bytes",
  },
} as const;

export const profileFlag = {
  profile: { type: "string", description: "Named profile (default: 'default')" },
} as const;

export const connectionFlags = {
  url: { type: "string", description: "Metabase URL" },
  apiKey: { type: "string", description: "API key", alias: "api-key" },
} as const;
