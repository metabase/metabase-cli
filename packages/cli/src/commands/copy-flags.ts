import type { FlagValues } from "./flag-values";

import { ConfigError } from "@metabase/client/errors";

import { parseOptionalInteger } from "./parse-integer";

export const copyFlags = {
  name: { type: "string", description: "Name for the copy (default: the source name)" },
  "collection-id": { type: "string", description: "Collection to copy into (default: root)" },
  "collection-position": {
    type: "string",
    description: "Pin the copy at this position in the collection",
  },
} as const;

interface CopyTarget {
  name: string | undefined;
  collection_id: number | null;
  collection_position: number | null;
}

export function parseCopyFlags(args: FlagValues<typeof copyFlags>): CopyTarget {
  return {
    name: parseCopyName(args.name),
    collection_id: parseOptionalInteger(args["collection-id"], { name: "--collection-id", min: 1 }),
    collection_position: parseOptionalInteger(args["collection-position"], {
      name: "--collection-position",
      min: 1,
    }),
  };
}

function parseCopyName(name: string | undefined): string | undefined {
  if (name !== undefined && name.trim() === "") {
    throw new ConfigError("invalid --name: must not be blank");
  }
  return name;
}
